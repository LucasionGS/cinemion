import Hls from "hls.js";
import type { ItemDetail, ItemSummary, SubtitleTrack } from "@shared/media.ts";
import { languageName } from "@shared/languages.ts";
import type { PlaybackInfo, QualityPreset, StartPlaybackRequest, TrickplayInfo } from "@shared/playback.ts";
import type { TogetherAction } from "@shared/together.ts";
import { together, type TogetherSession } from "../../lib/Together.ts";
import { toasts } from "../../lib/Toasts.ts";
import Controller from "../../lib/Controller.ts";
import { detectCapabilities, hasMediaSource } from "../../lib/capabilities.ts";
import { type Cue, parseVtt } from "../../lib/vtt.ts";
import PlaybackApi from "../../Api/PlaybackApi.ts";
import { devicePrefs } from "../../lib/DevicePrefs.ts";
import { canRenderStyled, renderStyled } from "../../lib/styledSubtitles.ts";
import type JASSUB from "jassub";
import { session } from "../../Session.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import { defaultSubtitle, tracksFor } from "../../lib/playback.ts";

export type PanelTab = "subtitles" | "audio" | "quality";

/**
 * Everything the player shows and does: loading streams, seeking across conversion sessions,
 * tracks, subtitles, progress reporting and the next-episode countdown.
 * Times are always positions in the whole file, even when a conversion started part-way in.
 */
export class PlayerController extends Controller {
  public item: ItemDetail;
  public info: PlaybackInfo | null = null;
  public next: ItemSummary | null = null;

  public loading = true;
  public playing = false;
  public buffering = false;
  public ended = false;
  public error: string | null = null;

  /**
   * Position in the file, in seconds.
   */
  public position = 0;
  public duration = 0;
  /**
   * How far the stream is loaded, as a position in the file.
   */
  public bufferedEnd = 0;
  public volume = 1;
  public muted = false;
  public fullscreen = false;

  public controlsVisible = true;
  public panelOpen = false;
  public subtitleSearchOpen = false;
  public togetherOpen = false;
  public panelTab: PanelTab = "subtitles";
  /**
   * Where TV-style scrubbing will jump to, or `null` when not scrubbing.
   */
  public scrubTarget: number | null = null;
  /**
   * Seconds until the next episode starts, or `null` when the countdown isn't showing.
   */
  public nextCountdown: number | null = null;

  /**
   * Seek thumbnails, once the server has made them.
   */
  public trickplay: TrickplayInfo | null = null;
  public subtitleIndex: number | null = null;
  public cues: Cue[] = [];
  /**
   * Subtitles are drawn with their own styling (ASS), so the plain subtitle text is hidden.
   */
  public styled = false;

  private _video: HTMLVideoElement | null = null;
  private _hls: Hls | null = null;
  private _hideTimer: ReturnType<typeof setTimeout> | null = null;
  private _progressTimer: ReturnType<typeof setInterval> | null = null;
  private _pingTimer: ReturnType<typeof setInterval> | null = null;
  private _trickplayTimer: ReturnType<typeof setTimeout> | null = null;
  private _lastSaved = 0;
  private _loadId = 0;
  private _recovering = false;
  private _restarts: number[] = [];
  private _nextDismissed = false;
  private _destroyed = false;
  private _wantPlay = true;
  private _together: TogetherSession | null = null;
  private _togetherCleanup: (() => void)[] = [];
  private _applyingShared = false;
  private _styledRenderer: JASSUB | null = null;
  // Intros already skipped by themselves, by start time, so seeking back into one doesn't skip it again
  private _autoSkipped = new Set<number>();
  private _creditsAdvanced = false;

  /**
   * Seconds before the end at which the next episode countdown appears.
   */
  public static readonly NEXT_UP_SECONDS = 30;
  /**
   * When the credits are known, the next episode starts this many seconds into them.
   */
  public static readonly CREDITS_COUNTDOWN = 10;
  private static readonly HIDE_AFTER_MS = 3500;
  private static readonly PROGRESS_EVERY_MS = 10_000;
  private static readonly PING_EVERY_MS = 30_000;
  private static readonly VOLUME_KEY = "cn-volume";

