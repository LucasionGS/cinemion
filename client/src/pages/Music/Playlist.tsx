import { type FormEvent, useEffect, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { ArrowDown, ArrowUp, Check, Pencil, Play, Shuffle, Trash2, X } from "lucide-react";
import type { PlaylistDetail, PlaylistEntry } from "@shared/music.ts";
import PlaylistsApi from "../../Api/PlaylistsApi.ts";
import { musicPlayer } from "../../lib/MusicPlayer.ts";
import { router } from "../../lib/Router.tsx";
import { toasts } from "../../lib/Toasts.ts";
import useController from "../../lib/useController.ts";
import { formatDuration } from "../../lib/playback.ts";
import AppShell from "../../components/AppShell/AppShell.tsx";
import Button from "../../components/Button/Button.tsx";
import IconButton from "../../components/IconButton/IconButton.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import TrackList from "../../components/TrackList/TrackList.tsx";
import { ConfirmDialog } from "../../components/Dialog/Dialog.tsx";
import { Cover } from "../../components/MusicCard/MusicCard.tsx";
import { addToPlaylist } from "../../components/AddToPlaylist/AddToPlaylist.tsx";
import MusicHeader from "./MusicHeader.tsx";
import "./Music.scss";

export interface PlaylistProps {
  id: number;
}

/**
 * One of the profile's playlists: play it, rename it, put its tracks in order or take them out.
 */
export default function Playlist(props: PlaylistProps) {
  const { id } = props;
  const [playlist, setPlaylist] = useState<PlaylistDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { changes } = useController(addToPlaylist);

  useEffect(() => {
    PlaylistsApi.get(id).then(setPlaylist).catch((e) => setError((e as Error).message));
  }, [id, changes]);

  async function update(change: () => Promise<PlaylistDetail>) {
    try {
      setPlaylist(await change());
    } catch (e) {
      toasts.error("Couldn't change the playlist", (e as Error).message);
    }
  }

  async function rename(e: FormEvent) {
    e.preventDefault();
    if (!playlist || renaming === null) return;
    try {
      const summary = await PlaylistsApi.rename(playlist.id, renaming);
      setPlaylist({ ...playlist, name: summary.name });
      setRenaming(null);
    } catch (err) {
      toasts.error("Couldn't rename the playlist", (err as Error).message);
    }
  }

  async function remove() {
    if (!playlist) return;
    try {
      await PlaylistsApi.remove(playlist.id);
      toasts.success(`Deleted ${playlist.name}`);
      router.back("/");
    } catch (e) {
      toasts.error("Couldn't delete the playlist", (e as Error).message);
    }
  }

  function move(tracks: PlaylistEntry[], from: number, to: number) {
    const order = tracks.map((t) => t.entryId);
    const [entry] = order.splice(from, 1);
    order.splice(to, 0, entry);
    update(() => PlaylistsApi.reorder(id, order));
  }

  return (
    <AppShell>
      <div className="cn-music">
        {error && <section className="cn-music__empty"><h2>Playlist not found</h2><p>{error}</p></section>}
        {!playlist && !error && <div className="cn-music__loading"><Spinner size="2rem" /></div>}
        {playlist && (
          <>
            <MusicHeader
              cover={<Cover image={null} mosaic={playlist.covers} title={playlist.name} width={500} />}
              eyebrow="Playlist"
              title={renaming === null ? playlist.name : (
                <form className="cn-playlist-name" onSubmit={rename}>
                  <input value={renaming} maxLength={128} autoFocus aria-label="Playlist name" onChange={(e) => setRenaming(e.target.value)} />
                  <IconButton label="Save name" icon={<Check />} type="submit" />
                  <IconButton label="Cancel" icon={<X />} variant="ghost" onClick={() => setRenaming(null)} />
                </form>
              )}
              meta={<span>{playlist.trackCount} {playlist.trackCount === 1 ? "track" : "tracks"}{playlist.trackCount > 0 && ` · ${formatDuration(playlist.duration)}`}</span>}
              actions={
                <>
                  <Button variant="primary" icon={<Play />} disabled={playlist.tracks.length === 0} onClick={() => musicPlayer.play(playlist.tracks)} data-autofocus>Play</Button>
                  <Button variant="secondary" icon={<Shuffle />} disabled={playlist.tracks.length === 0} onClick={() => musicPlayer.play(playlist.tracks, 0, { shuffle: true })}>Shuffle</Button>
                  <IconButton label="Rename" icon={<Pencil />} onClick={() => setRenaming(playlist.name)} />
                  <IconButton label="Delete playlist" icon={<Trash2 />} onClick={() => setDeleting(true)} />
                </>
              }
            />
            {playlist.tracks.length === 0 && (
              <section className="cn-music__empty">
                <h2>Nothing in here yet</h2>
                <p>Add tracks from their menu with "Add to playlist", or save what's playing from the queue.</p>
              </section>
            )}
            <TrackList
              tracks={playlist.tracks}
              label={`Tracks of ${playlist.name}`}
              menuItems={(_track, i) => (
                <>
                  {i > 0 && <Menu.Item className="cn-menu__item" onClick={() => move(playlist.tracks, i, i - 1)}><ArrowUp /> Move up</Menu.Item>}
                  {i < playlist.tracks.length - 1 && <Menu.Item className="cn-menu__item" onClick={() => move(playlist.tracks, i, i + 1)}><ArrowDown /> Move down</Menu.Item>}
                  <Menu.Item className="cn-menu__item" onClick={() => update(() => PlaylistsApi.removeEntry(id, playlist.tracks[i].entryId))}><Trash2 /> Remove from playlist</Menu.Item>
                </>
              )}
            />
          </>
        )}
      </div>
      {playlist && (
        <ConfirmDialog
          open={deleting}
          onOpenChange={setDeleting}
          title={`Delete ${playlist.name}?`}
          description="The playlist goes away for good. The tracks in it stay in your library."
          confirmLabel="Delete playlist"
          danger
          onConfirm={remove}
        />
      )}
    </AppShell>
  );
}
