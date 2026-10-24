import { useState } from "react";
import { CircleArrowUp, ExternalLink, RefreshCw } from "lucide-react";
import type { InstallKind, UpdateInfo } from "@shared/admin.ts";
import AdminApi from "../../Api/AdminApi.ts";
import { session } from "../../Session.ts";
import useController from "../../lib/useController.ts";
import { useUpdates } from "../../lib/Updates.ts";
import { toasts } from "../../lib/Toasts.ts";
import { formatDate, timeAgo } from "../../lib/format.ts";
import { rich, t, type TranslationKey } from "../../i18n/I18n.ts";
import Logo from "../../components/Logo/Logo.tsx";
import Button from "../../components/Button/Button.tsx";
import Switch from "../../components/Switch/Switch.tsx";
import TmdbCredit from "../../components/TmdbCredit/TmdbCredit.tsx";

/**
 * Which Cinemion this is, whether a newer one is out (for people who manage the server), its license, and credits for
 * the services it uses.
 */
export default function AboutSettings() {
  useController(session);
  const { info } = useUpdates();
  const server = session.server;
  return (
    <>
      <header className="cn-settings__header">
        <div>
          <h1>{t("settings.about.title")}</h1>
          <p>{t("settings.about.intro")}</p>
        </div>
      </header>

      <section className="cn-settings__card cn-about">
        <Logo size={2.5} />
        <div className="cn-about__text">
          <strong>
            {server?.name && server.name !== "Cinemion"
              ? t("settings.about.versionOn", { version: server.version, name: server.name })
              : t("settings.about.version", { version: server?.version ?? "" })}
          </strong>
          <span>{t("settings.about.pitch")}</span>
        </div>
        <div className="cn-about__links">
          <a href="https://github.com/LucasionGS/cinemion" target="_blank" rel="noreferrer">{t("settings.about.sourceCode")} <ExternalLink aria-hidden="true" /></a>
          <a href="https://github.com/LucasionGS/cinemion/releases" target="_blank" rel="noreferrer">{t("settings.about.releases")} <ExternalLink aria-hidden="true" /></a>
        </div>
      </section>

      {info && <UpdatesCard info={info} />}

      <section className="cn-settings__card">
        <h2>{t("settings.about.credits")}</h2>
        <TmdbCredit />
      </section>
    </>
  );
}

/**
 * How to put the new version in place, for each way Cinemion can be installed. Commands are filled in as `{placeholders}`
 * so translations can't break them.
 */
const HOW_TO_UPDATE: Record<InstallKind, { key: TranslationKey; commands: Record<string, string> }> = {
  docker: { key: "updates.how.docker", commands: { command: "docker compose pull && docker compose up -d" } },
  aur: { key: "updates.how.aur", commands: { package: "cinemion-bin", upgrade: "yay -Syu", restart: "sudo systemctl restart cinemion" } },
  binary: { key: "updates.how.binary", commands: {} },
  source: { key: "updates.how.source", commands: { command: "git pull" } },
};

/**
 * The update instructions with each command drawn as code.
 */
function howToUpdate(install: InstallKind) {
  const { key, commands } = HOW_TO_UPDATE[install];
  return rich(key, Object.fromEntries(Object.entries(commands).map(([name, command]) => [name, <code key={name}>{command}</code>])));
}

interface UpdatesCardProps {
  info: UpdateInfo;
}

/**
 * Whether a newer Cinemion is out, how to get it, and the switch for checking.
 */
function UpdatesCard(props: UpdatesCardProps) {
  const { info } = props;
  const updates = useUpdates();
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const latest = updates.available();

  async function checkNow() {
    setChecking(true);
    try {
      const result = await AdminApi.checkForUpdate();
      updates.set(result);
      if (result.error) toasts.error(t("updates.checkFailed"), result.error);
      else if (!result.available) toasts.success(t("updates.upToDate"));
    } catch (error) {
      toasts.error(t("updates.checkFailed"), (error as Error).message);
    } finally {
      setChecking(false);
    }
  }

  async function setEnabled(enabled: boolean) {
    setSaving(true);
    try {
      updates.set(await AdminApi.setUpdateCheck(enabled));
    } catch (error) {
      toasts.error(t("common.couldntSave"), (error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="cn-settings__card" aria-labelledby="cn-updates-heading">
      <h2 id="cn-updates-heading">{t("updates.title")}</h2>
      {latest && (
        <div className="cn-update">
          <CircleArrowUp className="cn-update__icon" aria-hidden="true" />
          <div className="cn-update__text">
            <strong>{t("updates.isOut", { version: latest.version })}</strong>
            <span>{t("updates.versions", { current: info.current, date: formatDate(latest.publishedAt.slice(0, 10)) })}</span>
            <span>{howToUpdate(info.install)}</span>
          </div>
          <a className="cn-update__link" href={latest.url} target="_blank" rel="noreferrer">{t("updates.whatsNew")} <ExternalLink aria-hidden="true" /></a>
        </div>
      )}
      {info.enabled && (
        <div className="cn-settings__row">
          <div className="cn-settings__row-text">
            {!latest && <strong>{info.checkedAt && !info.error ? t("updates.upToDate") : t("updates.notChecked")}</strong>}
            <span>
              {info.error ? t("updates.lastCheckFailed", { error: info.error }) : info.checkedAt ? t("updates.checked", { ago: timeAgo(info.checkedAt) }) : t("updates.checksSoon")}
            </span>
          </div>
          <Button icon={<RefreshCw />} onClick={checkNow} loading={checking}>{t("updates.checkNow")}</Button>
        </div>
      )}
      <Switch
        label={t("updates.switch")}
        description={info.disabledByEnv ? rich("updates.disabledByEnv", { setting: <code>UPDATE_CHECK=false</code> }) : t("updates.switchDescription")}
        checked={info.enabled}
        disabled={saving || info.disabledByEnv}
        onChange={setEnabled}
      />
    </section>
  );
}
