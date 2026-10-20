import { useEffect, useRef } from "react";
import { ArrowLeft } from "lucide-react";
import offline from "../../lib/Offline.ts";
import { session } from "../../Session.ts";
import { router } from "../../lib/Router.tsx";
import IconButton from "../../components/IconButton/IconButton.tsx";
import "./Downloads.scss";

export interface OfflinePlayerProps {
  downloadKey: string;
}

// Places closer than this to the start or end start from the beginning. Unit is in seconds.
const RESUME_MARGIN = 30;

/**
 * Plays a download from this device, with the browser's own controls. Progress is kept here and sent to the server
 * once it's reachable.
 */
export default function OfflinePlayer(props: OfflinePlayerProps) {
  const { downloadKey } = props;
  const download = offline.get(downloadKey);
  const video = useRef<HTMLVideoElement>(null);
  const lastSave = useRef(0);

  useEffect(() => {
    const el = video.current;
    if (!el || !download) return;
    const save = () => {
      if (!el.duration || !Number.isFinite(el.duration)) return;
      offline.saveProgress(download.key, el.ended ? el.duration : el.currentTime, el.duration);
    };
    const onLoaded = () => {
      if (download.position > RESUME_MARGIN && download.position < el.duration - RESUME_MARGIN) el.currentTime = download.position;
    };
    const onTime = () => {
      if (Date.now() - lastSave.current < 10_000) return;
      lastSave.current = Date.now();
      save();
    };
    el.addEventListener("loadedmetadata", onLoaded);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("pause", save);
    el.addEventListener("ended", save);
    addEventListener("pagehide", save);
    return () => {
      save();
      el.removeEventListener("loadedmetadata", onLoaded);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("pause", save);
      el.removeEventListener("ended", save);
      removeEventListener("pagehide", save);
      // Back online while watching: the place goes to the server right away
      if (navigator.onLine) offline.sync(session.user?.id ?? null);
    };
  }, [download?.key]);

  const back = () => router.back("/downloads");
  if (!download || download.status !== "ready") {
    return (
      <div className="cn-offline-player cn-dark-theme">
        <p className="cn-offline-player__message">This download isn't on this device. <a href="/downloads">See your downloads</a>.</p>
      </div>
    );
  }
  return (
    <div className="cn-offline-player cn-dark-theme">
      <header className="cn-offline-player__bar">
        <IconButton label="Back" icon={<ArrowLeft />} variant="ghost" onClick={back} data-autofocus />
        <div>
          <strong>{download.title}</strong>
          {download.subtitle && <span>{download.subtitle}</span>}
        </div>
      </header>
      {!navigator.serviceWorker?.controller && <p className="cn-offline-player__message">Offline playback starts after the page has been reloaded once.</p>}
      <video ref={video} className="cn-offline-player__video" src={offline.url(download.key, "video")} controls autoPlay playsInline>
        {download.subtitles.filter((s) => !s.isForced || download.subtitles.length === 1).map((s) => (
          <track key={s.index} kind="subtitles" src={offline.url(download.key, `sub/${s.index}.vtt`)} label={s.label} srcLang={s.language ?? undefined} />
        ))}
      </video>
    </div>
  );
}
