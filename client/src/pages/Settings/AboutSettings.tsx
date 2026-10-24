import { useState } from "react";
import { CircleArrowUp, ExternalLink, RefreshCw } from "lucide-react";
import type { InstallKind, UpdateInfo } from "@shared/admin.ts";
import AdminApi from "../../Api/AdminApi.ts";
import { session } from "../../Session.ts";
import useController from "../../lib/useController.ts";
import { useUpdates } from "../../lib/Updates.ts";
import { toasts } from "../../lib/Toasts.ts";
import { formatDate, timeAgo } from "../../lib/format.ts";
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
          <h1>About</h1>
          <p>Which Cinemion this is, and who helps it know what's in your libraries.</p>
        </div>
      </header>

      <section className="cn-settings__card cn-about">
        <Logo size={2.5} />
        <div className="cn-about__text">
          <strong>Cinemion {server?.version}{server?.name && server.name !== "Cinemion" ? ` on ${server.name}` : ""}</strong>
          <span>A self-hosted home for your movies, shows, videos, music and books. Free software under the GNU General Public License, version 3 or later.</span>
        </div>
        <div className="cn-about__links">
          <a href="https://github.com/LucasionGS/cinemion" target="_blank" rel="noreferrer">Source code <ExternalLink aria-hidden="true" /></a>
          <a href="https://github.com/LucasionGS/cinemion/releases" target="_blank" rel="noreferrer">Releases <ExternalLink aria-hidden="true" /></a>
        </div>
      </section>

      {info && <UpdatesCard info={info} />}

      <section className="cn-settings__card">
        <h2>Credits</h2>
        <TmdbCredit />
      </section>
    </>
  );
}

/**
 * How to put the new version in place, for each way Cinemion can be installed.
 */
const HOW_TO_UPDATE: Record<InstallKind, React.ReactNode> = {
  docker: <>To update, get the new image and start the container again, for example with <code>docker compose pull &amp;&amp; docker compose up -d</code>. Your libraries and settings stay as they are.</>,
  aur: <>To update, upgrade the <code>cinemion-bin</code> package (for example with <code>yay -Syu</code>), then restart Cinemion with <code>sudo systemctl restart cinemion</code>.</>,
  binary: <>To update, download the new version from the release page, put it in place of this one and start Cinemion again. Your libraries and settings stay as they are.</>,
  source: <>To update, get the new version with <code>git pull</code> and start Cinemion again.</>,
};

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
      if (result.error) toasts.error("Couldn't check for updates", result.error);
      else if (!result.available) toasts.success("You have the newest Cinemion");
    } catch (error) {
      toasts.error("Couldn't check for updates", (error as Error).message);
    } finally {
      setChecking(false);
    }
  }

  async function setEnabled(enabled: boolean) {
    setSaving(true);
    try {
      updates.set(await AdminApi.setUpdateCheck(enabled));
    } catch (error) {
      toasts.error("Couldn't save", (error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="cn-settings__card" aria-labelledby="cn-updates-heading">
      <h2 id="cn-updates-heading">Updates</h2>
      {latest && (
        <div className="cn-update">
          <CircleArrowUp className="cn-update__icon" aria-hidden="true" />
          <div className="cn-update__text">
            <strong>Cinemion {latest.version} is out</strong>
            <span>This server has {info.current}. The new one came out {formatDate(latest.publishedAt.slice(0, 10))}.</span>
            <span>{HOW_TO_UPDATE[info.install]}</span>
          </div>
          <a className="cn-update__link" href={latest.url} target="_blank" rel="noreferrer">What's new <ExternalLink aria-hidden="true" /></a>
        </div>
      )}
      {info.enabled && (
        <div className="cn-settings__row">
          <div className="cn-settings__row-text">
            {!latest && <strong>{info.checkedAt && !info.error ? "You have the newest Cinemion" : "Not checked yet"}</strong>}
            <span>
              {info.error ? `The last check didn't work: ${info.error}` : info.checkedAt ? `Checked ${timeAgo(info.checkedAt)}.` : "Cinemion checks a minute after it starts."}
            </span>
          </div>
          <Button icon={<RefreshCw />} onClick={checkNow} loading={checking}>Check now</Button>
        </div>
      )}
      <Switch
        label="Check for updates"
        description={info.disabledByEnv
          ? <>Turned off for this server with <code>UPDATE_CHECK=false</code>.</>
          : "Looks at Cinemion's releases on GitHub twice a day and tells admins when there's a new one. Nothing about your server or libraries is sent, and nothing is installed by itself."}
        checked={info.enabled}
        disabled={saving || info.disabledByEnv}
        onChange={setEnabled}
      />
    </section>
  );
}
