import { Menu } from "@base-ui/react/menu";
import { Download, House, LayoutDashboard, LogOut, Popcorn, Search, Settings, Users } from "lucide-react";
import type { LibraryInfo } from "@shared/api.ts";
import { Link, router } from "../../lib/Router.tsx";
import useController from "../../lib/useController.ts";
import { deviceMode } from "../../lib/DeviceMode.ts";
import cx from "../../lib/cx.ts";
import { session } from "../../Session.ts";
import Logo from "../Logo/Logo.tsx";
import Avatar from "../Avatar/Avatar.tsx";
import LibraryIcon from "../LibraryIcon/LibraryIcon.tsx";
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
    { href: "/", label: "Home", icon: <House /> },
    ...libraries.map((l) => ({ href: `/library/${l.id}`, label: l.name, icon: <LibraryIcon type={l.type} /> })),
  ];
  const isActive = (href: string) => href === "/" ? path === "/" : path.startsWith(href);

  const searchItem: NavItem = { href: "/search", label: "Search", icon: <Search /> };

  if (mode === "mobile") {
    // Room for five tabs: Home, up to three libraries, and Search
    const tabs = [...items.slice(0, 4), searchItem];
    return (
      <>
        <header className="cn-topbar cn-topbar--mobile">
          <Link href="/" className="cn-topbar__logo"><Logo size={1.6} /></Link>
          {user && <ProfileMenu />}
        </header>
        <nav className="cn-tabbar" aria-label="Main">
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
      <nav className="cn-topbar__nav" aria-label="Main">
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
        {user && <ProfileMenu />}
      </div>
    </header>
  );
}

function ProfileMenu() {
  const { user } = useController(session);
  if (!user) return null;

  return (
    <Menu.Root>
      <Menu.Trigger className="cn-topbar__profile" aria-label={`Profile: ${user.name}`}>
        <Avatar profile={user} size={2.6} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={10} align="end" className="cn-menu__positioner">
          <Menu.Popup className="cn-menu">
            <div className="cn-menu__header">
              <Avatar profile={user} size={2.25} />
              <div>
                <strong>{user.name}</strong>
                <span>{user.role === "admin" ? "Admin" : "Profile"}</span>
              </div>
            </div>
            <Menu.Item className="cn-menu__item" onClick={() => router.navigate("/settings/profile")}><Settings /> Profile &amp; settings</Menu.Item>
            {session.can("SERVER_MANAGE") && <Menu.Item className="cn-menu__item" onClick={() => router.navigate("/settings/dashboard")}><LayoutDashboard /> Server dashboard</Menu.Item>}
            <Menu.Item className="cn-menu__item" onClick={() => router.navigate("/together")}><Popcorn /> Join watch together</Menu.Item>
            {session.can("MEDIA_DOWNLOAD") && <Menu.Item className="cn-menu__item" onClick={() => router.navigate("/downloads")}><Download /> Downloads</Menu.Item>}
            <Menu.Item className="cn-menu__item" onClick={() => router.navigate("/profiles")}><Users /> Switch profile</Menu.Item>
            <Menu.Separator className="cn-menu__separator" />
            <Menu.Item className="cn-menu__item" onClick={() => session.signOut()}><LogOut /> Sign out</Menu.Item>
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
  const words = ["movies", "shows"];
  if (libraries.some((l) => l.type === "videos")) words.push("videos");
  if (libraries.some((l) => l.type === "music")) words.push("music");
  if (libraries.some((l) => l.type === "audiobooks" || l.type === "books")) words.push("books");
  // A long list doesn't fit in the box
  if (words.length > 3) return "Search your libraries";
  return `Search ${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}
