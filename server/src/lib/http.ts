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
