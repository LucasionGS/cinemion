import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck, Copy, Plus, Trash2 } from "lucide-react";
import type { IntegrationSettings, PathMapping } from "@shared/admin.ts";
import type { TraktAppSettings } from "@shared/trakt.ts";
import IntegrationsApi from "../../Api/IntegrationsApi.ts";
import TraktApi from "../../Api/TraktApi.ts";
import { toasts } from "../../lib/Toasts.ts";
import { copyText } from "../../lib/clipboard.ts";
import { timeAgo } from "../../lib/format.ts";
import cx from "../../lib/cx.ts";
import Button from "../../components/Button/Button.tsx";
import IconButton from "../../components/IconButton/IconButton.tsx";
import TextField from "../../components/TextField/TextField.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import { ConfirmDialog } from "../../components/Dialog/Dialog.tsx";
import "./Admin.scss";

/**
 * Sonarr and Radarr (the address to paste into them, and path mappings for when they see the media elsewhere), and
 * the server's Trakt app.
 */
export default function IntegrationsSettings() {
  const [settings, setSettings] = useState<IntegrationSettings | null>(null);
  const [mappings, setMappings] = useState<PathMapping[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);

  useEffect(() => {
    IntegrationsApi.get().then((s) => {
      setSettings(s);
      setMappings(s.pathMappings);
    }).catch((e: Error) => toasts.error("Couldn't load integrations", e.message));
  }, []);

  // Pick up the connection test while this page is open
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      IntegrationsApi.get().then((s) => setSettings((current) => current ? { ...current, lastEvent: s.lastEvent } : s)).catch(() => { });
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  if (!settings) return <Spinner size="2rem" />;
  const address = `${location.origin}${settings.arrPath}`;
  const isLocalhost = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  const changed = JSON.stringify(mappings.filter((m) => m.from || m.to)) !== JSON.stringify(settings.pathMappings);
  const event = settings.lastEvent;

  async function copy() {
    if (await copyText(address)) toasts.success("Address copied");
    else toasts.error("Couldn't copy", "Select the address and copy it by hand.");
  }

  async function newAddress() {
    try {
      const result = await IntegrationsApi.newAddress();
      setSettings(result);
      setConfirmNew(false);
      toasts.success("New address made", "Paste it into Sonarr and Radarr again.");
    } catch (e) {
      toasts.error("Couldn't make a new address", (e as Error).message);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const result = await IntegrationsApi.setPathMappings(mappings);
      setSettings(result);
      setMappings(result.pathMappings);
      toasts.success("Path mappings saved");
    } catch (e) {
      toasts.error("Couldn't save", (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function updateMapping(index: number, patch: Partial<PathMapping>) {
    setMappings(mappings.map((m, i) => i === index ? { ...m, ...patch } : m));
  }

  return (
    <>
      <header className="cn-settings__header">
        <div>
          <h1>Integrations</h1>
          <p>Let Sonarr and Radarr tell Cinemion about new downloads, so they show up right away, and let profiles keep their Trakt history up to date.</p>
        </div>
        <Button variant="primary" onClick={save} loading={saving} disabled={!changed}>Save changes</Button>
      </header>

      <section className="cn-settings__card">
        <h2>Sonarr and Radarr</h2>
        <div className="cn-integrations__address">
          <TextField label="Webhook address" value={address} readOnly onFocus={(e) => e.target.select()} spellCheck={false} className="cn-integrations__address-field" />
          <Button icon={<Copy />} onClick={copy}>Copy</Button>
        </div>
        {isLocalhost && (
          <p className="cn-integrations__hint">
            You opened Cinemion as {location.hostname}, which Sonarr and Radarr can't reach from another computer or container.{" "}
            Open Cinemion through its network address (like http://192.168.1.10:8600) and copy the address from there.
          </p>
        )}
        <ol className="cn-integrations__steps">
          <li>In Sonarr or Radarr, open <strong>Settings → Connect</strong>, click <strong>+</strong> and pick <strong>Webhook</strong>.</li>
          <li>Paste the address above into <strong>URL</strong> and leave the method on <strong>POST</strong>.</li>
          <li>Tick <strong>On File Import</strong>, <strong>On File Upgrade</strong>, <strong>On Rename</strong> and the <strong>Delete</strong> events.</li>
          <li>Click <strong>Test</strong>. Cinemion shows below that it arrived.</li>
        </ol>
        <div className={cx("cn-integrations__status", event?.problem && "cn-integrations__status--problem")} role="status">
          {event ? (event.problem ? <CircleAlert /> : <CircleCheck />) : null}
          <span>
            {event
              ? <><strong>{event.app} · {event.eventType}</strong>, {timeAgo(event.at)}. {event.result}</>
              : "Nothing received yet."}
          </span>
        </div>
        <div className="cn-settings__divider" />
        <div className="cn-settings__row">
          <p className="cn-settings__row-text">
            <strong>New address</strong>
            <span>If the address got out, make a new one. The old one stops working, so paste the new one into Sonarr and Radarr.</span>
          </p>
          <Button size="sm" variant="danger" onClick={() => setConfirmNew(true)}>Make new address</Button>
        </div>
      </section>

      <section className="cn-settings__card">
        <h2>Path mappings</h2>
        <p className="cn-settings__row-text">
          <span>
            Only needed when Sonarr or Radarr see your media in a different folder than Cinemion does, like{" "}
            <code>/tv</code> in their container and <code>/media/shows</code> here. Folders inside a mapped folder are mapped too.
          </span>
        </p>
        {mappings.map((m, i) => (
          <div key={i} className="cn-integrations__mapping">
            <TextField label="Their folder" value={m.from} placeholder="/tv" onChange={(e) => updateMapping(i, { from: e.target.value })} spellCheck={false} />
            <TextField label="Cinemion's folder" value={m.to} placeholder="/media/shows" onChange={(e) => updateMapping(i, { to: e.target.value })} spellCheck={false} />
            <IconButton label="Remove this mapping" icon={<Trash2 />} onClick={() => setMappings(mappings.filter((_, j) => j !== i))} />
          </div>
        ))}
        <div>
          <Button size="sm" icon={<Plus />} onClick={() => setMappings([...mappings, { from: "", to: "" }])}>Add mapping</Button>
        </div>
      </section>

      <TraktAppCard />

      <ConfirmDialog
        open={confirmNew}
        onOpenChange={setConfirmNew}
        title="Make a new address?"
        description="Sonarr and Radarr can't reach Cinemion with the old address anymore until you paste the new one into them."
        confirmLabel="Make new address"
        danger
        onConfirm={newAddress}
      />
    </>
  );
}

/**
 * The server's Trakt app, which every profile links its own Trakt account through.
 */
function TraktAppCard() {
  const [settings, setSettings] = useState<TraktAppSettings | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    TraktApi.appSettings().then((s) => {
      setSettings(s);
      setClientId(s.clientId ?? "");
    }).catch(() => { });
  }, []);

  async function save() {
    setSaving(true);
    try {
      const result = await TraktApi.saveApp({ clientId, ...(clientSecret ? { clientSecret } : {}) });
      setSettings(result);
      setClientSecret("");
      toasts.success("Trakt is set up", "Profiles can link their accounts in Settings › Your profile.");
    } catch (error) {
      toasts.error("Couldn't save", (error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const changed = !!settings && (clientId !== (settings.clientId ?? "") || !!clientSecret);
  return (
    <section className="cn-settings__card">
      <h2>Trakt</h2>
      <p className="cn-settings__row-text">
        <span>
          With a Trakt app, every profile can link its own Trakt account: what they watch is scrobbled, and what they mark
          watched shows up in their Trakt history. Make the app at{" "}
          <a href="https://trakt.tv/oauth/applications/new" target="_blank" rel="noreferrer">trakt.tv/oauth/applications</a>{" "}
          with <code>urn:ietf:wg:oauth:2.0:oob</code> as its redirect URI, then copy its keys here.
        </span>
      </p>
      <div className="cn-integrations__trakt">
        <TextField label="Client ID" value={clientId} autoComplete="off" spellCheck={false} onChange={(e) => setClientId(e.target.value)} />
        <TextField
          label="Client secret"
          type="password"
          value={clientSecret}
          autoComplete="new-password"
          placeholder={settings?.hasSecret ? "Saved (type to replace)" : ""}
          onChange={(e) => setClientSecret(e.target.value)}
        />
      </div>
      <div>
        <Button variant="primary" size="sm" onClick={save} loading={saving} disabled={!changed}>Save Trakt app</Button>
      </div>
    </section>
  );
}
