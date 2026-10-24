import { useEffect, useRef, useState } from "react";
import type { ItemDetail } from "@shared/media.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import PlayerController from "../Player/PlayerController.ts";
import { t } from "../../i18n/I18n.ts";
import Spinner from "../Spinner/Spinner.tsx";

export interface InlineVideoProps {
  id: number;
  poster: string | null;
  onEnded: () => void;
}

/**
 * A video from a Photos library, playing right in the viewer with the browser's own controls. The stream comes
 * through the regular player, so it plays directly or converted like anywhere else, and progress is kept.
 */
export default function InlineVideo(props: InlineVideoProps) {
  const { id, poster, onEnded } = props;
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const ended = useRef(onEnded);
  ended.current = onEnded;

  useEffect(() => {
    ItemsApi.get(id).then(setItem).catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(() => {
    const el = video.current;
    if (!item || !el) return;
    // There's nothing to move on to from here; the viewer decides what comes next
    const controller = new PlayerController(item, () => { }, () => { });
    controller.attach(el, 0);
    const onEnd = () => ended.current();
    el.addEventListener("ended", onEnd);
    return () => {
      el.removeEventListener("ended", onEnd);
      controller.destroy();
    };
  }, [item]);

  if (error) return <p className="cn-photo-viewer__message">{error}</p>;
  return (
    <>
      {!item && <Spinner size="2rem" label={t("photos.viewer.loadingVideo")} />}
      <video ref={video} className="cn-photo-viewer__video" poster={poster ?? undefined} controls autoPlay playsInline />
    </>
  );
}
