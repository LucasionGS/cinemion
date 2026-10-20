import { type CreationOptional, DataTypes, type ForeignKey, type InferAttributes, type InferCreationAttributes, Model, type NonAttribute } from "sequelize";
import bcrypt from "bcryptjs";
import { sign, verify } from "hono/jwt";
import type { MiddlewareHandler } from "hono";
import type { CreateUserRequest, ProfileSummary, UserInfo } from "@shared/api.ts";
import { isProfileColor, type Permission, PROFILE_COLORS, type ProfileColor } from "@shared/profiles.ts";
import sequelize, { ID_TYPE, jsonColumn } from "./sequelize.ts";
import Role from "./Role.ts";
import AppSystem from "../AppSystem.ts";
import type { AppEnv } from "../lib/types.ts";

const TOKEN_LIFETIME = 60 * 60 * 24 * 30; // 30 days, in seconds

export class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
  declare id: CreationOptional<number>;
  declare username: string;
  declare name: string;
  /**
   * bcrypt hash. `null` = this profile can only be opened from the profile picker.
   */
  declare password: string | null;
  /**
   * bcrypt hash of the 4-digit PIN. `null` = no PIN.
   */
  declare pin: string | null;
  declare color: CreationOptional<ProfileColor>;
  /**
   * Version of the uploaded profile picture. `null` = no picture, use initials.
   */
  declare avatar: CreationOptional<string | null>;
  declare showOnPicker: CreationOptional<boolean>;
  /**
   * Highest content rating this user may watch. `null` = no limit.
   */
  declare maxRating: CreationOptional<string | null>;
  /**
   * Library ids this user can see. `null` = all libraries.
   */
  declare libraryAccess: CreationOptional<number[] | null>;
  declare roleId: ForeignKey<Role["id"]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  declare role?: NonAttribute<Role>;

  //#region Validation

  /**
   * Normalise and check a username.
   * @throws When it doesn't match the allowed format.
   */
  public static verifyUsername(username: string) {
    const normalised = username.trim().toLowerCase();
    if (!/^[a-z0-9._-]{2,32}$/.test(normalised)) {
      throw new Error(`Invalid username "${username}". Use 2 to 32 letters, numbers, dots, dashes or underscores.`);
    }
    return normalised;
  }

  /**
   * @throws When the PIN isn't exactly 4 digits.
   */
  public static verifyPin(pin: string) {
    if (!/^\d{4}$/.test(pin)) throw new Error("The PIN must be exactly 4 digits.");
    return pin;
  }

  /**
   * @throws When the password is too short.
   */
  public static verifyPassword(password: string) {
    if (password.length < 6) throw new Error("The password must be at least 6 characters long.");
    return password;
  }

  /**
   * @throws When the display name is empty or too long.
   */
  public static verifyName(name: string) {
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 40) throw new Error("The name must be between 1 and 40 characters long.");
    return trimmed;
  }

  /**
   * Turn a display name into a free username, like "Mira" → "mira" or "mira-2".
   */
  public static async suggestUsername(name: string) {
    const base = name.trim().toLowerCase().normalize("NFKD").replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28) || "user";
    let candidate = base.length >= 2 ? base : `${base}-user`;
    for (let i = 2; await User.findOne({ where: { username: candidate } }); i++) {
      candidate = `${base}-${i}`;
    }
    return candidate;
  }

  //#endregion

  //#region Factories and lookups

  /**
   * Validate and create a user.
   * @throws With a readable message when any value is invalid or the username is taken.
   */
  public static async registerUser(data: CreateUserRequest) {
    const name = User.verifyName(data.name);
    const username = data.username ? User.verifyUsername(data.username) : await User.suggestUsername(name);
    if (await User.findOne({ where: { username } })) throw new Error(`The username "${username}" is already taken.`);
    if (data.color !== undefined && !isProfileColor(data.color)) throw new Error(`Unknown profile colour "${data.color}".`);

    const role = await Role.getRoleByName(data.role ?? Role.USER);
    if (!role) throw new Error(`Unknown role "${data.role}".`);

    const user = await User.create({
      username,
      name,
      password: data.password ? await bcrypt.hash(User.verifyPassword(data.password), 10) : null,
      pin: data.pin ? await bcrypt.hash(User.verifyPin(data.pin), 10) : null,
      color: data.color ?? User.pickColor(await User.count()),
      showOnPicker: data.showOnPicker ?? true,
      maxRating: data.maxRating ?? null,
      libraryAccess: data.libraryAccess ?? null,
      roleId: role.id,
    });
    user.role = role;
    return user;
  }

  /**
   * Find a user by username and password. Returns `null` when either is wrong.
   */
  public static async authenticateUser(username: string, password: string) {
    const user = await User.findOne({ where: { username: username.trim().toLowerCase() } });
    if (!user || !(await user.checkPassword(password))) return null;
    return user;
  }

  /**
   * Give new profiles different colours by default.
   */
  public static pickColor(index: number): ProfileColor {
    const colors = Object.keys(PROFILE_COLORS) as ProfileColor[];
    return colors[index % colors.length];
  }

  //#endregion

  //#region Instance helpers

  public async checkPassword(password: string) {
    return this.password !== null && await bcrypt.compare(password, this.password);
  }

  public async checkPin(pin: string) {
    return this.pin !== null && await bcrypt.compare(pin, this.pin);
  }

  public async setPassword(password: string | null) {
    this.password = password === null ? null : await bcrypt.hash(User.verifyPassword(password), 10);
  }

  public async setPin(pin: string | null) {
    this.pin = pin === null ? null : await bcrypt.hash(User.verifyPin(pin), 10);
  }

  public isAdmin() {
    return this.role?.isAdmin() ?? false;
  }

  public async hasPermission(permission: Permission) {
    return this.role ? await this.role.hasPermission(permission) : false;
  }

  /**
   * Create a signed login token for this user.
   */
  public createToken() {
    const now = Math.floor(Date.now() / 1000);
    return sign({ sub: this.id, iat: now, exp: now + TOKEN_LIFETIME }, AppSystem.jwtSecret());
  }

  //#endregion

  //#region Serialisers

  /**
   * What the profile picker may show. Safe to send before anyone signs in.
   */
  public toProfileJSON(): ProfileSummary {
    return {
      id: this.id,
      name: this.name,
      color: this.color,
      avatar: this.avatar,
      hasPin: this.pin !== null,
      isAdmin: this.isAdmin(),
      maxRating: this.maxRating,
    };
  }

  /**
   * Full view for the user themselves and for admins. Never includes hashes.
   */
  public async toClientJSON(): Promise<UserInfo> {
    return {
      ...this.toProfileJSON(),
      username: this.username,
      hasPassword: this.password !== null,
      role: this.role?.name ?? Role.USER,
      permissions: this.role ? [...await this.role.getAllPermissions()] : [],
      showOnPicker: this.showOnPicker,
      libraryAccess: this.libraryAccess,
    };
  }

  public override toJSON() {
    return this.toProfileJSON();
  }

  //#endregion

  /**
   * The user a login token belongs to, or `null` when the token is invalid or expired.
   */
  public static async fromToken(token: string): Promise<User | null> {
    try {
      const payload = await verify(token, AppSystem.jwtSecret(), "HS256");
      return await User.findByPk(Number(payload.sub));
    } catch {
      return null;
    }
  }

  /**
   * Route middleware that reads the `Authorization: Bearer <token>` header and sets `c.get("user")`.
   * @param opts.required Reject requests without a valid token. Default is `true`.
   * @param opts.admin Only allow admins.
   * @param opts.permissions Permissions the user must all have. Admins pass every check.
   */
  public static $middleware(opts?: User.MiddlewareOptions): MiddlewareHandler<AppEnv> {
    opts ??= {};
    const { required = true, admin = false, permissions = [] } = opts;

    return async (c, next) => {
      const header = c.req.header("Authorization");
      const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
      let user: User | null = null;

      if (token) user = await User.fromToken(token);

      if (!user) {
        if (required) return c.json({ message: "You need to sign in first." }, 401);
        c.set("user", undefined);
        return next();
      }

      if (admin && !user.isAdmin()) {
        return c.json({ message: "Only admins can do this." }, 403);
      }
      for (const permission of permissions) {
        if (!(await user.hasPermission(permission))) {
          return c.json({ message: "You don't have permission to do this." }, 403);
        }
      }

      c.set("user", user);
      return next();
    };
  }
}

export namespace User {
  export interface MiddlewareOptions {
    required?: boolean;
    admin?: boolean;
    permissions?: Permission[];
  }
}

User.init({
  id: { type: ID_TYPE, autoIncrement: true, primaryKey: true },
  username: { type: DataTypes.STRING(32), allowNull: false, unique: true },
  name: { type: DataTypes.STRING(40), allowNull: false },
  password: { type: DataTypes.STRING, allowNull: true },
  pin: { type: DataTypes.STRING, allowNull: true },
  color: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "sky" },
  avatar: { type: DataTypes.STRING(32), allowNull: true, defaultValue: null },
  showOnPicker: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  maxRating: { type: DataTypes.STRING(16), allowNull: true, defaultValue: null },
  libraryAccess: jsonColumn<number[] | null, User>("libraryAccess", null, true),
  createdAt: DataTypes.DATE,
  updatedAt: DataTypes.DATE,
}, { sequelize, tableName: "users" });

export type UserAttributes = InferAttributes<User>;

export default User;
