import { useCallback, useEffect, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { Clapperboard, EllipsisVertical, Plus, RefreshCw, ScanSearch, Trash2, Tv } from "lucide-react";
import type { LibraryInfo, LibraryType } from "@shared/api.ts";
import LibrariesApi from "../../Api/LibrariesApi.ts";
import { toasts } from "../../lib/Toasts.ts";
import { timeAgo } from "../../lib/format.ts";
import Button from "../../components/Button/Button.tsx";
import TextField from "../../components/TextField/TextField.tsx";
import SegmentedControl from "../../components/SegmentedControl/SegmentedControl.tsx";
import FolderBrowser from "../../components/FolderBrowser/FolderBrowser.tsx";
import Dialog, { ConfirmDialog } from "../../components/Dialog/Dialog.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";

/**
 * Add, scan and remove libraries.
 */
export default function LibrariesSettings() {
  const { libraries, reload } = useLiveLibraries();
  const [adding, setAdding] = useState(false);
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
          <p>The folders Cinemion looks in for movies and shows. New files are picked up by themselves.</p>
        </div>
        <Button variant="primary" icon={<Plus />} onClick={() => setAdding(true)}>Add library</Button>
      </header>

      {!libraries && <Spinner size="2rem" />}
      {libraries?.length === 0 && <p className="cn-settings__row-text"><span>No libraries yet.</span></p>}
      {libraries && libraries.length > 0 && (
        <div className="cn-settings__list">
          {libraries.map((l) => (
            <div key={l.id} className="cn-settings__item cn-settings__item--library">
              {l.type === "shows" ? <Tv /> : <Clapperboard />}
              <div className="cn-settings__item-text">
                <strong>{l.name}</strong>
                <span>{l.paths.join(", ")}</span>
                {l.scan
                  ? (
                    <span className="cn-settings__scan">
                      <span className="cn-settings__scan-bar"><span style={{ width: `${Math.round((l.scan.progress ?? 0) * 100)}%` }} /></span>
                      {l.scan.status}{l.scan.progress !== null && ` · ${Math.round(l.scan.progress * 100)}%`}
                    </span>
                  )
                  : <span>{l.itemCount} {l.type === "shows" ? (l.itemCount === 1 ? "show" : "shows") : (l.itemCount === 1 ? "movie" : "movies")} · {l.lastScannedAt ? `scanned ${timeAgo(l.lastScannedAt)}` : "not scanned yet"}</span>}
              </div>
              <Button size="sm" icon={<RefreshCw />} onClick={() => scan(l, false)} disabled={!!l.scan}>Scan now</Button>
              <Menu.Root>
                <Menu.Trigger className="cn-icon-button cn-icon-button--glass cn-icon-button--md" aria-label={`More for ${l.name}`}><EllipsisVertical /></Menu.Trigger>
                <Menu.Portal>
                  <Menu.Positioner sideOffset={6} align="end" className="cn-menu__positioner">
                    <Menu.Popup className="cn-menu">
                      <Menu.Item className="cn-menu__item" onClick={() => scan(l, true)}><ScanSearch /> Refresh all details</Menu.Item>
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

      <AddLibraryDialog open={adding} onOpenChange={setAdding} onAdded={reload} defaultType={libraries?.some((l) => l.type === "movies") ? "shows" : "movies"} />
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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setType(defaultType);
    setName(defaultType === "movies" ? "Movies" : "Shows");
    setNameEdited(false);
    setPaths([]);
  }, [open]);

  async function add() {
    setSaving(true);
    try {
      await LibrariesApi.create({ name, type, paths });
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
            if (!nameEdited) setName(value === "movies" ? "Movies" : "Shows");
          }}
          options={[{ value: "movies", label: "Movies" }, { value: "shows", label: "Shows" }]}
        />
        <TextField label="Name" value={name} style={{ flex: "1 1 14rem" }} onChange={(e) => {
          setName(e.target.value);
          setNameEdited(true);
        }} />
      </div>
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
