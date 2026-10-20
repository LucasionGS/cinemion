import { useEffect, useMemo, useState } from "react";
import type { ItemDetail } from "@shared/media.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import { router } from "../../lib/Router.tsx";
import { applyAmbient } from "../../lib/ambient.ts";
import useController from "../../lib/useController.ts";
import PlayerController from "../../components/Player/PlayerController.ts";
import PlayerView from "../../components/Player/PlayerView.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import Button from "../../components/Button/Button.tsx";
import "./Player.scss";

export interface PlayerProps {
  id: number;
}

/**
 * `/watch/<id>`: plays a movie or episode, resuming where the profile left off unless `?from=start` is given.
 */
export default function Player(props: PlayerProps) {
  const { id } = props;
  const { query } = useController(router);
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ItemsApi.get(id).then((detail) => {
      if (detail.type !== "movie" && detail.type !== "episode") throw new Error("Only movies and episodes can be played.");
      setItem(detail);
    }).catch((e: Error) => setError(e.message));
  }, [id]);

  // The scrubber and buttons take the title's colour
  useEffect(() => {
    if (item) applyAmbient(item.palette);
    return () => applyAmbient(null);
  }, [item?.palette?.accent]);

  const controller = useMemo(() => item && new PlayerController(
    item,
    () => router.back(`/item/${item.id}`),
    // Replacing keeps Back going to the page the player was opened from
    (next) => router.navigate(`/watch/${next.id}`, { replace: true }),
  ), [item?.id]);

  if (error) {
    return (
      <div className="cn-player-page cn-player-page--message">
        <h1>This title can't play</h1>
        <p>{error}</p>
        <Button variant="primary" onClick={() => router.back("/")} data-autofocus>Back</Button>
      </div>
    );
  }
  if (!item || !controller) {
    return <div className="cn-player-page"><Spinner size="3rem" label="Loading" /></div>;
  }

  const startAt = query.get("from") === "start" ? 0 : item.userData?.position ?? 0;
  return <PlayerView controller={controller} startAt={startAt} />;
}
