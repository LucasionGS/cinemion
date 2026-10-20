import fsp from "node:fs/promises";
import { Hono } from "hono";
import type { CreateUserRequest, UpdateSelfRequest, UpdateUserRequest } from "@shared/api.ts";
import { AVATAR_SIZES, type AvatarSize, isProfileColor, normalizePreferences } from "@shared/profiles.ts";
import { Role, User } from "../models/index.ts";
import Avatars from "../lib/Avatars.ts";
import { errorMessage, readJson } from "../lib/http.ts";
import type { AppEnv } from "../lib/types.ts";

export namespace UsersController {
  export const router = new Hono<AppEnv>();

  const manage = User.$middleware({ permissions: ["USERS_MANAGE"] });

  async function countAdmins() {
    const admin = await Role.getRoleByName(Role.ADMIN);
    return admin ? await User.unscoped().count({ where: { roleId: admin.id } }) : 0;
  }

  /**
   * Can `actor` change `target`'s profile picture? Users can change their own, managers anyone's.
   */
  async function canEditAvatar(actor: User, target: User) {
    return actor.id === target.id || await actor.hasPermission("USERS_MANAGE");
  }

  /**
   * @swagger
   * /api/users:
   *   get:
   *     summary: Every user, for user management.
   */
  router.get("/", manage, async (c) => {
    const users = await User.findAll({ order: [["id", "ASC"]] });
    return c.json(await Promise.all(users.map((u) => u.toClientJSON())));
  });