  /**
   * @param onExit Leave the player.
   * @param onOpenItem Switch the player to another movie or episode, like the next episode.
   */
  constructor(item: ItemDetail, public readonly onExit: () => void, public readonly onOpenItem: (itemId: number) => void) {
    super();
    this.item = item;
    this.duration = item.files[0]?.duration ?? (item.runtime ?? 0) * 60;
    try {
      const saved = JSON.parse(localStorage.getItem(PlayerController.VOLUME_KEY) ?? "null");
      if (saved) {
        this.volume = saved.volume ?? 1;
        this.muted = !!saved.muted;
      }
    } catch {
      // Defaults are fine
    }
  }

  public get video() {
    return this._video;
  }

  /**
   * Where the current stream starts in the file, in seconds.
   */
  public get offset() {
    return this.info?.startOffset ?? 0;
  }

  //#region Lifecycle
  /**
   * Connect the `<video>` element and start playing from `startAt` seconds.
   */
  public attach(video: HTMLVideoElement, startAt: number) {
    // React may detach and attach again (StrictMode); start over cleanly
    this._destroyed = false;
    this._video = video;
    video.volume = this.volume;
    video.muted = this.muted;

    video.addEventListener("timeupdate", this._onTimeUpdate);
    video.addEventListener("progress", this._onProgress);
    video.addEventListener("play", this._onPlayState);
    video.addEventListener("pause", this._onPlayState);
    video.addEventListener("waiting", this._onWaiting);
    video.addEventListener("playing", this._onPlaying);
    video.addEventListener("canplay", this._onPlaying);
    video.addEventListener("ended", this._onEnded);
    video.addEventListener("error", this._onVideoError);
    video.addEventListener("volumechange", this._onVolume);
    document.addEventListener("fullscreenchange", this._onFullscreen);
    addEventListener("pagehide", this._onPageHide);
    addEventListener("pageshow", this._onPageShow);

    this._progressTimer = setInterval(() => {
      this.saveProgress();
      this._report();
    }, PlayerController.PROGRESS_EVERY_MS);
    this._pingTimer = setInterval(() => {
      if (this.info?.sessionId) PlaybackApi.ping(this.info.sessionId);
    }, PlayerController.PING_EVERY_MS);

    this._setupMediaSession();
    // Episodes lead to the next episode, videos to the next one in their folder
    if (this.item.type === "episode" || this.item.type === "video") ItemsApi.next(this.item.id).then((n) => this.next = n).catch(() => { });

    // Start with what was picked on the title's page, or the file's defaults
    const choice = tracksFor(this.item.id);
    const file = this.item.files.find((f) => f.id === choice.fileId) ?? this.item.files[0];
    this.load({
      startAt,
      fileId: choice.fileId,
      audioIndex: choice.audioIndex ?? null,
      subtitleIndex: choice.subtitleIndex !== undefined ? choice.subtitleIndex : defaultSubtitle(file)?.index ?? null,
    });
  }

