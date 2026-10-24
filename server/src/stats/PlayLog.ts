import { MediaItem, PlaySession } from "../models/index.ts";
import log from "../lib/Logger.ts";

/**
 * Writes down time spent with each title. Players report now and then while they play; the time between two reports
 * counts when they're close together, so pauses, closed tabs and sleeping laptops don't.
 */
export namespace PlayLog {
  interface Open {
    userId: number;
    itemId: number;
    /**
     * The row being added to, once there's one.
     */
    sessionId: number | null;
    startedAt: Date;
    lastAt: number;
    /**
     * Seconds not written yet.
     */
    pending: number;
  }

  /**
   * Reports further apart than this start a new sitting; videos report every 10 s, audiobooks every 15 s.
   */
  const GAP_MS = 90 * 1000;
  /**
   * Books are read in long stretches between saves of the place.
   */
  const BOOK_GAP_MS = 5 * 60 * 1000;
  const FLUSH_MS = 60 * 1000;

  const _open = new Map<string, Open>();
  let _timer: ReturnType<typeof setInterval> | null = null;

  function startTimer() {
    _timer ??= setInterval(() => flushAll().catch((error) => log.warn("Could not write playing time", { error })), FLUSH_MS);
  }

  /**
   * A report from a player. Pass `playing: false` for a pause; the time up to it still counts.
   * @param book Reading saves the place less often, so longer gaps still count.
   */
  export function tick(userId: number, itemId: number, playing: boolean, opts?: { book?: boolean }) {
    startTimer();
    const key = `${userId}:${itemId}`;
    const now = Date.now();
    const gap = opts?.book ? BOOK_GAP_MS : GAP_MS;
    const open = _open.get(key);
    if (open && now - open.lastAt <= gap) {
      open.pending += (now - open.lastAt) / 1000;
      open.lastAt = now;
    }
    else {
      if (open) flush(open).catch(() => { });
      _open.set(key, { userId, itemId, sessionId: null, startedAt: new Date(now), lastAt: now, pending: 0 });
    }
    if (!playing) {
      // A pause ends the stretch; the next report starts counting again
      const current = _open.get(key)!;
      current.lastAt = -Infinity;
    }
  }

  /**
   * Count a whole sitting at once, like a music track that played through.
   */
  export async function add(userId: number, itemId: number, seconds: number) {
    if (seconds <= 0) return;
    const item = await MediaItem.findByPk(itemId, { attributes: ["type"] });
    if (!item) return;
    await PlaySession.create({ userId, itemId, kind: item.type, startedAt: new Date(Date.now() - seconds * 1000), seconds: Math.round(seconds) });
  }

  async function flush(open: Open) {
    const seconds = Math.round(open.pending);
    if (seconds <= 0) return;
    open.pending -= seconds;
    if (open.sessionId !== null) {
      await PlaySession.increment("seconds", { by: seconds, where: { id: open.sessionId } });
      return;
    }
    const item = await MediaItem.findByPk(open.itemId, { attributes: ["type"] });
    if (!item) return;
    const row = await PlaySession.create({ userId: open.userId, itemId: open.itemId, kind: item.type, startedAt: open.startedAt, seconds });
    open.sessionId = row.id;
  }

  async function flushAll() {
    const now = Date.now();
    for (const [key, open] of _open) {
      await flush(open);
      // Long quiet ones are over
      if (open.lastAt !== -Infinity && now - open.lastAt > BOOK_GAP_MS) _open.delete(key);
      if (open.lastAt === -Infinity && open.pending === 0) _open.delete(key);
    }
  }

  /**
   * Write everything down, at shutdown.
   */
  export async function stop() {
    if (_timer !== null) clearInterval(_timer);
    _timer = null;
    await flushAll().catch(() => { });
  }
}

export default PlayLog;
