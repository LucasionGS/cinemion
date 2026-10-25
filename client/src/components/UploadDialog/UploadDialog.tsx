import { type DragEvent, useEffect, useRef, useState } from "react";
import { File as FileIcon, FileArchive, FolderOpen, FolderUp, RotateCcw, Upload, X } from "lucide-react";
import type { LibraryInfo, LibraryType } from "@shared/api.ts";
import { type UploadEntry, uploads } from "../../lib/Uploads.ts";
import UploadsApi from "../../Api/UploadsApi.ts";
import useController from "../../lib/useController.ts";
import { formatBytes } from "../../lib/format.ts";
import { toasts } from "../../lib/Toasts.ts";
import cx from "../../lib/cx.ts";
import { rich, serverText, t, type TranslationKey } from "../../i18n/I18n.ts";
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

const KINDS: Record<LibraryType, TranslationKey> = {
  movies: "uploads.accepts.video",
  shows: "uploads.accepts.video",
  videos: "uploads.accepts.video",
  music: "uploads.accepts.music",
  audiobooks: "uploads.accepts.audiobooks",
  books: "uploads.accepts.books",
  photos: "uploads.accepts.photos",
  clips: "uploads.accepts.clips",
};

const FOLDER_EXAMPLES: Record<LibraryType, TranslationKey> = {
  movies: "uploads.folderExample.movies",
  shows: "uploads.folderExample.shows",
  videos: "uploads.folderExample.videos",
  music: "uploads.folderExample.music",
  audiobooks: "uploads.folderExample.audiobooks",
  books: "uploads.folderExample.books",
  photos: "uploads.folderExample.photos",
  clips: "uploads.folderExample.clips",
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
      .then((result) => !cancelled && setFolderProblem(result.message ? serverText(result.message) : null))
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
      if (rules && !accepted.includes(ext)) skip = t("uploads.skip.notUsed");
      else if (file.size === 0) skip = t("uploads.skip.empty");
      else if (rules?.maxSize && file.size > rules.maxSize) skip = t("uploads.skip.tooBig", { size: formatBytes(rules.maxSize) });
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
      title={t("uploads.dialog.title", { name: library.name })}
      description={t("uploads.dialog.description")}
      size="lg"
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>
        <Button variant="primary" icon={<Upload />} onClick={start} disabled={!canStart}>
          {sending.length > 0 ? t("uploads.dialog.uploadButton", { count: sending.length, size: formatBytes(total) }) : t("common.upload")}
        </Button>
      </>}
    >
      <div className="cn-upload">
        <FolderBrowser roots={library.paths} onNavigate={setFolder} />
        <TextField
          label={t("uploads.dialog.newFolder")}
          placeholder={t(FOLDER_EXAMPLES[library.type])}
          value={newFolder}
          onChange={(e) => setNewFolder(e.target.value)}
          error={subfolder.error}
          description={t("uploads.dialog.newFolderDescription")}
        />
        <p className="cn-upload__destination">
          {destination ? rich("uploads.dialog.goesTo", { destination: <code>{destination}</code> }) : t("uploads.dialog.openFolder")}
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
          <strong>{t("uploads.dialog.drop")}</strong>
          <span>{t(KINDS[library.type])}{rules?.maxSize ? ` ${t("uploads.dialog.maxSize", { size: formatBytes(rules.maxSize) })}` : ""}</span>
          <div className="cn-upload__drop-buttons">
            <Button size="sm" icon={<FileIcon />} onClick={() => filesInput.current?.click()}>{t("uploads.dialog.chooseFiles")}</Button>
            <Button size="sm" icon={<FolderUp />} onClick={() => folderInput.current?.click()}>{t("uploads.dialog.chooseFolder")}</Button>
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
            <ul className="cn-upload__list" aria-label={t("uploads.dialog.picked")}>
              {picked.map((p) => (
                <li key={p.path} className={cx("cn-upload__row", p.skip && "cn-upload__row--skipped")}>
                  {isZip(p.path) ? <FileArchive className="cn-upload__icon" /> : <FileIcon className="cn-upload__icon" />}
                  <div className="cn-upload__text">
                    <strong title={p.path}>{p.path}</strong>
                    <span>{p.skip ? t("uploads.dialog.leftOut", { reason: p.skip }) : formatBytes(p.file.size)}</span>
                  </div>
                  <IconButton label={t("common.remove")} icon={<X />} size="sm" variant="ghost" onClick={() => setPicked(picked.filter((x) => x !== p))} />
                </li>
              ))}
            </ul>
            <Switch
              label={t("uploads.dialog.replace")}
              description={t("uploads.dialog.replaceDescription")}
              checked={replace}
              onChange={setReplace}
            />
          </>
        )}

        {entries.length > 0 && (
          <section className="cn-upload__section">
            <header className="cn-upload__section-header">
              <h3>{t("uploads.dialog.uploads")}</h3>
              {entries.some((e) => e.state === "done") && <Button size="sm" variant="ghost" onClick={() => uploads.clearFinished(library.id)}>{t("uploads.dialog.clearFinished")}</Button>}
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
                if (file && resumeKey.current) uploads.resumeWith(resumeKey.current, file).catch((error: Error) => toasts.error(t("uploads.dialog.cantCarryOn"), error.message));
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
  const percent = Math.floor(fraction * 100);
  const server = entry.server;

  let status: string;
  let bar: number | null = null;
  switch (entry.state) {
    case "waiting":
      status = entry.sent > 0 ? t("uploads.status.waitingResumed", { percent }) : t("uploads.status.waiting", { size: formatBytes(entry.size) });
      bar = fraction;
      break;
    case "uploading":
      status = [
        t("uploads.status.percent", { percent }),
        t("uploads.status.sentOf", { sent: formatBytes(entry.sent), size: formatBytes(entry.size) }),
        entry.speed ? t("uploads.status.speed", { speed: formatBytes(entry.speed) }) : null,
        entry.speed ? timeLeft((entry.size - entry.sent) / entry.speed) : null,
      ].filter(Boolean).join(t("common.dotSeparator"));
      bar = fraction;
      break;
    case "retrying":
      status = entry.error ?? t("uploads.status.retrying");
      bar = fraction;
      break;
    case "paused":
      status = t("uploads.status.paused", { percent });
      bar = fraction;
      break;
    case "processing":
      status = server?.message ? serverText(server.message) : t("uploads.status.adding");
      if (server?.progress) status = t("uploads.status.processingProgress", { status, percent: Math.floor(server.progress * 100) });
      bar = server?.progress ?? 0;
      break;
    case "done":
      status = server?.message ? serverText(server.message) : t("uploads.status.added");
      break;
    case "failed":
      status = entry.error ?? t("uploads.status.stopped");
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
            <summary>{t("uploads.row.leftOut", { count: skipped.length })}</summary>
            <ul>
              {skipped.map((s) => <li key={s.path}><code>{s.path}</code>{t("common.dotSeparator")}{s.reason}</li>)}
            </ul>
          </details>
        )}
      </div>
      <div className="cn-upload__actions">
        {entry.state === "paused" && <Button size="sm" icon={<FolderOpen />} onClick={onPickFile}>{t("uploads.row.pickFile")}</Button>}
        {entry.state === "failed" && !entry.replace && /already/i.test(entry.error ?? "") && <Button size="sm" onClick={() => uploads.retry(entry.key, true)}>{t("uploads.row.replace")}</Button>}
        {entry.state === "failed" && <IconButton label={t("common.tryAgain")} icon={<RotateCcw />} size="sm" onClick={() => uploads.retry(entry.key)} />}
        {entry.state !== "processing" && (
          <IconButton
            label={entry.state === "done" ? t("uploads.row.clear") : entry.state === "failed" ? t("common.remove") : t("uploads.row.cancel")}
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
  if (parts.some((p) => p === "..")) return { path: "", error: t("uploads.folderErrors.outside") };
  if (parts.some((p) => p.startsWith("."))) return { path: "", error: t("uploads.folderErrors.hidden") };
  return { path: parts.join("/"), error: null };
}

/**
 * "About 4 min left", from seconds.
 */
function timeLeft(seconds: number) {
  if (!isFinite(seconds)) return null;
  if (seconds < 60) return t("uploads.timeLeft.underAMinute");
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t("uploads.timeLeft.minutes", { count: minutes });
  return t("uploads.timeLeft.hours", { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
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
