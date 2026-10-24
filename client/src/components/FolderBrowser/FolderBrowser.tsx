import { Fragment, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { ChevronRight, CornerDownLeft, Folder, FolderCheck, HardDrive, Pencil, X } from "lucide-react";
import type { FsListing } from "@shared/api.ts";
import ServerApi from "../../Api/ServerApi.ts";
import { t } from "../../i18n/I18n.ts";
import Button from "../Button/Button.tsx";
import IconButton from "../IconButton/IconButton.tsx";
import Spinner from "../Spinner/Spinner.tsx";
import "./FolderBrowser.scss";

export interface FolderBrowserProps {
  /**
   * Folders already picked, marked in the list.
   */
  selected?: string[];
  /**
   * Called with the open folder when "Use this folder" is clicked. Without it, there's no such button; follow the
   * open folder with `onNavigate` instead.
   */
  onSelect?: (path: string) => void;
  /**
   * Called whenever another folder is opened. `null` = the list of roots.
   */
  onNavigate?: (path: string | null) => void;
  /**
   * Only these folders and what's inside them can be opened, like a library's folders. Default is the server's media
   * roots, and typing a path.
   */
  roots?: string[];
}

/**
 * Browse the folders the server allows (its media roots) and pick one. The path can also be typed: click the empty
 * part of the path bar or the pencil.
 */
export default function FolderBrowser(props: FolderBrowserProps) {
  const { selected = [], onSelect, onNavigate, roots } = props;
  const [path, setPath] = useState<string | null>(roots?.length === 1 ? roots[0] : null);
  const [listing, setListing] = useState<FsListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    onNavigate?.(path);
    if (path === null && roots) {
      setListing({ path: null, root: null, parent: null, entries: roots.map((r) => ({ name: r, path: r })) });
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    ServerApi.listFolders(path)
      .then((result) => {
        setListing(result);
        setError(null);
        // A single root is opened straight away; there's nothing to choose between
        if (path === null && result.entries.length === 1) setPath(result.entries[0].path);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [path]);

  const crumbs = listing ? breadcrumbs(listing, roots) : [];
  const crumbsRef = useRef<HTMLElement>(null);
  const [typing, setTyping] = useState(false);

  // Keep the current folder in view when the path is long
  useEffect(() => {
    crumbsRef.current?.scrollTo({ left: crumbsRef.current.scrollWidth });
  }, [listing, typing]);

  if (typing) {
    return (
      <div className="cn-folders">
        <PathInput
          initial={listing?.path ?? listing?.entries[0]?.path ?? ""}
          onOpen={(opened) => {
            setPath(opened);
            setTyping(false);
          }}
          onCancel={() => setTyping(false)}
        />
        <FolderList loading={loading} error={error} listing={listing} selected={selected} onOpen={setPath} />
      </div>
    );
  }

  return (
    <div className="cn-folders">
      <div className="cn-folders__bar">
        {/* Clicking the empty part of the bar starts typing, like the address bar of a file manager */}
        <nav
          ref={crumbsRef}
          className="cn-folders__crumbs"
          aria-label={t("folderBrowser.path")}
          onClick={(e) => {
            if (e.target === e.currentTarget && !roots) setTyping(true);
          }}
        >
          <button type="button" className="cn-folders__crumb" aria-label={roots ? t("folderBrowser.top") : t("folderBrowser.drives")} onClick={() => setPath(roots?.length === 1 ? roots[0] : null)}><HardDrive /></button>
          {crumbs.map((crumb, i) => (
            <Fragment key={crumb.path}>
              <ChevronRight className="cn-folders__sep" aria-hidden="true" />
              {i === crumbs.length - 1
                ? <strong className="cn-folders__current">{crumb.name}</strong>
                : <button type="button" className="cn-folders__crumb" title={crumb.path} onClick={() => setPath(crumb.path)}>{crumb.name}</button>}
            </Fragment>
          ))}
        </nav>
        {!roots && <IconButton label={t("folderBrowser.typePath")} icon={<Pencil />} size="sm" onClick={() => setTyping(true)} />}
        {onSelect && path && !error && (
          <Button size="sm" variant="primary" icon={<FolderCheck />} onClick={() => onSelect(path)} disabled={selected.includes(path)}>
            {selected.includes(path) ? t("folderBrowser.selected") : t("folderBrowser.useFolder")}
          </Button>
        )}
      </div>

      <FolderList loading={loading} error={error} listing={listing} selected={selected} onOpen={setPath} />
    </div>
  );
}

function FolderList(props: { loading: boolean; error: string | null; listing: FsListing | null; selected: string[]; onOpen: (path: string) => void }) {
  const { loading, error, listing, selected, onOpen } = props;
  return (
    <div className="cn-folders__list">
      {loading && <div className="cn-folders__empty"><Spinner /></div>}
      {!loading && error && <div className="cn-folders__empty cn-folders__empty--error">{error}</div>}
      {!loading && !error && listing?.entries.length === 0 && <div className="cn-folders__empty">{t("folderBrowser.empty")}</div>}
      {!loading && !error && listing?.entries.map((entry) => (
        <button key={entry.path} type="button" className="cn-folders__entry" onClick={() => onOpen(entry.path)}>
          {selected.includes(entry.path) ? <FolderCheck className="cn-folders__icon cn-folders__icon--selected" /> : <Folder className="cn-folders__icon" />}
          <span>{entry.name}</span>
          <ChevronRight className="cn-folders__chevron" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

/**
 * Where a typed path splits into the folder to list and the start of the name being typed.
 * Example: "/media/mo" → "/media/" and "mo".
 */
function splitTyped(typed: string) {
  const sep = typed.includes("\\") && !typed.includes("/") ? "\\" : "/";
  const cut = typed.lastIndexOf(sep);
  return { sep, folder: cut >= 0 ? typed.slice(0, cut + 1) : "", partial: cut >= 0 ? typed.slice(cut + 1) : typed };
}

/**
 * The longest start that all `values` share.
 */
function commonStart(values: string[]) {
  if (values.length === 0) return "";
  let prefix = values[0];
  for (const value of values.slice(1)) {
    while (!value.toLowerCase().startsWith(prefix.toLowerCase())) prefix = prefix.slice(0, -1);
  }
  return prefix;
}

/**
 * A text field for the folder path. Subfolders are suggested while typing; Tab completes like a shell, Enter opens
 * the folder, Escape goes back to the path bar.
 */
function PathInput(props: { initial: string; onOpen: (path: string) => void; onCancel: () => void }) {
  const { initial, onOpen, onCancel } = props;
  const [typed, setTyped] = useState(initial.endsWith("/") || initial.endsWith("\\") || !initial ? initial : `${initial}/`);
  const [problem, setProblem] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const cache = useRef(new Map<string, string[]>());
  const listId = useId();

  // Suggest the subfolders of what's typed so far, a moment after typing stops
  useEffect(() => {
    const { folder, partial } = splitTyped(typed);
    if (!folder) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      let names = cache.current.get(folder);
      if (!names) {
        names = await ServerApi.listFolders(folder).then((l) => l.entries.map((e) => e.name)).catch(() => []);
        cache.current.set(folder, names);
      }
      if (cancelled) return;
      // Exact case first, like a shell; "devel" shouldn't become "Developer" when "development" is there too
      const exact = names.filter((n) => n.startsWith(partial) && n !== partial);
      const matches = exact.length ? exact : names.filter((n) => n.toLowerCase().startsWith(partial.toLowerCase()) && n.toLowerCase() !== partial.toLowerCase());
      // Built from what was typed, so "~/Vid" suggests "~/Videos" rather than the full home path
      setSuggestions(matches.map((n) => folder + n));
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [typed]);

  async function open() {
    const value = typed.trim();
    if (!value) return;
    setOpening(true);
    try {
      const listing = await ServerApi.listFolders(value);
      onOpen(listing.path ?? value);
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setOpening(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      open();
    }
    else if (e.key === "Escape") {
      // Inside a dialog, Escape would otherwise close the whole dialog
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
    else if (e.key === "Tab" && suggestions.length > 0 && !e.shiftKey) {
      e.preventDefault();
      const { sep } = splitTyped(typed);
      const completed = suggestions.length === 1 ? suggestions[0] + sep : commonStart(suggestions);
      if (completed.length > typed.length) setTyped(completed);
    }
  }

  return (
    <div className="cn-folders__typing">
      <div className="cn-folders__bar">
        <HardDrive className="cn-folders__bar-icon" aria-hidden="true" />
        <input
          className="cn-folders__input"
          aria-label={t("folderBrowser.path")}
          value={typed}
          list={listId}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          aria-invalid={!!problem || undefined}
          onChange={(e) => {
            setTyped(e.target.value);
            setProblem(null);
          }}
          onKeyDown={onKeyDown}
        />
        <datalist id={listId}>
          {suggestions.slice(0, 50).map((s) => <option key={s} value={s} />)}
        </datalist>
        <Button size="sm" variant="primary" icon={<CornerDownLeft />} onClick={open} loading={opening}>{t("common.open")}</Button>
        <IconButton label={t("folderBrowser.stopTyping")} icon={<X />} size="sm" onClick={onCancel} />
      </div>
      {problem && <p className="cn-folders__problem" role="alert">{problem}</p>}
    </div>
  );
}

/**
 * Split the listed path into clickable parts, starting at its media root (or the one of `roots` it's in). Folders above
 * the root can't be opened.
 */
function breadcrumbs(listing: FsListing, roots?: string[]) {
  if (!listing.path || !listing.root) return [];
  const sep = listing.root.includes("\\") ? "\\" : "/";
  const path = listing.path;
  const root = roots?.find((r) => path === r || path.startsWith(r.endsWith(sep) ? r : r + sep)) ?? listing.root;
  // The root is shown by its folder name; its full path is in the tooltip
  const crumbs = [{ name: root.split(sep).filter(Boolean).pop() ?? root, path: root }];
  let current = root;
  for (const part of path.slice(root.length).split(sep).filter(Boolean)) {
    current = current.endsWith(sep) ? current + part : current + sep + part;
    crumbs.push({ name: part, path: current });
  }
  return crumbs;
}
