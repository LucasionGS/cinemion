import { useCallback, useEffect, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { EllipsisVertical, Pencil, Plus, RefreshCw, ScanSearch, Trash2 } from "lucide-react";
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

/**
 * Add, scan and remove libraries.
 */
export default function LibrariesSettings() {
  const { libraries, reload } = useLiveLibraries();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<LibraryInfo | null>(null);
  const [removing, setRemoving] = useState<LibraryInfo | null>(null);
  const [busy, setBusy] = useState(false);

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
          <p>The folders Cinemion looks in for movies, shows and other videos. New files are picked up by themselves.</p>
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
                {l.scan
                  ? (
                    <span className="cn-settings__scan">
                      <span className="cn-settings__scan-bar"><span style={{ width: `${Math.round((l.scan.progress ?? 0) * 100)}%` }} /></span>
                      {l.scan.status}{l.scan.progress !== null && ` · ${Math.round(l.scan.progress * 100)}%`}
                    </span>
                  )
                  : <span>{l.itemCount} {NOUNS[l.type][l.itemCount === 1 ? 0 : 1]} · {l.lastScannedAt ? `scanned ${timeAgo(l.lastScannedAt)}` : "not scanned yet"}{l.type === "videos" && ` · unrated videos count as ${l.defaultRating ?? "unrated"}`}</span>}
              </div>
              <Button size="sm" icon={<RefreshCw />} onClick={() => scan(l, false)} disabled={!!l.scan}>Scan now</Button>
              <Menu.Root>
                <Menu.Trigger className="cn-icon-button cn-icon-button--glass cn-icon-button--md" aria-label={`More for ${l.name}`}><EllipsisVertical /></Menu.Trigger>
                <Menu.Portal>
                  <Menu.Positioner sideOffset={6} align="end" className="cn-menu__positioner">
                    <Menu.Popup className="cn-menu">
                      <Menu.Item className="cn-menu__item" onClick={() => setEditing(l)}><Pencil /> Edit library</Menu.Item>
                      <Menu.Item className="cn-menu__item" onClick={() => scan(l, true)}><ScanSearch /> {l.type === "videos" ? "Refresh details and thumbnails" : "Refresh all details"}</Menu.Item>
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

const NOUNS: Record<LibraryType, [string, string]> = { movies: ["movie", "movies"], shows: ["show", "shows"], videos: ["video", "videos"] };
const TYPE_NAMES: Record<LibraryType, string> = { movies: "Movies", shows: "Shows", videos: "Videos" };

/**
 * The type a new library most likely has: whatever kind isn't there yet.
 */
function nextType(libraries: LibraryInfo[]): LibraryType {
  return (["movies", "shows", "videos"] as const).find((t) => !libraries.some((l) => l.type === t)) ?? "movies";
}

/**
 * The rating unrated videos get, for Videos libraries.
 */
function DefaultRatingSelect(props: { value: string; onChange: (value: string) => void }) {
  return (
    <Select
      label="Rating for unrated videos"
      description="Profiles with an age limit only see videos rated within it. Pick “G / All ages” for family videos everyone may see."
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
      await LibrariesApi.update(library.id, { name, paths, ...(library.type === "videos" ? { defaultRating: rating || null } : {}) });
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
      {library?.type === "videos" && <DefaultRatingSelect value={rating} onChange={setRating} />}
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
      await LibrariesApi.create({ name, type, paths, defaultRating: type === "videos" ? rating || null : undefined });
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
          options={[{ value: "movies", label: "Movies" }, { value: "shows", label: "Shows" }, { value: "videos", label: "Videos" }]}
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
