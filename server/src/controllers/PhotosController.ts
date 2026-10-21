import Path from "node:path";
import { Hono } from "hono";
import { Op, type Order, type WhereOptions } from "sequelize";
import type { CreatePhotoAlbumRequest, PhotoAlbumDetail, PhotoAlbumSort, PhotoAlbumSummary, PhotoDetail, PhotoPage, PhotosOverview, UpdatePhotoAlbumRequest } from "@shared/photos.ts";
import { Library, MediaFile, MediaItem, PhotoAlbum, PhotoAlbumItem, User } from "../models/index.ts";
import Visibility from "../library/Visibility.ts";
import VideoDetails from "../library/VideoDetails.ts";
import FolderTree from "../library/FolderTree.ts";
import PhotoSummaries from "../photos/PhotoSummaries.ts";
import PhotoLibrary from "../photos/PhotoLibrary.ts";
import StreamGrants from "../media/StreamGrants.ts";
import { errorMessage, readJson, sendFile } from "../lib/http.ts";
import type { AppEnv } from "../lib/types.ts";

/**
 * Browsing Photos libraries: albums (folders and hand-made ones), photos and videos by date, and the full-size
 * pictures for the viewer.
 */
export namespace PhotosController {
  export const router = new Hono<AppEnv>();

  const PAGE_LIMIT = 500;
  const MAX_ALBUM_ADD = 5000;
  const DESCRIPTION_LIMIT = 5000;
  const MEDIA_TYPES = ["photo", "video"];
  const manage = User.$middleware({ permissions: ["LIBRARY_MANAGE"] });

  async function photosLibrary(user: User, id: number) {
    const library = await Library.findByPk(id);
    return library?.type === "photos" && Visibility.canSeeLibrary(user, library.id) ? library : null;
  }

  async function visibleFolder(user: User, id: number) {
    const folder = await MediaItem.findByPk(id);
    if (!folder || folder.type !== "folder" || !Visibility.canSee(user, folder)) return null;
    return (await Library.findByPk(folder.libraryId))?.type === "photos" ? folder : null;
  }

  async function visibleAlbum(user: User, id: number) {
    const album = await PhotoAlbum.findByPk(id);
    return album && Visibility.canSeeLibrary(user, album.libraryId) ? album : null;
  }

  function paging(c: { req: { query(name: string): string | undefined } }) {
    return {
      limit: Math.min(Math.max(parseInt(c.req.query("limit") ?? "200") || 200, 1), PAGE_LIMIT),
      offset: Math.max(parseInt(c.req.query("offset") ?? "0") || 0, 0),
    };
  }

  /**
   * Oldest first reads like a story inside an album; the library's own lists start with the newest.
   */
  function byDate(direction: "ASC" | "DESC"): Order {
    return [["takenAt", direction], ["sortTitle", "ASC"], ["id", "ASC"]];
  }

  async function page(user: User, where: WhereOptions<MediaItem>, order: Order, opts: { limit: number; offset: number }): Promise<PhotoPage> {
    const { rows, count } = await MediaItem.findAndCountAll({ where: { [Op.and]: [Visibility.where(user), { type: MEDIA_TYPES }, where] }, order, ...opts });
    return { items: await PhotoSummaries.photos(rows), total: count };
  }

  function sortAlbums(albums: PhotoAlbumSummary[], sort: PhotoAlbumSort) {
    const title = (a: PhotoAlbumSummary, b: PhotoAlbumSummary) => a.title.localeCompare(b.title, undefined, { numeric: true });
    if (sort === "title") return albums.sort(title);
    if (sort === "oldest") return albums.sort((a, b) => (a.from ?? "9999").localeCompare(b.from ?? "9999") || title(a, b));
    return albums.sort((a, b) => (b.to ?? "").localeCompare(a.to ?? "") || title(a, b));
  }

