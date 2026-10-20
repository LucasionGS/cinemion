import { type FormEvent, useEffect, useState } from "react";
import { ListPlus, Plus } from "lucide-react";
import type { PlaylistSummary } from "@shared/music.ts";
import PlaylistsApi from "../../Api/PlaylistsApi.ts";
import Controller from "../../lib/Controller.ts";
import useController from "../../lib/useController.ts";
import { toasts } from "../../lib/Toasts.ts";
import Dialog from "../Dialog/Dialog.tsx";
import Button from "../Button/Button.tsx";
import TextField from "../TextField/TextField.tsx";
import { Cover } from "../MusicCard/MusicCard.tsx";
import "./AddToPlaylist.scss";

/**
 * Opens the "Add to playlist" dialog from anywhere, like a track's menu.
 */
export class AddToPlaylistController extends Controller {
  public trackIds: number[] = [];
  public open = false;
  /**
   * Bumped when a playlist changes, so pages showing playlists can load them again.
   */
  public changes = 0;

  public show(trackIds: number[]) {
    if (trackIds.length === 0) return;
    this.trackIds = trackIds;
    this.open = true;
    this.notify();
  }

  public close() {
    this.open = false;
    this.notify();
  }

  public changed() {
    this.changes++;
    this.notify();
  }
}

export const addToPlaylist = new AddToPlaylistController();

/**
 * Pick a playlist for some tracks, or make a new one with them. Rendered once, at the root of the app.
 */
export default function AddToPlaylist() {
  const { open, trackIds } = useController(addToPlaylist);
  const [playlists, setPlaylists] = useState<PlaylistSummary[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const count = trackIds.length === 1 ? "1 track" : `${trackIds.length} tracks`;

  useEffect(() => {
    if (!open) return;
    setName("");
    setPlaylists(null);
    PlaylistsApi.list().then(setPlaylists).catch(() => setPlaylists([]));
  }, [open]);

  async function addTo(playlist: PlaylistSummary) {
    setBusy(true);
    try {
      await PlaylistsApi.addTracks(playlist.id, trackIds);
      toasts.success(`Added ${count} to ${playlist.name}`);
      addToPlaylist.changed();
      addToPlaylist.close();
    } catch (error) {
      toasts.error("Couldn't add to the playlist", (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const playlist = await PlaylistsApi.create(name, trackIds);
      toasts.success(`Made ${playlist.name} with ${count}`);
      addToPlaylist.changed();
      addToPlaylist.close();
    } catch (error) {
      toasts.error("Couldn't make the playlist", (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !value && addToPlaylist.close()} title="Add to playlist" description={`Add ${count} to one of your playlists, or start a new one.`} size="sm">
      <form className="cn-add-playlist__new" onSubmit={create}>
        <TextField label="New playlist" placeholder="Name" value={name} maxLength={128} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" variant="primary" icon={<Plus />} disabled={!name.trim()} loading={busy && !!name.trim()}>Create</Button>
      </form>
      {playlists && playlists.length > 0 && (
        <ul className="cn-add-playlist__list">
          {playlists.map((p) => (
            <li key={p.id}>
              <button type="button" className="cn-add-playlist__item" disabled={busy} onClick={() => addTo(p)}>
                <Cover image={null} mosaic={p.covers} title={p.name} width={96} className="cn-add-playlist__cover" />
                <span>
                  <strong>{p.name}</strong>
                  <span>{p.trackCount} {p.trackCount === 1 ? "track" : "tracks"}</span>
                </span>
                <ListPlus aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
