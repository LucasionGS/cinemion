import { useEffect, useId, useRef, useState } from "react";
import { Film, ImageUp, RotateCcw } from "lucide-react";
import type { ItemDetail } from "@shared/media.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import LibrariesApi from "../../Api/LibrariesApi.ts";
import { toasts } from "../../lib/Toasts.ts";
import { formatClock } from "../../lib/playback.ts";
import { ratingOptions } from "../../lib/ratings.ts";
import { t } from "../../i18n/I18n.ts";
import Button from "../Button/Button.tsx";
import Dialog from "../Dialog/Dialog.tsx";
import Select from "../Select/Select.tsx";
import TextField from "../TextField/TextField.tsx";
import "../TextField/TextField.scss";
import "./EditDetailsDialog.scss";

export interface EditDetailsDialogProps {
  /**
   * The video or folder to edit. `null` closes the dialog.
   */
  item: ItemDetail | null;
  onClose: () => void;
  /**
   * Called after anything was saved, including a new thumbnail, so the page can reload.
   */
  onSaved: () => void;
}

/**
 * Hand-made details for a video or folder: title, date, description, tags, age rating and thumbnail.
 */
export default function EditDetailsDialog(props: EditDetailsDialogProps) {
  const { item, onClose, onSaved } = props;
  const libraries = LibrariesApi.useLibraries();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [overview, setOverview] = useState("");
  const [tags, setTags] = useState("");
  const [rating, setRating] = useState("");
  const [saving, setSaving] = useState(false);
  const descriptionId = useId();
  const isVideo = item?.type === "video";
  const library = libraries?.find((l) => l.id === item?.libraryId);

  useEffect(() => {
    if (!item) return;
    setTitle(item.title);
    setDate(item.releaseDate ?? "");
    setOverview(item.overview ?? "");
    setTags(item.genres.join(", "));
    setRating(item.contentRating ?? "");
  }, [item?.id]);

  async function save() {
    if (!item) return;
    setSaving(true);
    try {
      await ItemsApi.editDetails(item.id, {
        title,
        releaseDate: date || null,
        overview: overview || null,
        tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        contentRating: rating || null,
      });
      toasts.success(t("editDetails.saved"));
      onSaved();
      onClose();
    } catch (error) {
      toasts.error(t("common.couldntSave"), (error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const defaultLabel = library?.defaultRating ? t("editDetails.ratingDefault", { rating: library.defaultRating }) : t("editDetails.ratingDefaultUnrated");

  return (
    <Dialog
      open={!!item}
      onOpenChange={(open) => !open && onClose()}
      title={isVideo ? t("editDetails.videoTitle") : t("editDetails.folderTitle")}
      description={t("editDetails.description")}
      size="lg"
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="primary" onClick={save} loading={saving} disabled={!title.trim()}>{t("common.save")}</Button>
      </>}
    >
      {item && <ThumbnailPicker item={item} onChanged={onSaved} />}
      <div className="cn-details__fields">
        <TextField label={t("editDetails.titleLabel")} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        {isVideo && <TextField label={t("editDetails.date")} type="date" value={date} onChange={(e) => setDate(e.target.value)} description={t("editDetails.dateDescription")} />}
      </div>
      <div className="cn-field">
        <label className="cn-field__label" htmlFor={descriptionId}>{t("editDetails.descriptionLabel")}</label>
        <textarea id={descriptionId} className="cn-field__input cn-details__description" value={overview} onChange={(e) => setOverview(e.target.value)} rows={4} maxLength={5000} />
      </div>
      {isVideo && (
        <div className="cn-details__fields">
          <TextField label={t("editDetails.tags")} value={tags} onChange={(e) => setTags(e.target.value)} placeholder={t("editDetails.tagsPlaceholder")} description={t("editDetails.tagsDescription")} />
          <Select
            label={t("editDetails.rating")}
            value={rating}
            onChange={(e) => setRating(e.target.value)}
            options={[{ value: "", label: defaultLabel }, ...ratingOptions()]}
            description={t("editDetails.ratingDescription")}
          />
        </div>
      )}
    </Dialog>
  );
}

/**
 * The thumbnail, with buttons to upload a picture, pick a frame from the video, or go back to the automatic one.
 * Each change is saved right away.
 */
function ThumbnailPicker(props: { item: ItemDetail; onChanged: () => void }) {
  const { item, onChanged } = props;
  const duration = item.files[0]?.duration ?? 0;
  const [picking, setPicking] = useState(false);
  const [time, setTime] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const thumb = item.artwork.thumb;

  // Load the frame under the slider, a moment after it stops moving
  useEffect(() => {
    if (!picking) return;
    let url: string | null = null;
    let cancelled = false;
    const timer = setTimeout(() => {
      ItemsApi.frame(item.id, time).then((u) => {
        if (cancelled) URL.revokeObjectURL(u);
        else {
          url = u;
          setPreview(u);
        }
      }).catch(() => { });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (url) URL.revokeObjectURL(url);
    };
  }, [picking, time, item.id]);

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await action();
      toasts.success(done);
      setPicking(false);
      setPreview(null);
      onChanged();
    } catch (error) {
      toasts.error(t("editDetails.thumbnail.failed"), (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function startPicking() {
    setTime(Math.min(duration * 0.1, 60));
    setPicking(true);
  }

  const shown = picking ? preview : thumb ? ItemsApi.imageUrl(thumb, 780) : null;

  return (
    <div className="cn-details__thumb">
      <span className="cn-details__image" style={{ background: item.palette?.base ?? "var(--cn-surface-2)" }}>
        {shown && <img src={shown} alt="" />}
      </span>
      <div className="cn-details__thumb-controls">
        <strong>{t("editDetails.thumbnail.title")}</strong>
        {picking
          ? (
            <>
              <input
                type="range"
                className="cn-details__slider"
                min={0}
                max={Math.max(0, duration - 0.5)}
                step={0.5}
                value={time}
                onChange={(e) => setTime(Number(e.target.value))}
                aria-label={t("editDetails.thumbnail.moment")}
              />
              <span className="cn-details__time">{t("editDetails.thumbnail.time", { time: formatClock(time), duration: formatClock(duration) })}</span>
              <div className="cn-details__buttons">
                <Button size="sm" variant="primary" loading={busy} onClick={() => run(() => ItemsApi.setThumbnailFrame(item.id, time), t("editDetails.thumbnail.changed"))}>{t("editDetails.thumbnail.useFrame")}</Button>
                <Button size="sm" variant="ghost" onClick={() => setPicking(false)}>{t("common.cancel")}</Button>
              </div>
            </>
          )
          : (
            <>
              <span className="cn-details__hint">
                {item.edited.thumbnail ? t("editDetails.thumbnail.byHand") : item.type === "video" ? t("editDetails.thumbnail.fromVideo") : t("editDetails.thumbnail.fromFolder")}
              </span>
              <div className="cn-details__buttons">
                <Button size="sm" icon={<ImageUp />} onClick={() => fileInput.current?.click()} loading={busy}>{t("editDetails.thumbnail.upload")}</Button>
                {item.type === "video" && duration > 0 && <Button size="sm" icon={<Film />} onClick={startPicking}>{t("editDetails.thumbnail.pickFrame")}</Button>}
                {item.edited.thumbnail && <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={() => run(() => ItemsApi.resetThumbnail(item.id), t("editDetails.thumbnail.reset"))}>{t("editDetails.thumbnail.automatic")}</Button>}
              </div>
            </>
          )}
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) run(() => ItemsApi.uploadThumbnail(item.id, file), t("editDetails.thumbnail.changed"));
          }}
        />
      </div>
    </div>
  );
}
