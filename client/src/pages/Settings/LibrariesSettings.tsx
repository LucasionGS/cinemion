import { useCallback, useEffect, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { EllipsisVertical, Pencil, Plus, RefreshCw, ScanSearch, Trash2, Upload } from "lucide-react";
import type { LibraryInfo, LibraryType } from "@shared/api.ts";
import LibrariesApi from "../../Api/LibrariesApi.ts";
import { toasts } from "../../lib/Toasts.ts";
import { timeAgo } from "../../lib/format.ts";
import { RATINGS } from "../../lib/ratings.ts";
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
      toasts.success(`${removing.name} was removed`);
      setRemoving(null);
      reload();
    } catch (error) {
      toasts.error("Couldn't remove the library", (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function scan(library: LibraryInfo, refresh: boolean) {
    try {
      await LibrariesApi.scan(library.id, refresh);
      reload();
    } catch (error) {
      toasts.error("Couldn't start the scan", (error as Error).message);
    }
  }

  return (
    <>
      <header className="cn-settings__header">
        <div>
          <h1>Libraries</h1>
          <p>The folders Cinemion looks in for movies, shows, other videos, music and books. New files are picked up by themselves.</p>
        </div>
        <Button variant="primary" icon={<Plus />} onClick={() => setAdding(true)}>Add library</Button>
      </header>

      {!libraries && <Spinner size="2rem" />}
      {libraries?.length === 0 && <p className="cn-settings__row-text"><span>No libraries yet.</span></p>}
      {libraries && libraries.length > 0 && (
        <div className="cn-settings__list">
          {libraries.map((l) => (
            <div key={l.id} className="cn-settings__item cn-settings__item--library">
              <LibraryIcon type={l.type} />
              <div className="cn-settings__item-text">
                <strong>{l.name}</strong>
                <span>{l.paths.join(", ")}</span>
                {l.conflict && <span className="cn-settings__conflict" role="alert">{l.conflict} Use “Edit library” to change the folders.</span>}
                <UploadProgress library={l} onOpen={() => setUploading(l)} />
                {l.scan
                  ? (
                    <span className="cn-settings__scan">
                      <span className="cn-settings__scan-bar"><span style={{ width: `${Math.round((l.scan.progress ?? 0) * 100)}%` }} /></span>
                      {l.scan.status}{l.scan.progress !== null && ` · ${Math.round(l.scan.progress * 100)}%`}
                    </span>
                  )
                  : <span>{l.itemCount} {NOUNS[l.type][l.itemCount === 1 ? 0 : 1]} · {l.lastScannedAt ? `scanned ${timeAgo(l.lastScannedAt)}` : "not scanned yet"}{l.type !== "movies" && l.type !== "shows" && ` · rated ${l.defaultRating ?? "unrated"}`}</span>}
              </div>
              <Button size="sm" icon={<RefreshCw />} onClick={() => scan(l, false)} disabled={!!l.scan}>Scan now</Button>
              <Menu.Root>
                <Menu.Trigger className="cn-icon-button cn-icon-button--glass cn-icon-button--md" aria-label={`More for ${l.name}`}><EllipsisVertical /></Menu.Trigger>
                <Menu.Portal>
                  <Menu.Positioner sideOffset={6} align="end" className="cn-menu__positioner">
                    <Menu.Popup className="cn-menu">
                      <Menu.Item className="cn-menu__item" onClick={() => setUploading(l)}><Upload /> Upload files</Menu.Item>
                      <Menu.Item className="cn-menu__item" onClick={() => setEditing(l)}><Pencil /> Edit library</Menu.Item>
                      <Menu.Item className="cn-menu__item" onClick={() => scan(l, true)}><ScanSearch /> {l.type === "videos" || l.type === "photos" ? "Refresh details and thumbnails" : l.type === "clips" ? "Refresh thumbnails and games" : l.type === "music" ? "Find covers again" : l.type === "audiobooks" || l.type === "books" ? "Read book details again" : "Refresh all details"}</Menu.Item>
                      <Menu.Separator className="cn-menu__separator" />
                      <Menu.Item className="cn-menu__item" onClick={() => setRemoving(l)}><Trash2 /> Remove library</Menu.Item>
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
        title={`Remove ${removing?.name}?`}
        description="Cinemion forgets this library and its watch history. The files in its folders are not touched."
        confirmLabel="Remove library"
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
        ? unpacking ? `Adding ${active.length === 1 ? "an upload" : `${active.length} uploads`} to the library` : `Uploading ${active.length} ${active.length === 1 ? "file" : "files"} · ${Math.floor(fraction * 100)}%`
        : `${paused} ${paused === 1 ? "upload needs" : "uploads need"} a look`}
    </button>
  );
}

const NOUNS: Record<LibraryType, [string, string]> = { movies: ["movie", "movies"], shows: ["show", "shows"], videos: ["video", "videos"], music: ["album", "albums"], audiobooks: ["audiobook", "audiobooks"], books: ["book", "books"], photos: ["photo", "photos"], clips: ["clip", "clips"] };
const TYPE_NAMES: Record<LibraryType, string> = { movies: "Movies", shows: "Shows", videos: "Videos", music: "Music", audiobooks: "Audiobooks", books: "Books", photos: "Photos", clips: "Clips" };

/**
 * The type a new library most likely has: whatever kind isn't there yet.
 */
function nextType(libraries: LibraryInfo[]): LibraryType {
  return (["movies", "shows", "videos", "music", "photos", "clips", "audiobooks", "books"] as const).find((t) => !libraries.some((l) => l.type === t)) ?? "movies";
}

/**
 * The rating unrated videos, music, books, photos or clips get, for the libraries that have one.
 */
function DefaultRatingSelect(props: { value: string; onChange: (value: string) => void; type?: LibraryType }) {
  const what = props.type === "music" ? "music" : props.type === "audiobooks" || props.type === "books" ? "books" : null;
  if (props.type === "photos") {
    return (
      <Select
        label="Rating for unrated photos"
        description="Profiles with an age limit only see photos and videos rated within it. Pick “G / All ages” for family photos everyone may see."
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        options={[{ value: "", label: "None: hide them from age-limited profiles" }, ...RATINGS]}
      />
    );
  }
  return (
    <Select
      label={what ? `Rating for these ${what === "music" ? "albums" : "books"}` : props.type === "clips" ? "Rating for unrated clips" : "Rating for unrated videos"}
      description={what
        ? `Profiles with an age limit only see ${what} rated within it. Pick “G / All ages” so everyone can ${what === "music" ? "listen" : "read and listen"}.`
        : props.type === "clips"
        ? "Profiles with an age limit only see clips rated within it. Pick one that suits the games you play, like “12”."
        : "Profiles with an age limit only see videos rated within it. Pick “G / All ages” for family videos everyone may see."}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      options={[{ value: "", label: "None: hide them from age-limited profiles" }, ...RATINGS]}
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
      toasts.success("Library saved");
      onSaved();
      onClose();
    } catch (error) {
      toasts.error("Couldn't save the library", (error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={!!library}
      onOpenChange={(open) => !open && onClose()}
      title={`Edit ${library?.name ?? "library"}`}
      size="lg"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save} loading={saving} disabled={!name.trim() || paths.length === 0}>Save</Button>
      </>}
    >
      <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
      {library && library.type !== "movies" && library.type !== "shows" && <DefaultRatingSelect value={rating} onChange={setRating} type={library.type} />}
      <FolderBrowser selected={paths} onSelect={(path) => setPaths([...paths, path])} />
      <div className="cn-settings__badges">
        {paths.length === 0 && <span className="cn-settings__row-text"><span>Open a folder and choose "Use this folder".</span></span>}
        {paths.map((p) => (
          <button key={p} type="button" className="cn-settings__badge cn-settings__badge--accent" onClick={() => setPaths(paths.filter((x) => x !== p))} title="Remove">
            {p} ×
          </button>
        ))}
      </div>
      {library && JSON.stringify(paths) !== JSON.stringify(library.paths) && (
        <p className="cn-settings__row-text"><span>After saving, the libraries are scanned again. Titles in folders you removed leave this library, along with their watch history here.</span></p>
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
    LibrariesApi.list().then(setLibraries).catch((e: Error) => toasts.error("Couldn't load libraries", e.message));
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

  useEffect(() => {
    if (!open) return;
    setType(defaultType);
    setName(TYPE_NAMES[defaultType]);
    setNameEdited(false);
    setPaths([]);
    setRating("");
  }, [open]);

  async function add() {
    setSaving(true);
    try {
      await LibrariesApi.create({ name, type, paths, defaultRating: type !== "movies" && type !== "shows" ? rating || null : undefined });
      toasts.success(`${name.trim()} was added`, "Cinemion is scanning it now.");
      onAdded();
      onOpenChange(false);
    } catch (error) {
      toasts.error("Couldn't add the library", (error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add library"
      size="lg"
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="primary" onClick={add} loading={saving} disabled={!name.trim() || paths.length === 0}>Add library</Button>
      </>}
    >
      <div className="cn-settings__row">
        <SegmentedControl<LibraryType>
          label="Library type"
          value={type}
          onChange={(value) => {
            setType(value);
            if (!nameEdited) setName(TYPE_NAMES[value]);
          }}
          options={[{ value: "movies", label: "Movies" }, { value: "shows", label: "Shows" }, { value: "videos", label: "Videos" }, { value: "music", label: "Music" }, { value: "photos", label: "Photos" }, { value: "clips", label: "Clips" }, { value: "audiobooks", label: "Audiobooks" }, { value: "books", label: "Books" }]}
        />
        <TextField label="Name" value={name} style={{ flex: "1 1 14rem" }} onChange={(e) => {
          setName(e.target.value);
          setNameEdited(true);
        }} />
      </div>
      {type === "videos" && (
        <>
          <p className="cn-settings__row-text"><span>For home videos, recordings and anything else that isn't a movie or show. Nothing is looked up online: titles come from the file names, and you can edit the details by hand.</span></p>
          <DefaultRatingSelect value={rating} onChange={setRating} />
        </>
      )}
      {type === "music" && (
        <>
          <p className="cn-settings__row-text"><span>Albums, artists and tracks, sorted by the tags in the files (or folders like Artist/Album/01 Title.mp3). Covers come from the files or a cover.jpg next to them, and lyrics from tags or .lrc files. Nothing is looked up online.</span></p>
          <DefaultRatingSelect value={rating} onChange={setRating} type="music" />
        </>
      )}
      {type === "audiobooks" && (
        <>
          <p className="cn-settings__row-text"><span>A folder of audio files is one book (parts in CD1, CD2… folders too), and so is a single .m4b. Chapters come from the files, details from their tags, and everyone keeps their own place.</span></p>
          <DefaultRatingSelect value={rating} onChange={setRating} type="audiobooks" />
        </>
      )}
      {type === "books" && (
        <>
          <p className="cn-settings__row-text"><span>EPUB books are read right in Cinemion, with everyone's place saved; PDFs open in the browser's own viewer. Details and covers come from the files.</span></p>
          <DefaultRatingSelect value={rating} onChange={setRating} type="books" />
        </>
      )}
      {type === "clips" && (
        <>
          <p className="cn-settings__row-text"><span>Game recordings, grouped by game. The game comes from the names recorders give their files and folders (NVIDIA, AMD, Xbox Game Bar, OBS, Steam and more), with covers from Steam. Clips without a game can be given one by hand, or get a suggestion from picture recognition.</span></p>
          <DefaultRatingSelect value={rating} onChange={setRating} type="clips" />
        </>
      )}
      {type === "photos" && (
        <>
          <p className="cn-settings__row-text"><span>Photos and phone videos, with every folder as an album. Dates, cameras and places come from the photos themselves (HEIC from iPhones works too), and nothing is looked up online. Everyone can also make their own albums without moving any files.</span></p>
          <DefaultRatingSelect value={rating} onChange={setRating} type="photos" />
        </>
      )}
      <FolderBrowser selected={paths} onSelect={(path) => setPaths([...paths, path])} />
      <div className="cn-settings__badges">
        {paths.length === 0 && <span className="cn-settings__row-text"><span>Open a folder and choose "Use this folder".</span></span>}
        {paths.map((p) => (
          <button key={p} type="button" className="cn-settings__badge cn-settings__badge--accent" onClick={() => setPaths(paths.filter((x) => x !== p))} title="Remove">
            {p} ×
          </button>
        ))}
      </div>
    </Dialog>
  );
}
