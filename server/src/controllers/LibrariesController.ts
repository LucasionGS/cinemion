import { Hono } from "hono";
import type { CreateLibraryRequest } from "@shared/api.ts";
import { Library, User } from "../models/index.ts";
import MediaRoots from "../lib/MediaRoots.ts";
import { errorMessage, readJson } from "../lib/http.ts";
import type { AppEnv } from "../lib/types.ts";

export namespace LibrariesController {
  export const router = new Hono<AppEnv>();

  /**
   * @swagger
   * /api/libraries:
   *   get:
   *     summary: Libraries the signed-in user can see.
   */
  router.get("/", User.$middleware(), async (c) => {
    const user = c.get("user")!;
    const libraries = await Library.findAll({ order: [["id", "ASC"]] });
    const visible = user.libraryAccess === null ? libraries : libraries.filter((l) => user.libraryAccess!.includes(l.id));
    return c.json(visible.map((l) => l.toJSON()));
  });

  /**
   * @swagger
   * /api/libraries:
   *   post:
   *     summary: Add a library.
   */
  router.post("/", User.$middleware({ permissions: ["LIBRARY_MANAGE"] }), async (c) => {
    const body = await readJson<CreateLibraryRequest>(c);
    if (!body) return c.json({ message: "A name, type and folders are required." }, 400);

    for (const path of body.paths ?? []) {
      if (!(await MediaRoots.resolveAllowed(path))) {
        return c.json({ message: `The folder "${path}" isn't available. Only folders inside ${MediaRoots.roots().join(", ")} can be used.` }, 400);
      }
    }
    try {
      const library = await Library.createLibrary(body as CreateLibraryRequest);
      return c.json(library.toJSON(), 201);
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 400);
    }
  });

  /**
   * @swagger
   * /api/libraries/{id}:
   *   delete:
   *     summary: Remove a library. The files on disk are not touched.
   */
  router.delete("/:id", User.$middleware({ permissions: ["LIBRARY_MANAGE"] }), async (c) => {
    const library = await Library.findByPk(Number(c.req.param("id")));
    if (!library) return c.json({ message: "That library doesn't exist." }, 404);
    await library.destroy();
    return c.body(null, 204);
  });
}

export default LibrariesController;
