import { useEffect, useState } from "react";
import { Clapperboard, Plus, Trash2, Tv } from "lucide-react";
import type { LibraryInfo, LibraryType } from "@shared/api.ts";
import LibrariesApi from "../../Api/LibrariesApi.ts";
import { toasts } from "../../lib/Toasts.ts";
import Button from "../../components/Button/Button.tsx";
import IconButton from "../../components/IconButton/IconButton.tsx";
import TextField from "../../components/TextField/TextField.tsx";
import SegmentedControl from "../../components/SegmentedControl/SegmentedControl.tsx";
import FolderBrowser from "../../components/FolderBrowser/FolderBrowser.tsx";
import Dialog, { ConfirmDialog } from "../../components/Dialog/Dialog.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";

/**
 * Add and remove libraries.
 */
export default function LibrariesSettings() {
  const [libraries, setLibraries] = useState<LibraryInfo[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<LibraryInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = () => {
    LibrariesApi.list().then(setLibraries).catch((e: Error) => toasts.error("Couldn't load libraries", e.message));
  };
  useEffect(reload, []);

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

  return (
    <>
      <header className="cn-settings__header">
        <div>
          <h1>Libraries</h1>
          <p>The folders Cinemion looks in for movies and shows.</p>
        </div>
        <Button variant="primary" icon={<Plus />} onClick={() => setAdding(true)}>Add library</Button>
      </header>

      {!libraries && <Spinner size="2rem" />}
      {libraries?.length === 0 && <p className="cn-settings__row-text"><span>No libraries yet.</span></p>}
      {libraries && libraries.length > 0 && (
        <div className="cn-settings__list">
          {libraries.map((l) => (
            <div key={l.id} className="cn-settings__item">
              {l.type === "shows" ? <Tv /> : <Clapperboard />}
              <div className="cn-settings__item-text">
                <strong>{l.name}</strong>
                <span>{l.paths.join(", ")}</span>
              </div>
              <IconButton label={`Remove ${l.name}`} icon={<Trash2 />} onClick={() => setRemoving(l)} />
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
      toasts.success(`${name.trim()} was added`);
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
