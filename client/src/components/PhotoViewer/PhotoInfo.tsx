import { type ReactNode, useEffect, useId, useState } from "react";
import { Calendar, Camera, FolderOpen, Image as ImageIcon, Images, MapPin, Pencil, Tag, X } from "lucide-react";
import type { PhotoDetail } from "@shared/photos.ts";
import PhotosApi from "../../Api/PhotosApi.ts";
import { router } from "../../lib/Router.tsx";
import { toasts } from "../../lib/Toasts.ts";
import { formatBytes, formatDateTime } from "../../lib/format.ts";
import { formatClock } from "../../lib/playback.ts";
import { ratingOptions } from "../../lib/ratings.ts";
import { t, type TranslationKey } from "../../i18n/I18n.ts";
import IconButton from "../IconButton/IconButton.tsx";
import Button from "../Button/Button.tsx";
import TextField from "../TextField/TextField.tsx";
import Select from "../Select/Select.tsx";
import Spinner from "../Spinner/Spinner.tsx";
import "../TextField/TextField.scss";

export interface PhotoInfoProps {
  detail: PhotoDetail | null;
  /**
   * Whether the profile may change the caption, date, tags and rating.
   */
  canEdit: boolean;
  onClose: () => void;
  onSaved: (detail: PhotoDetail) => void;
}

/**
 * What's known about a photo: caption, when, the file, the camera, where, and which albums it's in. People who
 * manage libraries can edit the caption, date, tags and age rating here.
 */
export default function PhotoInfo(props: PhotoInfoProps) {
  const { detail, canEdit, onClose, onSaved } = props;
  const [editing, setEditing] = useState(false);

  useEffect(() => setEditing(false), [detail?.id]);

  return (
    <div className="cn-photo-info">
      <div className="cn-photo-info__head">
        <h2>{t("photos.info.title")}</h2>
        {canEdit && detail && !editing && <IconButton label={t("photos.info.edit")} icon={<Pencil />} variant="ghost" size="sm" onClick={() => setEditing(true)} />}
        <IconButton label={t("photos.info.close")} icon={<X />} variant="ghost" size="sm" onClick={onClose} />
      </div>
      {!detail && <div className="cn-photo-info__loading"><Spinner size="1.5rem" /></div>}
      {detail && editing && <EditForm detail={detail} onDone={(updated) => {
        setEditing(false);
        if (updated) onSaved(updated);
      }} />}
      {detail && !editing && <Facts detail={detail} />}
    </div>
  );
}

function Facts(props: { detail: PhotoDetail }) {
  const { detail } = props;
  const meta = detail.meta;
  const megapixels = meta?.width && meta.height ? Math.round(meta.width * meta.height / 100000) / 10 : null;
  const exposure = [
    meta?.fNumber ? `ƒ/${meta.fNumber}` : null,
    meta?.exposureTime ? meta.exposureTime >= 1 ? `${meta.exposureTime} s` : `1/${Math.round(1 / meta.exposureTime)} s` : null,
    meta?.iso ? `ISO ${meta.iso}` : null,
    meta?.focalLength ? `${meta.focalLength} mm` : null,
  ].filter(Boolean).join(t("common.dotSeparator"));
  const hasPlace = meta?.latitude != null && meta.longitude != null;

  return (
    <>
      {detail.caption && <p className="cn-photo-info__caption">{detail.caption}</p>}
      <dl className="cn-photo-info__facts">
        <Fact icon={<Calendar />} title={detail.takenAt ? formatDateTime(detail.takenAt) : t("photos.info.dateUnknown")}>
          {meta?.offset ? t("photos.info.cameraClock", { offset: meta.offset }) : detail.type === "video" && detail.duration ? t("photos.info.length", { length: formatClock(detail.duration) }) : null}
        </Fact>
        <Fact icon={<ImageIcon />} title={detail.fileName}>
          {[meta?.width && meta.height ? `${meta.width} × ${meta.height}` : null, megapixels && detail.type === "photo" ? t("photos.info.megapixels", { value: megapixels }) : null, formatBytes(detail.size)].filter(Boolean).join(t("common.dotSeparator"))}
        </Fact>
        {(meta?.camera || exposure) && (
          <Fact icon={<Camera />} title={meta?.camera ?? t("photos.info.camera")}>
            {[exposure, meta?.lens].filter(Boolean).join(t("common.dotSeparator")) || null}
          </Fact>
        )}
        {hasPlace && (
          <Fact icon={<MapPin />} title={t("photos.info.place", { latitude: formatCoordinate(meta!.latitude!, "photos.info.north", "photos.info.south"), longitude: formatCoordinate(meta!.longitude!, "photos.info.east", "photos.info.west") })}>
            <a href={`https://www.openstreetmap.org/?mlat=${meta!.latitude}&mlon=${meta!.longitude}#map=15/${meta!.latitude}/${meta!.longitude}`} target="_blank" rel="noreferrer noopener">{t("photos.info.openMap")}</a>
          </Fact>
        )}
        {detail.folders.length > 0 && (
          <Fact icon={<FolderOpen />} title={t("photos.info.folder")}>
            {detail.folders.map((f, i) => (
              <span key={f.id}>
                {i > 0 && " › "}
                <a href={`/photos/folder/${f.id}`} onClick={(e) => {
                  e.preventDefault();
                  router.navigate(`/photos/folder/${f.id}`);
                }}>{f.title}</a>
              </span>
            ))}
          </Fact>
        )}
        {detail.albums.length > 0 && (
          <Fact icon={<Images />} title={detail.albums.length === 1 ? t("photos.info.inAlbum") : t("photos.info.inAlbums")}>
            {detail.albums.map((a, i) => (
              <span key={a.id}>
                {i > 0 && t("common.listSeparator")}
                <a href={`/photos/album/${a.id}`} onClick={(e) => {
                  e.preventDefault();
                  router.navigate(`/photos/album/${a.id}`);
                }}>{a.title}</a>
              </span>
            ))}
          </Fact>
        )}
        {(detail.tags.length > 0 || detail.contentRating) && (
          <Fact icon={<Tag />} title={t("photos.info.tags")}>
            <span className="cn-photo-info__tags">
              {detail.tags.map((tag) => <span key={tag} className="cn-photo-info__tag">{tag}</span>)}
              {detail.contentRating && <span className="cn-photo-info__tag">{t("photos.info.rated", { rating: detail.contentRating })}</span>}
            </span>
          </Fact>
        )}
      </dl>
    </>
  );
}

