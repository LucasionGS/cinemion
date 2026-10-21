import { Hono } from "hono";
import type { Context } from "hono";
import type { StartUploadRequest } from "@shared/uploads.ts";
import { User } from "../models/index.ts";
import Uploads from "../library/Uploads.ts";
import log from "../lib/Logger.ts";
import { readJson } from "../lib/http.ts";
import type { AppEnv } from "../lib/types.ts";

/**
 * Uploading media into libraries from the browser, in resumable pieces. See `Uploads` for how it works.
 */
export namespace UploadsController {
  export const router = new Hono<AppEnv>();

  const manage = User.$middleware({ permissions: ["LIBRARY_MANAGE"] });

  function fail(c: Context<AppEnv>, error: unknown) {
    if (error instanceof Uploads.Problem) return c.json({ message: error.message, upload: error.upload ?? null }, error.status);
    log.error("Upload request failed", { error });
    return c.json({ message: "Something went wrong with the upload. The server's log has the details." }, 500);
  }

  /**
   * @swagger
   * /api/uploads/rules:
   *   get:
   *     summary: The largest file and piece the server takes, and the file types each library type takes.
   */
  router.get("/rules", manage, (c) => c.json(Uploads.rules()));

  /**
   * @swagger
   * /api/uploads/check:
   *   get:
   *     summary: Whether uploads can go into `folder` (query) of `libraryId` (query), with the reason when they can't.
   */
  router.get("/check", manage, async (c) => c.json(await Uploads.check(Number(c.req.query("libraryId")), c.req.query("folder") ?? "")));

  /**
   * @swagger
   * /api/uploads:
   *   get:
   *     summary: Uploads the server has, unfinished ones included, oldest first. Query `libraryId` for one library's.
   */
  router.get("/", manage, (c) => {
    const libraryId = c.req.query("libraryId");
    return c.json(Uploads.list(libraryId ? Number(libraryId) : undefined));
  });

  /**
   * @swagger
   * /api/uploads:
   *   post:
   *     summary: Start an upload (a `StartUploadRequest`). The same file again (name, size, date and fingerprint) returns
   *       the unfinished upload, whose `received` says where to carry on.
   */
  router.post("/", manage, async (c) => {
    const body = await readJson<StartUploadRequest>(c);
    if (!body) return c.json({ message: "A library, folder, path and size are required." }, 400);
    try {
      return c.json(await Uploads.start(c.get("user")!, body), 201);
    } catch (error) {
      return fail(c, error);
    }
  });

  /**
   * @swagger
   * /api/uploads/{id}:
   *   get:
   *     summary: One upload, to see how much the server has or how adding it to the library is going.
   */
  router.get("/:id", manage, (c) => {
    const info = Uploads.get(c.req.param("id"));
    if (!info) return c.json({ message: "That upload doesn't exist anymore." }, 404);
    return c.json(info);
  });

  /**
   * @swagger
   * /api/uploads/{id}:
   *   put:
   *     summary: Send the next piece as the raw body, with `offset` (query) = the upload's `received`. A wrong offset
   *       answers 409 with the upload, so the client can carry on from the right place.
   */
  router.put("/:id", manage, async (c) => {
    const offset = Number(c.req.query("offset"));
    if (!Number.isSafeInteger(offset) || offset < 0) return c.json({ message: "The offset is missing." }, 400);
    const length = c.req.header("Content-Length");
    try {
      return c.json(await Uploads.write(c.req.param("id"), offset, length ? Number(length) : null, c.req.raw.body));
    } catch (error) {
      return fail(c, error);
    }
  });

  /**
   * @swagger
   * /api/uploads/{id}/retry:
   *   post:
   *     summary: Try adding a failed upload to the library again. With `{ "replace": true }`, files that are already
   *       there are replaced.
   */
  router.post("/:id/retry", manage, async (c) => {
    const body = await readJson<{ replace: boolean }>(c);
    try {
      return c.json(await Uploads.retry(c.req.param("id"), typeof body?.replace === "boolean" ? body.replace : undefined));
    } catch (error) {
      return fail(c, error);
    }
  });

  /**
   * @swagger
   * /api/uploads/{id}:
   *   delete:
   *     summary: Cancel an upload and delete what was received, or clear a finished one from the list.
   */
  router.delete("/:id", manage, async (c) => {
    try {
      await Uploads.cancel(c.req.param("id"));
      return c.body(null, 204);
    } catch (error) {
      return fail(c, error);
    }
  });
}

export default UploadsController;
