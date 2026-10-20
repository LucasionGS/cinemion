import { Fragment, useEffect, useRef, useState } from "react";
import { ChevronRight, Folder, FolderCheck, HardDrive } from "lucide-react";
import type { FsListing } from "@shared/api.ts";
import ServerApi from "../../Api/ServerApi.ts";
import Button from "../Button/Button.tsx";
import Spinner from "../Spinner/Spinner.tsx";
import "./FolderBrowser.scss";

export interface FolderBrowserProps {
  /**
   * Folders already picked, marked in the list.
   */
  selected: string[];
  onSelect: (path: string) => void;
}

/**
 * Browse the folders the server allows (its media roots) and pick one.
 */
export default function FolderBrowser(props: FolderBrowserProps) {
  const { selected, onSelect } = props;
  const [path, setPath] = useState<string | null>(null);
  const [listing, setListing] = useState<FsListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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

  const crumbs = listing ? breadcrumbs(listing) : [];
  const crumbsRef = useRef<HTMLElement>(null);

  // Keep the current folder in view when the path is long
  useEffect(() => {
    crumbsRef.current?.scrollTo({ left: crumbsRef.current.scrollWidth });
  }, [listing]);

  return (
    <div className="cn-folders">
      <div className="cn-folders__bar">
        <nav ref={crumbsRef} className="cn-folders__crumbs" aria-label="Folder path">
          <button type="button" className="cn-folders__crumb" onClick={() => setPath(null)}><HardDrive /></button>
          {crumbs.map((crumb, i) => (
            <Fragment key={crumb.path}>
              <ChevronRight className="cn-folders__sep" aria-hidden="true" />
              {i === crumbs.length - 1
                ? <strong className="cn-folders__current">{crumb.name}</strong>
                : <button type="button" className="cn-folders__crumb" title={crumb.path} onClick={() => setPath(crumb.path)}>{crumb.name}</button>}
            </Fragment>
          ))}
        </nav>
        {path && (
          <Button size="sm" variant="primary" icon={<FolderCheck />} onClick={() => onSelect(path)} disabled={selected.includes(path)}>
            {selected.includes(path) ? "Selected" : "Use this folder"}
          </Button>
        )}
      </div>

      <div className="cn-folders__list">
        {loading && <div className="cn-folders__empty"><Spinner /></div>}
        {!loading && error && <div className="cn-folders__empty cn-folders__empty--error">{error}</div>}
        {!loading && !error && listing?.entries.length === 0 && <div className="cn-folders__empty">No folders in here.</div>}
        {!loading && !error && listing?.entries.map((entry) => (
          <button key={entry.path} type="button" className="cn-folders__entry" onClick={() => setPath(entry.path)}>
            {selected.includes(entry.path) ? <FolderCheck className="cn-folders__icon cn-folders__icon--selected" /> : <Folder className="cn-folders__icon" />}
            <span>{entry.name}</span>
            <ChevronRight className="cn-folders__chevron" aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Split the listed path into clickable parts, starting at its media root. Folders above the root can't be opened.
 */
function breadcrumbs(listing: FsListing) {
  if (!listing.path || !listing.root) return [];
  const sep = listing.root.includes("\\") ? "\\" : "/";
  // The root is shown by its folder name; its full path is in the tooltip
  const crumbs = [{ name: listing.root.split(sep).filter(Boolean).pop() ?? listing.root, path: listing.root }];
  let current = listing.root;
  for (const part of listing.path.slice(listing.root.length).split(sep).filter(Boolean)) {
    current = current.endsWith(sep) ? current + part : current + sep + part;
    crumbs.push({ name: part, path: current });
  }
  return crumbs;
}
