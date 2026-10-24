import { useEffect, useState } from "react";
import { Ban, Gamepad2, Plus } from "lucide-react";
import type { GameCandidate, GameChoice } from "@shared/clips.ts";
import ClipsApi from "../../Api/ClipsApi.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import { toasts } from "../../lib/Toasts.ts";
import Dialog from "../Dialog/Dialog.tsx";
import TextField from "../TextField/TextField.tsx";
import Spinner from "../Spinner/Spinner.tsx";
import { fallbackColor } from "../PosterCard/PosterCard.tsx";
import "./SetGameDialog.scss";

const SEARCH_DELAY_MS = 300;

export interface SetGameDialogProps {
  open: boolean;
  libraryId: number;
  title: string;
  description?: string;
  /**
   * Offer "No game", for clips.
   */
  allowNone?: boolean;
  /**
   * What to search for when the dialog opens, like the game's current name.
   */
  initialQuery?: string;
  /**
   * Do something with the picked game. The dialog closes when it resolves.
   */
  onPick: (choice: GameChoice) => Promise<void>;
  onClose: () => void;
}

/**
 * Pick a game: one the library already has, one found on Steam (or SteamGridDB), a name typed in, or none.
 */
export default function SetGameDialog(props: SetGameDialogProps) {
  const { open, libraryId, title, description, allowNone = false, initialQuery = "", onPick, onClose } = props;
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<GameCandidate[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (open) setQuery(initialQuery);
  }, [open, initialQuery]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setResults(null);
    const timer = setTimeout(() => {
      ClipsApi.searchGames(libraryId, query.trim())
        .then((r) => {
          if (cancelled) return;
          setResults(r.results);
          setMessage(r.message);
        })
        .catch((e: Error) => !cancelled && setMessage(e.message));
    }, query ? SEARCH_DELAY_MS : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, libraryId, query]);

  async function pick(key: string, choice: GameChoice) {
    setBusy(key);
    try {
      await onPick(choice);
      onClose();
    } catch (error) {
      toasts.error("Couldn't set the game", (error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const typed = query.trim();
  const exact = results?.some((r) => r.title.toLowerCase() === typed.toLowerCase());

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()} title={title} description={description} size="md">
      <div className="cn-set-game">
        <TextField label="Game" placeholder="Search for a game" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        {message && <p className="cn-set-game__message">{message}</p>}
        <div className="cn-set-game__list" role="list">
          {!results && <div className="cn-set-game__loading"><Spinner size="1.5rem" label="Searching" /></div>}
          {results?.map((r) => {
            const key = r.gameId ? `game:${r.gameId}` : `${r.provider}:${r.id}`;
            const cover = r.cover ? (r.gameId ? ItemsApi.imageUrl(r.cover, 160) : r.cover) : null;
            const where = r.gameId ? `In this library · ${r.clipCount} ${r.clipCount === 1 ? "clip" : "clips"}` : r.provider === "steamgriddb" ? "SteamGridDB" : "Steam";
            return (
              <button
                key={key}
                type="button"
                role="listitem"
                className="cn-set-game__option"
                disabled={!!busy}
                onClick={() => pick(key, r.gameId ? { gameId: r.gameId } : { provider: r.provider!, id: r.id!, title: r.title })}
              >
                <span className="cn-set-game__cover" style={{ background: fallbackColor(r.title) }}>
                  {cover ? <img src={cover} alt="" loading="lazy" onError={(e) => e.currentTarget.remove()} /> : <Gamepad2 aria-hidden="true" />}
                </span>
                <span className="cn-set-game__text">
                  <strong>{r.title}</strong>
                  <span>{[where, r.year].filter(Boolean).join(" · ")}</span>
                </span>
                {busy === key && <Spinner size="1.1rem" />}
              </button>
            );
          })}
          {results && typed && !exact && (
            <button type="button" role="listitem" className="cn-set-game__option" disabled={!!busy} onClick={() => pick("typed", { title: typed })}>
              <span className="cn-set-game__cover cn-set-game__cover--icon"><Plus aria-hidden="true" /></span>
              <span className="cn-set-game__text">
                <strong>Call it “{typed}”</strong>
                <span>A game with just this name, without artwork</span>
              </span>
              {busy === "typed" && <Spinner size="1.1rem" />}
            </button>
          )}
          {results && results.length === 0 && !typed && <p className="cn-set-game__message">Type a game's name to search for it.</p>}
          {allowNone && (
            <button type="button" role="listitem" className="cn-set-game__option" disabled={!!busy} onClick={() => pick("none", null)}>
              <span className="cn-set-game__cover cn-set-game__cover--icon"><Ban aria-hidden="true" /></span>
              <span className="cn-set-game__text">
                <strong>No game</strong>
                <span>Like recordings of the desktop</span>
              </span>
              {busy === "none" && <Spinner size="1.1rem" />}
            </button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
