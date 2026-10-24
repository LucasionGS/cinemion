import type { ClipsSettings } from "@shared/clips.ts";
import { Setting } from "../models/index.ts";

/**
 * Settings for Clips libraries: online game lookups and picture recognition.
 */
export namespace ClipSettings {
  export const DEFAULTS: ClipsSettings = { lookups: true, steamGridDbKey: null, autoSuggest: true };

  export async function get(): Promise<ClipsSettings> {
    const stored = await Setting.get<Partial<ClipsSettings>>(Setting.Keys.CLIPS, {});
    return { ...DEFAULTS, ...stored };
  }

  /**
   * The SteamGridDB key from Settings, or else from `STEAMGRIDDB_API_KEY`. `null` when there's none.
   */
  export async function steamGridDbKey() {
    return (await get()).steamGridDbKey || Deno.env.get("STEAMGRIDDB_API_KEY") || null;
  }

  /**
   * Check and store new settings. Fields that aren't sent stay as they are.
   */
  export async function update(body: Partial<ClipsSettings>): Promise<ClipsSettings> {
    const current = await get();
    const next: ClipsSettings = {
      lookups: typeof body.lookups === "boolean" ? body.lookups : current.lookups,
      steamGridDbKey: body.steamGridDbKey !== undefined ? (String(body.steamGridDbKey ?? "").trim() || null) : current.steamGridDbKey,
      autoSuggest: typeof body.autoSuggest === "boolean" ? body.autoSuggest : current.autoSuggest,
    };
    await Setting.set(Setting.Keys.CLIPS, next);
    return next;
  }
}

export default ClipSettings;
