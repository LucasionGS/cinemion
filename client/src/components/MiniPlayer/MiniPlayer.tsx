import { type CSSProperties, useEffect } from "react";
import { ListMusic, MicVocal, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX, X } from "lucide-react";
import { musicPlayer } from "../../lib/MusicPlayer.ts";
import useController from "../../lib/useController.ts";
import { router } from "../../lib/Router.tsx";
import { deviceMode } from "../../lib/DeviceMode.ts";
import { formatClock } from "../../lib/playback.ts";
import cx from "../../lib/cx.ts";
import IconButton from "../IconButton/IconButton.tsx";
import Spinner from "../Spinner/Spinner.tsx";
import { Cover } from "../MusicCard/MusicCard.tsx";
import "./MiniPlayer.scss";

// Pages without the app frame, where the mini player stays out of the way
const HIDDEN_ON = /^\/(watch|setup|profiles|sign-in)\b/;

/**
 * The music player bar at the bottom of every page while something is queued. Opens the full "Now playing" view.
 */
export default function MiniPlayer() {
  const player = useController(musicPlayer);
  const { path } = useController(router);
  const { mode } = useController(deviceMode);
  const track = player.current;
  const visible = !!track && !HIDDEN_ON.test(path);

  // Pages leave room for the bar
  useEffect(() => {
    if (visible) document.documentElement.dataset.miniPlayer = "";
    else delete document.documentElement.dataset.miniPlayer;
  }, [visible]);

  if (!visible || !track) return null;
  const artist = track.trackArtist ?? track.artistName;

  return (
    <div className="cn-mini-player" role="region" aria-label="Music player" style={track.palette ? { "--mini-tint": track.palette.accent } as CSSProperties : undefined}>
      <SeekBar compact />
      <button type="button" className="cn-mini-player__track" onClick={() => musicPlayer.openNowPlaying()} aria-label={`Now playing: ${track.title} by ${artist}. Open the player.`}>
        <Cover image={track.cover} title={track.albumTitle} width={160} className="cn-mini-player__cover" />
        <span className="cn-mini-player__text">
          <strong>{track.title}</strong>
          <span>{player.error ?? artist}</span>
        </span>
      </button>
      <div className="cn-mini-player__controls">
        {mode !== "mobile" && <IconButton label="Previous" icon={<SkipBack />} variant="ghost" onClick={() => musicPlayer.previous()} />}
        <PlayButton />
        <IconButton label="Next" icon={<SkipForward />} variant="ghost" onClick={() => musicPlayer.next()} />
      </div>
      {mode !== "mobile" && (
        <div className="cn-mini-player__extras">
          <span className="cn-mini-player__time">{formatClock(player.position)} / {formatClock(player.duration)}</span>
          <IconButton label="Lyrics" icon={<MicVocal />} variant="ghost" onClick={() => musicPlayer.openNowPlaying("lyrics")} />
          <IconButton label="Queue" icon={<ListMusic />} variant="ghost" onClick={() => musicPlayer.openNowPlaying("queue")} />
          {mode === "desktop" && <VolumeControl />}
          <IconButton label="Stop and close" icon={<X />} variant="ghost" onClick={() => musicPlayer.stop()} />
        </div>
      )}
    </div>
  );
}

/**
 * Play or pause, with a spinner while the track loads.
 */
export function PlayButton(props: { size?: "md" | "lg" }) {
  const { size = "md" } = props;
  const { playing, loading } = useController(musicPlayer);
  return (
    <button type="button" className={cx("cn-play-button", `cn-play-button--${size}`)} onClick={() => musicPlayer.toggle()} aria-label={playing ? "Pause" : "Play"}>
      {loading && !playing ? <Spinner size="1.25em" /> : playing ? <Pause /> : <Play />}
    </button>
  );
}

/**
 * Where the track is. `compact` is a thin line along the top of the mini player.
 */
export function SeekBar(props: { compact?: boolean }) {
  const { compact = false } = props;
  const { position, duration } = useController(musicPlayer);
  const progress = duration ? Math.min(1, position / duration) : 0;
  return (
    <input
      type="range"
      className={cx("cn-seek", compact && "cn-seek--compact")}
      min={0}
      max={duration || 1}
      step={0.1}
      value={Math.min(position, duration || 1)}
      onChange={(e) => musicPlayer.seek(Number(e.target.value))}
      aria-label="Position"
      aria-valuetext={`${formatClock(position)} of ${formatClock(duration)}`}
      style={{ "--progress": `${progress * 100}%` } as CSSProperties}
    />
  );
}

export function VolumeControl() {
  const { volume, muted } = useController(musicPlayer);
  const level = muted ? 0 : volume;
  return (
    <div className="cn-mini-player__volume">
      <IconButton label={muted ? "Unmute" : "Mute"} icon={muted || volume === 0 ? <VolumeX /> : <Volume2 />} variant="ghost" onClick={() => musicPlayer.toggleMute()} />
      <input
        type="range"
        className="cn-seek"
        min={0}
        max={1}
        step={0.01}
        value={level}
        onChange={(e) => musicPlayer.setVolume(Number(e.target.value))}
        aria-label="Volume"
        style={{ "--progress": `${level * 100}%` } as CSSProperties}
      />
    </div>
  );
}
