import type { ReactNode } from "react";
import { Captions, Clapperboard, FolderOpen, Info, LayoutDashboard, Library as LibraryIcon, ListChecks, MonitorSmartphone, Plug, ScrollText, UserRound, Users, Webhook } from "lucide-react";
import { session } from "../../Session.ts";
import AdminApi from "../../Api/AdminApi.ts";
import { Link } from "../../lib/Router.tsx";
import useController from "../../lib/useController.ts";
import usePoll from "../../lib/usePoll.ts";
import cx from "../../lib/cx.ts";
import AppShell from "../../components/AppShell/AppShell.tsx";
import ProfileSettings from "./ProfileSettings.tsx";
import DeviceSettings from "./DeviceSettings.tsx";
import Dashboard from "./Dashboard.tsx";
import UsersSettings from "./UsersSettings.tsx";
import LibrariesSettings from "./LibrariesSettings.tsx";
import MetadataSettings from "./MetadataSettings.tsx";
import PlaybackSettings from "./PlaybackSettings.tsx";
import SubtitleSettings from "./SubtitleSettings.tsx";
import IntegrationsSettings from "./IntegrationsSettings.tsx";
import WebhooksSettings from "./WebhooksSettings.tsx";
import TasksSettings from "./TasksSettings.tsx";
import LogsSettings from "./LogsSettings.tsx";
import AboutSettings from "./AboutSettings.tsx";
import "./Settings.scss";

interface Tab {
  id: string;
  label: string;
  icon: ReactNode;
  group: "you" | "server";
  visible: boolean;
  /**
   * Use the full page width, for the dashboard and logs.
   */
  wide?: boolean;
  badge?: number;
  render: () => ReactNode;
}

export interface SettingsProps {
  tab: string;
}

export default function Settings(props: SettingsProps) {
  const { tab } = props;
  useController(session);
  const canManage = session.can("SERVER_MANAGE");
  const running = useRunningTasks(canManage);

  const tabs: Tab[] = [
    { id: "profile", label: "Your profile", icon: <UserRound />, group: "you", visible: true, render: () => <ProfileSettings /> },
    { id: "device", label: "This device", icon: <MonitorSmartphone />, group: "you", visible: true, render: () => <DeviceSettings /> },
    { id: "about", label: "About", icon: <Info />, group: "you", visible: true, render: () => <AboutSettings /> },
    { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard />, group: "server", visible: canManage, wide: true, render: () => <Dashboard /> },
    { id: "libraries", label: "Libraries", icon: <FolderOpen />, group: "server", visible: session.can("LIBRARY_MANAGE"), render: () => <LibrariesSettings /> },
    { id: "users", label: "Users", icon: <Users />, group: "server", visible: session.can("USERS_MANAGE"), render: () => <UsersSettings /> },
    { id: "playback", label: "Playback", icon: <Clapperboard />, group: "server", visible: canManage, render: () => <PlaybackSettings /> },
    { id: "metadata", label: "Metadata", icon: <LibraryIcon />, group: "server", visible: canManage, render: () => <MetadataSettings /> },
    { id: "subtitles", label: "Subtitles", icon: <Captions />, group: "server", visible: canManage, render: () => <SubtitleSettings /> },
    { id: "integrations", label: "Integrations", icon: <Plug />, group: "server", visible: canManage, render: () => <IntegrationsSettings /> },
    { id: "webhooks", label: "Webhooks", icon: <Webhook />, group: "server", visible: canManage, render: () => <WebhooksSettings /> },
    { id: "tasks", label: "Tasks", icon: <ListChecks />, group: "server", visible: canManage, badge: running, render: () => <TasksSettings /> },
    { id: "logs", label: "Logs", icon: <ScrollText />, group: "server", visible: canManage, wide: true, render: () => <LogsSettings /> },
  ];
  const visible = tabs.filter((t) => t.visible);
  const current = visible.find((t) => t.id === tab) ?? visible[0];
  const groups = [
    { id: "you", title: "You", tabs: visible.filter((t) => t.group === "you") },
    { id: "server", title: "Server", tabs: visible.filter((t) => t.group === "server") },
  ].filter((g) => g.tabs.length > 0);

  return (
    <AppShell>
      <div className="cn-settings">
        <nav className="cn-settings__nav" aria-label="Settings">
          {groups.map((g) => (
            <div key={g.id} className="cn-settings__nav-group">
              <span className="cn-settings__nav-title">{g.title}</span>
              {g.tabs.map((t) => (
                <Link key={t.id} href={`/settings/${t.id}`} className={cx("cn-settings__link", t === current && "cn-settings__link--active")} aria-current={t === current ? "page" : undefined}>
                  {t.icon}
                  {t.label}
                  {!!t.badge && <span className="cn-settings__link-badge" aria-label={`${t.badge} running`}>{t.badge}</span>}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className={cx("cn-settings__content", current.wide && "cn-settings__content--wide")}>{current.render()}</div>
      </div>
    </AppShell>
  );
}

/**
 * How many background tasks are running, for the badge on Tasks. Only asked for by people who manage the server.
 */
function useRunningTasks(enabled: boolean) {
  const { data } = usePoll(() => enabled ? AdminApi.tasks().then((t) => t.running) : Promise.resolve([]), enabled ? 5000 : null);
  return data?.length ?? 0;
}
