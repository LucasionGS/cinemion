import { Hono } from "hono";
import type { SubtitleDownloadRequest, SubtitleSettings } from "@shared/playback.ts";
import { findLanguage, languageName } from "@shared/languages.ts";
import { MediaFile, MediaItem, User } from "../models/index.ts";
import Visibility from "../library/Visibility.ts";
import SubtitleManager from "../subtitles/SubtitleManager.ts";
import ItemLabels from "../library/ItemLabels.ts";
import Events from "../integrations/Events.ts";
import { errorMessage, readJson } from "../lib/http.ts";
import type { AppEnv } from "../lib/types.ts";

export namespace SubtitlesController {
  export const router = new Hono<AppEnv>();

  const manage = User.$middleware({ permissions: ["SERVER_MANAGE"] });
  const download = User.$middleware({ permissions: ["SUBTITLES_DOWNLOAD"] });

  /**
   * The media file with `id`, when the signed-in profile may see what it plays.
   */
  async function findVisibleFile(user: User, id: number) {
    const file = await MediaFile.findByPk(id);
    const item = file?.itemId ? await MediaItem.findByPk(file.itemId) : null;
    return file && item && Visibility.canSee(user, item) ? file : null;
  }

  /**
   * @swagger
   * /api/subtitles/settings:
   *   get:
   *     summary: Subtitle search settings. The OpenSubtitles password is never sent back.
   */
  router.get("/settings", manage, async (c) => c.json(await SubtitleManager.publicSettings()));

  /**
   * @swagger
   * /api/subtitles/settings:
   *   put:
   *     summary: Change subtitle search settings. Leave `openSubtitlesPassword` out to keep the saved one.
   */
  router.put("/settings", manage, async (c) => {
    const body = await readJson<SubtitleSettings>(c);
    if (!body) return c.json({ message: "Nothing to change." }, 400);
    const current = await SubtitleManager.settings();

    const languages = body.languages ?? current.languages;
    if (!Array.isArray(languages) || languages.length === 0) return c.json({ message: "Pick at least one subtitle language." }, 400);
    const unknown = languages.find((l) => !findLanguage(l));
    if (unknown) return c.json({ message: `"${unknown}" isn't a language Cinemion knows.` }, 400);

    const clean = (value: string | null | undefined, fallback: string | null) => value === undefined ? fallback : (value?.trim() || null);
    const next: SubtitleSettings = {
      openSubtitlesApiKey: clean(body.openSubtitlesApiKey, current.openSubtitlesApiKey),
      openSubtitlesUsername: clean(body.openSubtitlesUsername, current.openSubtitlesUsername),
      // null and missing keep the saved password; an empty string clears it
      openSubtitlesPassword: body.openSubtitlesPassword === undefined || body.openSubtitlesPassword === null ? current.openSubtitlesPassword : (body.openSubtitlesPassword || null),
      languages: languages.map((l) => findLanguage(l)!.code),
      saveNextToVideo: body.saveNextToVideo ?? current.saveNextToVideo,
    };
    await SubtitleManager.saveSettings(next);
    return c.json(await SubtitleManager.publicSettings());
  });

  /**
   * @swagger
   * /api/subtitles/search:
   *   get:
   *     summary: Search subtitles for a media file. Query `fileId`, `language` (ISO 639-1), optional `query`
   *       to search by text instead of the matched title, and `hearingImpaired` (include, exclude or only).
   */
  router.get("/search", download, async (c) => {
    const file = await findVisibleFile(c.get("user")!, Number(c.req.query("fileId")));
    if (!file) return c.json({ message: "That video doesn't exist." }, 404);
    const language = findLanguage(c.req.query("language"));
    if (!language) return c.json({ message: "Pick a language to search for." }, 400);
    const hearingImpaired = c.req.query("hearingImpaired");

    try {
      return c.json(await SubtitleManager.search(file, {
        language: language.code,
        query: c.req.query("query"),
        hearingImpaired: hearingImpaired === "only" || hearingImpaired === "exclude" ? hearingImpaired : "include",
      }));
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 502);
    }
  });

  async function reportDownload(user: User, file: MediaFile, language: string) {
    const item = file.itemId ? await MediaItem.findByPk(file.itemId) : null;
    if (!item) return;
    const label = await ItemLabels.describe(item);
    Events.emit("subtitles.downloaded", { user: { id: user.id, name: user.name }, item: await ItemLabels.forWebhook(item, label.show), language }, {
      kind: "subtitles",
      message: `Subtitles downloaded for ${label.inline} (${language})`,
      userId: user.id,
      itemId: item.id,
    });
  }

  /**
   * @swagger
   * /api/subtitles/download:
   *   post:
   *     summary: Download a search result and save it for the file. Returns the new subtitle track.
   */
  router.post("/download", download, async (c) => {
    const body = await readJson<SubtitleDownloadRequest>(c);
    if (!body?.fileId || !body.provider || !body.id) return c.json({ message: "Pick a search result to download." }, 400);
    const file = await findVisibleFile(c.get("user")!, Number(body.fileId));
    if (!file) return c.json({ message: "That video doesn't exist." }, 404);
    const language = findLanguage(body.language);

    try {
      const track = await SubtitleManager.download(file, {
        provider: body.provider,
        id: String(body.id),
        language: language?.code ?? "und",
        isHearingImpaired: !!body.isHearingImpaired,
      });
      reportDownload(c.get("user")!, file, languageName(language?.code ?? null) ?? "unknown language");
      return c.json(track);
    } catch (error) {
      return c.json({ message: errorMessage(error) }, 502);
    }
  });
}

export default SubtitlesController;
