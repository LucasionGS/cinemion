import { useEffect, useState } from "react";
import { Gamepad2, Scissors, Send, Sparkles, Star } from "lucide-react";
import type { ClipGameSource, GameChoice } from "@shared/clips.ts";
import type { ItemDetail } from "@shared/media.ts";
import ClipsApi from "../../Api/ClipsApi.ts";
import LibrariesApi from "../../Api/LibrariesApi.ts";
import { session } from "../../Session.ts";
import { Link, router } from "../../lib/Router.tsx";
import { toasts } from "../../lib/Toasts.ts";
import { formatClock } from "../../lib/playback.ts";
import { formatDate, formatDateTime } from "../../lib/format.ts";
import cx from "../../lib/cx.ts";
import ItemHero from "../../components/ItemHero/ItemHero.tsx";
import { qualityBadges } from "../../components/ItemHero/ItemMeta.tsx";
import ItemActions from "../../components/ItemActions/ItemActions.tsx";
import IconButton from "../../components/IconButton/IconButton.tsx";
import Button from "../../components/Button/Button.tsx";
import Row from "../../components/Row/Row.tsx";
import ClipCard from "../../components/ClipCard/ClipCard.tsx";
import SetGameDialog from "../../components/SetGameDialog/SetGameDialog.tsx";
import TrimDialog from "../../components/TrimDialog/TrimDialog.tsx";
import ShareCopyDialog from "../../components/ShareCopyDialog/ShareCopyDialog.tsx";
import "./Clips.scss";

const FOUND: Record<ClipGameSource, string> = {
  folder: "Game from the folder's name",
  file: "Game from the file's name",
  tags: "Game from the file's tags",
  steam: "Game from the Steam recording's name",
  upload: "Game from the app that uploaded it",
  manual: "Game picked by hand",
};

export interface ClipViewProps {
  item: ItemDetail;
  reload: () => void;
}

/**
 * A clip in a Clips library: when it was recorded, its game (or a suggestion), and the tools to star it, cut it
 * down and share a small copy.
 */
export default function ClipView(props: ClipViewProps) {
  const { item, reload } = props;
  const clip = item.clip;
  const library = LibrariesApi.useLibraries()?.find((l) => l.id === item.libraryId);
  const [favorite, setFavorite] = useState(item.userData?.favorite ?? false);
  const [settingGame, setSettingGame] = useState(false);
  const [trimming, setTrimming] = useState(false);
  const [sharing, setSharing] = useState(false);
  const canManage = session.can("LIBRARY_MANAGE");
  const when = clip?.takenAt ? formatDateTime(clip.takenAt) : item.releaseDate ? formatDate(item.releaseDate) : null;
  const seconds = clip?.seconds ?? item.files[0]?.duration ?? null;

  useEffect(() => setFavorite(item.userData?.favorite ?? false), [item.userData?.favorite]);

  async function toggleFavorite() {
    const next = !favorite;
    setFavorite(next);
    try {
      await ClipsApi.setFavorite([item.id], next);
    } catch (error) {
      setFavorite(!next);
      toasts.error("Couldn't star the clip", (error as Error).message);
    }
  }

  async function setGame(choice: GameChoice) {
    const result = await ClipsApi.setGame(item.libraryId, [item.id], choice);
    toasts.success(result.game ? `It's in ${result.game.title} now` : "It has no game now");
    reload();
  }

  async function answer(accept: boolean) {
    try {
      await ClipsApi.answerSuggestion(item.id, accept);
      if (accept) toasts.success(`It's in ${clip?.suggestion?.title} now`);
      reload();
    } catch (error) {
      toasts.error("Couldn't change the game", (error as Error).message);
    }
  }

  const title = clip?.titled ? item.title : clip?.game?.title ?? item.title;

  return (
    <div className="cn-item">
      <ItemHero
        title={title}
        artwork={{ ...item.artwork, poster: null, logo: null }}
        palette={item.palette}
        hidePoster
        eyebrow={
          <nav aria-label="Library" className="cn-item__path">
            {library && <Link href={`/library/${library.id}`}>{library.name}</Link>}
            {clip?.game ? <Link href={`/item/${clip.game.id}`}>{clip.game.title}</Link> : <Link href={`/library/${item.libraryId}?view=clips&game=none`}>No game</Link>}
          </nav>
        }
      >
        <div className="cn-meta">
          {when && <span>{when}</span>}
          {seconds ? <span>{formatClock(seconds)}</span> : null}
          {item.genres.length > 0 && <span>{item.genres.join(", ")}</span>}
          {item.contentRating && <span className="cn-meta__badge cn-meta__badge--outline">{item.contentRating}</span>}
          {qualityBadges(item.files).map((b) => <span key={b} className="cn-meta__badge">{b}</span>)}
        </div>
        <ItemActions item={item} onChanged={reload}>
          <IconButton
            label={favorite ? "Take the star off" : "Star this clip"}
            icon={<Star />}
            size="lg"
            className={cx("cn-clips__star", favorite && "cn-clips__star--on")}
            aria-pressed={favorite}
            onClick={toggleFavorite}
          />
          {canManage && <IconButton label="Set game" icon={<Gamepad2 />} size="lg" onClick={() => setSettingGame(true)} />}
          {canManage && <IconButton label="Cut the clip" icon={<Scissors />} size="lg" onClick={() => setTrimming(true)} />}
          {session.can("MEDIA_DOWNLOAD") && <IconButton label="Make a small copy to share" icon={<Send />} size="lg" onClick={() => setSharing(true)} />}
        </ItemActions>
        {clip?.suggestion && !clip.game && canManage && (
          <section className="cn-clips__notice cn-clips__notice--inline" aria-label="Suggested game">
            <Sparkles aria-hidden="true" />
            <p>
              Looks like <strong>{clip.suggestion.title}</strong>
              {clip.suggestion.source === "similar" ? ", from clips that look like it" : ", going by the picture"} ({Math.round(clip.suggestion.confidence * 100)}% sure).
            </p>
            <Button size="sm" variant="primary" onClick={() => answer(true)}>Use it</Button>
            <Button size="sm" variant="ghost" onClick={() => answer(false)}>Not this game</Button>
          </section>
        )}
        {clip?.found && clip.game && <p className="cn-item__next">{FOUND[clip.found]}</p>}
        {item.overview && <p className="cn-item__overview">{item.overview}</p>}
      </ItemHero>

      {item.similar.length > 0 && (
        <Row title={clip?.game ? `More from ${clip.game.title}` : "More clips without a game"} href={clip?.game ? `/item/${clip.game.id}` : `/library/${item.libraryId}?view=clips&game=none`} kind="wide">
          {item.similar.map((c) => <ClipCard key={c.id} item={c} showGame={false} />)}
        </Row>
      )}

      <SetGameDialog
        open={settingGame}
        libraryId={item.libraryId}
        title="Set the game"
        description="Pick a game you have, search Steam, or type a name."
        allowNone
        initialQuery={clip?.suggestion?.title ?? ""}
        onPick={setGame}
        onClose={() => setSettingGame(false)}
      />
      <TrimDialog
        item={trimming ? item : null}
        onClose={() => setTrimming(false)}
        onDone={(result, replaced) => replaced ? reload() : router.navigate(`/item/${result.id}`)}
      />
      <ShareCopyDialog item={sharing ? item : null} onClose={() => setSharing(false)} />
    </div>
  );
}
