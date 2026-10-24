import { type CSSProperties, useState } from "react";
import { CircleCheck, Download } from "lucide-react";
import type { DownloadOptions, DownloadQuality } from "@shared/downloads.ts";
import type { ItemDetail } from "@shared/media.ts";
import offline from "../../lib/Offline.ts";
import useController from "../../lib/useController.ts";
import { session } from "../../Session.ts";
import { router } from "../../lib/Router.tsx";
import { toasts } from "../../lib/Toasts.ts";
import { formatBytes } from "../../lib/format.ts";
import cx from "../../lib/cx.ts";
import { t, type TranslationKey } from "../../i18n/I18n.ts";
import Button from "../Button/Button.tsx";
import IconButton from "../IconButton/IconButton.tsx";
import Dialog from "../Dialog/Dialog.tsx";
import Spinner from "../Spinner/Spinner.tsx";
import "./DownloadButton.scss";

/**
 * What each size is called, by its id; the server's own labels are English.
 */
const QUALITY_LABELS: Record<DownloadQuality, TranslationKey> = {
  original: "downloads.quality.original",
  "1080p": "downloads.quality.high",
  "720p": "downloads.quality.medium",
  "480p": "downloads.quality.small",
};

export interface DownloadButtonProps {
  item: ItemDetail;
}

/**
 * Save a movie, episode or video on this device. Once saved (or saving), it shows that and leads to Downloads.
 */
export default function DownloadButton(props: DownloadButtonProps) {
  const { item } = props;
  useController(offline);
  const [options, setOptions] = useState<DownloadOptions | null>(null);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<DownloadQuality | null>(null);
  const [starting, setStarting] = useState(false);
  const existing = offline.find(item.id);

  async function openDialog() {
    if (!offline.isSupported()) {
      toasts.error(t("downloads.button.needsHttps"), t("downloads.button.needsHttpsDescription"));
      return;
    }
    setOpen(true);
    setOptions(null);
    try {
      const result = await offline.options(item);
      setOptions(result);
      // The smallest copy that still looks good on a phone, unless the original plays as it is
      setPicked(result.options.find((o) => o.quality === "720p")?.quality ?? result.options[0]?.quality ?? null);
    } catch (error) {
      setOpen(false);
      toasts.error(t("downloads.button.sizesFailed"), (error as Error).message);
    }
  }

  async function start() {
    if (!picked || !session.user) return;
    setStarting(true);
    try {
      await offline.start(item, picked, session.user.id);
      setOpen(false);
      toasts.success(t("downloads.button.started"), t("downloads.button.startedDescription"));
    } catch (error) {
      toasts.error(t("downloads.button.startFailed"), (error as Error).message);
    } finally {
      setStarting(false);
    }
  }

  if (existing) {
    const percent = existing.size ? Math.round(existing.received / existing.size * 100) : existing.preparing ? Math.round(existing.preparing * 100) : 0;
    const label = existing.status === "ready" ? t("downloads.button.ready") : existing.status === "failed" ? t("downloads.button.failed") : t("downloads.button.progress", { percent });
    return (
      <IconButton
        label={label}
        icon={existing.status === "ready" ? <CircleCheck /> : <Download />}
        size="lg"
        className={cx("cn-download-button", existing.status === "ready" && "cn-download-button--done", existing.status !== "ready" && existing.status !== "failed" && "cn-download-button--busy")}
        style={{ "--download-progress": `${percent}%` } as CSSProperties}
        onClick={() => router.navigate("/downloads")}
      />
    );
  }

  return (
    <>
      <IconButton label={t("downloads.button.label")} icon={<Download />} size="lg" onClick={openDialog} />
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t("downloads.button.label")}
        description={t("downloads.button.description", { title: item.title })}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
            <Button variant="primary" icon={<Download />} onClick={start} loading={starting} disabled={!picked}>{t("common.download")}</Button>
          </>
        }
      >
        {!options && <Spinner size="1.5rem" />}
        {options && (
          <div className="cn-download-options" role="radiogroup" aria-label={t("downloads.button.size")}>
            {options.options.map((o) => (
              <button key={o.quality} type="button" role="radio" aria-checked={picked === o.quality} className={cx("cn-download-options__option", picked === o.quality && "cn-download-options__option--on")} onClick={() => setPicked(o.quality)}>
                <strong>{t(QUALITY_LABELS[o.quality])}</strong>
                <span>{[o.size ? t("downloads.button.about", { size: formatBytes(o.size) }) : null, o.quality === "original" ? t("downloads.button.asIs") : t("downloads.button.madeOnServer")].filter(Boolean).join(t("common.dotSeparator"))}</span>
              </button>
            ))}
          </div>
        )}
      </Dialog>
    </>
  );
}