function Fact(props: { icon: ReactNode; title: string; children?: ReactNode }) {
  const { icon, title, children } = props;
  return (
    <div className="cn-photo-info__fact">
      <span className="cn-photo-info__icon" aria-hidden="true">{icon}</span>
      <div>
        <dt>{title}</dt>
        {children && <dd>{children}</dd>}
      </div>
    </div>
  );
}

/**
 * The caption, date, tags and age rating, saved with the same call "Edit details" uses for videos.
 */
function EditForm(props: { detail: PhotoDetail; onDone: (updated: PhotoDetail | null) => void }) {
  const { detail, onDone } = props;
  const [caption, setCaption] = useState(detail.caption ?? "");
  const [date, setDate] = useState(detail.takenAt?.slice(0, 10) ?? "");
  const [tags, setTags] = useState(detail.tags.join(", "));
  const [rating, setRating] = useState(detail.contentRating ?? "");
  const [saving, setSaving] = useState(false);
  const captionId = useId();

  async function save() {
    setSaving(true);
    try {
      await PhotosApi.editDetails(detail.id, {
        title: detail.title,
        releaseDate: date || null,
        overview: caption.trim() || null,
        tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        contentRating: rating || null,
      });
      onDone(await PhotosApi.get(detail.id));
      toasts.success(t("photos.info.saved"));
    } catch (error) {
      toasts.error(t("common.couldntSave"), (error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="cn-photo-info__form">
      <div className="cn-field">
        <label className="cn-field__label" htmlFor={captionId}>{t("photos.info.caption")}</label>
        <textarea id={captionId} className="cn-field__input cn-photo-info__textarea" value={caption} onChange={(e) => setCaption(e.target.value)} rows={3} maxLength={5000} placeholder={t("photos.info.captionPlaceholder")} autoFocus />
      </div>
      <TextField label={t("photos.info.date")} type="date" value={date} onChange={(e) => setDate(e.target.value)} description={t("photos.info.dateDescription")} />
      <TextField label={t("photos.info.tags")} value={tags} onChange={(e) => setTags(e.target.value)} placeholder={t("photos.info.tagsPlaceholder")} description={t("photos.info.tagsDescription")} />
      <Select label={t("photos.info.rating")} value={rating} onChange={(e) => setRating(e.target.value)} options={[{ value: "", label: t("photos.info.ratingDefault") }, ...ratingOptions()]} />
      <div className="cn-photo-info__actions">
        <Button variant="ghost" onClick={() => onDone(null)}>{t("common.cancel")}</Button>
        <Button variant="primary" onClick={save} loading={saving}>{t("common.save")}</Button>
      </div>
    </div>
  );
}

// Example: 37.0896 -> "37.0896° N"
function formatCoordinate(value: number, positive: TranslationKey, negative: TranslationKey) {
  return t(value < 0 ? negative : positive, { value: Math.abs(value).toFixed(4) });
}
