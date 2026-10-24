import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Bell, BellOff, CheckCheck, Clapperboard, Settings } from "lucide-react";
import type { NotificationData, NotificationInfo } from "@shared/notifications.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import { router } from "../../lib/Router.tsx";
import { notifications, useNotifications } from "../../lib/Notifications.ts";
import { timeAgo } from "../../lib/format.ts";
import cx from "../../lib/cx.ts";
import { t } from "../../i18n/I18n.ts";
import "./NotificationBell.scss";

/**
 * A notification's two lines, in the reader's language.
 */
export function notificationText(data: NotificationData): { title: string; body: string } {
  switch (data.kind) {
    case "episodes":
      if (data.count === 1 && data.season !== null && data.episode !== null) {
        const code = t("notifications.episodeCode", { season: data.season, episode: data.episode });
        return { title: data.showTitle, body: data.episodeTitle ? t("notifications.episodeWithTitle", { code, title: data.episodeTitle }) : t("notifications.episode", { code }) };
      }
      return { title: data.showTitle, body: t("notifications.episodes", { count: data.count }) };
    case "album":
      return { title: data.title, body: data.artist ? t("notifications.albumBy", { artist: data.artist }) : t("notifications.newIn", { library: data.libraryName }) };
    case "watchlist":
      return { title: data.title, body: t("notifications.fromList") };
    default:
      return { title: data.title, body: t("notifications.newIn", { library: data.libraryName }) };
  }
}

/**
 * The bell in the top bar: how many notifications are unread, and the latest ones in a panel.
 */
export default function NotificationBell() {
  const { items, unread } = useNotifications();
  const [open, setOpen] = useState(false);

  function openOne(item: NotificationInfo) {
    setOpen(false);
    if (!item.read) notifications.markRead([item.id]).catch(() => { });
    if (item.itemId) router.navigate(`/item/${item.itemId}`);
  }

  return (
    <Popover.Root open={open} onOpenChange={(value) => {
      setOpen(value);
      if (value) notifications.load();
    }}>
      <Popover.Trigger className="cn-bell" aria-label={unread ? t("notifications.bellUnread", { count: unread }) : t("notifications.bell")}>
        <Bell aria-hidden="true" />
        {unread > 0 && <span className="cn-bell__count" aria-hidden="true">{unread > 9 ? "9+" : unread}</span>}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={10} align="end" className="cn-menu__positioner">
          <Popover.Popup className="cn-menu cn-bell__panel">
            <div className="cn-bell__head">
              <Popover.Title className="cn-bell__title">{t("notifications.title")}</Popover.Title>
              {unread > 0 && (
                <button type="button" className="cn-bell__action" onClick={() => notifications.markRead().catch(() => { })}>
                  <CheckCheck aria-hidden="true" /> {t("notifications.markAllRead")}
                </button>
              )}
            </div>
            {items.length === 0 && (
              <div className="cn-bell__empty">
                <BellOff aria-hidden="true" />
                <p>{t("notifications.empty")}</p>
              </div>
            )}
            <div className="cn-bell__list">
              {items.map((item) => {
                const text = notificationText(item.data);
                return (
                  <button key={item.id} type="button" className={cx("cn-bell__item", !item.read && "cn-bell__item--unread")} onClick={() => openOne(item)}>
                    <span className="cn-bell__art">{item.image ? <img src={ItemsApi.imageUrl(item.image, 160)} alt="" loading="lazy" /> : <Clapperboard aria-hidden="true" />}</span>
                    <span className="cn-bell__text">
                      <strong>{text.title}</strong>
                      <span>{text.body}</span>
                      <span className="cn-bell__time">{timeAgo(item.at)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <button type="button" className="cn-bell__settings" onClick={() => {
              setOpen(false);
              router.navigate("/settings/profile#notifications");
            }}>
              <Settings aria-hidden="true" /> {t("notifications.settings")}
            </button>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
