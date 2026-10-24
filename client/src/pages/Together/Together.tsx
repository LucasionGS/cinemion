import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { TogetherPreview } from "@shared/together.ts";
import { formatRoomCode, parseRoomCode } from "@shared/together.ts";
import BaseApi from "../../Api/BaseApi.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import { router } from "../../lib/Router.tsx";
import { applyAmbient } from "../../lib/ambient.ts";
import { episodeLabel, formatClock } from "../../lib/playback.ts";
import useController from "../../lib/useController.ts";
import { session } from "../../Session.ts";
import { rich, t } from "../../i18n/I18n.ts";
import Avatar from "../../components/Avatar/Avatar.tsx";
import Button from "../../components/Button/Button.tsx";
import IconButton from "../../components/IconButton/IconButton.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import { fallbackColor } from "../../components/PosterCard/PosterCard.tsx";
import "./Together.scss";

export interface TogetherProps {
  /**
   * From an invite link. Without one, the page asks for the code.
   */
  code: string | null;
}

const CODE_LENGTH = 7;

/**
 * Join a watch together session: type the code (or open an invite link), see what's on, then join.
 */
export default function Together(props: TogetherProps) {
  const { user } = useController(session);
  const [typed, setTyped] = useState(props.code ? formatRoomCode(parseRoomCode(props.code)) : "");
  const code = parseRoomCode(typed);
  const [preview, setPreview] = useState<TogetherPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setPreview(null);
    setError(null);
    if (code.length !== CODE_LENGTH) return;
    setLoading(true);
    BaseApi.GET<TogetherPreview>(`/together/${code}`)
      .then((p) => {
        setPreview(p);
        applyAmbient(p.item.palette);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [code]);

  useEffect(() => () => applyAmbient(null), []);

  function join() {
    if (preview) router.navigate(`/watch/${preview.item.id}?together=${preview.code}`);
  }

  const item = preview?.item;
  const position = preview ? (preview.state.playing ? preview.state.position + (preview.serverTime - preview.state.at) / 1000 : preview.state.position) : 0;
  const poster = item?.artwork.poster;

  return (
    <div className="cn-together">
      <div className="cn-together__glow" aria-hidden="true" />
      <div className="cn-together__top">
        <IconButton label={t("common.close")} icon={<X />} onClick={() => router.back("/")} />
      </div>
      <div className="cn-together__content">
        <div className="cn-together__text">
          <h1>{t("together.page.title")}</h1>
          <p>{t("together.page.intro")}</p>
        </div>

        <label className="cn-together__code">
          <span className="cn-together__code-label">{t("together.page.codeLabel")}</span>
          <input
            value={typed}
            onChange={(e) => {
              const clean = parseRoomCode(e.target.value).slice(0, CODE_LENGTH);
              setTyped(formatRoomCode(clean));
            }}
            placeholder="KX4-29QM"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
            maxLength={CODE_LENGTH + 1}
            data-autofocus={!props.code || undefined}
            aria-invalid={!!error || undefined}
          />
        </label>

        {loading && <Spinner size="2rem" label={t("together.page.lookingUp")} />}
        {error && <p className="cn-together__error" role="alert">{error}</p>}

        {preview && item && (
          <div className="cn-together__card">
            <div className="cn-together__title">
              <div className="cn-together__poster" style={{ background: poster ? undefined : fallbackColor(item.title) }}>
                {poster && <img src={ItemsApi.imageUrl(poster, 160)} alt="" />}
              </div>
              <div className="cn-together__what">
                <span>{t("together.page.invited", { name: preview.host.name })}</span>
                <strong>{item.type === "episode" ? item.showTitle : item.title}</strong>
                {item.type === "episode" && <span>{t("together.page.episode", { episode: episodeLabel(item), title: item.title })}</span>}
                <span>{t(preview.state.playing ? "together.page.playingAt" : "together.page.pausedAt", { time: formatClock(position), count: preview.members.length })}</span>
              </div>
            </div>
            {preview.members.length > 0 && (
              <div className="cn-together__members">
                {preview.members.map((m) => <Avatar key={m.id} profile={m.profile} size={2} />)}
              </div>
            )}
            <Button variant="primary" size="lg" block onClick={join} data-autofocus>{t("together.page.join")}</Button>
          </div>
        )}

        <p className="cn-together__note">
          {rich("together.page.note", {
            name: user?.name ?? "",
            link: (text) => (
              <a
                href="/profiles"
                onClick={(e) => {
                  e.preventDefault();
                  router.navigate("/profiles");
                }}
              >
                {text}
              </a>
            ),
          })}
        </p>
      </div>
    </div>
  );
}