  /**
   * Save progress, stop the conversion and let go of the video element.
   */
  public destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.saveProgress(true);
    this.disconnectTogether();
    if (this.info?.sessionId) PlaybackApi.stop(this.info.sessionId);
    if (this.info) PlaybackApi.ended(this.info.playbackId);
    if (this._progressTimer) clearInterval(this._progressTimer);
    if (this._pingTimer) clearInterval(this._pingTimer);
    if (this._hideTimer) clearTimeout(this._hideTimer);
    if (this._trickplayTimer) clearTimeout(this._trickplayTimer);
    document.removeEventListener("fullscreenchange", this._onFullscreen);
    removeEventListener("pagehide", this._onPageHide);
    removeEventListener("pageshow", this._onPageShow);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
    this._hls?.destroy();
    this._hls = null;
    this._stopStyled();
    const video = this._video;
    if (video) {
      video.removeEventListener("timeupdate", this._onTimeUpdate);
      video.removeEventListener("progress", this._onProgress);
      video.removeEventListener("play", this._onPlayState);
      video.removeEventListener("pause", this._onPlayState);
      video.removeEventListener("waiting", this._onWaiting);
      video.removeEventListener("playing", this._onPlaying);
      video.removeEventListener("canplay", this._onPlaying);
      video.removeEventListener("ended", this._onEnded);
      video.removeEventListener("error", this._onVideoError);
      video.removeEventListener("volumechange", this._onVolume);
      video.removeAttribute("src");
      video.load();
    }
    if ("mediaSession" in navigator) navigator.mediaSession.metadata = null;
  }

  /**
   * Ask the server for a stream and play it. Stops the previous conversion.
   */
  public async load(opts: { startAt: number; audioIndex?: number | null; subtitleIndex?: number | null; quality?: QualityPreset; fileId?: number }) {
    const loadId = ++this._loadId;
    const previous = this.info;
    this.loading = true;
    this.error = null;
    this.ended = false;
    this.position = opts.startAt;
    this.notify();

    const subtitleIndex = opts.subtitleIndex !== undefined ? opts.subtitleIndex : this.subtitleIndex;
    const request: StartPlaybackRequest = {
      fileId: opts.fileId ?? previous?.fileId,
      audioIndex: opts.audioIndex !== undefined ? opts.audioIndex ?? undefined : previous?.audioIndex ?? undefined,
      // Only picture subtitles change the stream; text subtitles are drawn here
      subtitleIndex: this._isImageSubtitle(subtitleIndex, opts.fileId ?? previous?.fileId) ? subtitleIndex : null,
      startAt: opts.startAt,
      quality: opts.quality ?? previous?.quality ?? "original",
      capabilities: detectCapabilities(),
      playbackId: previous?.playbackId,
    };

    let info: PlaybackInfo;
    try {
      info = await PlaybackApi.start(this.item.id, request);
    } catch (error) {
      if (loadId !== this._loadId || this._destroyed) return;
      this.loading = false;
      this.error = (error as Error).message;
      this.notify();
      return;
    }
    if (loadId !== this._loadId || this._destroyed) {
      if (info.sessionId) PlaybackApi.stop(info.sessionId);
      // The same viewing carries on when the server reused the previous id
      if (info.playbackId !== previous?.playbackId) PlaybackApi.ended(info.playbackId);
      return;
    }
    if (previous?.sessionId) PlaybackApi.stop(previous.sessionId);

    this.info = info;
    this.duration = info.duration || this.duration;
    this.trickplay = info.trickplay;
    if (!this.trickplay) this._waitForTrickplay(info.streamBase, 0);
    this._recovering = false;
    this._attachStream(info, opts.startAt);
    this.setSubtitle(subtitleIndex, { reload: false });
    this.notify();
  }

  private _attachStream(info: PlaybackInfo, startAt: number) {
    const video = this._video!;
    this._hls?.destroy();
    this._hls = null;
    // Where to start inside this stream; a conversion already starts at the right place
    const local = info.mode === "direct" ? startAt : Math.max(0, startAt - info.startOffset);

    if (info.mode === "direct" || !hasMediaSource()) {
      // Direct files, and HLS on browsers that play it themselves (older iPhones)
      video.src = info.url;
      const seekOnce = () => {
        video.removeEventListener("loadedmetadata", seekOnce);
        if (local > 0) video.currentTime = local;
        this._resume();
      };
      video.addEventListener("loadedmetadata", seekOnce);
      return;
    }

    const hls = new Hls({
      // Copied video starts at a keyframe a little before the requested time
      startPosition: local,
      // The playlist grows while the server converts; never jump ahead to its end like live TV would
      liveSyncDurationCount: 1_000_000,
      liveMaxLatencyDurationCount: Infinity,
      liveDurationInfinity: false,
      maxBufferLength: 60,
      manifestLoadingTimeOut: 30_000,
      fragLoadingTimeOut: 60_000,
    });
    this._hls = hls;
    hls.on(Hls.Events.MANIFEST_PARSED, () => this._resume());
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !this._recovering) {
        this._recovering = true;
        hls.recoverMediaError();
        return;
      }
      this._restartHere();
    });
    hls.loadSource(info.url);
    hls.attachMedia(video);
  }

  /**
   * Thumbnails for a file are made the first time it's played; check back until they're there.
   */
  private _waitForTrickplay(streamBase: string, attempt: number) {
    if (this._trickplayTimer) clearTimeout(this._trickplayTimer);
    if (attempt > 60) return;
    this._trickplayTimer = setTimeout(async () => {
      if (this._destroyed || this.info?.streamBase !== streamBase) return;
      const info = await fetch(`${streamBase}/trickplay`).then((r) => r.ok ? r.json() as Promise<TrickplayInfo | null> : null).catch(() => null);
      if (info) {
        this.trickplay = info;
        this.notify();
      }
      else {
        this._waitForTrickplay(streamBase, attempt + 1);
      }
    }, 10_000);
  }

  private _resume() {
    const video = this._video;
    if (!video) return;
    if (this._wantPlay) {
      video.play().catch(() => {
        // Autoplay was blocked: show the play button instead
        this.playing = false;
        this.loading = false;
        this.notify();
      });
    }
    else {
      this.loading = false;
      this.notify();
    }
  }

  /**
   * After a stream error (often a conversion stopped while paused), start again where playback was.
   */
  private _restartHere() {
    if (this._destroyed) return;
    const now = Date.now();
    this._restarts = this._restarts.filter((t) => now - t < 60_000);
    if (this._restarts.length >= 3) {
      this._hls?.destroy();
      this._hls = null;
      this.loading = false;
      this.error = "The stream keeps stopping. The server log may say why.";
      this.notify();
      return;
    }
    this._restarts.push(now);
    this.load({ startAt: this.position });
  }
  //#endregion

  //#region Video events
  private _onTimeUpdate = () => {
    const video = this._video!;
    // While a new stream loads, the old one's times are meaningless
    if (this.loading) return;
    this.position = this.offset + video.currentTime;
    this._autoSkipIntro();
    this._updateNextUp();
    this.notify();
  };

  private _onProgress = () => {
    const video = this._video!;
    const ranges = video.buffered;
    let end = 0;
    for (let i = 0; i < ranges.length; i++) {
      if (ranges.start(i) <= video.currentTime + 0.5) end = Math.max(end, ranges.end(i));
    }
    this.bufferedEnd = this.offset + end;
    this.notify();
  };

  /**
   * Closing the tab doesn't unmount anything, so save and let go here; the conversion and the dashboard entry
   * would otherwise linger until they time out.
   */
  private _onPageHide = () => {
    this.saveProgress(true);
    if (this.info?.sessionId) PlaybackApi.stop(this.info.sessionId);
    if (this.info) PlaybackApi.ended(this.info.playbackId);
  };

  /**
   * Back from the browser's back/forward cache: the stream was let go on the way out, so start it again.
   */
  private _onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted && !this._destroyed) this.load({ startAt: this.position });
  };

  private _onPlayState = () => {
    this.playing = !this._video!.paused;
    this._report();
    if (!this.playing) {
      this.saveProgress();
      this.showControls();
    }
    else {
      this.scheduleHide();
    }
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = this.playing ? "playing" : "paused";
    this.notify();
  };

  private _onWaiting = () => {
    this.buffering = true;
    this.notify();
  };

  private _onPlaying = () => {
    this.buffering = false;
    this.loading = false;
    this.notify();
  };

  private _onEnded = () => {
    // A conversion's stream can end before the file does when it was stopped; only the real end counts
    if (this.duration && this.position < this.duration - 2 && this.info?.mode !== "direct") {
      this._restartHere();
      return;
    }
    this.ended = true;
    this.playing = false;
    this.saveProgress(true);
    this.notify();
    // Watching together, the host decides what's next; everyone else waits for them
    if (this._together?.isConnected() && !this._together.isHost()) return;
    if (this.next && !this._nextDismissed) this.playNext();
    else this.onExit();
  };

  private _onVideoError = () => {
    if (this._hls || this._destroyed) return;
    const code = this._video?.error?.code;
    if (!this._recovering && this.info?.mode === "direct") {
      // The browser said it could play this but couldn't; let the server convert it instead
      this._recovering = true;
      this.load({ startAt: this.position, quality: "1080p" });
      return;
    }
    this.loading = false;
    this.error = code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ? "This device can't play the video." : "The video stopped loading. Check your connection and try again.";
    this.notify();
  };

  private _onVolume = () => {
    const video = this._video!;
    this.volume = video.volume;
    this.muted = video.muted;
    try {
      localStorage.setItem(PlayerController.VOLUME_KEY, JSON.stringify({ volume: this.volume, muted: this.muted }));
    } catch {
      // Not remembered, that's all
    }
    this.notify();
  };

  private _onFullscreen = () => {
    this.fullscreen = !!document.fullscreenElement;
    this.notify();
  };
  //#endregion

  //#region Controls
  public play() {
    if (!this._shareControl("play", this.ended ? 0 : this.position)) return;
    this._wantPlay = true;
    if (this.ended) {
      this.seek(0);
      return;
    }
    this._video?.play().catch(() => { });
  }

  public pause() {
    if (!this._shareControl("pause", this.position)) return;
    this._wantPlay = false;
    this._video?.pause();
  }

  public togglePlay() {
    if (!this._video || this.error) return;
    if (this._video.paused) this.play();
    else this.pause();
  }

  /**
   * Jump to `time` seconds in the file. Positions the current conversion hasn't reached start a new one.
   */
  public seek(time: number) {
    const video = this._video;
    if (!video || !this.info) return;
    const target = Math.max(0, Math.min(time, Math.max(0, this.duration - 1)));
    if (!this._shareControl("seek", target)) return;
    this.ended = false;
    this.position = target;

    if (this.info.mode === "direct") {
      video.currentTime = target;
    }
    else {
      const local = target - this.info.startOffset;
      const seekable = video.seekable.length ? video.seekable.end(video.seekable.length - 1) : 0;
      // Within what's been converted so far (with a little room for what's about to arrive)
      if (local >= 0 && local <= seekable + 8) video.currentTime = local;
      else this.load({ startAt: target });
    }
    this._updateNextUp();
    this.notify();
  }

  public seekBy(seconds: number) {
    this.seek(this.position + seconds);
    this.showControls();
  }

  public setVolume(volume: number) {
    if (!this._video) return;
    this._video.volume = Math.max(0, Math.min(1, volume));
    if (volume > 0) this._video.muted = false;
  }

  public toggleMute() {
    if (this._video) this._video.muted = !this._video.muted;
  }

  public async toggleFullscreen(element: HTMLElement) {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await element.requestFullscreen();
    } catch {
      // Not allowed here (some TVs and iframes)
    }
  }

  public async togglePictureInPicture() {
    const video = this._video;
    if (!video || !document.pictureInPictureEnabled) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch {
      // Not available for this video
    }
  }

  public setAudio(index: number) {
    if (index === this.info?.audioIndex) return;
    this.load({ startAt: this.position, audioIndex: index });
  }

  public setQuality(quality: QualityPreset) {
    if (quality === this.info?.quality) return;
    this.load({ startAt: this.position, quality });
  }

  public setVersion(fileId: number) {
    if (fileId === this.info?.fileId) return;
    this.load({ startAt: this.position, fileId, audioIndex: null, subtitleIndex: null });
  }

  /**
   * Show the subtitle stream `index`, or none for `null`. Picture subtitles restart the stream to draw them in.
   */
  public async setSubtitle(index: number | null, opts?: { reload?: boolean }) {
    const reload = opts?.reload ?? true;
    const info = this.info;
    const wasBurned = info?.subtitleIndex !== null && info?.subtitleIndex !== undefined;
    this.subtitleIndex = index;
    this.cues = [];
    this._stopStyled();
    this.notify();

    if (reload && (this._isImageSubtitle(index, info?.fileId) || wasBurned)) {
      this.load({ startAt: this.position, subtitleIndex: index });
      return;
    }

    const option = info?.subtitles.find((s) => s.index === index);
    // ASS subtitles keep their look when the profile wants that and the browser can draw them
    const keepStyling = session.user?.preferences.subtitles.keepStyling ?? true;
    if (option?.styledUrl && keepStyling && canRenderStyled() && this._video && info) {
      try {
        const renderer = await renderStyled(this._video, option.styledUrl, `${info.streamBase}/fonts`, info.mode === "direct" ? 0 : info.startOffset);
        if (this.subtitleIndex !== index || this._destroyed || this.info !== info) {
          renderer.destroy();
          return;
        }
        this._styledRenderer = renderer;
        this.styled = true;
        this.notify();
        return;
      } catch (error) {
        // Plain text is better than nothing
        console.warn("Could not draw styled subtitles", error);
      }
    }
    if (!option?.url) return;
    try {
      const res = await fetch(option.url);
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? res.statusText);
      const cues = parseVtt(await res.text());
      if (this.subtitleIndex === index) {
        this.cues = cues;
        this.notify();
      }
    } catch (error) {
      if (this.subtitleIndex === index) {
        this.subtitleIndex = null;
        this.error = null;
        this.notify();
      }
      console.warn("Could not load subtitles", error);
    }
  }

  private _stopStyled() {
    this._styledRenderer?.destroy();
    this._styledRenderer = null;
    this.styled = false;
  }

  /**
   * Add a subtitle track that was just downloaded, and turn it on.
   */
  public addSubtitle(track: SubtitleTrack) {
    const info = this.info;
    if (!info) return;
    const file = this.item.files.find((f) => f.id === info.fileId);
    if (file && !file.subtitles.some((s) => s.index === track.index)) file.subtitles = [...file.subtitles, track];
    if (!info.subtitles.some((s) => s.index === track.index)) {
      info.subtitles = [...info.subtitles, {
        index: track.index,
        label: track.title ?? languageName(track.language) ?? "Subtitles",
        language: track.language,
        detail: ["Downloaded", track.isHearingImpaired ? "SDH" : null, "Text"].filter(Boolean).join(" · "),
        isForced: track.isForced,
        isDefault: false,
        url: `${info.streamBase}/subtitles/${track.index}.vtt`,
        styledUrl: track.codec === "ass" || track.codec === "ssa" ? `${info.streamBase}/subtitles/${track.index}.ass` : null,
      }];
    }
    this.setSubtitle(track.index);
  }

  //#region Watch together
  /**
   * Follow a watch together session: share this player's controls, and follow everyone else's.
   */
  public connectTogether(session: TogetherSession) {
    this.disconnectTogether();
    this._together = session;
    // Start paused or playing like everyone else
    if (session.room) this._wantPlay = session.room.state.playing;
    this._togetherCleanup = [
      session.onControl((_state, byMe) => {
        if (!byMe) this._applyShared();
      }),
      session.onItem((itemId) => {
        if (itemId !== this.item.id) this.onOpenItem(itemId);
      }),
      session.subscribe(() => this.notify()),
    ];
    const sync = setInterval(() => this._keepInSync(), 1000);
    const status = setInterval(() => {
      if (session.isConnected()) session.sendStatus(this.loading ? "loading" : this.buffering ? "buffering" : "ready", this.position);
    }, 2000);
    this._togetherCleanup.push(() => clearInterval(sync), () => clearInterval(status));
  }

  public disconnectTogether() {
    this._togetherCleanup.forEach((cleanup) => cleanup());
    this._togetherCleanup = [];
    this._together = null;
    if (this._video) this._video.playbackRate = 1;
  }

  public get together() {
    return this._together;
  }

  /**
   * Tell the room about a local play, pause or seek. Returns `false` when this device isn't allowed to.
   */
  private _shareControl(action: TogetherAction, position: number) {
    const t = this._together;
    if (!t?.isConnected() || this._applyingShared) return true;
    if (!t.canControl()) {
      toasts.show({ title: "Only the host can pause and seek", description: "Ask them to turn on \"Anyone can pause and seek\"." });
      return false;
    }
    t.sendControl(action, position);
    return true;
  }

  /**
   * Match the room's shared state: jump when far off, then play or pause.
   */
  private _applyShared() {
    const t = this._together;
    const video = this._video;
    if (!t?.room || !video || !this.info) return;
    const state = t.room.state;
    this._applyingShared = true;
    try {
      this._wantPlay = state.playing;
      const expected = t.expectedPosition();
      const beyondEnd = !!this.duration && expected >= this.duration - 1;
      if (Math.abs(expected - this.position) > 1.5 && !beyondEnd) this.seek(expected);
      if (state.playing && video.paused && !this.loading) video.play().catch(() => { });
      if (!state.playing && !video.paused) video.pause();
    } finally {
      this._applyingShared = false;
    }
  }

  /**
   * Small drift is fixed by playing a little faster or slower; big drift by jumping.
   */
  private _keepInSync() {
    const t = this._together;
    const video = this._video;
    if (!t?.isConnected() || !t.room || !video || this.loading || this.error) return;
    const state = t.room.state;
    const expected = t.expectedPosition();
    // Past the end there's nothing to catch up with; let this player finish on its own
    if (this.ended || video.ended || (this.duration && expected >= this.duration - 1)) {
      video.playbackRate = 1;
      return;
    }
    if (!state.playing) {
      video.playbackRate = 1;
      if (!video.paused) this._applyShared();
      return;
    }
    if (video.paused) {
      this._applyShared();
      return;
    }
    const drift = expected - this.position;
    if (Math.abs(drift) > 2.5) this._applyShared();
    else if (Math.abs(drift) > 0.35) video.playbackRate = drift > 0 ? 1.06 : 0.94;
    else video.playbackRate = 1;
  }

  public setTogetherOpen(open: boolean) {
    this.togetherOpen = open;
    if (open) this.panelOpen = false;
    this.showControls();
    this.notify();
  }
  //#endregion

  public setSubtitleSearchOpen(open: boolean) {
    this.subtitleSearchOpen = open;
    if (open) this.panelOpen = false;
    this.showControls();
    this.notify();
  }

  private _isImageSubtitle(index: number | null | undefined, fileId: number | undefined) {
    if (index === null || index === undefined) return false;
    const file = this.item.files.find((f) => f.id === fileId) ?? this.item.files[0];
    return !!file?.subtitles.find((s) => s.index === index)?.isImage;
  }

  public openPanel(tab?: PanelTab) {
    this.panelOpen = true;
    this.togetherOpen = false;
    if (tab) this.panelTab = tab;
    this.showControls();
    this.notify();
  }

  public closePanel() {
    this.panelOpen = false;
    this.scheduleHide();
    this.notify();
  }

  public setPanelTab(tab: PanelTab) {
    this.panelTab = tab;
    this.notify();
  }

  /**
   * Show the controls and hide them again after a while if the video is playing.
   */
  public showControls() {
    if (!this.controlsVisible) {
      this.controlsVisible = true;
      this.notify();
    }
    this.scheduleHide();
  }

  public scheduleHide() {
    if (this._hideTimer) clearTimeout(this._hideTimer);
    this._hideTimer = setTimeout(() => {
      if (!this.playing || this.panelOpen || this.togetherOpen || this.subtitleSearchOpen || this.scrubTarget !== null) return;
      this.controlsVisible = false;
      this.notify();
    }, PlayerController.HIDE_AFTER_MS);
  }

  public hideControls() {
    if (this.panelOpen || !this.playing) return;
    this.controlsVisible = false;
    this.notify();
  }

  /**
   * Move the scrub position by `seconds` without seeking yet (remote-style seeking).
   */
  public scrubBy(seconds: number) {
    this.scrubTarget = Math.max(0, Math.min((this.scrubTarget ?? this.position) + seconds, this.duration));
    this.showControls();
    this.notify();
  }

  public commitScrub() {
    if (this.scrubTarget === null) return;
    const target = this.scrubTarget;
    this.scrubTarget = null;
    this.seek(target);
    this.scheduleHide();
  }

  public cancelScrub() {
    this.scrubTarget = null;
    this.scheduleHide();
    this.notify();
  }
  //#endregion

  //#region Progress and next episode
  /**
   * Tell the server where playback is. Skipped when nothing changed, unless `force` is set.
   */
  public saveProgress(force = false) {
    if (!this.info || this.loading && !force) return;
    // Watching along doesn't change your own progress; only the host's counts. This checks the session itself,
    // since the player stops following it a moment before moving on to the next title.
    if (together.isConnected() && !together.isHost()) return;
    const position = Math.floor(this.position);
    if (!force && Math.abs(position - this._lastSaved) < 2) return;
    this._lastSaved = position;
    PlaybackApi.saveProgress(this.item.id, this.ended ? this.duration : position, this.duration || null);
  }

  /**
   * Tell the dashboard where playback is and whether it's paused.
   */
  private _report() {
    if (!this.info || this._destroyed) return;
    PlaybackApi.report(this.info.playbackId, this.position, !this.playing);
  }

  //#region Intros and credits
  /**
   * The intro playing right now, while there's still something of it to skip.
   */
  public get intro() {
    if (devicePrefs.skipIntros === "off" || this.scrubTarget !== null) return null;
    return this.info?.markers.find((m) => m.kind === "intro" && this.position >= m.start && this.position < m.end - 1) ?? null;
  }

  public skipIntro() {
    const intro = this.intro;
    if (!intro) return;
    this._autoSkipped.add(intro.start);
    this.seek(intro.end);
  }

  private _autoSkipIntro() {
    if (devicePrefs.skipIntros !== "auto" || this.loading) return;
    // Watching along, only the host skips; everyone else follows
    if (this._together?.isConnected() && !this._together.isHost()) return;
    const intro = this.intro;
    if (!intro || this._autoSkipped.has(intro.start)) return;
    this._autoSkipped.add(intro.start);
    this.seek(intro.end);
    toasts.show({ title: "Skipped the intro" });
  }
  //#endregion

  private _updateNextUp() {
    if (!this.next || this._nextDismissed || !this.duration) return;
    // Watching along, the host's player moves everyone on
    if (this._together?.isConnected() && !this._together.isHost()) {
      if (this.nextCountdown !== null) {
        this.nextCountdown = null;
        this.notify();
      }
      return;
    }
    // With known credits the countdown starts with them and moves on a little later; otherwise at the very end
    const credits = this.info?.markers.find((m) => m.kind === "credits" && m.start < this.duration - 5);
    const showFrom = credits ? credits.start : this.duration - PlayerController.NEXT_UP_SECONDS;
    const deadline = credits ? Math.min(credits.start + PlayerController.CREDITS_COUNTDOWN, this.duration) : this.duration;
    const countdown = this.position >= showFrom && this.scrubTarget === null ? Math.max(0, Math.ceil(deadline - this.position)) : null;
    if (countdown !== this.nextCountdown) {
      this.nextCountdown = countdown;
      this.notify();
    }
    if (credits && countdown === 0 && !this._creditsAdvanced) {
      this._creditsAdvanced = true;
      this.playNext();
    }
  }

  public dismissNext() {
    this._nextDismissed = true;
    this.nextCountdown = null;
    this.notify();
  }

  public playNext() {
    if (!this.next) return;
    if (together.isConnected() && !together.isHost()) {
      toasts.show({ title: "The host picks what's next", description: "Everyone moves on when their episode ends." });
      return;
    }
    // The rest is credits; count this one as watched
    PlaybackApi.saveProgress(this.item.id, this.duration, this.duration || null);
    if (this._together?.isConnected()) this._together.sendItem(this.next.id);
    this.onOpenItem(this.next.id);
  }
  //#endregion

  private _setupMediaSession() {
    if (!("mediaSession" in navigator)) return;
    const item = this.item;
    const artwork = item.artwork.thumb ?? item.artwork.poster ?? item.artwork.backdrop;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: item.title,
      artist: item.showTitle ?? undefined,
      artwork: artwork ? [{ src: ItemsApi.imageUrl(artwork, 512), sizes: "512x512", type: "image/webp" }] : [],
    });
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => this.play()],
      ["pause", () => this.pause()],
      ["seekbackward", () => this.seekBy(-10)],
      ["seekforward", () => this.seekBy(10)],
      ["seekto", (details) => details.seekTime !== undefined && this.seek(details.seekTime)],
      ["nexttrack", () => this.next && this.playNext()],
    ];
    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Unsupported action
      }
    }
  }
}

export default PlayerController;
