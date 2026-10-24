import { useEffect, useState } from "react";
import { Download, Link2, Send } from "lucide-react";
import { SHARE_COPY_SIZES, type ShareCopyInfo } from "@shared/clips.ts";
import type { ItemDetail } from "@shared/media.ts";
import ClipsApi from "../../Api/ClipsApi.ts";
import { toasts } from "../../lib/Toasts.ts";
import { copyText } from "../../lib/clipboard.ts";
import { formatBytes } from "../../lib/format.ts";
import { t } from "../../i18n/I18n.ts";
import Dialog from "../Dialog/Dialog.tsx";
import Button from "../Button/Button.tsx";
import SegmentedControl from "../SegmentedControl/SegmentedControl.tsx";
import Select from "../Select/Select.tsx";
import ClipRange from "../ClipRange/ClipRange.tsx";
import "./ShareCopyDialog.scss";

const POLL_MS = 1000;

export interface ShareCopyDialogProps {
  item: ItemDetail | null;
  onClose: () => void;
}

/**
 * What a copy of `seconds` comes out as at `sizeMb`, the way the server works it out: `null` when it doesn't fit.
 */
function estimate(seconds: number, sizeMb: number, sourceHeight: number, hasAudio: boolean) {
  const totalKbps = sizeMb * 1e6 * 8 * 0.96 / seconds / 1000;
  const audioKbps = !hasAudio ? 0 : totalKbps >= 2000 ? 128 : totalKbps >= 700 ? 96 : 64;
  const videoKbps = totalKbps - audioKbps;
  if (videoKbps < 150) return null;
  const step = [[4500, 1080], [2200, 720], [1100, 540], [600, 480], [0, 360]].find(([kbps]) => videoKbps >= kbps)!;
  return { height: Math.min(sourceHeight || 1080, step[1]), fps: videoKbps >= 3000 ? 60 : 30 };
}

/**
 * Make a copy of a clip (or part of it) small enough for a chat app, then download it or copy its link.
 */
export default function ShareCopyDialog(props: ShareCopyDialogProps) {
  const { item, onClose } = props;
  const file = item?.files[0];
  const duration = file?.duration ?? 0;
  const [part, setPart] = useState<"whole" | "part">("whole");
  const [range, setRange] = useState<[number, number]>([0, duration]);
  const [sizeMb, setSizeMb] = useState<number>(SHARE_COPY_SIZES[0]);
  const [audio, setAudio] = useState<string>("default");
  const [job, setJob] = useState<ShareCopyInfo | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!item) return;
    setPart("whole");
    setRange([0, duration]);
    setAudio("default");
    setJob(null);
  }, [item?.id]);

  // Follow the copy while it's being made
  useEffect(() => {
    if (job?.state !== "working") return;
    const timer = setInterval(() => {
      ClipsApi.share(job.id).then(setJob).catch((error) => {
        setJob(null);
        toasts.error(t("clips.share.couldntMake"), (error as Error).message);
      });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [job?.id, job?.state]);

  const [start, end] = part === "whole" ? [0, duration] : range;
  const fit = file ? estimate(end - start, sizeMb, file.height ?? 1080, file.audio.length > 0) : null;

  async function make() {
    if (!item) return;
    setStarting(true);
    try {
      setJob(await ClipsApi.startShare(item.id, {
        start: part === "whole" ? null : start,
        end: part === "whole" ? null : end,
        sizeMb,
        audio: audio === "default" ? null : audio === "mix" ? "mix" : Number(audio),
      }));
    } catch (error) {
      toasts.error(t("clips.share.couldntMake"), (error as Error).message);
    } finally {
      setStarting(false);
    }
  }

  async function copyLink() {
    if (!job) return;
    await copyText(ClipsApi.shareUrl(job));
    toasts.success(t("clips.share.linkCopied"), t("clips.share.linkCopiedDescription"));
  }

  const done = job?.state === "done";
  const working = job?.state === "working";

  return (
    <Dialog
      open={!!item}
      onOpenChange={(value) => !value && onClose()}
      title={t("clips.share.title")}
      description={t("clips.share.description")}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{done ? t("common.close") : t("common.cancel")}</Button>
          {!done && <Button variant="primary" icon={<Send />} loading={starting || working} disabled={!fit} onClick={make}>{t("clips.share.make")}</Button>}
          {done && <Button icon={<Link2 />} onClick={copyLink}>{t("clips.share.copyLink")}</Button>}
          {done && <a className="cn-button cn-button--primary cn-button--md" href={ClipsApi.shareUrl(job!, true)} download={job!.fileName}><Download /> {t("common.download")}</a>}
        </>
      }
    >
      {item && file && (
        <div className="cn-share-copy">
          <div className="cn-share-copy__options">
            <SegmentedControl<"whole" | "part"> label={t("clips.share.what")} value={part} onChange={setPart} options={[{ value: "whole", label: t("clips.share.whole") }, { value: "part", label: t("clips.share.part") }]} />
            <SegmentedControl<string>
              label={t("clips.share.size")}
              value={String(sizeMb)}
              onChange={(value) => setSizeMb(Number(value))}
              options={SHARE_COPY_SIZES.map((mb) => ({ value: String(mb), label: t("clips.share.sizeOption", { size: mb }) }))}
            />
            {file.audio.length > 1 && (
              <Select
                label={t("clips.share.sound")}
                value={audio}
                onChange={(e) => setAudio(e.target.value)}
                options={[
                  { value: "default", label: t("clips.share.mainTrack") },
                  ...file.audio.map((a, i) => ({ value: String(a.index), label: a.title ?? t("clips.share.track", { number: i + 1 }) })),
                  { value: "mix", label: t("clips.share.allTracks") },
                ]}
              />
            )}
          </div>
          {part === "part" && <ClipRange item={item} duration={duration} start={range[0]} end={range[1]} onChange={(s, e) => setRange([s, e])} />}
          <p className="cn-share-copy__note">
            {fit
              ? t("clips.share.fits", { height: String(fit.height), fps: fit.fps })
              : t("clips.share.tooBig", { count: Math.round(end - start), size: sizeMb })}
          </p>
          {working && (
            <div className="cn-share-copy__progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((job.progress ?? 0) * 100)}>
              <span style={{ width: `${Math.round((job.progress ?? 0) * 100)}%` }} />
            </div>
          )}
          {done && <p className="cn-share-copy__ready">{t("clips.share.ready", { size: formatBytes(job!.size ?? 0), height: String(job!.height) })}</p>}
          {job?.state === "failed" && <p className="cn-share-copy__error">{job.error}</p>}
        </div>
      )}
    </Dialog>
  );
}
