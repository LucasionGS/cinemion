import { type FormEvent, useEffect, useState } from "react";
import { Search } from "lucide-react";
import type { ItemSummary, MatchCandidate } from "@shared/media.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import { toasts } from "../../lib/Toasts.ts";
import Dialog from "../Dialog/Dialog.tsx";
import Button from "../Button/Button.tsx";
import TextField from "../TextField/TextField.tsx";
import Spinner from "../Spinner/Spinner.tsx";
import "./FixMatchDialog.scss";

export interface FixMatchDialogProps {
  item: ItemSummary | null;
  onClose: () => void;
  onMatched: (item: ItemSummary) => void;
}

/**
 * Search for the right movie or show and tie the item to it.
 */
export default function FixMatchDialog(props: FixMatchDialogProps) {
  const { item, onClose, onMatched } = props;
  const [query, setQuery] = useState("");
  const [year, setYear] = useState("");
  const [results, setResults] = useState<MatchCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search(q = query, y = year) {
    if (!item) return;
    setSearching(true);
    setError(null);
    try {
      setResults(await ItemsApi.searchMatches(item.id, q, parseInt(y) || null));
    } catch (e) {
      setError((e as Error).message);
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  useEffect(() => {
    if (!item) return;
    setQuery(item.title);
    setYear(item.year ? String(item.year) : "");
    setResults(null);
    search(item.title, item.year ? String(item.year) : "");
  }, [item?.id]);

  async function pick(candidate: MatchCandidate) {
    if (!item) return;
    setApplying(candidate.id);
    try {
      const updated = await ItemsApi.setMatch(item.id, candidate);
      toasts.success(`Matched to ${candidate.title}`);
      onMatched(updated);
      onClose();
    } catch (e) {
      toasts.error("Couldn't apply the match", (e as Error).message);
    } finally {
      setApplying(null);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    search();
  }

  return (
    <Dialog open={!!item} onOpenChange={(open) => !open && onClose()} title="Fix match" description={item ? `Pick what "${item.title}" really is.` : undefined} size="lg">
      <form className="cn-fix-match__search" onSubmit={submit}>
        <TextField label="Title" value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: "1 1 16rem" }} />
        <TextField label="Year" inputMode="numeric" maxLength={4} value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, ""))} style={{ flex: "0 0 7rem" }} />
        <Button type="submit" variant="secondary" icon={<Search />} loading={searching}>Search</Button>
      </form>

      <div className="cn-fix-match__results">
        {searching && !results && <div className="cn-fix-match__empty"><Spinner size="2rem" /></div>}
        {error && <div className="cn-fix-match__empty cn-fix-match__empty--error">{error}</div>}
        {results && !error && results.length === 0 && (
          <div className="cn-fix-match__empty">No results. Try another title, or check that a TMDB or TheTVDB key is set in Settings › Metadata.</div>
        )}
        {results?.map((r) => (
          <div key={`${r.provider}:${r.id}`} className="cn-fix-match__result">
            <span className="cn-fix-match__poster">{r.posterUrl && <img src={r.posterUrl} alt="" loading="lazy" />}</span>
            <div className="cn-fix-match__text">
              <strong>{r.title}{r.year ? ` (${r.year})` : ""}</strong>
              <span className="cn-fix-match__source">{r.provider === "tvdb" ? "TheTVDB" : "TMDB"}</span>
              {r.overview && <p>{r.overview}</p>}
            </div>
            <Button size="sm" variant="primary" onClick={() => pick(r)} loading={applying === r.id} disabled={applying !== null}>Use this</Button>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
