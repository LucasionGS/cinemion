import fsp from "node:fs/promises";
import type { Context } from "hono";

/**
 * Parse the JSON body, or `null` when it's missing or not valid JSON.
 */
export async function readJson<T>(c: Context): Promise<Partial<T> | null> {
  try {
    const body = await c.req.json();
    return body && typeof body === "object" ? body as Partial<T> : null;
  } catch {
    return null;
  }
}

/**
 * Message of a thrown error, for a response or the log. Database errors only say "Validation error" by
 * themselves, so the details they carry ("path must be unique") are added.
 */
export function errorMessage(error: unknown) {
  if (!(error instanceof Error)) return String(error);
  const details = (error as { errors?: { message?: string }[] }).errors?.map((e) => e.message).filter(Boolean) ?? [];
  return details.length ? `${error.message}: ${details.join(", ")}` : error.message;
}

/**
 * Send a file from disk with range requests, so players can seek in it.
 * @returns `null` when the file isn't there.
 */
export async function sendFile(c: Context, path: string, contentType: string): Promise<Response | null> {
  const stat = await fsp.stat(path).catch(() => null);
  if (!stat?.isFile()) return null;
  const size = stat.size;
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-transform",
  };

  // Example: Range: bytes=1000-  or  bytes=1000-1999
  const range = c.req.header("Range")?.match(/^bytes=(\d*)-(\d*)$/);
  let start = 0;
  let end = size - 1;
  if (range) {
    if (range[1] === "") {
      start = Math.max(0, size - Number(range[2]));
    }
    else {
      start = Number(range[1]);
      if (range[2] !== "") end = Math.min(Number(range[2]), size - 1);
    }
    if (start >= size || start > end) {
      return c.body(null, 416, { "Content-Range": `bytes */${size}` });
    }
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  }
  headers["Content-Length"] = String(end - start + 1);
  if (c.req.method === "HEAD") return c.body(null, range ? 206 : 200, headers);

  const handle = await Deno.open(path, { read: true });
  await handle.seek(start, Deno.SeekMode.Start);
  let remaining = end - start + 1;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const buffer = new Uint8Array(Math.min(256 * 1024, remaining));
      const read = await handle.read(buffer);
      if (read === null || read === 0) {
        handle.close();
        controller.close();
        return;
      }
      remaining -= read;
      controller.enqueue(buffer.subarray(0, read));
      if (remaining <= 0) {
        handle.close();
        controller.close();
      }
    },
    cancel() {
      try {
        handle.close();
      } catch {
        // Already closed
      }
    },
  });
  return c.body(body, range ? 206 : 200, headers);
}
