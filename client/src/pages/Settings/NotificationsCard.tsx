import { useEffect, useState } from "react";
import { BellRing, Trash2 } from "lucide-react";
import type { NotificationPreferences, NotificationSetup, NotifyMode } from "@shared/notifications.ts";
import NotificationsApi from "../../Api/NotificationsApi.ts";
import LibrariesApi from "../../Api/LibrariesApi.ts";
import UsersApi from "../../Api/UsersApi.ts";
import { session } from "../../Session.ts";
import { Push } from "../../lib/Notifications.ts";
import { toasts } from "../../lib/Toasts.ts";
import useController from "../../lib/useController.ts";
import { timeAgo } from "../../lib/format.ts";
import { t, type TranslationKey } from "../../i18n/I18n.ts";
import Button from "../../components/Button/Button.tsx";
import IconButton from "../../components/IconButton/IconButton.tsx";
import Select from "../../components/Select/Select.tsx";
import Switch from "../../components/Switch/Switch.tsx";
import TextField from "../../components/TextField/TextField.tsx";

const MODES: { value: NotifyMode; label: TranslationKey }[] = [
  { value: "all", label: "notifications.prefs.all" },
  { value: "following", label: "notifications.prefs.following" },
  { value: "none", label: "notifications.prefs.none" },
];

/**
 * Library types notifications are made for.
 */
const NOTIFYING = ["movies", "shows", "music", "audiobooks", "books"];

/**
 * What this profile is told about, per library, and where: push on this device and email.
 */
export default function NotificationsCard() {
  const { user } = useController(session);
  const libraries = LibrariesApi.useLibraries();
  const [setup, setSetup] = useState<NotificationSetup | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState(user?.preferences.notifications.email ?? "");

  // The bell's "Notification settings" link lands here
  useEffect(() => {
    if (location.hash !== "#notifications") return;
    const timer = setTimeout(() => document.getElementById("notifications")?.scrollIntoView({ block: "start", behavior: "smooth" }), 300);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    (async () => {
      const current = await Push.current().catch(() => null);
      setSubscribed(!!current);
      setSetup(await NotificationsApi.setup(current?.endpoint).catch(() => null));
    })();
  }, []);

  if (!user) return null;
  const prefs = user.preferences.notifications;

  async function save(patch: Partial<NotificationPreferences>, done?: TranslationKey) {
    const previous = user!;
    const preferences = { ...previous.preferences, notifications: { ...prefs, ...patch } };
    session.setUser({ ...previous, preferences });
    try {
      session.setUser(await UsersApi.updateSelf({ preferences }));
      if (done) toasts.success(t(done));
    } catch (error) {
      session.setUser(previous);
      toasts.error(t("common.couldntSave"), (error as Error).message);
    }
  }

  function setLibrary(id: number, value: string) {
    const libraries = { ...prefs.libraries };
    if (value === "") delete libraries[String(id)];
    else libraries[String(id)] = value as NotifyMode;
    save({ libraries });
  }

  async function togglePush(on: boolean) {
    if (!setup?.pushKey) return;
    setBusy("push");
    try {
      if (on) {
        const subscription = await Push.subscribe(setup.pushKey);
        setSetup(await NotificationsApi.subscribe(subscription));
        setSubscribed(true);
        toasts.success(t("notifications.prefs.pushOn"));
      }
      else {
        const endpoint = await Push.unsubscribe();
        if (endpoint) setSetup(await NotificationsApi.unsubscribe({ endpoint }));
        setSubscribed(false);
      }
    } catch (error) {
      const reason = (error as Error).message;
      toasts.error(t("notifications.prefs.pushFailed"), reason === "denied" ? t("notifications.prefs.pushDenied") : reason === "no-worker" ? t("notifications.prefs.pushNoWorker") : reason);
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    try {
      const { sent } = await NotificationsApi.testPush();
      if (sent) toasts.success(t("notifications.prefs.testSent", { count: sent }));
      else toasts.error(t("notifications.prefs.testNone"));
    } catch (error) {
      toasts.error(t("notifications.prefs.pushFailed"), (error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function removeDevice(id: number) {
    try {
      setSetup(await NotificationsApi.unsubscribe({ id }));
    } catch (error) {
      toasts.error(t("common.couldntSave"), (error as Error).message);
    }
  }

  const pushSupported = Push.isSupported();
  const shown = (libraries ?? []).filter((l) => NOTIFYING.includes(l.type));
  const emailChanged = (email.trim() || null) !== prefs.email;

  return (
    <section className="cn-settings__card" id="notifications">
      <h2>{t("notifications.prefs.title")}</h2>
      <Select
        label={t("notifications.prefs.mode")}
        description={t("notifications.prefs.modeDescription")}
        value={prefs.mode}
        options={MODES.map((m) => ({ value: m.value, label: t(m.label) }))}
        onChange={(e) => save({ mode: e.target.value as NotifyMode })}
      />
      {shown.length > 1 && (
        <div className="cn-backups__fields">
          {shown.map((library) => (
            <Select
              key={library.id}
              label={library.name}
              value={prefs.libraries[String(library.id)] ?? ""}
              options={[{ value: "", label: t("notifications.prefs.sameAsAbove") }, ...MODES.map((m) => ({ value: m.value, label: t(m.label) }))]}
              onChange={(e) => setLibrary(library.id, e.target.value)}
            />
          ))}
        </div>
      )}

      <div className="cn-settings__divider" />
      <Switch
        label={t("notifications.prefs.push")}
        description={pushSupported ? (setup?.pushKey ? t("notifications.prefs.pushDescription") : t("notifications.prefs.pushUnavailable")) : t("notifications.prefs.pushNeedsHttps")}
        checked={subscribed}
        disabled={!pushSupported || !setup?.pushKey || busy === "push"}
        onChange={togglePush}
      />
      {setup && setup.devices.length > 0 && (
        <div className="cn-settings__list">
          {setup.devices.map((device) => (
            <div key={device.id} className="cn-settings__item">
              <BellRing />
              <div className="cn-settings__item-text">
                <strong>{device.current ? t("notifications.prefs.thisDevice", { name: device.name }) : device.name}</strong>
                <span>{t("notifications.prefs.since", { ago: timeAgo(device.createdAt) })}</span>
              </div>
              <IconButton label={t("notifications.prefs.removeDevice", { name: device.name })} icon={<Trash2 />} onClick={() => removeDevice(device.id)} />
            </div>
          ))}
          <div>
            <Button size="sm" loading={busy === "test"} onClick={test}>{t("notifications.prefs.test")}</Button>
          </div>
        </div>
      )}

      {setup?.email && (
        <>
          <div className="cn-settings__divider" />
          <div className="cn-backups__folder">
            <TextField
              label={t("notifications.prefs.email")}
              description={t("notifications.prefs.emailDescription")}
              type="email"
              value={email}
              placeholder="you@example.com"
              onChange={(e) => setEmail(e.target.value)}
              className="cn-backups__folder-field"
            />
            <Button onClick={() => save({ email: email.trim() || null }, email.trim() ? "notifications.prefs.emailSaved" : "notifications.prefs.emailOff")} disabled={!emailChanged}>{t("common.save")}</Button>
          </div>
        </>
      )}
    </section>
  );
}
