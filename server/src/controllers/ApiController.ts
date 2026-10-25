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
import HomeController from "./HomeController.ts";
import SearchController from "./SearchController.ts";
import CollectionsController from "./CollectionsController.ts";
import PeopleController from "./PeopleController.ts";
import PlaybackController from "./PlaybackController.ts";
import SubtitlesController from "./SubtitlesController.ts";
import TogetherController from "./TogetherController.ts";
import AdminController from "./AdminController.ts";
import IntegrationsController from "./IntegrationsController.ts";
import WebhooksController from "./WebhooksController.ts";
import MusicController from "./MusicController.ts";
import PlaylistsController from "./PlaylistsController.ts";
import BooksController from "./BooksController.ts";
import PhotosController from "./PhotosController.ts";
import ClipsController from "./ClipsController.ts";
import PodiumController from "./PodiumController.ts";
import TraktController from "./TraktController.ts";
import DownloadsController from "./DownloadsController.ts";
import UploadsController from "./UploadsController.ts";
import BackupsController from "./BackupsController.ts";
import WatchlistController from "./WatchlistController.ts";
import HttpsController from "./HttpsController.ts";
import NotificationsController from "./NotificationsController.ts";
import StatsController from "./StatsController.ts";
import UpkeepController from "./UpkeepController.ts";
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
  router.route("/home", HomeController.router);
  router.route("/search", SearchController.router);
  router.route("/collections", CollectionsController.router);
  router.route("/people", PeopleController.router);
  router.route("/playback", PlaybackController.router);
  router.route("/subtitles", SubtitlesController.router);
  router.route("/together", TogetherController.router);
  router.route("/admin", AdminController.router);
  router.route("/integrations", IntegrationsController.router);
  router.route("/webhooks", WebhooksController.router);
  router.route("/music", MusicController.router);
  router.route("/playlists", PlaylistsController.router);
  router.route("/books", BooksController.router);
  router.route("/photos", PhotosController.router);
  router.route("/clips", ClipsController.router);
  router.route("/podium", PodiumController.router);
  router.route("/trakt", TraktController.router);
  router.route("/downloads", DownloadsController.router);
  router.route("/uploads", UploadsController.router);
  router.route("/backups", BackupsController.router);
  router.route("/watchlist", WatchlistController.router);
  router.route("/https", HttpsController.router);
  router.route("/notifications", NotificationsController.router);
  router.route("/stats", StatsController.router);
  router.route("/upkeep", UpkeepController.router);

  router.all("*", (c) => c.json({ message: `There's no API endpoint at ${c.req.method} ${c.req.path}.` }, 404));
}

export default ApiController;
