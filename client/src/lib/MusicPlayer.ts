import type { AudioFormat, TrackInfo } from "@shared/music.ts";
import type { AudiobookPart, BookChapter, BookDetail, SleepTimer } from "@shared/books.ts";
import type { Palette } from "@shared/media.ts";
import Controller from "./Controller.ts";
import MusicApi from "../Api/MusicApi.ts";
import BooksApi from "../Api/BooksApi.ts";
import ItemsApi from "../Api/ItemsApi.ts";
import { router } from "./Router.tsx";

export type RepeatMode = "off" | "all" | "one";

interface Saved {
  ids: number[];
  index: number;
  position: number;
  shuffle: boolean;
  repeat: RepeatMode;
  volume: number;
  /**
   * An audiobook instead of music, and where in it (seconds into the whole book).
   */
  book?: { id: number; position: number };
  speed?: number;
}

/**
 * An audiobook loaded in the player. Its parts are the queue.
 */
export interface BookSession {
  id: number;
  title: string;
  authors: string[];
  cover: string | null;
  palette: Palette | null;
  parts: AudiobookPart[];
  chapters: BookChapter[];
  /**
   * Unit is in seconds.
   */
  duration: number;
}

/**
 * Audio formats this browser plays, so the server only converts what it must.
 */
export function detectAudioFormats(): AudioFormat[] {
  const audio = document.createElement("audio");
  const can = (type: string) => audio.canPlayType(type) !== "";
  const formats: AudioFormat[] = [];
  if (can("audio/mpeg")) formats.push("mp3");
  if (can('audio/mp4; codecs="mp4a.40.2"')) formats.push("aac");
  if (can("audio/flac") || can('audio/mp4; codecs="flac"')) formats.push("flac");
  if (can('audio/ogg; codecs="opus"')) formats.push("opus");
  if (can('audio/ogg; codecs="vorbis"')) formats.push("vorbis");
  if (can('audio/mp4; codecs="alac"')) formats.push("alac");
  if (can('audio/wav; codecs="1"') || can("audio/wav")) formats.push("wav");
  return formats;
}

function shuffled<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * The music player: one audio element for the whole app, so music keeps playing while you browse. Holds the queue,
 * shuffle and repeat, counts plays, and talks to the system's media controls (lock screen, media keys).
 * It also plays audiobooks: then the queue is the book's files, and the player keeps a timeline over the whole
 * book, chapters, speed, a sleep timer and the profile's place on the server.
 * The queue is saved in this browser per profile and comes back paused after a reload.
 */
export class MusicPlayerController extends Controller {
  public queue: TrackInfo[] = [];
  public index = -1;
  public playing = false;
  public loading = false;
  /**
   * Unit is in seconds.
   */
  public position = 0;
  /**
   * Unit is in seconds.
   */
  public duration = 0;
  public error: string | null = null;
  public shuffle = false;
  public repeat: RepeatMode = "off";
  public volume = 1;
  public muted = false;
  public nowPlayingOpen = false;
  public nowPlayingTab: "lyrics" | "queue" | "chapters" = "queue";
  /**
   * The audiobook playing, when the queue is its parts rather than music.
   */
  public book: BookSession | null = null;
  public speed = 1;
  /**
   * When the sleep timer stops playback: `at` is a time in ms for minute timers, or a place in the book (seconds)
   * for the end of a chapter. `null` = off.
   */
  public sleep: { mode: SleepTimer; at: number } | null = null;

  /**
   * Seconds a track has to play before it counts as played, unless it's shorter than twice this.
   */
  private static readonly COUNT_AFTER = 30;
  /**
   * Within this many seconds of the start, "previous" goes to the previous track instead of the start.
   */
  private static readonly RESTART_WITHIN = 3;
  private static readonly STORAGE_PREFIX = "cn-music-";
  /**
   * How often the place in an audiobook is saved on the server while it plays. Unit is in ms.
   */
  private static readonly BOOK_SAVE_EVERY = 15_000;

  private _audio: HTMLAudioElement | null = null;
  private _formats: AudioFormat[] | null = null;
  /**
   * The queue before shuffling, to go back to when shuffle is turned off.
   */
  private _unshuffled: TrackInfo[] | null = null;
  private _loadId = 0;
  private _counted = false;
  private _lastSaved = 0;
  private _userId: number | null = null;
  private _lastBookSave = 0;
  private _sleepTimer: ReturnType<typeof setTimeout> | null = null;

