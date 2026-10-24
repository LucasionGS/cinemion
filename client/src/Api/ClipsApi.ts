import type { ClipSort, ClipsOverview, ClipsSettings, GameCandidate, GameChoice, GameSort, RecognitionStatus, ShareCopyInfo, ShareCopyRequest, TrimRequest } from "@shared/clips.ts";
import type { ItemPage, ItemSummary } from "@shared/media.ts";
import BaseApi from "./BaseApi.ts";

export namespace ClipsApi {
  export interface ClipQuery {
    /**
     * A game id, or `none` for clips without a game.
     */
    game?: number | "none" | null;
    tag?: string | null;
    favorites?: boolean;
    suggested?: boolean;
    sort?: ClipSort;
  }

  export function overview(libraryId: number, sort: GameSort = "recent") {
    return BaseApi.GET<ClipsOverview>(`/clips/libraries/${libraryId}?sort=${sort}`);
  }

  function query(q: ClipQuery) {
    const params = new URLSearchParams();
    if (q.game) params.set("game", String(q.game));
    if (q.tag) params.set("tag", q.tag);
    if (q.favorites) params.set("favorites", "1");
    if (q.suggested) params.set("suggested", "1");
    if (q.sort) params.set("sort", q.sort);
    return params;
  }

  export function clips(libraryId: number, q: ClipQuery, offset: number, limit = 60) {
    const params = query(q);
    params.set("offset", String(offset));
    params.set("limit", String(limit));
    return BaseApi.GET<ItemPage>(`/clips/libraries/${libraryId}/clips?${params}`);
  }

  export function tags(libraryId: number, game?: number | "none" | null) {
    return BaseApi.GET<string[]>(`/clips/libraries/${libraryId}/tags${game ? `?game=${game}` : ""}`);
  }

  /**
   * Games to pick from: the library's own matching `q`, then games found online. `message` says why the online
   * search didn't work, when it didn't.
   */
  export function searchGames(libraryId: number, q: string) {
    return BaseApi.GET<{ results: GameCandidate[]; message: string | null }>(`/clips/libraries/${libraryId}/games/search?q=${encodeURIComponent(q)}`);
  }

  /**
   * Put clips in a game, or in none.
   * @returns The game they're in now.
   */
  export function setGame(libraryId: number, ids: number[], game: GameChoice) {
    return BaseApi.PUT<{ game: ItemSummary | null }>(`/clips/libraries/${libraryId}/game`, { ids, game });
  }

  /**
   * Rename a game, match it with one found online, or put its clips in another game.
   * @returns The game its clips are in now, which is another one when the library already had the matched game.
   */
  export function editGame(id: number, change: Exclude<GameChoice, null>) {
    return BaseApi.PUT<ItemSummary>(`/clips/games/${id}`, change);
  }

  export function removeGame(id: number) {
    return BaseApi.DELETE<void>(`/clips/games/${id}`);
  }

  export function answerSuggestion(id: number, accept: boolean) {
    return BaseApi.POST<ItemSummary>(`/clips/${id}/suggestion`, { accept });
  }

  export function setFavorite(ids: number[], favorite: boolean) {
    return BaseApi.PUT<void>("/clips/favorite", { ids, favorite });
  }

  export function keyframes(id: number) {
    return BaseApi.GET<number[]>(`/clips/${id}/keyframes`);
  }

  /**
   * Cut a clip down.
   * @returns The clip with the cut: a new one, or the same one when the original was replaced.
   */
  export function trim(id: number, request: TrimRequest) {
    return BaseApi.POST<ItemSummary>(`/clips/${id}/trim`, request);
  }

  export function startShare(id: number, request: ShareCopyRequest) {
    return BaseApi.POST<ShareCopyInfo>(`/clips/${id}/share`, request);
  }

  export function share(id: string) {
    return BaseApi.GET<ShareCopyInfo>(`/clips/shares/${id}`);
  }

  /**
   * The full address of a small copy, to download or pass on.
   */
  export function shareUrl(info: ShareCopyInfo, download = false) {
    return `${location.origin}${info.url}${download ? "?download=1" : ""}`;
  }

  export function settings() {
    return BaseApi.GET<ClipsSettings>("/clips/settings");
  }

  export function setSettings(settings: Partial<ClipsSettings>) {
    return BaseApi.PUT<ClipsSettings>("/clips/settings", settings);
  }

  export function recognition() {
    return BaseApi.GET<RecognitionStatus>("/clips/recognition");
  }

  export function installRecognition() {
    return BaseApi.POST<RecognitionStatus>("/clips/recognition");
  }

  export function removeRecognition() {
    return BaseApi.DELETE<RecognitionStatus>("/clips/recognition");
  }

  export function runRecognition(libraryId?: number) {
    return BaseApi.POST<void>("/clips/recognition/run", libraryId ? { libraryId } : {});
  }
}

export default ClipsApi;
