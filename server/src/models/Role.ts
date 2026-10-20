import { type CreationOptional, DataTypes, type InferAttributes, type InferCreationAttributes, Model, type NonAttribute } from "sequelize";
import type { Permission } from "@shared/profiles.ts";
import sequelize, { ID_TYPE, jsonColumn } from "./sequelize.ts";

export class Role extends Model<InferAttributes<Role>, InferCreationAttributes<Role>> {
  declare id: CreationOptional<number>;
  declare name: string;
  declare permissions: CreationOptional<Permission[]>;
  /**
   * Role this one inherits permissions from. `null` = none.
   */
  declare inheritsId: CreationOptional<number | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  declare inherits?: NonAttribute<Role>;

  public static readonly ADMIN = "admin";
  public static readonly USER = "user";

  public static getRoleByName(name: string) {
    return Role.findOne({ where: { name } });
  }

  public isAdmin() {
    return this.name === Role.ADMIN;
  }

  /**
   * All permissions of this role, including the ones it inherits.
   */
  public async getAllPermissions(): Promise<Set<Permission>> {
    const permissions = new Set<Permission>(this.permissions);
    const seen = new Set<number>([this.id]);
    // Walk up the inheritance chain, stopping on loops
    let parentId = this.inheritsId;
    while (parentId !== null && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = await Role.findByPk(parentId);
      if (!parent) break;
      parent.permissions.forEach((p) => permissions.add(p));
      parentId = parent.inheritsId;
    }
    return permissions;
  }

  /**
   * Check whether this role grants `permission`. Admins pass every check.
   */
  public async hasPermission(permission: Permission) {
    return this.isAdmin() || (await this.getAllPermissions()).has(permission);
  }
}

Role.init({
  id: { type: ID_TYPE, autoIncrement: true, primaryKey: true },
  name: { type: DataTypes.STRING(64), allowNull: false, unique: true },
  permissions: jsonColumn<Permission[], Role>("permissions", []),
  inheritsId: { type: ID_TYPE, allowNull: true, defaultValue: null },
  createdAt: DataTypes.DATE,
  updatedAt: DataTypes.DATE,
}, { sequelize, tableName: "roles" });

export type RoleAttributes = InferAttributes<Role>;

export default Role;