  public get current(): TrackInfo | null {
    return this.queue[this.index] ?? null;
  }

  public hasQueue() {
    return this.queue.length > 0;
  }

  /**
   * Play `tracks` from `start`, replacing the queue.
   */
  public play(tracks: TrackInfo[], start = 0, opts?: { shuffle?: boolean }) {
    opts ??= {};
    if (tracks.length === 0) return;
    this._leaveBook();
    if (opts.shuffle) {
      this._unshuffled = [...tracks];
      this.queue = shuffled(tracks);
      this.index = 0;
      this.shuffle = true;
    }
    else {
      this._unshuffled = null;
      this.queue = [...tracks];
      this.index = Math.max(0, Math.min(start, tracks.length - 1));
      this.shuffle = false;
    }
    this._load(true);
  }

  /**
   * Put `tracks` right after the current one.
   */
  public playNext(tracks: TrackInfo[]) {
    if (!this.hasQueue() || this.book) return this.play(tracks);
    this.queue = [...this.queue.slice(0, this.index + 1), ...tracks, ...this.queue.slice(this.index + 1)];
    this._unshuffled = this._unshuffled ? [...this._unshuffled, ...tracks] : null;
    this._save(true);
    this.notify();
  }

  /**
   * Add `tracks` to the end of the queue.
   */
  public addToQueue(tracks: TrackInfo[]) {
    if (!this.hasQueue() || this.book) return this.play(tracks);
    this.queue = [...this.queue, ...tracks];
    this._unshuffled = this._unshuffled ? [...this._unshuffled, ...tracks] : null;
    this._save(true);
    this.notify();
  }

  public toggle() {
    if (this.playing) this.pause();
    else this.resume();
  }

  public pause() {
    this._audio?.pause();
  }

  public resume() {
    if (!this.current) return;
    // A restored queue has no stream yet
    if (!this._audio?.src) return this._load(true, this.position);
    this._audio.play().catch((error) => this._fail(error));
  }

  /**
   * The next track. At the end of the queue it stops, unless repeat is on.
   * @param auto The track ended by itself, so "repeat one" plays it again.
   */
  public next(auto = false) {
    if (!this.hasQueue()) return;
    if (this.book) return auto ? this._nextPart() : this.nextChapter();
    if (auto && this.repeat === "one") return this.seek(0, true);
    if (this.index < this.queue.length - 1) this.index++;
    else if (this.repeat === "all") this.index = 0;
    else {
      // Finished: stay on the last track, back at its start
      this.pause();
      this.seek(0);
      return;
    }
    this._load(true);
  }

  public previous() {
    if (!this.hasQueue()) return;
    if (this.book) return this.previousChapter();
    if (this.position > MusicPlayerController.RESTART_WITHIN || (this.index === 0 && this.repeat !== "all")) return this.seek(0);
    this.index = this.index > 0 ? this.index - 1 : this.queue.length - 1;
    this._load(true);
  }

  public jumpTo(index: number) {
    if (index < 0 || index >= this.queue.length) return;
    this.index = index;
    this._load(true);
  }

  /**
   * @param play Start playing too, like when a track repeats.
   */
  public seek(time: number, play = false) {
    const t = Math.max(0, Math.min(time, this.duration || time));
    this.position = t;
    if (this._audio?.src) this._audio.currentTime = t;
    if (play) this.resume();
    this._updatePositionState();
    this.notify();
  }

  public removeAt(index: number) {
    if (index < 0 || index >= this.queue.length) return;
    if (index === this.index) {
      this.queue = this.queue.filter((_, i) => i !== index);
      if (this.queue.length === 0) return this.stop();
      this.index = Math.min(index, this.queue.length - 1);
      this._load(this.playing);
      return;
    }
    this.queue = this.queue.filter((_, i) => i !== index);
    if (index < this.index) this.index--;
    this._save(true);
    this.notify();
  }