  /**
   * Photos and videos from `ids` that `user` may see and that are in `libraryId`.
   */
  async function usableItems(user: User, libraryId: number, ids: unknown) {
    const list = Array.isArray(ids) ? [...new Set(ids.filter((id): id is number => Number.isInteger(id)))].slice(0, MAX_ALBUM_ADD) : [];
    if (list.length === 0) return [];
    return await MediaItem.findAll({ where: { [Op.and]: [Visibility.where(user), { id: list, libraryId, type: MEDIA_TYPES }] }, attributes: ["id"] });
  }

  //#region Libraries

  /**
   * @swagger
   * /api/photos/libraries/{id}:
   *   get:
   *     summary: A Photos library's albums (top-level folders and hand-made albums) and counts. Query `sort` (newest, oldest, title).
   */
  router.get("/libraries/:id", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const library = await photosLibrary(user, Number(c.req.param("id")));
    if (!library) return c.json({ message: "That library doesn't exist." }, 404);
    const sort = (["newest", "oldest", "title"].includes(c.req.query("sort") ?? "") ? c.req.query("sort") : "newest") as PhotoAlbumSort;

    const folders = await MediaItem.findAll({ where: { [Op.and]: [Visibility.where(user), { libraryId: library.id, type: "folder", parentId: null }] } });
    const made = await PhotoAlbum.findAll({ where: { libraryId: library.id } });
    const albums = [
      ...(await PhotoSummaries.folders(folders, user)).filter((a) => a.photoCount + a.videoCount > 0),
      // A new album is empty, so its maker still sees it
      ...(await PhotoSummaries.albums(made, user)).filter((a) => a.photoCount + a.videoCount > 0 || a.owner?.id === user.id),
    ];
    const count = (where: WhereOptions<MediaItem>) => MediaItem.count({ where: { [Op.and]: [Visibility.where(user), { libraryId: library.id }, where] } });
    const overview: PhotosOverview = {
      photoCount: await count({ type: "photo" }),
      videoCount: await count({ type: "video" }),
      looseCount: await count({ type: MEDIA_TYPES, parentId: null }),
      albums: sortAlbums(albums, sort),
    };
    return c.json(overview);
  });

  /**
   * @swagger
   * /api/photos/libraries/{id}/items:
   *   get:
   *     summary: Photos and videos of a library, newest first. Query `scope` (all, or loose for those outside every folder), `offset`, `limit`.
   */
  router.get("/libraries/:id/items", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const library = await photosLibrary(user, Number(c.req.param("id")));
    if (!library) return c.json({ message: "That library doesn't exist." }, 404);
    const where = c.req.query("scope") === "loose" ? { libraryId: library.id, parentId: null } : { libraryId: library.id };
    return c.json(await page(user, where, byDate("DESC"), paging(c)));
  });
  //#endregion

  //#region Folders

  /**
   * @swagger
   * /api/photos/folders/{id}:
   *   get:
   *     summary: A folder in a Photos library, with the folders above and inside it.
   */
  router.get("/folders/:id", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const folder = await visibleFolder(user, Number(c.req.param("id")));
    if (!folder) return c.json({ message: "That album doesn't exist." }, 404);
    const tree = await FolderTree.load([folder.libraryId]);
    const [summary] = await PhotoSummaries.folders([folder], user, tree);
    const children = await MediaItem.findAll({ where: { [Op.and]: [Visibility.where(user), { parentId: folder.id, type: "folder" }] } });
    const albums = (await PhotoSummaries.folders(children, user, tree)).filter((a) => a.photoCount + a.videoCount > 0);
    const detail: PhotoAlbumDetail = {
      ...summary,
      description: folder.overview,
      folders: await VideoDetails.ancestors(folder),
      albums: sortAlbums(albums, "oldest"),
      canEdit: await user.hasPermission("LIBRARY_MANAGE"),
    };
    return c.json(detail);
  });

  /**
   * @swagger
   * /api/photos/folders/{id}/items:
   *   get:
   *     summary: Photos and videos directly in a folder, oldest first, or with `all=1` everything in its subfolders too (for slideshows). Query `offset`, `limit`.
   */
  router.get("/folders/:id/items", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const folder = await visibleFolder(user, Number(c.req.param("id")));
    if (!folder) return c.json({ message: "That album doesn't exist." }, 404);
    const parents = c.req.query("all") === "1" ? (await FolderTree.load([folder.libraryId])).foldersUnder(folder.id) : [folder.id];
    return c.json(await page(user, { parentId: parents }, byDate("ASC"), paging(c)));
  });

  /**
   * @swagger
   * /api/photos/folders/{id}/cover:
   *   put:
   *     summary: Use a photo inside the folder as its cover. Body `{ "itemId": 12 }`, or `{ "itemId": null }` for the automatic one.
   */
  router.put("/folders/:id/cover", manage, async (c) => {
    const user = c.get("user")!;
    const folder = await visibleFolder(user, Number(c.req.param("id")));
    if (!folder) return c.json({ message: "That album doesn't exist." }, 404);
    const body = await readJson<{ itemId: number | null }>(c);
    const library = await Library.findByPk(folder.libraryId);
    if (body?.itemId === null) {
      folder.customArtwork = false;
      await folder.save();
    }
    else {
      const tree = await FolderTree.load([folder.libraryId]);
      const item = tree.itemsUnder(folder.id).find((i) => i.id === body?.itemId);
      if (!item?.artwork.thumb) return c.json({ message: "Pick a photo or video from inside this album." }, 400);
      await VideoDetails.setThumbnail(folder, item.artwork.thumb);
      folder.customArtwork = true;
      await folder.save();
    }
    if (library) await VideoDetails.refreshFolders(library);
    await folder.reload();
    return c.json((await PhotoSummaries.folders([folder], user))[0]);
  });
  //#endregion

  //#region Hand-made albums

  /**
   * @swagger
   * /api/photos/albums:
   *   get:
   *     summary: Hand-made albums in a library. Query `libraryId`, and `editable=1` for only those the profile may change.
   */
  router.get("/albums", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const library = await photosLibrary(user, Number(c.req.query("libraryId")));
    if (!library) return c.json({ message: "That library doesn't exist." }, 404);
    let albums = await PhotoAlbum.findAll({ where: { libraryId: library.id } });
    if (c.req.query("editable") === "1") {
      const manager = await user.hasPermission("LIBRARY_MANAGE");
      albums = albums.filter((a) => manager || a.userId === user.id);
    }
    return c.json(sortAlbums(await PhotoSummaries.albums(albums, user), "title"));
  });

  /**
   * @swagger
   * /api/photos/albums:
   *   post:
   *     summary: Make an album, optionally with photos in it. Body is a `CreatePhotoAlbumRequest`.
   */
  router.post("/albums", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const body = await readJson<CreatePhotoAlbumRequest>(c);
    const library = await photosLibrary(user, Number(body?.libraryId));
    if (!library) return c.json({ message: "Pick a Photos library for the album." }, 400);
    let title: string;
    try {
      title = PhotoAlbum.cleanTitle(body?.title);
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 400);
    }
    const album = await PhotoAlbum.create({ libraryId: library.id, userId: user.id, title });
    const items = await usableItems(user, library.id, body?.itemIds);
    if (items.length) await PhotoAlbumItem.bulkCreate(items.map((i) => ({ albumId: album.id, itemId: i.id })));
    return c.json((await PhotoSummaries.albums([album], user))[0], 201);
  });

  /**
   * @swagger
   * /api/photos/albums/{id}:
   *   get:
   *     summary: A hand-made album.
   */
  router.get("/albums/:id", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const album = await visibleAlbum(user, Number(c.req.param("id")));
    if (!album) return c.json({ message: "That album doesn't exist." }, 404);
    const detail: PhotoAlbumDetail = {
      ...(await PhotoSummaries.albums([album], user))[0],
      description: album.description,
      folders: [],
      albums: [],
      canEdit: await album.canEdit(user),
    };
    return c.json(detail);
  });

  /**
   * @swagger
   * /api/photos/albums/{id}:
   *   patch:
   *     summary: Rename an album, change its description or pick its cover. Body is an `UpdatePhotoAlbumRequest`.
   */
  router.patch("/albums/:id", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const album = await visibleAlbum(user, Number(c.req.param("id")));
    if (!album) return c.json({ message: "That album doesn't exist." }, 404);
    if (!await album.canEdit(user)) return c.json({ message: "Only the one who made this album, or someone who manages libraries, can change it." }, 403);
    const body = await readJson<UpdatePhotoAlbumRequest>(c) ?? {};
    try {
      if (body.title !== undefined) album.title = PhotoAlbum.cleanTitle(body.title);
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 400);
    }
    if (body.description !== undefined) album.description = typeof body.description === "string" ? body.description.trim().slice(0, DESCRIPTION_LIMIT) || null : null;
    if (body.coverItemId !== undefined) {
      if (body.coverItemId !== null && !await PhotoAlbumItem.findOne({ where: { albumId: album.id, itemId: body.coverItemId } })) {
        return c.json({ message: "Pick a photo from inside this album as its cover." }, 400);
      }
      album.coverItemId = body.coverItemId;
    }
    await album.save();
    return c.json((await PhotoSummaries.albums([album], user))[0]);
  });

  /**
   * @swagger
   * /api/photos/albums/{id}:
   *   delete:
   *     summary: Delete a hand-made album. The photos in it stay where they are.
   */
  router.delete("/albums/:id", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const album = await visibleAlbum(user, Number(c.req.param("id")));
    if (!album) return c.json({ message: "That album doesn't exist." }, 404);
    if (!await album.canEdit(user)) return c.json({ message: "Only the one who made this album, or someone who manages libraries, can delete it." }, 403);
    await album.destroy();
    return c.body(null, 204);
  });

  /**
   * @swagger
   * /api/photos/albums/{id}/items:
   *   get:
   *     summary: Photos and videos in a hand-made album, oldest first. Query `offset`, `limit`.
   */
  router.get("/albums/:id/items", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const album = await visibleAlbum(user, Number(c.req.param("id")));
    if (!album) return c.json({ message: "That album doesn't exist." }, 404);
    const ids = (await PhotoAlbumItem.findAll({ where: { albumId: album.id }, attributes: ["itemId"] })).map((e) => e.itemId);
    if (ids.length === 0) return c.json({ items: [], total: 0 } satisfies PhotoPage);
    return c.json(await page(user, { id: ids }, byDate("ASC"), paging(c)));
  });

  /**
   * @swagger
   * /api/photos/albums/{id}/items:
   *   post:
   *     summary: Add photos and videos to a hand-made album. Body `{ "itemIds": [1, 2] }`; ones already in it are skipped.
   */
  router.post("/albums/:id/items", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const album = await visibleAlbum(user, Number(c.req.param("id")));
    if (!album) return c.json({ message: "That album doesn't exist." }, 404);
    if (!await album.canEdit(user)) return c.json({ message: "Only the one who made this album, or someone who manages libraries, can add to it." }, 403);
    const body = await readJson<{ itemIds: number[] }>(c);
    const items = await usableItems(user, album.libraryId, body?.itemIds);
    if (items.length === 0) return c.json({ message: "Pick photos or videos from this album's library." }, 400);
    const already = new Set((await PhotoAlbumItem.findAll({ where: { albumId: album.id, itemId: items.map((i) => i.id) }, attributes: ["itemId"] })).map((e) => e.itemId));
    const fresh = items.filter((i) => !already.has(i.id));
    if (fresh.length) await PhotoAlbumItem.bulkCreate(fresh.map((i) => ({ albumId: album.id, itemId: i.id })));
    album.changed("updatedAt", true);
    await album.save();
    return c.json({ ...(await PhotoSummaries.albums([album], user))[0], added: fresh.length });
  });

  /**
   * @swagger
   * /api/photos/albums/{id}/remove:
   *   post:
   *     summary: Take photos and videos out of a hand-made album. Body `{ "itemIds": [1, 2] }`. The files stay where they are.
   */
  router.post("/albums/:id/remove", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const album = await visibleAlbum(user, Number(c.req.param("id")));
    if (!album) return c.json({ message: "That album doesn't exist." }, 404);
    if (!await album.canEdit(user)) return c.json({ message: "Only the one who made this album, or someone who manages libraries, can change it." }, 403);
    const body = await readJson<{ itemIds: number[] }>(c);
    const ids = Array.isArray(body?.itemIds) ? body.itemIds.filter((id) => Number.isInteger(id)) : [];
    if (ids.length === 0) return c.json({ message: "Say which photos to take out: { \"itemIds\": [1, 2] }." }, 400);
    await PhotoAlbumItem.destroy({ where: { albumId: album.id, itemId: ids } });
    if (album.coverItemId !== null && ids.includes(album.coverItemId)) album.coverItemId = null;
    album.changed("updatedAt", true);
    await album.save();
    return c.json((await PhotoSummaries.albums([album], user))[0]);
  });
  //#endregion

  //#region Photos

  /**
   * @swagger
   * /api/photos/view/{token}:
   *   get:
   *     summary: The full-size picture for the viewer (the original, or a JPEG copy for formats browsers can't show). `download=1` sends the original file to save.
   */
  router.get("/view/:token", async (c) => {
    const grant = StreamGrants.use(c.req.param("token"));
    const file = grant ? await MediaFile.findByPk(grant.fileId) : null;
    if (!file) return c.json({ message: "This link has expired. Open the photo again." }, 404);
    // Pictures are someone else's files: never run anything in them (SVG isn't taken, but be safe)
    c.header("Content-Security-Policy", "script-src 'none'; object-src 'none'");
    c.header("X-Content-Type-Options", "nosniff");
    let response: Response | null;
    if (c.req.query("download") === "1") {
      c.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(Path.basename(file.path))}`);
      response = await sendFile(c, file.path, PhotoLibrary.contentType(file.path));
    }
    else {
      const view = await PhotoLibrary.viewFile(file);
      response = view ? await sendFile(c, view.path, view.contentType) : null;
    }
    if (!response) return c.json({ message: "The photo can't be found on disk." }, 404);
    // The same link is handed out again for a while, so opening a photo twice doesn't load it twice
    response.headers.set("Cache-Control", "private, max-age=10800");
    return response;
  });

  /**
   * @swagger
   * /api/photos/{id}:
   *   get:
   *     summary: A photo or video from a Photos library, with what its file says and links to the full-size picture.
   */
  router.get("/:id", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const item = await MediaItem.findByPk(Number(c.req.param("id")));
    if (!item || (item.type !== "photo" && item.type !== "video") || !Visibility.canSee(user, item)) return c.json({ message: "That photo doesn't exist." }, 404);
    const file = await MediaFile.findOne({ where: { itemId: item.id }, order: [["path", "ASC"]] });
    if (!file) return c.json({ message: "That photo's file is gone." }, 404);
    const [summary] = await PhotoSummaries.photos([item]);
    const albumIds = (await PhotoAlbumItem.findAll({ where: { itemId: item.id }, attributes: ["albumId"] })).map((e) => e.albumId);
    const albums = albumIds.length ? await PhotoAlbum.findAll({ where: { id: albumIds }, order: [["title", "ASC"]] }) : [];
    const token = StreamGrants.reuse(file.id, user.id);
    const detail: PhotoDetail = {
      ...summary,
      caption: item.overview,
      tags: item.genres,
      contentRating: item.contentRating,
      fileName: Path.basename(file.path),
      size: Number(file.size),
      meta: file.photo,
      folders: await VideoDetails.ancestors(item),
      albums: albums.map((a) => ({ id: a.id, title: a.title })),
      viewUrl: `/api/photos/view/${token}`,
      downloadUrl: `/api/photos/view/${token}?download=1`,
      palette: item.palette,
      edited: !!item.editedAt,
    };
    return c.json(detail);
  });
  //#endregion
}

export default PhotosController;
