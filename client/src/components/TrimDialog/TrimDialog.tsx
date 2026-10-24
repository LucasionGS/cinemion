import { useEffect, useState } from "react";
import { Scissors } from "lucide-react";
import type { ItemDetail, ItemSummary } from "@shared/media.ts";
import ClipsApi from "../../Api/ClipsApi.ts";
import { toasts } from "../../lib/Toasts.ts";
import { t } from "../../i18n/I18n.ts";
import Dialog, { ConfirmDialog } from "../Dialog/Dialog.tsx";
import Button from "../Button/Button.tsx";
import SegmentedControl from "../SegmentedControl/SegmentedControl.tsx";
import Spinner from "../Spinner/Spinner.tsx";
import ClipRange from "../ClipRange/ClipRange.tsx";
import "./TrimDialog.scss";

export interface TrimDialogProps {
  item: ItemDetail | null;
  onClose: () => void;
  /**
   * Called with the clip that holds the cut: a new one, or the same one when the original was replaced.
   */
  onDone: (clip: ItemSummary, replaced: boolean) => void;
}

/**
 * Cut a clip down without converting it, saved as a new clip or over the original.
 */
export default function TrimDialog(props: TrimDialogProps) {
  const { item, onClose, onDone } = props;
  const duration = item?.files[0]?.duration ?? 0;
  const [keyframes, setKeyframes] = useState<number[] | null>(null);
  const [range, setRange] = useState<[number, number]>([0, duration]);
  const [mode, setMode] = useState<"copy" | "replace">("copy");
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!item) return;
    setKeyframes(null);
    setRange([0, duration]);
    setMode("copy");
    ClipsApi.keyframes(item.id).then(setKeyframes).catch((error) => {
      toasts.error(t("clips.trim.couldntRead"), (error as Error).message);
      onClose();
    });
  }, [item?.id]);

  async function save() {
    if (!item) return;
    setConfirming(false);
    setSaving(true);
    try {
      const clip = await ClipsApi.trim(item.id, { start: range[0], end: range[1], replace: mode === "replace" });
      toasts.success(mode === "replace" ? t("clips.trim.cut") : t("clips.trim.savedNew"));
      onDone(clip, mode === "replace");
      onClose();
    } catch (error) {
      toasts.error(t("clips.trim.couldntCut"), (error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const whole = range[0] < 0.05 && range[1] > duration - 0.05;

  return (
    <Dialog
      open={!!item}
      onOpenChange={(value) => !value && onClose()}
      title={t("clips.trim.title")}
      description={t("clips.trim.description")}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" icon={<Scissors />} loading={saving} disabled={!keyframes || whole} onClick={() => mode === "replace" ? setConfirming(true) : save()}>{mode === "replace" ? t("clips.trim.cutOriginal") : t("clips.trim.saveCut")}</Button>
        </>
      }
    >
      {item && !keyframes && <div className="cn-trim__loading"><Spinner size="2rem" label={t("clips.trim.reading")} /></div>}
      {item && keyframes && (
        <div className="cn-trim">
          <ClipRange item={item} duration={duration} start={range[0]} end={range[1]} onChange={(start, end) => setRange([start, end])} snapStart={keyframes} />
          <SegmentedControl<"copy" | "replace">
            label={t("clips.trim.where")}
            value={mode}
            onChange={setMode}
            options={[{ value: "copy", label: t("clips.trim.copy") }, { value: "replace", label: t("clips.trim.replace") }]}
          />
          <p className="cn-trim__note">
            {mode === "copy"
              ? t("clips.trim.copyNote")
              : t("clips.trim.replaceNote")}
          </p>
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("clips.trim.confirmTitle")}
        description={t("clips.trim.confirmDescription")}
        confirmLabel={t("clips.trim.confirmLabel")}
        danger
        onConfirm={save}
      />
    </Dialog>
  );
}
