import { Menu } from "@base-ui/react/menu";
import { Bookmark, CircleArrowUp, Download, House, LayoutDashboard, LogOut, Popcorn, Search, Settings, Users } from "lucide-react";
import type { LibraryInfo } from "@shared/api.ts";
import { Link, router } from "../../lib/Router.tsx";
import useController from "../../lib/useController.ts";
import { deviceMode } from "../../lib/DeviceMode.ts";
import cx from "../../lib/cx.ts";
import { session } from "../../Session.ts";
import { useUpdates } from "../../lib/Updates.ts";
import { t, type TranslationKey } from "../../i18n/I18n.ts";
import Logo from "../Logo/Logo.tsx";
import Avatar from "../Avatar/Avatar.tsx";
import LibraryIcon from "../LibraryIcon/LibraryIcon.tsx";
import NotificationBell from "../NotificationBell/NotificationBell.tsx";
import "./TopBar.scss";

export interface TopBarProps {
  libraries: LibraryInfo[];
}

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

/**
 * The app's main navigation: a top bar with pill tabs, or a floating tab bar on phones.
 */
export default function TopBar(props: TopBarProps) {
  const { libraries } = props;
  const { path } = useController(router);
  const { mode } = useController(deviceMode);
  const { user } = useController(session);

  const items: NavItem[] = [
    { href: "/", label: t("topbar.home"), icon: <House /> },
    ...libraries.map((l) => ({ href: `/library/${l.id}`, label: l.name, icon: <LibraryIcon type={l.type} /> })),
  ];
  const isActive = (href: string) => href === "/" ? path === "/" : path.startsWith(href);

  const searchItem: NavItem = { href: "/search", label: t("common.search"), icon: <Search /> };

  if (mode === "mobile") {
    // Room for five tabs: Home, up to three libraries, and Search
    const tabs = [...items.slice(0, 4), searchItem];
    return (
      <>
        <header className="cn-topbar cn-topbar--mobile">
          <Link href="/" className="cn-topbar__logo"><Logo size={1.6} /></Link>
          {user && (
            <div className="cn-topbar__end">
              <NotificationBell />
              <ProfileMenu />
            </div>
          )}
        </header>
        <nav className="cn-tabbar" aria-label={t("topbar.mainNavigation")}>
          {tabs.map((item) => (
            <Link key={item.href} href={item.href} className={cx("cn-tabbar__item", isActive(item.href) && "cn-tabbar__item--active")} aria-current={isActive(item.href) ? "page" : undefined}>
              {item.icon}
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
      </>
    );
  }

  return (
    <header className="cn-topbar">
      <Link href="/" className="cn-topbar__logo"><Logo /></Link>
      <nav className="cn-topbar__nav" aria-label={t("topbar.mainNavigation")}>
        {(mode === "tv" ? [...items, searchItem] : items).map((item) => (
          <Link key={item.href} href={item.href} className={cx("cn-topbar__link", isActive(item.href) && "cn-topbar__link--active")} aria-current={isActive(item.href) ? "page" : undefined}>
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="cn-topbar__end">
        {mode === "desktop" && (
          <Link href="/search" className="cn-topbar__search">
            <Search aria-hidden="true" />
            <span>{searchLabel(libraries)}</span>
          </Link>
        )}
        {user && <NotificationBell />}
        {user && <ProfileMenu />}
      </div>
    </header>
  );
}

function ProfileMenu() {
  const { user } = useController(session);
  const update = useUpdates().available();
  if (!user) return null;

  return (
    <Menu.Root>
      <Menu.Trigger className="cn-topbar__profile" aria-label={update ? t("topbar.profileWithUpdate", { name: user.name }) : t("topbar.profile", { name: user.name })}>
        <Avatar profile={user} size={2.6} />
        {update && <span className="cn-topbar__dot" aria-hidden="true" />}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={10} align="end" className="cn-menu__positioner">
          <Menu.Popup className="cn-menu">
            <div className="cn-menu__header">
              <Avatar profile={user} size={2.25} />
              <div>
                <strong>{user.name}</strong>
                <span>{user.role === "admin" ? t("topbar.admin") : t("topbar.profileRole")}</span>
              </div>
            </div>
            {update && <Menu.Item className="cn-menu__item cn-menu__item--accent" onClick={() => router.navigate("/settings/about")}><CircleArrowUp /> {t("updates.isOut", { version: update.version })}</Menu.Item>}
            <Menu.Item className="cn-menu__item" onClick={() => router.navigate("/settings/profile")}><Settings /> {t("topbar.menu.settings")}</Menu.Item>
            {session.can("SERVER_MANAGE") && <Menu.Item className="cn-menu__item" onClick={() => router.navigate("/settings/dashboard")}><LayoutDashboard /> {t("topbar.menu.dashboard")}</Menu.Item>}
            <Menu.Item className="cn-menu__item" onClick={() => router.navigate("/my-list")}><Bookmark /> {t("topbar.menu.myList")}</Menu.Item>
            <Menu.Item className="cn-menu__item" onClick={() => router.navigate("/together")}><Popcorn /> {t("topbar.menu.together")}</Menu.Item>
            {session.can("MEDIA_DOWNLOAD") && <Menu.Item className="cn-menu__item" onClick={() => router.navigate("/downloads")}><Download /> {t("topbar.menu.downloads")}</Menu.Item>}
            <Menu.Item className="cn-menu__item" onClick={() => router.navigate("/profiles")}><Users /> {t("topbar.menu.switchProfile")}</Menu.Item>
            <Menu.Separator className="cn-menu__separator" />
            <Menu.Item className="cn-menu__item" onClick={() => session.signOut()}><LogOut /> {t("topbar.menu.signOut")}</Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * "Search movies, shows and music": what the search box finds, from the kinds of libraries there are.
 */
function searchLabel(libraries: LibraryInfo[]) {
  const extras: TranslationKey[] = [];
  if (libraries.some((l) => l.type === "videos")) extras.push("topbar.search.videos");
  if (libraries.some((l) => l.type === "music")) extras.push("topbar.search.music");
  if (libraries.some((l) => l.type === "audiobooks" || l.type === "books")) extras.push("topbar.search.books");
  if (libraries.some((l) => l.type === "photos")) extras.push("topbar.search.albums");
  if (libraries.some((l) => l.type === "clips")) extras.push("topbar.search.games");
  // A long list doesn't fit in the box
  if (extras.length > 1) return t("topbar.search.everything");
  return t(extras[0] ?? "topbar.search.default");
}
