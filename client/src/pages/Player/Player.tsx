import { useEffect, useMemo, useState } from "react";
import { type ItemDetail, isPlayable } from "@shared/media.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import { router } from "../../lib/Router.tsx";
import { applyAmbient } from "../../lib/ambient.ts";
import useController from "../../lib/useController.ts";
import { together } from "../../lib/Together.ts";
import { musicPlayer } from "../../lib/MusicPlayer.ts";
import { t } from "../../i18n/I18n.ts";
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
 * `?together=<code>` joins a watch together session and starts where everyone else is.
 */
export default function Player(props: PlayerProps) {
  const { id } = props;
  const { query } = useController(router);
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // After a reload, rejoin the session this tab was in
  const [code] = useState(() => query.get("together") ?? together.rememberedCode());
  const [joined, setJoined] = useState(!code);

  // Videos and music don't play over each other
  useEffect(() => musicPlayer.pause(), []);

  useEffect(() => {
    ItemsApi.get(id).then((detail) => {
      if (!isPlayable(detail.type)) throw new Error(t("player.onlyPlayable"));
      setItem(detail);
    }).catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (!code) return;
    together.join(code).then(() => {
      // The link may be for something the session has moved on from
      const itemId = together.room?.itemId;
      if (itemId && itemId !== id) router.navigate(`/watch/${itemId}`, { replace: true });
      setJoined(true);
    }).catch((e: Error) => {
      // Not in the session after all; just play on our own
      if (query.get("together")) setError(e.message);
      else setJoined(true);
    });
  }, [code]);

  // Leaving the player leaves the session; moving on to the next episode doesn't
  useEffect(() => () => {
    if (!router.path.startsWith("/watch/") && together.isConnected()) together.leave();
  }, []);

  // The scrubber and buttons take the title's colour
  useEffect(() => {
    if (item) applyAmbient(item.palette);
    return () => applyAmbient(null);
  }, [item?.palette?.accent]);

  const controller = useMemo(() => item && new PlayerController(
    item,
    () => router.back(`/item/${item.id}`),
    // Replacing keeps Back going to the page the player was opened from
    (nextId) => router.navigate(`/watch/${nextId}`, { replace: true }),
  ), [item?.id]);

  if (error) {
    return (
      <div className="cn-player-page cn-player-page--message cn-dark-theme">
        <h1>{t("player.cantPlayTitle")}</h1>
        <p>{error}</p>
        <Button variant="primary" onClick={() => router.back("/")} data-autofocus>{t("common.back")}</Button>
      </div>
    );
  }
  if (!item || !controller || !joined) {
    return <div className="cn-player-page cn-dark-theme"><Spinner size="3rem" label={joined ? t("player.loading") : t("player.joining")} /></div>;
  }

  const inSession = together.isConnected() && together.room?.itemId === item.id;
  const startAt = inSession ? together.expectedPosition() : query.get("from") === "start" ? 0 : item.userData?.position ?? 0;
  return <PlayerView controller={controller} startAt={startAt} />;
}
