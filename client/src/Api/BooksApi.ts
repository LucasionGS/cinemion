import type { BookDetail, BookFilter, BookPage, BookProgressRequest, BookReading, BookSort } from "@shared/books.ts";
import type { AudioFormat, TrackStream } from "@shared/music.ts";
import BaseApi from "./BaseApi.ts";

export namespace BooksApi {
  export function books(libraryId: number, opts: { sort?: BookSort; filter?: BookFilter; genre?: string | null; offset?: number; limit?: number }) {
    const query = new URLSearchParams({ sort: opts.sort ?? "title", filter: opts.filter ?? "all", offset: String(opts.offset ?? 0), limit: String(opts.limit ?? 60) });
    if (opts.genre) query.set("genre", opts.genre);
    return BaseApi.GET<BookPage>(`/books/libraries/${libraryId}/books?${query}`);
  }

  export function genres(libraryId: number) {
    return BaseApi.GET<string[]>(`/books/libraries/${libraryId}/genres`);
  }

  export function get(id: number) {
    return BaseApi.GET<BookDetail>(`/books/${id}`);
  }

  /**
   * Save where the profile is, or mark the book finished.
   */
  export function progress(id: number, data: BookProgressRequest) {
    return BaseApi.PUT<void>(`/books/${id}/progress`, data);
  }

  /**
   * The same, sent with `keepalive` so it still goes out while the page closes.
   */
  export function progressOnLeave(id: number, data: BookProgressRequest) {
    fetch(`/api/books/${id}/progress`, { method: "PUT", headers: BaseApi.getHeaders(), body: JSON.stringify(data), keepalive: true }).catch(() => { });
  }

  /**
   * A URL to play one file of an audiobook.
   */
  export function partStream(id: number, fileId: number, formats: AudioFormat[]) {
    return BaseApi.POST<TrackStream>(`/books/${id}/parts/${fileId}/stream`, { formats });
  }

  export function read(id: number) {
    return BaseApi.GET<BookReading>(`/books/${id}/read`);
  }
}

export default BooksApi;
