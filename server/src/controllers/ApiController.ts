import { Hono } from "hono";
import ServerController from "./ServerController.ts";
import SetupController from "./SetupController.ts";
import AuthController from "./AuthController.ts";
import ProfilesController from "./ProfilesController.ts";
import UsersController from "./UsersController.ts";
import LibrariesController from "./LibrariesController.ts";
import FilesystemController from "./FilesystemController.ts";
import ItemsController from "./ItemsController.ts";
import ImagesController from "./ImagesController.ts";
import SettingsController from "./SettingsController.ts";
import type { AppEnv } from "../lib/types.ts";

/**
 * Mounts every resource controller under `/api`.
 */
export namespace ApiController {
  export const router = new Hono<AppEnv>();

  router.route("/server", ServerController.router);
  router.route("/setup", SetupController.router);
  router.route("/auth", AuthController.router);
  router.route("/profiles", ProfilesController.router);
  router.route("/users", UsersController.router);
  router.route("/libraries", LibrariesController.router);
  router.route("/fs", FilesystemController.router);
  router.route("/items", ItemsController.router);
  router.route("/images", ImagesController.router);
  router.route("/settings", SettingsController.router);

  router.all("*", (c) => c.json({ message: `There's no API endpoint at ${c.req.method} ${c.req.path}.` }, 404));
}

export default ApiController;
