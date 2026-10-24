import { useCallback, useEffect, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { EllipsisVertical, Pencil, Plus, RefreshCw, ScanSearch, Trash2, Upload } from "lucide-react";
import type { LibraryInfo, LibraryType } from "@shared/api.ts";
import LibrariesApi from "../../Api/LibrariesApi.ts";
import { toasts } from "../../lib/Toasts.ts";
import { timeAgo } from "../../lib/format.ts";
import { ratingOptions } from "../../lib/ratings.ts";
import Select from "../../components/Select/Select.tsx";
import Button from "../../components/Button/Button.tsx";
import TextField from "../../components/TextField/TextField.tsx";
import SegmentedControl from "../../components/SegmentedControl/SegmentedControl.tsx";
import FolderBrowser from "../../components/FolderBrowser/FolderBrowser.tsx";
import Dialog, { ConfirmDialog } from "../../components/Dialog/Dialog.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import LibraryIcon from "../../components/LibraryIcon/LibraryIcon.tsx";
import UploadDialog from "../../components/UploadDialog/UploadDialog.tsx";
import { uploads } from "../../lib/Uploads.ts";
import useController from "../../lib/useController.ts";
import { t, type TranslationKey } from "../../i18n/I18n.ts";

/**
 * Add, scan and remove libraries.
 */
export default function LibrariesSettings() {
  const { libraries, reload } = useLiveLibraries();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<LibraryInfo | null>(null);
  const [removing, setRemoving] = useState<LibraryInfo | null>(null);
  const [uploading, setUploading] = useState<LibraryInfo | null>(null);
  const [busy, setBusy] = useState(false);
  useController(uploads);

  // Uploads from an earlier visit that stopped halfway show on their library's row
  useEffect(() => {
    uploads.load().catch(() => { });
  }, []);

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await LibrariesApi.remove(removing.id);
      toasts.success(t("libraries.remove.done", { name: removing.name }));
      setRemoving(null);
      reload();
    } catch (error) {
      toasts.error(t("libraries.remove.failed"), (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function scan(library: LibraryInfo, refresh: boolean) {
    try {
      await LibrariesApi.scan(library.id, refresh);
      reload();
    } catch (error) {
      toasts.error(t("libraries.scanFailed"), (error as Error).message);
    }
  }

  return (
    <>
      <header className="cn-settings__header">
        <div>
          <h1>{t("libraries.title")}</h1>
          <p>{t("libraries.intro")}</p>
        </div>
        <Button variant="primary" icon={<Plus />} onClick={() => setAdding(true)}>{t("libraries.addButton")}</Button>
      </header>

      {!libraries && <Spinner size="2rem" />}
      {libraries?.length === 0 && <p className="cn-settings__row-text"><span>{t("libraries.empty")}</span></p>}
      {libraries && libraries.length > 0 && (
        <div className="cn-settings__list">
          {libraries.map((l) => (
            <div key={l.id} className="cn-settings__item cn-settings__item--library">
              <LibraryIcon type={l.type} />
              <div className="cn-settings__item-text">
                <strong>{l.name}</strong>
                <span>{l.paths.join(t("common.listSeparator"))}</span>
                {l.conflict && <span className="cn-settings__conflict" role="alert">{t("libraries.conflict", { conflict: l.conflict })}</span>}
                <UploadProgress library={l} onOpen={() => setUploading(l)} />
                {l.scan
                  ? (
                    <span className="cn-settings__scan">
                      <span className="cn-settings__scan-bar"><span style={{ width: `${Math.round((l.scan.progress ?? 0) * 100)}%` }} /></span>
                      {l.scan.progress !== null ? t("libraries.scanProgress", { status: l.scan.status, percent: Math.round(l.scan.progress * 100) }) : l.scan.status}
                    </span>
                  )
                  : <span>{librarySummary(l)}</span>}
              </div>
              <Button size="sm" icon={<RefreshCw />} onClick={() => scan(l, false)} disabled={!!l.scan}>{t("libraries.scanNow")}</Button>
              <Menu.Root>
                <Menu.Trigger className="cn-icon-button cn-icon-button--glass cn-icon-button--md" aria-label={t("libraries.moreFor", { name: l.name })}><EllipsisVertical /></Menu.Trigger>
                <Menu.Portal>
                  <Menu.Positioner sideOffset={6} align="end" className="cn-menu__positioner">
                    <Menu.Popup className="cn-menu">
                      <Menu.Item className="cn-menu__item" onClick={() => setUploading(l)}><Upload /> {t("libraries.menu.upload")}</Menu.Item>
                      <Menu.Item className="cn-menu__item" onClick={() => setEditing(l)}><Pencil /> {t("libraries.menu.edit")}</Menu.Item>
                      <Menu.Item className="cn-menu__item" onClick={() => scan(l, true)}><ScanSearch /> {t(REFRESH_LABELS[l.type])}</Menu.Item>
                      <Menu.Separator className="cn-menu__separator" />
                      <Menu.Item className="cn-menu__item" onClick={() => setRemoving(l)}><Trash2 /> {t("libraries.menu.remove")}</Menu.Item>
                    </Menu.Popup>
                  </Menu.Positioner>
                </Menu.Portal>
              </Menu.Root>
            </div>
          ))}
        </div>
      )}

      <AddLibraryDialog open={adding} onOpenChange={setAdding} onAdded={reload} defaultType={nextType(libraries ?? [])} />
      <EditLibraryDialog library={editing} onClose={() => setEditing(null)} onSaved={reload} />
      <UploadDialog key={uploading?.id} library={uploading} onClose={() => setUploading(null)} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t("libraries.remove.title", { name: removing?.name ?? "" })}
        description={t("libraries.remove.description")}
        confirmLabel={t("libraries.remove.confirm")}
        danger
        loading={busy}
        onConfirm={remove}
      />
    </>
  );
}

/**
 * "Uploading 2 files · 45%" on a library's row while its uploads run; a click opens them.
 */
function UploadProgress(props: { library: LibraryInfo; onOpen: () => void }) {
  const { library, onOpen } = props;
  const active = uploads.forLibrary(library.id).filter((e) => e.state === "waiting" || e.state === "uploading" || e.state === "retrying" || e.state === "processing");
  const paused = uploads.forLibrary(library.id).filter((e) => e.state === "paused" || e.state === "failed").length;
  if (active.length === 0 && paused === 0) return null;
  const size = active.reduce((sum, e) => sum + e.size, 0);
  const sent = active.reduce((sum, e) => sum + e.sent, 0);
  const fraction = size ? sent / size : 0;
  const unpacking = active.length > 0 && active.every((e) => e.state === "processing");
  return (
    <button type="button" className="cn-settings__scan cn-settings__upload" onClick={onOpen}>
      {active.length > 0 && <span className="cn-settings__scan-bar"><span style={{ width: `${Math.round(fraction * 100)}%` }} /></span>}
      {active.length > 0
        ? unpacking ? t("libraries.uploadProgress.adding", { count: active.length }) : t("libraries.uploadProgress.uploading", { count: active.length, percent: Math.floor(fraction * 100) })
        : t("libraries.uploadProgress.needsALook", { count: paused })}
    </button>
  );
}

/**
 * The library types in the order the picker shows them.
 */
const TYPE_ORDER: LibraryType[] = ["movies", "shows", "videos", "music", "photos", "clips", "audiobooks", "books"];

const TYPE_NAMES: Record<LibraryType, TranslationKey> = {
  movies: "libraries.types.movies.name",
  shows: "libraries.types.shows.name",
  videos: "libraries.types.videos.name",
  music: "libraries.types.music.name",
  audiobooks: "libraries.types.audiobooks.name",
  books: "libraries.types.books.name",
  photos: "libraries.types.photos.name",
  clips: "libraries.types.clips.name",
};

/**
 * "12 movies", "1 album": how many titles a library has.
 */
const TYPE_COUNTS: Record<LibraryType, TranslationKey> = {
  movies: "libraries.types.movies.count",
  shows: "libraries.types.shows.count",
  videos: "libraries.types.videos.count",
  music: "libraries.types.music.count",
  audiobooks: "libraries.types.audiobooks.count",
  books: "libraries.types.books.count",
  photos: "libraries.types.photos.count",
  clips: "libraries.types.clips.count",
};

/**
 * What a new library of each type does, for the types that need explaining.
 */
const TYPE_DESCRIPTIONS: Partial<Record<LibraryType, TranslationKey>> = {
  videos: "libraries.types.videos.description",
  music: "libraries.types.music.description",
  audiobooks: "libraries.types.audiobooks.description",
  books: "libraries.types.books.description",
  clips: "libraries.types.clips.description",
  photos: "libraries.types.photos.description",
};

/**
 * What "refresh all details" fetches again for each type.
 */
const REFRESH_LABELS: Record<LibraryType, TranslationKey> = {
  movies: "libraries.menu.refresh.all",
  shows: "libraries.menu.refresh.all",
  videos: "libraries.menu.refresh.detailsAndThumbnails",
  photos: "libraries.menu.refresh.detailsAndThumbnails",
  clips: "libraries.menu.refresh.thumbnailsAndGames",
  music: "libraries.menu.refresh.covers",
  audiobooks: "libraries.menu.refresh.bookDetails",
  books: "libraries.menu.refresh.bookDetails",
};

/**
 * The label and explanation of the rating for unrated titles. Movies and shows get their ratings online, so theirs
 * is never shown.
 */
const RATING_LINES: Record<LibraryType, { label: TranslationKey; description: TranslationKey }> = {
  movies: { label: "libraries.rating.videos.label", description: "libraries.rating.videos.description" },
  shows: { label: "libraries.rating.videos.label", description: "libraries.rating.videos.description" },
  videos: { label: "libraries.rating.videos.label", description: "libraries.rating.videos.description" },
  music: { label: "libraries.rating.music.label", description: "libraries.rating.music.description" },
  audiobooks: { label: "libraries.rating.books.label", description: "libraries.rating.books.description" },
  books: { label: "libraries.rating.books.label", description: "libraries.rating.books.description" },
  photos: { label: "libraries.rating.photos.label", description: "libraries.rating.photos.description" },
  clips: { label: "libraries.rating.clips.label", description: "libraries.rating.clips.description" },
};

/**
 * "12 movies · scanned 2 hours ago · rated PG" under a library's name.
 */
function librarySummary(library: LibraryInfo) {
  const parts = [
    t(TYPE_COUNTS[library.type], { count: library.itemCount }),
    library.lastScannedAt ? t("libraries.row.scanned", { ago: timeAgo(library.lastScannedAt) }) : t("libraries.row.notScanned"),
  ];
  if (library.type !== "movies" && library.type !== "shows") {
    parts.push(library.defaultRating ? t("libraries.row.rated", { rating: library.defaultRating }) : t("libraries.row.unrated"));
  }
  return parts.join(t("common.dotSeparator"));
}

/**
 * The type a new library most likely has: whatever kind isn't there yet.
 */
function nextType(libraries: LibraryInfo[]): LibraryType {
  return TYPE_ORDER.find((type) => !libraries.some((l) => l.type === type)) ?? "movies";
}

/**
 * The rating unrated videos, music, books, photos or clips get, for the libraries that have one.
 */
function DefaultRatingSelect(props: { value: string; onChange: (value: string) => void; type: LibraryType }) {
  const lines = RATING_LINES[props.type];
  return (
    <Select
      label={t(lines.label)}
      description={t(lines.description, { rating: t(props.type === "clips" ? "ratings.age12" : "ratings.g") })}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      options={[{ value: "", label: t("libraries.rating.none") }, ...ratingOptions()]}
    />
  );
}

function EditLibraryDialog(props: { library: LibraryInfo | null; onClose: () => void; onSaved: () => void }) {
  const { library, onClose, onSaved } = props;
  const [name, setName] = useState("");
  const [rating, setRating] = useState("");
  const [paths, setPaths] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!library) return;
    setName(library.name);
    setRating(library.defaultRating ?? "");
    setPaths(library.paths);
  }, [library?.id]);

  async function save() {
    if (!library) return;
    setSaving(true);
    try {
      await LibrariesApi.update(library.id, { name, paths, ...(library.type !== "movies" && library.type !== "shows" ? { defaultRating: rating || null } : {}) });
      toasts.success(t("libraries.edit.saved"));
      onSaved();
      onClose();
    } catch (error) {
      toasts.error(t("libraries.edit.failed"), (error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={!!library}
      onOpenChange={(open) => !open && onClose()}
      title={library ? t("libraries.edit.title", { name: library.name }) : t("libraries.edit.titleFallback")}
      size="lg"
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="primary" onClick={save} loading={saving} disabled={!name.trim() || paths.length === 0}>{t("common.save")}</Button>
      </>}
    >
      <TextField label={t("libraries.form.name")} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
      {library && library.type !== "movies" && library.type !== "shows" && <DefaultRatingSelect value={rating} onChange={setRating} type={library.type} />}
      <FolderBrowser selected={paths} onSelect={(path) => setPaths([...paths, path])} />
      <div className="cn-settings__badges">
        {paths.length === 0 && <span className="cn-settings__row-text"><span>{t("libraries.form.noFolders", { button: t("folderBrowser.useFolder") })}</span></span>}
        {paths.map((p) => (
          <button key={p} type="button" className="cn-settings__badge cn-settings__badge--accent" onClick={() => setPaths(paths.filter((x) => x !== p))} title={t("common.remove")}>
            {p} ×
          </button>
        ))}
      </div>
      {library && JSON.stringify(paths) !== JSON.stringify(library.paths) && (
        <p className="cn-settings__row-text"><span>{t("libraries.edit.rescanNote")}</span></p>
      )}
    </Dialog>
  );
}

/**
 * Libraries, polled while any of them is scanning so the progress stays current.
 */
function useLiveLibraries() {
  const [libraries, setLibraries] = useState<LibraryInfo[] | null>(null);

  const reload = useCallback(() => {
    LibrariesApi.list().then(setLibraries).catch((e: Error) => toasts.error(t("libraries.loadFailed"), e.message));
  }, []);

  useEffect(reload, [reload]);

  const scanning = libraries?.some((l) => l.scan) ?? false;
  useEffect(() => {
    if (!scanning) return;
    const timer = setInterval(reload, 1500);
    return () => clearInterval(timer);
  }, [scanning, reload]);

  return { libraries, reload };
}

function AddLibraryDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; onAdded: () => void; defaultType: LibraryType }) {
  const { open, onOpenChange, onAdded, defaultType } = props;
  const [type, setType] = useState<LibraryType>(defaultType);
  const [name, setName] = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  const [paths, setPaths] = useState<string[]>([]);
  const [rating, setRating] = useState("");
  const [saving, setSaving] = useState(false);
  const description = TYPE_DESCRIPTIONS[type];

  useEffect(() => {
    if (!open) return;
    setType(defaultType);
    setName(t(TYPE_NAMES[defaultType]));
    setNameEdited(false);
    setPaths([]);
    setRating("");
  }, [open]);

  async function add() {
    setSaving(true);
    try {
      await LibrariesApi.create({ name, type, paths, defaultRating: type !== "movies" && type !== "shows" ? rating || null : undefined });
      toasts.success(t("libraries.add.added", { name: name.trim() }), t("libraries.add.scanning"));
      onAdded();
      onOpenChange(false);
    } catch (error) {
      toasts.error(t("libraries.add.failed"), (error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("libraries.add.title")}
      size="lg"
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
        <Button variant="primary" onClick={add} loading={saving} disabled={!name.trim() || paths.length === 0}>{t("libraries.add.confirm")}</Button>
      </>}
    >
      <div className="cn-settings__row">
        <SegmentedControl<LibraryType>
          label={t("libraries.form.type")}
          value={type}
          onChange={(value) => {
            setType(value);
            if (!nameEdited) setName(t(TYPE_NAMES[value]));
          }}
          options={TYPE_ORDER.map((kind) => ({ value: kind, label: t(TYPE_NAMES[kind]) }))}
        />
        <TextField label={t("libraries.form.name")} value={name} style={{ flex: "1 1 14rem" }} onChange={(e) => {
          setName(e.target.value);
          setNameEdited(true);
        }} />
      </div>
      {description && (
        <>
          <p className="cn-settings__row-text"><span>{t(description)}</span></p>
          <DefaultRatingSelect value={rating} onChange={setRating} type={type} />
        </>
      )}
      <FolderBrowser selected={paths} onSelect={(path) => setPaths([...paths, path])} />
      <div className="cn-settings__badges">
        {paths.length === 0 && <span className="cn-settings__row-text"><span>{t("libraries.form.noFolders", { button: t("folderBrowser.useFolder") })}</span></span>}
        {paths.map((p) => (
          <button key={p} type="button" className="cn-settings__badge cn-settings__badge--accent" onClick={() => setPaths(paths.filter((x) => x !== p))} title={t("common.remove")}>
            {p} ×
          </button>
        ))}
      </div>
    </Dialog>
  );
}
