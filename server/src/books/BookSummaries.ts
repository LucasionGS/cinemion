import type { BookFormat, BookSummary } from "@shared/books.ts";
import { Credit, MediaFile, type MediaItem, Person, type User, WatchState } from "../models/index.ts";

/**
 * Builds `BookSummary` lists, loading authors, lengths and the profile's progress in a few batched queries.
 */
export namespace BookSummaries {
  export interface Extras {
    authors: Map<number, { personId: number; name: string }[]>;
    narrators: Map<number, { personId: number; name: string }[]>;
    durations: Map<number, number>;
    formats: Map<number, BookFormat>;
    states: Map<number, WatchState>;
  }

  /**
   * Everything summaries need that the items don't know themselves.
   */
  export async function extras(items: MediaItem[], user: User | null): Promise<Extras> {
    const ids = items.map((i) => i.id);
    const result: Extras = { authors: new Map(), narrators: new Map(), durations: new Map(), formats: new Map(), states: new Map() };
    if (ids.length === 0) return result;

    const credits = await Credit.findAll({ where: { itemId: ids, kind: ["author", "narrator"] }, order: [["order", "ASC"]] });
    const people = new Map((await Person.findAll({ where: { id: [...new Set(credits.map((c) => c.personId))] }, attributes: ["id", "name"] })).map((p) => [p.id, p.name]));
    for (const credit of credits) {
      const map = credit.kind === "author" ? result.authors : result.narrators;
      map.set(credit.itemId, [...map.get(credit.itemId) ?? [], { personId: credit.personId, name: people.get(credit.personId) ?? "" }]);
    }

    for (const file of await MediaFile.findAll({ where: { itemId: ids }, attributes: ["itemId", "duration", "container"] })) {
      const id = file.itemId!;
      result.durations.set(id, (result.durations.get(id) ?? 0) + (file.duration ?? 0));
      if (!result.formats.has(id)) result.formats.set(id, file.container === "pdf" ? "pdf" : file.container === "epub" ? "epub" : "audio");
    }

    if (user) {
      for (const state of await WatchState.findAll({ where: { userId: user.id, itemId: ids } })) result.states.set(state.itemId, state);
    }
    return result;
  }

  /**
   * How far a profile got, 0 to 1, or `null` when it didn't start.
   */
  export function progressOf(item: MediaItem, extra: Extras) {
    const state = extra.states.get(item.id);
    if (!state || state.watched || !state.position) return null;
    const length = item.type === "audiobook" ? extra.durations.get(item.id) ?? 0 : 1;
    return length ? Math.min(1, state.position / length) : null;
  }

  export function summary(item: MediaItem, extra: Extras): BookSummary {
    return {
      id: item.id,
      libraryId: item.libraryId,
      type: item.type === "audiobook" ? "audiobook" : "book",
      format: extra.formats.get(item.id) ?? (item.type === "audiobook" ? "audio" : "epub"),
      title: item.title,
      authors: (extra.authors.get(item.id) ?? []).map((a) => a.name),
      narrators: (extra.narrators.get(item.id) ?? []).map((n) => n.name),
      year: item.year,
      cover: item.artwork.poster,
      palette: item.palette,
      duration: item.type === "audiobook" ? extra.durations.get(item.id) ?? 0 : null,
      progress: progressOf(item, extra),
      finished: extra.states.get(item.id)?.watched ?? false,
      addedAt: item.addedAt.toISOString(),
    };
  }

  export async function build(items: MediaItem[], user: User | null) {
    const extra = await extras(items, user);
    return items.map((item) => summary(item, extra));
  }
}

export default BookSummaries;
