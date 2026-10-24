import { useEffect, useState } from "react";
import { CloudOff, Download as DownloadIcon, Pause, Play, RefreshCw, Trash2 } from "lucide-react";
import offline, { type OfflineDownload } from "../../lib/Offline.ts";
import useController from "../../lib/useController.ts";
import { router } from "../../lib/Router.tsx";
import { formatBytes } from "../../lib/format.ts";
import { formatDuration } from "../../lib/playback.ts";
import cx from "../../lib/cx.ts";
import { t } from "../../i18n/I18n.ts";
import AppShell from "../../components/AppShell/AppShell.tsx";
import Button from "../../components/Button/Button.tsx";
import IconButton from "../../components/IconButton/IconButton.tsx";
import Logo from "../../components/Logo/Logo.tsx";
import { ConfirmDialog } from "../../components/Dialog/Dialog.tsx";
import { fallbackColor } from "../../components/PosterCard/PosterCard.tsx";
import "./Downloads.scss";

export interface DownloadsProps {
  /**
   * The server can't be reached: no app frame, just what's on this device.
   */
  offlineMode?: boolean;
}

/**
 * What's saved on this device to watch without a connection.
 */
export default function Downloads(props: DownloadsProps) {
  const { offlineMode = false } = props;
  const { downloads, storage } = useController(offline);
  const [removing, setRemoving] = useState<OfflineDownload | null>(null);

  useEffect(() => {
    offline.updateStorage();
  }, []);

  const content = (
    <div className="cn-downloads">
      <header className="cn-downloads__header">
        <div>
          <h1>{t("downloads.title")}</h1>
          <p>
            {offlineMode ? t("downloads.introOffline") : t("downloads.intro")}
            {storage && ` ${t("downloads.storage", { used: formatBytes(downloads.reduce((sum, d) => sum + d.received, 0)), free: formatBytes(Math.max(0, storage.quota - storage.used)) })}`}
          </p>
        </div>
        {offlineMode && <Button variant="primary" icon={<RefreshCw />} onClick={() => location.reload()}>{t("downloads.retryServer")}</Button>}
      </header>

      {!offline.isSupported() && (
        <section className="cn-downloads__empty">
          <h2>{t("downloads.unsupported.title")}</h2>
          <p>{t("downloads.unsupported.text")}</p>
        </section>
      )}
      {offline.isSupported() && downloads.length === 0 && (
        <section className="cn-downloads__empty">
          <h2>{t("downloads.empty.title")}</h2>
          <p>{t("downloads.empty.text")}</p>
        </section>
      )}

      <ul className="cn-downloads__list">
        {downloads.map((d) => <DownloadRow key={d.key} download={d} onRemove={() => setRemoving(d)} />)}
      </ul>

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={removing ? t("downloads.delete.title", { title: removing.title }) : t("downloads.delete.titleUntitled")}
        description={t("downloads.delete.description")}
        confirmLabel={t("common.delete")}
        danger
        onConfirm={async () => {
          if (removing) await offline.remove(removing.key);
          setRemoving(null);
        }}
      />
    </div>
  );

  if (!offlineMode) return <AppShell>{content}</AppShell>;
  return (
    <div className="cn-offline-shell">
      <header className="cn-offline-shell__bar">
        <Logo size={1.75} />
        <span className="cn-offline-shell__badge"><CloudOff /> {t("downloads.offline")}</span>
      </header>
      <main className="cn-offline-shell__main">{content}</main>
    </div>
  );
}

function DownloadRow(props: { download: OfflineDownload; onRemove: () => void }) {
  const { download: d, onRemove } = props;
  const [posterBroken, setPosterBroken] = useState(false);
  const fraction = d.size ? d.received / d.size : 0;
  const watched = d.duration && d.position ? d.position / d.duration : 0;

  let status: string;
  if (d.status === "preparing") status = d.preparing ? t("downloads.status.preparingPercent", { percent: Math.round(d.preparing * 100) }) : t("downloads.status.preparing");
  else if (d.status === "downloading") status = d.size ? t("downloads.status.downloadingOf", { received: formatBytes(d.received), size: formatBytes(d.size) }) : t("downloads.status.downloading", { received: formatBytes(d.received) });
  else if (d.status === "paused") status = d.size ? t("downloads.status.pausedOf", { received: formatBytes(d.received), size: formatBytes(d.size) }) : t("downloads.status.paused", { received: formatBytes(d.received) });
  else if (d.status === "failed") status = d.error ?? t("downloads.status.failed");
  else status = [d.quality === "original" ? t("downloads.quality.original") : d.quality, d.size ? formatBytes(d.size) : null, d.duration ? formatDuration(d.duration) : null].filter(Boolean).join(t("common.dotSeparator"));

  return (
    <li className={cx("cn-downloads__row", `cn-downloads__row--${d.status}`)}>
      <span className="cn-downloads__poster cn-dark-theme" style={posterBroken ? { background: fallbackColor(d.title) } : undefined}>
        {!posterBroken && <img src={offline.url(d.key, "poster")} alt="" onError={() => setPosterBroken(true)} />}
      </span>
      <div className="cn-downloads__text">
        <strong>{d.title}</strong>
        {d.subtitle && <span>{d.subtitle}</span>}
        <span className="cn-downloads__status">{status}</span>
        {(d.status === "downloading" || d.status === "paused" || d.status === "preparing") && (
          <span className="cn-downloads__bar"><span style={{ width: `${(d.status === "preparing" ? d.preparing ?? 0 : fraction) * 100}%` }} /></span>
        )}
        {d.status === "ready" && watched > 0 && <span className="cn-downloads__bar cn-downloads__bar--watched"><span style={{ width: `${watched * 100}%` }} /></span>}
      </div>
      <div className="cn-downloads__actions">
        {d.status === "ready" && <Button variant="primary" icon={<Play />} onClick={() => router.navigate(`/offline/${d.key}`)}>{d.position > 30 ? t("common.resume") : t("common.play")}</Button>}
        {(d.status === "downloading" || d.status === "preparing") && <IconButton label={t("downloads.pause")} icon={<Pause />} onClick={() => offline.pause(d.key)} />}
        {(d.status === "paused" || d.status === "failed") && <IconButton label={d.status === "failed" ? t("common.tryAgain") : t("downloads.carryOn")} icon={d.status === "failed" ? <RefreshCw /> : <DownloadIcon />} onClick={() => offline.resume(d.key)} />}
        <IconButton label={t("downloads.deleteFromDevice")} icon={<Trash2 />} variant="ghost" onClick={onRemove} />
      </div>
    </li>
  );
}
