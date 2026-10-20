import Hls from "hls.js";
import type { ItemDetail, ItemSummary } from "@shared/media.ts";
import type { PlaybackInfo, QualityPreset, StartPlaybackRequest } from "@shared/playback.ts";
import Controller from "../../lib/Controller.ts";
import { detectCapabilities, hasMediaSource } from "../../lib/capabilities.ts";
import { type Cue, parseVtt } from "../../lib/vtt.ts";
import PlaybackApi from "../../Api/PlaybackApi.ts";
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
  public panelTab: PanelTab = "subtitles";
  /**
   * Where TV-style scrubbing will jump to, or `null` when not scrubbing.
   */
  public scrubTarget: number | null = null;
  /**
   * Seconds until the next episode starts, or `null` when the countdown isn't showing.
   */
  public nextCountdown: number | null = null;

  public subtitleIndex: number | null = null;
  public cues: Cue[] = [];

  private _video: HTMLVideoElement | null = null;
  private _hls: Hls | null = null;
  private _hideTimer: ReturnType<typeof setTimeout> | null = null;
  private _progressTimer: ReturnType<typeof setInterval> | null = null;
  private _pingTimer: ReturnType<typeof setInterval> | null = null;
  private _lastSaved = 0;
  private _loadId = 0;
  private _recovering = false;
  private _restarts: number[] = [];
  private _nextDismissed = false;
  private _destroyed = false;
  private _wantPlay = true;

  /**
   * Seconds before the end at which the next episode countdown appears.
   */
  public static readonly NEXT_UP_SECONDS = 30;
  private static readonly HIDE_AFTER_MS = 3500;
  private static readonly PROGRESS_EVERY_MS = 10_000;
  private static readonly PING_EVERY_MS = 30_000;
  private static readonly VOLUME_KEY = "cn-volume";

  constructor(item: ItemDetail, public readonly onExit: () => void, public readonly onPlayNext: (next: ItemSummary) => void) {
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

    this._progressTimer = setInterval(() => this.saveProgress(), PlayerController.PROGRESS_EVERY_MS);
    this._pingTimer = setInterval(() => {
      if (this.info?.sessionId) PlaybackApi.ping(this.info.sessionId);
    }, PlayerController.PING_EVERY_MS);

    this._setupMediaSession();
    if (this.item.type === "episode") ItemsApi.next(this.item.id).then((n) => this.next = n).catch(() => { });

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
    if (this.info?.sessionId) PlaybackApi.stop(this.info.sessionId);
    if (this._progressTimer) clearInterval(this._progressTimer);
    if (this._pingTimer) clearInterval(this._pingTimer);
    if (this._hideTimer) clearTimeout(this._hideTimer);
    document.removeEventListener("fullscreenchange", this._onFullscreen);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
    this._hls?.destroy();
    this._hls = null;
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
      return;
    }
    if (previous?.sessionId) PlaybackApi.stop(previous.sessionId);

    this.info = info;
    this.duration = info.duration || this.duration;
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

  private _onPlayState = () => {
    this.playing = !this._video!.paused;
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
    this._wantPlay = true;
    if (this.ended) {
      this.seek(0);
      return;
    }
    this._video?.play().catch(() => { });
  }

  public pause() {
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
    this.notify();

    if (reload && (this._isImageSubtitle(index, info?.fileId) || wasBurned)) {
      this.load({ startAt: this.position, subtitleIndex: index });
      return;
    }

    const option = info?.subtitles.find((s) => s.index === index);
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

  private _isImageSubtitle(index: number | null | undefined, fileId: number | undefined) {
    if (index === null || index === undefined) return false;
    const file = this.item.files.find((f) => f.id === fileId) ?? this.item.files[0];
    return !!file?.subtitles.find((s) => s.index === index)?.isImage;
  }

  public openPanel(tab?: PanelTab) {
    this.panelOpen = true;
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
      if (!this.playing || this.panelOpen || this.scrubTarget !== null) return;
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
    const position = Math.floor(this.position);
    if (!force && Math.abs(position - this._lastSaved) < 2) return;
    this._lastSaved = position;
    PlaybackApi.saveProgress(this.item.id, this.ended ? this.duration : position, this.duration || null);
  }

  private _updateNextUp() {
    if (!this.next || this._nextDismissed || !this.duration) return;
    const left = this.duration - this.position;
    const countdown = left <= PlayerController.NEXT_UP_SECONDS && this.scrubTarget === null ? Math.max(0, Math.ceil(left)) : null;
    if (countdown !== this.nextCountdown) {
      this.nextCountdown = countdown;
      this.notify();
    }
  }

  public dismissNext() {
    this._nextDismissed = true;
    this.nextCountdown = null;
    this.notify();
  }

  public playNext() {
    if (!this.next) return;
    // The rest is credits; count this one as watched
    PlaybackApi.saveProgress(this.item.id, this.duration, this.duration || null);
    this.onPlayNext(this.next);
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
