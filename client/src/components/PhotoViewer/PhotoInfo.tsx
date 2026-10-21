import { type ReactNode, useEffect, useId, useState } from "react";
import { Calendar, Camera, FolderOpen, Image as ImageIcon, Images, MapPin, Pencil, Tag, X } from "lucide-react";
import type { PhotoDetail } from "@shared/photos.ts";
import PhotosApi from "../../Api/PhotosApi.ts";
import { router } from "../../lib/Router.tsx";
import { toasts } from "../../lib/Toasts.ts";
import { formatBytes, formatDateTime } from "../../lib/format.ts";
import { formatClock } from "../../lib/playback.ts";
import { RATINGS } from "../../lib/ratings.ts";
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
        <h2>Details</h2>
        {canEdit && detail && !editing && <IconButton label="Edit details" icon={<Pencil />} variant="ghost" size="sm" onClick={() => setEditing(true)} />}
        <IconButton label="Close details" icon={<X />} variant="ghost" size="sm" onClick={onClose} />
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
  ].filter(Boolean).join(" · ");
  const hasPlace = meta?.latitude != null && meta.longitude != null;

  return (
    <>
      {detail.caption && <p className="cn-photo-info__caption">{detail.caption}</p>}
      <dl className="cn-photo-info__facts">
        <Fact icon={<Calendar />} title={detail.takenAt ? formatDateTime(detail.takenAt) : "Date unknown"}>
          {meta?.offset ? `Camera clock at UTC${meta.offset}` : detail.type === "video" && detail.duration ? `Length ${formatClock(detail.duration)}` : null}
        </Fact>
        <Fact icon={<ImageIcon />} title={detail.fileName}>
          {[meta?.width && meta.height ? `${meta.width} × ${meta.height}` : null, megapixels && detail.type === "photo" ? `${megapixels} MP` : null, formatBytes(detail.size)].filter(Boolean).join(" · ")}
        </Fact>
        {(meta?.camera || exposure) && (
          <Fact icon={<Camera />} title={meta?.camera ?? "Camera"}>
            {[exposure, meta?.lens].filter(Boolean).join(" · ") || null}
          </Fact>
        )}
        {hasPlace && (
          <Fact icon={<MapPin />} title={`${formatCoordinate(meta!.latitude!, "N", "S")}, ${formatCoordinate(meta!.longitude!, "E", "W")}`}>
            <a href={`https://www.openstreetmap.org/?mlat=${meta!.latitude}&mlon=${meta!.longitude}#map=15/${meta!.latitude}/${meta!.longitude}`} target="_blank" rel="noreferrer noopener">Open in a map</a>
          </Fact>
        )}
        {detail.folders.length > 0 && (
          <Fact icon={<FolderOpen />} title="Folder">
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
          <Fact icon={<Images />} title={detail.albums.length === 1 ? "In an album" : "In albums"}>
            {detail.albums.map((a, i) => (
              <span key={a.id}>
                {i > 0 && ", "}
                <a href={`/photos/album/${a.id}`} onClick={(e) => {
                  e.preventDefault();
                  router.navigate(`/photos/album/${a.id}`);
                }}>{a.title}</a>
              </span>
            ))}
          </Fact>
        )}
        {(detail.tags.length > 0 || detail.contentRating) && (
          <Fact icon={<Tag />} title="Tags">
            <span className="cn-photo-info__tags">
              {detail.tags.map((t) => <span key={t} className="cn-photo-info__tag">{t}</span>)}
              {detail.contentRating && <span className="cn-photo-info__tag">Rated {detail.contentRating}</span>}
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
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        contentRating: rating || null,
      });
      onDone(await PhotosApi.get(detail.id));
      toasts.success("Details saved");
    } catch (error) {
      toasts.error("Couldn't save", (error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="cn-photo-info__form">
      <div className="cn-field">
        <label className="cn-field__label" htmlFor={captionId}>Caption</label>
        <textarea id={captionId} className="cn-field__input cn-photo-info__textarea" value={caption} onChange={(e) => setCaption(e.target.value)} rows={3} maxLength={5000} placeholder="What's happening here?" autoFocus />
      </div>
      <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} description="The time of day stays as it was." />
      <TextField label="Tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Beach, Mira" description="Separate them with commas." />
      <Select label="Age rating" value={rating} onChange={(e) => setRating(e.target.value)} options={[{ value: "", label: "Library default" }, ...RATINGS]} />
      <div className="cn-photo-info__actions">
        <Button variant="ghost" onClick={() => onDone(null)}>Cancel</Button>
        <Button variant="primary" onClick={save} loading={saving}>Save</Button>
      </div>
    </div>
  );
}

// Example: 37.0896 -> "37.0896° N"
function formatCoordinate(value: number, positive: string, negative: string) {
  return `${Math.abs(value).toFixed(4)}° ${value < 0 ? negative : positive}`;
}
