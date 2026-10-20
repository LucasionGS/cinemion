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
import Button from "../Button/Button.tsx";
import IconButton from "../IconButton/IconButton.tsx";
import Dialog from "../Dialog/Dialog.tsx";
import Spinner from "../Spinner/Spinner.tsx";
import "./DownloadButton.scss";

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
      toasts.error("Downloads need https", "Browsers only let sites save videos when they're opened over https (or as localhost on the server).");
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
      toasts.error("Couldn't get the download sizes", (error as Error).message);
    }
  }

  async function start() {
    if (!picked || !session.user) return;
    setStarting(true);
    try {
      await offline.start(item, picked, session.user.id);
      setOpen(false);
      toasts.success("Download started", "Follow it in Downloads, in the profile menu.");
    } catch (error) {
      toasts.error("Couldn't start the download", (error as Error).message);
    } finally {
      setStarting(false);
    }
  }

  if (existing) {
    const percent = existing.size ? Math.round(existing.received / existing.size * 100) : existing.preparing ? Math.round(existing.preparing * 100) : 0;
    const label = existing.status === "ready" ? "Downloaded. Open Downloads" : existing.status === "failed" ? "Download failed. Open Downloads" : `Downloading ${percent}%. Open Downloads`;
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
      <IconButton label="Download to watch offline" icon={<Download />} size="lg" onClick={openDialog} />
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Download to watch offline"
        description={`${item.title} is kept on this device, for when there's no connection. Watching progress comes back to the server later.`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" icon={<Download />} onClick={start} loading={starting} disabled={!picked}>Download</Button>
          </>
        }
      >
        {!options && <Spinner size="1.5rem" />}
        {options && (
          <div className="cn-download-options" role="radiogroup" aria-label="Size">
            {options.options.map((o) => (
              <button key={o.quality} type="button" role="radio" aria-checked={picked === o.quality} className={cx("cn-download-options__option", picked === o.quality && "cn-download-options__option--on")} onClick={() => setPicked(o.quality)}>
                <strong>{o.label}</strong>
                <span>{[o.size ? `About ${formatBytes(o.size)}` : null, o.note].filter(Boolean).join(" · ")}</span>
              </button>
            ))}
          </div>
        )}
      </Dialog>
    </>
  );
}
