import type { ReactNode } from "react";
import { ArchiveRestore, Captions, Clapperboard, FolderOpen, Info, LayoutDashboard, Library as LibraryIcon, ListChecks, MonitorSmartphone, Plug, ScrollText, UserRound, Users, Webhook } from "lucide-react";
import { session } from "../../Session.ts";
import AdminApi from "../../Api/AdminApi.ts";
import { Link } from "../../lib/Router.tsx";
import useController from "../../lib/useController.ts";
import usePoll from "../../lib/usePoll.ts";
import cx from "../../lib/cx.ts";
import { useUpdates } from "../../lib/Updates.ts";
import { t } from "../../i18n/I18n.ts";
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
import BackupsSettings from "./BackupsSettings.tsx";
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
  /**
   * Shows a dot after the label; the text is for screen readers.
   */
  dot?: string | null;
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
  const update = useUpdates().available();

  const tabs: Tab[] = [
    { id: "profile", label: t("settings.tabs.profile"), icon: <UserRound />, group: "you", visible: true, render: () => <ProfileSettings /> },
    { id: "device", label: t("settings.tabs.device"), icon: <MonitorSmartphone />, group: "you", visible: true, render: () => <DeviceSettings /> },
    { id: "about", label: t("settings.tabs.about"), icon: <Info />, group: "you", visible: true, dot: update && t("updates.isOut", { version: update.version }), render: () => <AboutSettings /> },
    { id: "dashboard", label: t("settings.tabs.dashboard"), icon: <LayoutDashboard />, group: "server", visible: canManage, wide: true, render: () => <Dashboard /> },
    { id: "libraries", label: t("settings.tabs.libraries"), icon: <FolderOpen />, group: "server", visible: session.can("LIBRARY_MANAGE"), render: () => <LibrariesSettings /> },
    { id: "users", label: t("settings.tabs.users"), icon: <Users />, group: "server", visible: session.can("USERS_MANAGE"), render: () => <UsersSettings /> },
    { id: "playback", label: t("settings.tabs.playback"), icon: <Clapperboard />, group: "server", visible: canManage, render: () => <PlaybackSettings /> },
    { id: "metadata", label: t("settings.tabs.metadata"), icon: <LibraryIcon />, group: "server", visible: canManage, render: () => <MetadataSettings /> },
    { id: "subtitles", label: t("settings.tabs.subtitles"), icon: <Captions />, group: "server", visible: canManage, render: () => <SubtitleSettings /> },
    { id: "integrations", label: t("settings.tabs.integrations"), icon: <Plug />, group: "server", visible: canManage, render: () => <IntegrationsSettings /> },
    { id: "webhooks", label: t("settings.tabs.webhooks"), icon: <Webhook />, group: "server", visible: canManage, render: () => <WebhooksSettings /> },
    { id: "backups", label: t("settings.tabs.backups"), icon: <ArchiveRestore />, group: "server", visible: canManage, render: () => <BackupsSettings /> },
    { id: "tasks", label: t("settings.tabs.tasks"), icon: <ListChecks />, group: "server", visible: canManage, badge: running, render: () => <TasksSettings /> },
    { id: "logs", label: t("settings.tabs.logs"), icon: <ScrollText />, group: "server", visible: canManage, wide: true, render: () => <LogsSettings /> },
  ];
  const visible = tabs.filter((item) => item.visible);
  const current = visible.find((item) => item.id === tab) ?? visible[0];
  const groups = [
    { id: "you", title: t("settings.tabs.you"), tabs: visible.filter((item) => item.group === "you") },
    { id: "server", title: t("settings.tabs.server"), tabs: visible.filter((item) => item.group === "server") },
  ].filter((g) => g.tabs.length > 0);

  return (
    <AppShell>
      <div className="cn-settings">
        <nav className="cn-settings__nav" aria-label={t("settings.tabs.navigation")}>
          {groups.map((g) => (
            <div key={g.id} className="cn-settings__nav-group">
              <span className="cn-settings__nav-title">{g.title}</span>
              {g.tabs.map((item) => (
                <Link key={item.id} href={`/settings/${item.id}`} className={cx("cn-settings__link", item === current && "cn-settings__link--active")} aria-current={item === current ? "page" : undefined}>
                  {item.icon}
                  {item.label}
                  {item.dot && <span className="cn-settings__link-dot" role="img" aria-label={item.dot} />}
                  {!!item.badge && <span className="cn-settings__link-badge" aria-label={t("settings.tabs.running", { count: item.badge })}>{item.badge}</span>}
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
