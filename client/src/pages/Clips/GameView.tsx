import { useEffect, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { EllipsisVertical, Pencil, RefreshCw, Trash2 } from "lucide-react";
import type { GameChoice } from "@shared/clips.ts";
import type { ItemDetail, ItemSummary } from "@shared/media.ts";
import ClipsApi from "../../Api/ClipsApi.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import LibrariesApi from "../../Api/LibrariesApi.ts";
import { session } from "../../Session.ts";
import { Link, router } from "../../lib/Router.tsx";
import { toasts } from "../../lib/Toasts.ts";
import { play } from "../../lib/playback.ts";
import { t } from "../../i18n/I18n.ts";
import ItemHero from "../../components/ItemHero/ItemHero.tsx";
import { PlayRing } from "../../components/ItemActions/ItemActions.tsx";
import Button from "../../components/Button/Button.tsx";
import { ConfirmDialog } from "../../components/Dialog/Dialog.tsx";
import SetGameDialog from "../../components/SetGameDialog/SetGameDialog.tsx";
import ClipBrowser from "./ClipBrowser.tsx";
import "../../components/ItemActions/ItemActions.scss";
import "./Clips.scss";

export interface GameViewProps {
  item: ItemDetail;
  reload: () => void;
}

/**
 * A game in a Clips library: its cover and artwork, and its clips by day.
 */
export default function GameView(props: GameViewProps) {
  const { item, reload } = props;
  const library = LibrariesApi.useLibraries()?.find((l) => l.id === item.libraryId);
  const [newest, setNewest] = useState<ItemSummary | null>(null);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const canManage = session.can("LIBRARY_MANAGE");

  useEffect(() => {
    ItemsApi.next(item.id).then(setNewest).catch(() => setNewest(null));
  }, [item.id]);

  async function change(choice: GameChoice) {
    if (!choice) return;
    const game = await ClipsApi.editGame(item.id, choice);
    toasts.success(game.id === item.id ? t("clips.game.renamed", { title: game.title }) : t("clips.game.moved", { title: game.title }));
    if (game.id !== item.id) router.navigate(`/item/${game.id}`, { replace: true });
    else reload();
  }

  async function refresh() {
    const id = toasts.show({ title: t("clips.game.lookingUp", { title: item.title }) });
    try {
      await ItemsApi.refresh(item.id);
      toasts.dismiss(id);
      toasts.success(t("clips.game.upToDate", { title: item.title }));
      reload();
    } catch (error) {
      toasts.dismiss(id);
      toasts.error(t("clips.game.couldntLookUp"), (error as Error).message);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await ClipsApi.removeGame(item.id);
      toasts.success(t("clips.game.removed", { title: item.title }), t("clips.game.removedDescription"));
      router.navigate(`/library/${item.libraryId}`, { replace: true });
    } catch (error) {
      toasts.error(t("clips.game.couldntRemove"), (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const facts = [
    t("clips.counts.clips", { count: item.childCount }),
    item.genres.slice(0, 3).join(t("common.listSeparator")) || null,
    item.year ? t("clips.game.released", { year: String(item.year) }) : null,
  ].filter(Boolean);

  return (
    <div className="cn-item cn-game">
      <ItemHero title={item.title} artwork={item.artwork} palette={item.palette} eyebrow={library && <nav aria-label={t("clips.game.library")} className="cn-item__path"><Link href={`/library/${library.id}`}>{library.name}</Link></nav>}>
        <div className="cn-meta">
          {facts.map((f) => <span key={f}>{f}</span>)}
          {canManage && item.matchStatus === "unmatched" && <span className="cn-meta__badge cn-meta__badge--outline">{t("clips.game.notFound")}</span>}
        </div>
        <div className="cn-actions">
          <div className="cn-actions__buttons">
            {newest && (
              <Button variant="primary" size="lg" className="cn-actions__play" icon={<PlayRing />} onClick={() => play(newest)} data-autofocus>
                {newest.userData?.position ? t("common.resume") : t("clips.game.playNewest")}
              </Button>
            )}
            {canManage && (
              <Menu.Root>
                <Menu.Trigger className="cn-icon-button cn-icon-button--glass cn-icon-button--lg" aria-label={t("clips.game.moreOptions")}><EllipsisVertical /></Menu.Trigger>
                <Menu.Portal>
                  <Menu.Positioner sideOffset={8} align="start" className="cn-menu__positioner">
                    <Menu.Popup className="cn-menu">
                      <Menu.Item className="cn-menu__item" onClick={() => setEditing(true)}><Pencil /> {t("clips.game.change")}</Menu.Item>
                      <Menu.Item className="cn-menu__item" onClick={refresh}><RefreshCw /> {t("clips.game.lookUp")}</Menu.Item>
                      <Menu.Separator className="cn-menu__separator" />
                      <Menu.Item className="cn-menu__item" onClick={() => setRemoving(true)}><Trash2 /> {t("clips.game.remove")}</Menu.Item>
                    </Menu.Popup>
                  </Menu.Positioner>
                </Menu.Portal>
              </Menu.Root>
            )}
          </div>
        </div>
        {item.overview && <p className="cn-item__overview">{item.overview}</p>}
      </ItemHero>

      <ClipBrowser libraryId={item.libraryId} game={item.id} onChanged={reload} />

      <SetGameDialog
        open={editing}
        libraryId={item.libraryId}
        title={t("clips.game.changeTitle")}
        description={t("clips.game.changeDescription")}
        initialQuery={item.title}
        onPick={change}
        onClose={() => setEditing(false)}
      />
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={t("clips.game.removeTitle", { title: item.title })}
        description={t("clips.game.removeDescription")}
        confirmLabel={t("clips.game.remove")}
        danger
        loading={busy}
        onConfirm={remove}
      />
    </div>
  );
}
