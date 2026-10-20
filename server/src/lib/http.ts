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
 * Message of a thrown validation error, for a 400 response.
 */
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
