import { type DragEvent, useEffect, useRef, useState } from "react";
import { File as FileIcon, FileArchive, FolderOpen, FolderUp, RotateCcw, Upload, X } from "lucide-react";
import type { LibraryInfo, LibraryType } from "@shared/api.ts";
import { type UploadEntry, uploads } from "../../lib/Uploads.ts";
import UploadsApi from "../../Api/UploadsApi.ts";
import useController from "../../lib/useController.ts";
import { formatBytes } from "../../lib/format.ts";
import { toasts } from "../../lib/Toasts.ts";
import cx from "../../lib/cx.ts";
import Dialog from "../Dialog/Dialog.tsx";
import Button from "../Button/Button.tsx";
import IconButton from "../IconButton/IconButton.tsx";
import TextField from "../TextField/TextField.tsx";
import Switch from "../Switch/Switch.tsx";
import FolderBrowser from "../FolderBrowser/FolderBrowser.tsx";
import "./UploadDialog.scss";

export interface UploadDialogProps {
  /**
   * The library to upload into. `null` = closed.
   */
  library: LibraryInfo | null;
  onClose: () => void;
}

/**
 * A file picked in the dialog, before it's sent.
 */
interface Picked {
  file: File;
  /**
   * Where it goes inside the chosen folder; keeps the folders of a dropped folder.
   */
  path: string;
  /**
   * Why it won't be uploaded. `null` = it will.
   */
  skip: string | null;
}

const KINDS: Record<LibraryType, string> = {
  movies: "Video files, subtitles, NFO files and pictures",
  shows: "Video files, subtitles, NFO files and pictures",
  videos: "Video files, subtitles, NFO files and pictures",
  music: "Audio files, lyrics and covers",
  audiobooks: "Audio files, cue sheets, descriptions and covers",
  books: "EPUB and PDF files and covers",
};

const FOLDER_EXAMPLES: Record<LibraryType, string> = {
  movies: "Glass Harbor (2021)",
  shows: "Saltwater Kings/Season 1",
  videos: "Holiday 2025",
  music: "Artist/Album",
  audiobooks: "Author/Book title",
  books: "Author",
};

/**
 * Upload files, folders and zip files into a folder of a library. Uploads keep going after the dialog closes, and an
 * unfinished one carries on when its file is picked again.
 */