  /**
   * @swagger
   * /api/users:
   *   post:
   *     summary: Create a user or profile.
   */
  router.post("/", manage, async (c) => {
    const body = await readJson<CreateUserRequest>(c);
    if (!body?.name) return c.json({ message: "A name is required." }, 400);
    if (body.role === Role.ADMIN && !c.get("user")!.isAdmin()) {
      return c.json({ message: "Only admins can create other admins." }, 403);
    }

    try {
      const user = await User.registerUser(body as CreateUserRequest);
      return c.json(await user.toClientJSON(), 201);
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 400);
    }
  });

  /**
   * @swagger
   * /api/users/me:
   *   patch:
   *     summary: Change your own name, colour, PIN or password.
   */
  router.patch("/me", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const body = await readJson<UpdateSelfRequest>(c);
    if (!body) return c.json({ message: "Nothing to change." }, 400);

    try {
      if (body.name !== undefined) user.name = User.verifyName(body.name);
      if (body.color !== undefined) {
        if (!isProfileColor(body.color)) return c.json({ message: `Unknown profile colour "${body.color}".` }, 400);
        user.color = body.color;
      }
      if (body.pin !== undefined) await user.setPin(body.pin);
      if (body.preferences !== undefined) user.preferences = normalizePreferences(body.preferences);
      if (body.newPassword !== undefined) {
        // Profiles without a password (picker-only) can set one without knowing an old one
        if (user.password !== null && !(await user.checkPassword(body.currentPassword ?? ""))) {
          return c.json({ message: "Your current password isn't right." }, 400);
        }
        await user.setPassword(body.newPassword);
      }
      await user.save();
      return c.json(await user.toClientJSON());
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 400);
    }
  });

  /**
   * @swagger
   * /api/users/{id}:
   *   patch:
   *     summary: Change any user's details.
   */
  router.patch("/:id", manage, async (c) => {
    const actor = c.get("user")!;
    const user = await User.findByPk(Number(c.req.param("id")));
    if (!user) return c.json({ message: "That user doesn't exist." }, 404);
    const body = await readJson<UpdateUserRequest>(c);
    if (!body) return c.json({ message: "Nothing to change." }, 400);

    try {
      if (body.name !== undefined) user.name = User.verifyName(body.name);
      if (body.username !== undefined) {
        const username = User.verifyUsername(body.username);
        const taken = await User.findOne({ where: { username } });
        if (taken && taken.id !== user.id) return c.json({ message: `The username "${username}" is already taken.` }, 400);
        user.username = username;
      }
      if (body.color !== undefined) {
        if (!isProfileColor(body.color)) return c.json({ message: `Unknown profile colour "${body.color}".` }, 400);
        user.color = body.color;
      }
      if (body.password !== undefined) await user.setPassword(body.password || null);
      if (body.pin !== undefined) await user.setPin(body.pin);
      if (body.showOnPicker !== undefined) user.showOnPicker = !!body.showOnPicker;
      if (body.maxRating !== undefined) user.maxRating = body.maxRating;
      if (body.libraryAccess !== undefined) user.libraryAccess = body.libraryAccess;
      if (body.role !== undefined && body.role !== user.role?.name) {
        if (!actor.isAdmin()) return c.json({ message: "Only admins can change roles." }, 403);
        const role = await Role.getRoleByName(body.role);
        if (!role) return c.json({ message: `Unknown role "${body.role}".` }, 400);
        if (user.isAdmin() && !role.isAdmin() && await countAdmins() <= 1) {
          return c.json({ message: "This is the only admin. Make someone else an admin first." }, 400);
        }
        user.roleId = role.id;
        user.role = role;
      }
      await user.save();
      return c.json(await user.toClientJSON());
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 400);
    }
  });

  /**
   * @swagger
   * /api/users/{id}:
   *   delete:
   *     summary: Delete a user and their profile picture.
   */
  router.delete("/:id", manage, async (c) => {
    const actor = c.get("user")!;
    const user = await User.findByPk(Number(c.req.param("id")));
    if (!user) return c.json({ message: "That user doesn't exist." }, 404);
    if (user.id === actor.id) return c.json({ message: "You can't delete your own account." }, 400);
    if (user.isAdmin() && !actor.isAdmin()) return c.json({ message: "Only admins can delete admins." }, 403);
    if (user.isAdmin() && await countAdmins() <= 1) return c.json({ message: "You can't delete the only admin." }, 400);

    await Avatars.remove(user.id);
    await user.destroy();
    return c.body(null, 204);
  });

  //#region Profile pictures

  /**
   * @swagger
   * /api/users/{id}/avatar:
   *   put:
   *     summary: Upload a profile picture (multipart field "file"). It's cropped square and stored in every size.
   */
  router.put("/:id/avatar", User.$middleware(), async (c) => {
    const actor = c.get("user")!;
    const user = await User.findByPk(Number(c.req.param("id")));
    if (!user) return c.json({ message: "That user doesn't exist." }, 404);
    if (!(await canEditAvatar(actor, user))) return c.json({ message: "You can only change your own profile picture." }, 403);

    const declared = Number(c.req.header("Content-Length") ?? 0);
    if (declared > Avatars.MAX_UPLOAD_BYTES + 64 * 1024) return c.json({ message: "The picture is too large. The limit is 10 MB." }, 413);

    const body = await c.req.parseBody().catch(() => null);
    const file = body?.["file"];
    if (!(file instanceof File)) return c.json({ message: "Send the picture as a \"file\" field in a multipart form." }, 400);

    try {
      user.avatar = await Avatars.save(user.id, new Uint8Array(await file.arrayBuffer()));
      await user.save();
      return c.json(await user.toClientJSON());
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 400);
    }
  });

  /**
   * @swagger
   * /api/users/{id}/avatar:
   *   delete:
   *     summary: Remove the profile picture and go back to initials.
   */
  router.delete("/:id/avatar", User.$middleware(), async (c) => {
    const actor = c.get("user")!;
    const user = await User.findByPk(Number(c.req.param("id")));
    if (!user) return c.json({ message: "That user doesn't exist." }, 404);
    if (!(await canEditAvatar(actor, user))) return c.json({ message: "You can only change your own profile picture." }, 403);

    await Avatars.remove(user.id);
    user.avatar = null;
    await user.save();
    return c.json(await user.toClientJSON());
  });

  /**
   * @swagger
   * /api/users/{id}/avatar/{version}/{size}:
   *   get:
   *     summary: A stored profile picture. Public, since the profile picker shows them before sign-in.
   */
  router.get("/:id/avatar/:version/:size", async (c) => {
    const id = Number(c.req.param("id"));
    const version = c.req.param("version");
    const size = Number(c.req.param("size")) as AvatarSize;
    if (!Number.isInteger(id) || !/^[0-9a-f]{6,32}$/.test(version) || !AVATAR_SIZES.includes(size)) {
      return c.json({ message: "Unknown profile picture." }, 404);
    }

    const data = await fsp.readFile(Avatars.pathFor(id, version, size)).catch(() => null);
    if (!data) return c.json({ message: "Unknown profile picture." }, 404);
    // The version is part of the URL, so a picture at a given URL never changes
    return c.body(new Uint8Array(data), 200, {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
    });
  });

  //#endregion
}

export default UsersController;
