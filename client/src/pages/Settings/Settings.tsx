import type { ReactNode } from "react";
import { Captions, Clapperboard, FolderOpen, Library as LibraryIcon, MonitorSmartphone, UserRound, Users } from "lucide-react";
import { session } from "../../Session.ts";
import { Link } from "../../lib/Router.tsx";
import useController from "../../lib/useController.ts";
import cx from "../../lib/cx.ts";
import AppShell from "../../components/AppShell/AppShell.tsx";
import ProfileSettings from "./ProfileSettings.tsx";
import DeviceSettings from "./DeviceSettings.tsx";
import UsersSettings from "./UsersSettings.tsx";
import LibrariesSettings from "./LibrariesSettings.tsx";
import MetadataSettings from "./MetadataSettings.tsx";
import PlaybackSettings from "./PlaybackSettings.tsx";
import SubtitleSettings from "./SubtitleSettings.tsx";
import "./Settings.scss";

interface Tab {
  id: string;
  label: string;
  icon: ReactNode;
  visible: boolean;
  render: () => ReactNode;
}

export interface SettingsProps {
  tab: string;
}

export default function Settings(props: SettingsProps) {
  const { tab } = props;
  useController(session);

  const tabs: Tab[] = [
    { id: "profile", label: "Your profile", icon: <UserRound />, visible: true, render: () => <ProfileSettings /> },
    { id: "device", label: "This device", icon: <MonitorSmartphone />, visible: true, render: () => <DeviceSettings /> },
    { id: "users", label: "Users", icon: <Users />, visible: session.can("USERS_MANAGE"), render: () => <UsersSettings /> },
    { id: "libraries", label: "Libraries", icon: <FolderOpen />, visible: session.can("LIBRARY_MANAGE"), render: () => <LibrariesSettings /> },
    { id: "metadata", label: "Metadata", icon: <LibraryIcon />, visible: session.can("SERVER_MANAGE"), render: () => <MetadataSettings /> },
    { id: "playback", label: "Playback", icon: <Clapperboard />, visible: session.can("SERVER_MANAGE"), render: () => <PlaybackSettings /> },
    { id: "subtitles", label: "Subtitles", icon: <Captions />, visible: session.can("SERVER_MANAGE"), render: () => <SubtitleSettings /> },
  ];
  const visible = tabs.filter((t) => t.visible);
  const current = visible.find((t) => t.id === tab) ?? visible[0];

  return (
    <AppShell>
      <div className="cn-settings">
        <nav className="cn-settings__nav" aria-label="Settings">
          <span className="cn-settings__nav-title">Settings</span>
          {visible.map((t) => (
            <Link key={t.id} href={`/settings/${t.id}`} className={cx("cn-settings__link", t === current && "cn-settings__link--active")} aria-current={t === current ? "page" : undefined}>
              {t.icon}
              {t.label}
            </Link>
          ))}
        </nav>
        <div className="cn-settings__content">{current.render()}</div>
      </div>
    </AppShell>
  );
}