export default function UploadDialog(props: UploadDialogProps) {
  const { library, onClose } = props;
  useController(uploads);
  const [folder, setFolder] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState("");
  const [picked, setPicked] = useState<Picked[]>([]);
  const [replace, setReplace] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [folderProblem, setFolderProblem] = useState<string | null>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const resumeInput = useRef<HTMLInputElement>(null);
  const resumeKey = useRef<string | null>(null);

  useEffect(() => {
    if (!library) return;
    setNewFolder("");
    setPicked([]);
    setReplace(false);
    setLoadError(null);
    uploads.load(library.id).catch((error: Error) => setLoadError(error.message));
  }, [library?.id]);

  // Media folders are often mounted read-only; say so before anything is picked
  useEffect(() => {
    setFolderProblem(null);
    if (!library || !folder) return;
    let cancelled = false;
    UploadsApi.check(library.id, folder)
      .then((result) => !cancelled && setFolderProblem(result.message))
      .catch(() => { });
    return () => {
      cancelled = true;
    };
  }, [library?.id, folder]);

  if (!library) return null;

  const rules = uploads.rules;
  const subfolder = cleanFolder(newFolder);
  const sending = picked.filter((p) => !p.skip);
  const total = sending.reduce((sum, p) => sum + p.file.size, 0);
  const entries = uploads.forLibrary(library.id);
  const destination = folder ? [folder.replace(/[\\/]+$/, ""), subfolder.path].filter(Boolean).join("/") : null;

  function add(files: { file: File; path: string }[]) {
    if (!library) return;
    const accepted = [...(rules?.extensions[library.type] ?? []), ".zip"];
    const added: Picked[] = [];
    for (const { file, path } of files) {
      // Hidden files (.DS_Store and friends) never show in a library
      if (path.split("/").some((part) => part.startsWith("."))) continue;
      const ext = path.includes(".") ? path.slice(path.lastIndexOf(".")).toLowerCase() : "";
      let skip: string | null = null;
      if (rules && !accepted.includes(ext)) skip = "Not a file this library uses";
      else if (file.size === 0) skip = "Empty";
      else if (rules?.maxSize && file.size > rules.maxSize) skip = `Bigger than the server takes (${formatBytes(rules.maxSize)})`;
      added.push({ file, path, skip });
    }
    setPicked((current) => [...current.filter((p) => !added.some((a) => a.path === p.path)), ...added]);
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    // Entries must be taken during the event; the data transfer is emptied once it's over
    const entries = [...e.dataTransfer.items].filter((i) => i.kind === "file").map((i) => i.webkitGetAsEntry?.() ?? null);
    const files = [...e.dataTransfer.files];
    if (entries.some((entry) => entry === null)) {
      add(files.map((file) => ({ file, path: file.name })));
      return;
    }
    add((await Promise.all(entries.map((entry) => readEntry(entry!, "")))).flat());
  }

  function start() {
    if (!library || !folder || subfolder.error) return;
    uploads.add(sending.map((p) => ({ file: p.file, libraryId: library.id, folder, path: [subfolder.path, p.path].filter(Boolean).join("/"), replace })));
    setPicked([]);
  }

  const canStart = !!folder && sending.length > 0 && !subfolder.error && !!rules && !folderProblem;

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Upload to ${library.name}`}
      description="Files go into the folder you pick. Zip files are unpacked there, keeping the folders inside them. Uploads keep going when you close this."
      size="lg"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        <Button variant="primary" icon={<Upload />} onClick={start} disabled={!canStart}>
          {sending.length > 0 ? `Upload ${sending.length} ${sending.length === 1 ? "file" : "files"} · ${formatBytes(total)}` : "Upload"}
        </Button>
      </>}
    >
      <div className="cn-upload">
        <FolderBrowser roots={library.paths} onNavigate={setFolder} />
        <TextField
          label="New folder inside it (optional)"
          placeholder={FOLDER_EXAMPLES[library.type]}
          value={newFolder}
          onChange={(e) => setNewFolder(e.target.value)}
          error={subfolder.error}
          description="Use / for a folder inside a folder. It's made when the upload starts."
        />
        <p className="cn-upload__destination">
          {destination ? <>Goes to <code>{destination}</code></> : "Open the folder to upload into."}
        </p>
        {folderProblem && <p className="cn-upload__error" role="alert">{folderProblem}</p>}

        <div
          className={cx("cn-upload__drop", dragging && "cn-upload__drop--active")}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            setDragging(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
          }}
          onDrop={onDrop}
        >
          <Upload className="cn-upload__drop-icon" aria-hidden="true" />
          <strong>Drop files, folders or zip files here</strong>
          <span>{KINDS[library.type]}, or zip files with them.{rules?.maxSize ? ` Up to ${formatBytes(rules.maxSize)} each.` : ""}</span>
          <div className="cn-upload__drop-buttons">
            <Button size="sm" icon={<FileIcon />} onClick={() => filesInput.current?.click()}>Choose files</Button>
            <Button size="sm" icon={<FolderUp />} onClick={() => folderInput.current?.click()}>Choose a folder</Button>
          </div>
          <input
            ref={filesInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              add([...e.target.files ?? []].map((file) => ({ file, path: file.name })));
              e.target.value = "";
            }}
          />
          <input
            ref={folderInput}
            type="file"
            hidden
            {...{ webkitdirectory: "" }}
            onChange={(e) => {
              add([...e.target.files ?? []].map((file) => ({ file, path: file.webkitRelativePath || file.name })));
              e.target.value = "";
            }}
          />
        </div>
        {loadError && <p className="cn-upload__error" role="alert">{loadError}</p>}

        {picked.length > 0 && (
          <>
            <ul className="cn-upload__list" aria-label="Picked files">
              {picked.map((p) => (
                <li key={p.path} className={cx("cn-upload__row", p.skip && "cn-upload__row--skipped")}>
                  {isZip(p.path) ? <FileArchive className="cn-upload__icon" /> : <FileIcon className="cn-upload__icon" />}
                  <div className="cn-upload__text">
                    <strong title={p.path}>{p.path}</strong>
                    <span>{p.skip ? `Left out: ${p.skip}` : formatBytes(p.file.size)}</span>
                  </div>
                  <IconButton label="Remove" icon={<X />} size="sm" variant="ghost" onClick={() => setPicked(picked.filter((x) => x !== p))} />
                </li>
              ))}
            </ul>
            <Switch
              label="Replace files that are already there"
              description="Otherwise a file that's already in the folder isn't uploaded, and zip files leave those files out."
              checked={replace}
              onChange={setReplace}
            />
          </>
        )}

        {entries.length > 0 && (
          <section className="cn-upload__section">
            <header className="cn-upload__section-header">
              <h3>Uploads</h3>
              {entries.some((e) => e.state === "done") && <Button size="sm" variant="ghost" onClick={() => uploads.clearFinished(library.id)}>Clear finished</Button>}
            </header>
            <ul className="cn-upload__list">
              {entries.map((entry) => (
                <UploadRow
                  key={entry.key}
                  entry={entry}
                  onPickFile={() => {
                    resumeKey.current = entry.key;
                    resumeInput.current?.click();
                  }}
                />
              ))}
            </ul>
            <input
              ref={resumeInput}
              type="file"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file && resumeKey.current) uploads.resumeWith(resumeKey.current, file).catch((error: Error) => toasts.error("Can't carry on with that file", error.message));
              }}
            />
          </section>
        )}
      </div>
    </Dialog>
  );
}

function UploadRow(props: { entry: UploadEntry; onPickFile: () => void }) {
  const { entry, onPickFile } = props;
  const fraction = entry.size ? entry.sent / entry.size : 0;
  const percent = `${Math.floor(fraction * 100)}%`;
  const server = entry.server;

  let status: string;
  let bar: number | null = null;
  switch (entry.state) {
    case "waiting":
      status = entry.sent > 0 ? `Waiting · ${percent} sent before` : `Waiting · ${formatBytes(entry.size)}`;
      bar = fraction;
      break;
    case "uploading":
      status = [percent, `${formatBytes(entry.sent)} of ${formatBytes(entry.size)}`, entry.speed ? `${formatBytes(entry.speed)}/s` : null, entry.speed ? timeLeft((entry.size - entry.sent) / entry.speed) : null].filter(Boolean).join(" · ");
      bar = fraction;
      break;
    case "retrying":
      status = entry.error ?? "Trying again…";
      bar = fraction;
      break;
    case "paused":
      status = `Stopped at ${percent}. Pick the file again to carry on.`;
      bar = fraction;
      break;
    case "processing":
      status = `${server?.message ?? "Adding to the library"}${server?.progress ? ` · ${Math.floor(server.progress * 100)}%` : ""}`;
      bar = server?.progress ?? 0;
      break;
    case "done":
      status = server?.message ?? "Added";
      break;
    case "failed":
      status = entry.error ?? "The upload stopped.";
      break;
  }
  const skipped = entry.state === "done" ? server?.skipped ?? [] : [];

  return (
    <li className={cx("cn-upload__row", `cn-upload__row--${entry.state}`)}>
      {isZip(entry.path) ? <FileArchive className="cn-upload__icon" /> : <FileIcon className="cn-upload__icon" />}
      <div className="cn-upload__text">
        <strong title={entry.path}>{entry.path}</strong>
        <span className="cn-upload__status">{status}</span>
        {bar !== null && <span className="cn-upload__bar"><span style={{ width: `${Math.min(1, bar) * 100}%` }} /></span>}
        {skipped.length > 0 && (
          <details className="cn-upload__skipped">
            <summary>{skipped.length} left out</summary>
            <ul>
              {skipped.map((s) => <li key={s.path}><code>{s.path}</code> · {s.reason}</li>)}
            </ul>
          </details>
        )}
      </div>
      <div className="cn-upload__actions">
        {entry.state === "paused" && <Button size="sm" icon={<FolderOpen />} onClick={onPickFile}>Pick the file</Button>}
        {entry.state === "failed" && !entry.replace && /already/i.test(entry.error ?? "") && <Button size="sm" onClick={() => uploads.retry(entry.key, true)}>Replace it</Button>}
        {entry.state === "failed" && <IconButton label="Try again" icon={<RotateCcw />} size="sm" onClick={() => uploads.retry(entry.key)} />}
        {entry.state !== "processing" && (
          <IconButton
            label={entry.state === "done" ? "Clear" : entry.state === "failed" ? "Remove" : "Cancel upload"}
            icon={<X />}
            size="sm"
            variant="ghost"
            onClick={() => uploads.remove(entry.key)}
          />
        )}
      </div>
    </li>
  );
}

function isZip(path: string) {
  return path.toLowerCase().endsWith(".zip");
}

/**
 * The typed "new folder", cleaned up, or why it can't be used.
 */
function cleanFolder(typed: string): { path: string; error: string | null } {
  const parts = typed.split(/[\\/]+/).map((p) => p.trim()).filter((p) => p !== "" && p !== ".");
  if (parts.some((p) => p === "..")) return { path: "", error: "The new folder has to be inside the folder above." };
  if (parts.some((p) => p.startsWith("."))) return { path: "", error: "Folder names starting with a dot are hidden, so the library would never show them." };
  return { path: parts.join("/"), error: null };
}

/**
 * "About 4 min left", from seconds.
 */
function timeLeft(seconds: number) {
  if (!isFinite(seconds)) return null;
  if (seconds < 60) return "under a minute left";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} min left`;
  return `about ${Math.floor(minutes / 60)} h ${minutes % 60} min left`;
}

/**
 * Every file under a dropped file or folder, with its path from the drop.
 */
async function readEntry(entry: FileSystemEntry, parent: string): Promise<{ file: File; path: string }[]> {
  const path = parent ? `${parent}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    return [{ file, path }];
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const children: FileSystemEntry[] = [];
  // Browsers hand out a folder's entries in batches of about 100
  while (true) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) break;
    children.push(...batch);
  }
  return (await Promise.all(children.map((child) => readEntry(child, path)))).flat();
}