  /**
   * Move a queued track to another place.
   */
  public move(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= this.queue.length || to >= this.queue.length) return;
    const queue = [...this.queue];
    const [track] = queue.splice(from, 1);
    queue.splice(to, 0, track);
    const current = this.current;
    this.queue = queue;
    this.index = queue.indexOf(current!);
    this._save(true);
    this.notify();
  }

  public setShuffle(on: boolean) {
    const current = this.current;
    if (on && !this.shuffle) {
      this._unshuffled = [...this.queue];
      // What's played stays; only what comes after is shuffled
      this.queue = [...this.queue.slice(0, this.index + 1), ...shuffled(this.queue.slice(this.index + 1))];
    }
    else if (!on && this.shuffle && this._unshuffled) {
      this.queue = this._unshuffled;
      this.index = Math.max(0, this.queue.findIndex((t) => t.id === current?.id));
      this._unshuffled = null;
    }
    this.shuffle = on;
    this._save(true);
    this.notify();
  }

  public cycleRepeat() {
    this.repeat = this.repeat === "off" ? "all" : this.repeat === "all" ? "one" : "off";
    this._save(true);
    this.notify();
  }

  public setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    this.muted = this.volume === 0;
    if (this._audio) {
      this._audio.volume = this.volume;
      this._audio.muted = this.muted;
    }
    this._save(true);
    this.notify();
  }

  public toggleMute() {
    this.muted = !this.muted;
    if (this._audio) this._audio.muted = this.muted;
    this.notify();
  }

  /**
   * Stop and forget the queue, which hides the mini player.
   */
  public stop() {
    this._leaveBook();
    this._loadId++;
    if (this._audio) {
      this._audio.pause();
      this._audio.removeAttribute("src");
      this._audio.load();
    }
    this.queue = [];
    this.index = -1;
    this.playing = false;
    this.loading = false;
    this.position = 0;
    this.duration = 0;
    this.error = null;
    this.nowPlayingOpen = false;
    this._unshuffled = null;
    this._save(true);
    if ("mediaSession" in navigator) navigator.mediaSession.metadata = null;
    this.notify();
  }

  public openNowPlaying(tab?: "lyrics" | "queue" | "chapters") {
    this.nowPlayingOpen = true;
    if (tab) this.nowPlayingTab = tab;
    this.notify();
  }

  public closeNowPlaying() {
    this.nowPlayingOpen = false;
    this.notify();
  }

  public setNowPlayingTab(tab: "lyrics" | "queue" | "chapters") {
    this.nowPlayingTab = tab;
    this.notify();
  }

  /**
   * Switch to another profile's saved queue (paused), or none when signed out.
   */
  public async setUser(userId: number | null) {
    if (userId === this._userId) return;
    if (this.hasQueue()) this.stop();
    this._userId = userId;
    if (userId === null) return;
    let saved: Saved | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(MusicPlayerController.STORAGE_PREFIX + userId) ?? "null");
    } catch {
      // Nothing saved
    }
    this.speed = saved?.speed ?? 1;
    if (saved?.book) {
      const detail = await BooksApi.get(saved.book.id).catch(() => null);
      if (this._userId !== userId || !detail) return;
      this.volume = saved.volume ?? 1;
      this._startBook(detail, saved.book.position, false);
      return;
    }
    if (!saved?.ids?.length) return;
    const tracks = await MusicApi.tracksByIds(saved.ids).catch(() => [] as TrackInfo[]);
    if (this._userId !== userId || tracks.length === 0) return;
    this.queue = tracks;
    this.index = Math.max(0, Math.min(saved.index, tracks.length - 1));
    this.position = this.current?.id === saved.ids[saved.index] ? saved.position : 0;
    this.duration = this.current?.duration ?? 0;
    this.shuffle = saved.shuffle;
    this.repeat = saved.repeat ?? "off";
    this.volume = saved.volume ?? 1;
    this._updateMediaSession();
    this.notify();
  }

  private _ensureAudio() {
    if (this._audio) return this._audio;
    const audio = new Audio();
    audio.preload = "auto";
    audio.volume = this.volume;
    audio.muted = this.muted;
    audio.addEventListener("playing", () => {
      audio.playbackRate = this.book ? this.speed : 1;
      this.playing = true;
      this.loading = false;
      this.error = null;
      this._setPlaybackState("playing");
      this.notify();
    });
    audio.addEventListener("pause", () => {
      this.playing = false;
      this._setPlaybackState("paused");
      this._save(true);
      this._saveBook(true);
      this.notify();
    });
    audio.addEventListener("waiting", () => {
      this.loading = true;
      this.notify();
    });
    audio.addEventListener("durationchange", () => {
      if (Number.isFinite(audio.duration)) this.duration = audio.duration;
      this._updatePositionState();
      this.notify();
    });
    audio.addEventListener("timeupdate", () => {
      this.position = audio.currentTime;
      this._countPlay();
      this._save();
      this._saveBook();
      this._checkSleep();
      this.notify();
    });
    audio.addEventListener("ended", () => this.next(true));
    audio.addEventListener("error", () => {
      if (!audio.src || !audio.error) return;
      this._fail(new Error("This track can't be played right now."));
    });
    this._audio = audio;
    this._setUpMediaSession();
    return audio;
  }

  /**
   * Fetch a stream for the current track and play it.
   * @param startAt Where to start. Unit is in seconds.
   */
  private async _load(autoplay: boolean, startAt = 0) {
    const track = this.current;
    if (!track) return;
    const loadId = ++this._loadId;
    this.loading = true;
    this.error = null;
    this.position = startAt;
    this.duration = track.duration;
    this._counted = false;
    this._updateMediaSession();
    this._save(true);
    this.notify();
    try {
      this._formats ??= detectAudioFormats();
      const stream = this.book ? await BooksApi.partStream(this.book.id, track.id, this._formats) : await MusicApi.stream(track.id, this._formats);
      if (loadId !== this._loadId) return;
      const audio = this._ensureAudio();
      audio.src = stream.url;
      if (startAt > 0) {
        audio.addEventListener("loadedmetadata", () => {
          if (loadId === this._loadId) audio.currentTime = startAt;
        }, { once: true });
      }
      if (autoplay) await audio.play();
      else {
        this.loading = false;
        this.notify();
      }
    } catch (error) {
      if (loadId === this._loadId) this._fail(error);
    }
  }

  private _fail(error: unknown) {
    // Autoplay without a click first is refused; that's not an error, just paused
    if ((error as Error)?.name === "NotAllowedError") {
      this.loading = false;
      this.playing = false;
      this.notify();
      return;
    }
    if ((error as Error)?.name === "AbortError") return;
    this.loading = false;
    this.playing = false;
    this.error = (error as Error)?.message ?? "This track can't be played right now.";
    this.notify();
  }

  private _countPlay() {
    const track = this.current;
    if (this._counted || !track || this.book) return;
    const needed = Math.min(MusicPlayerController.COUNT_AFTER, (this.duration || track.duration) / 2);
    if (this.position < needed) return;
    this._counted = true;
    track.playCount++;
    MusicApi.played(track.id).catch(() => { });
  }

  /**
   * Remember the queue in this browser. Called often while playing, so it only writes every few seconds.
   * @param now Write right away.
   */
  private _save(now = false) {
    if (this._userId === null) return;
    if (!now && Date.now() - this._lastSaved < 5000) return;
    this._lastSaved = Date.now();
    const key = MusicPlayerController.STORAGE_PREFIX + this._userId;
    try {
      if (!this.hasQueue()) {
        localStorage.removeItem(key);
        return;
      }
      if (this.book) {
        const saved: Saved = { ids: [], index: 0, position: 0, shuffle: false, repeat: "off", volume: this.volume, speed: this.speed, book: { id: this.book.id, position: this.bookPosition() } };
        localStorage.setItem(key, JSON.stringify(saved));
        return;
      }
      // Long queues keep the part around the current track
      const start = Math.max(0, this.index - 100);
      const saved: Saved = {
        ids: this.queue.slice(start, start + 500).map((t) => t.id),
        index: this.index - start,
        position: this.position,
        shuffle: this.shuffle,
        repeat: this.repeat,
        volume: this.volume,
        speed: this.speed,
      };
      localStorage.setItem(key, JSON.stringify(saved));
    } catch {
      // Storage full or blocked: the queue lasts until the tab closes
    }
  }

  //#region Timeline and audiobooks

  /**
   * Where playback is and how long it all is: the track, or the whole audiobook. Unit is in seconds.
   */
  public timeline() {
    return this.book ? { position: this.bookPosition(), duration: this.book.duration } : { position: this.position, duration: this.duration };
  }

  /**
   * Seek on the timeline: in the track, or anywhere in the audiobook.
   */
  public seekTimeline(time: number) {
    if (!this.book) return this.seek(time);
    const t = Math.max(0, Math.min(time, this.book.duration - 0.5));
    const index = this._partAt(t);
    const part = this.book.parts[index];
    if (index === this.index && this._audio?.src) return this.seek(t - part.offset);
    this.index = index;
    this._load(this.playing, t - part.offset);
  }

  /**
   * Jump back or ahead, like 30 seconds in an audiobook.
   * @param seconds Negative goes back.
   */
  public skip(seconds: number) {
    this.seekTimeline(this.timeline().position + seconds);
  }

  /**
   * Seconds into the whole audiobook.
   */
  public bookPosition() {
    const part = this.book?.parts[this.index];
    return part ? part.offset + this.position : 0;
  }

  public currentChapterIndex() {
    if (!this.book) return -1;
    const at = this.bookPosition() + 0.25;
    let found = 0;
    this.book.chapters.forEach((c, i) => {
      if (c.start <= at) found = i;
    });
    return found;
  }

  public currentChapter() {
    return this.book?.chapters[this.currentChapterIndex()] ?? null;
  }

  public nextChapter() {
    const chapters = this.book?.chapters ?? [];
    const next = chapters[this.currentChapterIndex() + 1];
    if (next) this.seekTimeline(next.start);
  }

  /**
   * To the start of this chapter, or the one before when it only just started.
   */
  public previousChapter() {
    const chapters = this.book?.chapters ?? [];
    const index = this.currentChapterIndex();
    const chapter = chapters[index];
    if (!chapter) return;
    const into = this.bookPosition() - chapter.start;
    this.seekTimeline(into > MusicPlayerController.RESTART_WITHIN || index === 0 ? chapter.start : chapters[index - 1].start);
  }

  /**
   * Listen to an audiobook, from where the profile left off unless `startAt` says otherwise.
   * @param startAt Seconds into the whole book.
   */
  public playBook(detail: BookDetail, startAt?: number) {
    this._leaveBook();
    this._startBook(detail, startAt ?? detail.position, true);
  }

  private _startBook(detail: BookDetail, startAt: number, autoplay: boolean) {
    if (detail.parts.length === 0) return;
    this.book = {
      id: detail.id,
      title: detail.title,
      authors: detail.authors,
      cover: detail.cover,
      palette: detail.palette,
      parts: detail.parts,
      chapters: detail.chapters.length ? detail.chapters : detail.parts.map((p) => ({ title: p.title, start: p.offset, end: p.offset + p.duration })),
      duration: detail.duration ?? detail.parts.reduce((sum, p) => sum + p.duration, 0),
    };
    // The parts stand in for tracks, so the mini player and media controls work the same
    this.queue = detail.parts.map((part, i) => ({
      id: part.fileId,
      title: part.title,
      albumId: null,
      albumTitle: detail.title,
      artistId: null,
      artistName: detail.authors.join(", ") || detail.title,
      trackArtist: null,
      disc: null,
      number: i + 1,
      duration: part.duration,
      cover: detail.cover,
      palette: detail.palette,
      playCount: 0,
    }));
    this._unshuffled = null;
    this.shuffle = false;
    this.repeat = "off";
    this.nowPlayingTab = "chapters";
    const start = Math.max(0, Math.min(startAt, this.book.duration - 1));
    this.index = this._partAt(start);
    const offset = start - this.book.parts[this.index].offset;
    if (autoplay) {
      this._load(true, offset);
    }
    else {
      this.position = offset;
      this.duration = this.current?.duration ?? 0;
      this._updateMediaSession();
      this.notify();
    }
  }

  public setSpeed(speed: number) {
    this.speed = speed;
    if (this._audio && this.book) this._audio.playbackRate = speed;
    this._updatePositionState();
    this._save(true);
    this.notify();
  }

  /**
   * Stop playback after some minutes or at the end of the chapter. `null` turns the timer off.
   */
  public setSleep(mode: SleepTimer | null) {
    if (this._sleepTimer) clearTimeout(this._sleepTimer);
    this._sleepTimer = null;
    if (mode === null) this.sleep = null;
    else if (mode === "chapter") this.sleep = { mode, at: this.currentChapter()?.end ?? this.timeline().duration };
    else {
      this.sleep = { mode, at: Date.now() + mode * 60_000 };
      this._sleepTimer = setTimeout(() => this._fallAsleep(), mode * 60_000);
    }
    this.notify();
  }

  private _checkSleep() {
    if (this.sleep?.mode === "chapter" && this.bookPosition() >= this.sleep.at - 0.5) this._fallAsleep();
  }

  private _fallAsleep() {
    if (this._sleepTimer) clearTimeout(this._sleepTimer);
    this._sleepTimer = null;
    this.sleep = null;
    this.pause();
    this.notify();
  }

  /**
   * The part that plays at `time` seconds into the book.
   */
  private _partAt(time: number) {
    const parts = this.book?.parts ?? [];
    let index = 0;
    parts.forEach((p, i) => {
      if (p.offset <= time) index = i;
    });
    return index;
  }

  private _nextPart() {
    if (!this.book) return;
    if (this.index < this.queue.length - 1) {
      this.index++;
      this._load(true);
      return;
    }
    // The end of the book
    BooksApi.progress(this.book.id, { finished: true }).catch(() => { });
    this.pause();
    this.seek(0);
  }

  /**
   * Save the place in the audiobook on the server. Called often while playing, so it only sends now and then.
   * @param now Send right away.
   */
  private _saveBook(now = false) {
    if (!this.book || (!now && Date.now() - this._lastBookSave < MusicPlayerController.BOOK_SAVE_EVERY)) return;
    this._lastBookSave = Date.now();
    BooksApi.progress(this.book.id, { position: this.bookPosition() }).catch(() => { });
  }

  /**
   * Save the place in the audiobook and go back to music mode.
   */
  private _leaveBook() {
    if (!this.book) return;
    this._saveBook(true);
    this.book = null;
    this.setSleep(null);
    if (this.nowPlayingTab === "chapters") this.nowPlayingTab = "queue";
  }

  //#endregion

  //#region Media Session

  private _setUpMediaSession() {
    if (!("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => this.resume()],
      ["pause", () => this.pause()],
      ["previoustrack", () => this.previous()],
      ["nexttrack", () => this.next()],
      ["seekbackward", (d) => this.skip(-(d.seekOffset ?? (this.book ? 30 : 10)))],
      ["seekforward", (d) => this.skip(d.seekOffset ?? (this.book ? 30 : 10))],
      ["seekto", (d) => d.seekTime !== undefined && this.seekTimeline(d.seekTime)],
      ["stop", () => this.stop()],
    ];
    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // This browser doesn't know that action
      }
    }
  }

  private _updateMediaSession() {
    const track = this.current;
    if (!("mediaSession" in navigator) || !track) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: this.book ? this.currentChapter()?.title ?? this.book.title : track.title,
      artist: track.trackArtist ?? track.artistName,
      album: track.albumTitle,
      artwork: track.cover ? [256, 512].map((size) => ({ src: new URL(ItemsApi.imageUrl(track.cover!, size), location.origin).toString(), sizes: `${size}x${size}`, type: "image/jpeg" })) : [],
    });
  }

  private _setPlaybackState(state: MediaSessionPlaybackState) {
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = state;
    this._updatePositionState();
  }

  private _updatePositionState() {
    const { position, duration } = this.timeline();
    if (!("mediaSession" in navigator) || !duration || !Number.isFinite(duration)) return;
    try {
      navigator.mediaSession.setPositionState({ duration, position: Math.min(position, duration), playbackRate: this.book ? this.speed : 1 });
    } catch {
      // Position out of range while switching tracks
    }
  }

  //#endregion
}

export const musicPlayer = new MusicPlayerController();

// Media keys on keyboards and TV remotes control the music, except in the video player, which has its own
addEventListener("keydown", (e) => {
  if (!musicPlayer.hasQueue() || e.defaultPrevented || router.path.startsWith("/watch")) return;
  const actions: Record<string, () => void> = {
    MediaPlayPause: () => musicPlayer.toggle(),
    MediaPlay: () => musicPlayer.resume(),
    MediaPause: () => musicPlayer.pause(),
    MediaTrackNext: () => musicPlayer.next(),
    MediaTrackPrevious: () => musicPlayer.previous(),
  };
  const action = actions[e.key];
  if (!action) return;
  e.preventDefault();
  action();
});

export default musicPlayer;
