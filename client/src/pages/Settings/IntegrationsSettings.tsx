import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck, Copy, KeyRound, Plus, Trash2, UploadCloud } from "lucide-react";
import type { AppKeyInfo, IntegrationSettings, PathMapping, PodiumTargetInfo, PodiumTargets } from "@shared/admin.ts";
import type { TraktAppSettings } from "@shared/trakt.ts";
import IntegrationsApi from "../../Api/IntegrationsApi.ts";
import TraktApi from "../../Api/TraktApi.ts";
import LibrariesApi from "../../Api/LibrariesApi.ts";
import { toasts } from "../../lib/Toasts.ts";
import { copyText } from "../../lib/clipboard.ts";
import { session } from "../../Session.ts";
import { timeAgo } from "../../lib/format.ts";
import cx from "../../lib/cx.ts";
import Button from "../../components/Button/Button.tsx";
import IconButton from "../../components/IconButton/IconButton.tsx";
import TextField from "../../components/TextField/TextField.tsx";
import Select from "../../components/Select/Select.tsx";
import Switch from "../../components/Switch/Switch.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import { ConfirmDialog } from "../../components/Dialog/Dialog.tsx";
import "./Admin.scss";

/**
 * Sonarr and Radarr (the address to paste into them, and path mappings for when they see the media elsewhere), keys
 * for apps like Seerr and Homepage, Podium upload targets, and the server's Trakt app.
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
          <p>Let Sonarr and Radarr tell Cinemion about new downloads, so they show up right away, connect apps like Seerr and Homepage, and let profiles keep their Trakt history up to date.</p>
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

      {session.isAdmin() && <AppsCard />}
      <PodiumCard />

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

/**
 * Apps that connect to Cinemion as their media server: Seerr for requests, Homepage for a dashboard tile. Seerr makes
 * its own key when an admin signs in; other apps get one made here.
 */
function AppsCard() {
  const [keys, setKeys] = useState<AppKeyInfo[] | null>(null);
  const [app, setApp] = useState("");
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<AppKeyInfo | null>(null);

  useEffect(() => {
    IntegrationsApi.appKeys().then(setKeys).catch(() => setKeys([]));
  }, []);

  async function copy(text: string, what: string) {
    if (await copyText(text)) toasts.success(`${what} copied`);
    else toasts.error("Couldn't copy", "Select it and copy it by hand.");
  }

  async function create() {
    setCreating(true);
    try {
      const key = await IntegrationsApi.createAppKey(app);
      setKeys([...keys ?? [], key]);
      setApp("");
      await copy(key.token, "Key");
    } catch (error) {
      toasts.error("Couldn't make a key", (error as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function remove() {
    if (!removing) return;
    try {
      setKeys(await IntegrationsApi.removeAppKey(removing.id));
      setRemoving(null);
      toasts.success("Key removed", `${removing.app} can't reach Cinemion with it anymore.`);
    } catch (error) {
      toasts.error("Couldn't remove the key", (error as Error).message);
    }
  }

  return (
    <section className="cn-settings__card">
      <h2>Seerr, Homepage and other apps</h2>
      <p className="cn-settings__row-text">
        <span>
          Apps made for other media servers can use Cinemion instead. In Seerr, pick the media server that signs in with
          a server address, username and password, give it the address below, and sign in with your Cinemion login: it
          sees what's in your libraries and links back here. Homepage's media server widget can show what's playing and
          how big your libraries are with a key made below.
        </span>
      </p>
      <div className="cn-integrations__address">
        <TextField label="Server address" value={location.origin} readOnly onFocus={(e) => e.target.select()} spellCheck={false} className="cn-integrations__address-field" />
        <Button icon={<Copy />} onClick={() => copy(location.origin, "Address")}>Copy</Button>
      </div>
      {keys && keys.length > 0 && (
        <div className="cn-settings__list">
          {keys.map((k) => (
            <div key={k.id} className="cn-settings__item">
              <KeyRound />
              <div className="cn-settings__item-text">
                <strong>{k.app}</strong>
                <span>{k.createdBy ? `Made by ${k.createdBy}, ${timeAgo(k.createdAt)}` : `Made ${timeAgo(k.createdAt)} by a profile that has been removed, so it doesn't work`}</span>
              </div>
              <IconButton label={`Copy the key for ${k.app}`} icon={<Copy />} onClick={() => copy(k.token, "Key")} />
              <IconButton label={`Remove the key for ${k.app}`} icon={<Trash2 />} onClick={() => setRemoving(k)} />
            </div>
          ))}
        </div>
      )}
      <div className="cn-integrations__address">
        <TextField label="New key for" value={app} placeholder="Homepage" maxLength={60} onChange={(e) => setApp(e.target.value)} className="cn-integrations__key-field" />
        <Button icon={<Plus />} onClick={create} loading={creating} disabled={!app.trim()}>Make key</Button>
      </div>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove the key for ${removing?.app ?? ""}?`}
        description="The app using it can't reach Cinemion anymore until it gets a new key."
        confirmLabel="Remove key"
        danger
        onConfirm={remove}
      />
    </section>
  );
}

/**
 * Podium, a clip recorder, uploads straight into a library through its upload protocol. Each target is a library
 * (and a folder in it) with its own token; Podium gets the server URL and a target's token.
 */
function PodiumCard() {
  const libraries = LibrariesApi.useLibraries();
  const [data, setData] = useState<PodiumTargets | null>(null);
  const [name, setName] = useState("");
  const [libraryId, setLibraryId] = useState<number | null>(null);
  const [folder, setFolder] = useState("Podium");
  const [gameFolders, setGameFolders] = useState(true);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<PodiumTargetInfo | null>(null);
  const library = libraries?.find((l) => l.id === libraryId) ?? libraries?.find((l) => l.type === "clips") ?? libraries?.[0] ?? null;

  useEffect(() => {
    IntegrationsApi.podiumTargets().then(setData).catch(() => setData({ serverUrl: `${location.origin}/api/podium`, targets: [] }));
  }, []);

  async function copy(text: string, what: string) {
    if (await copyText(text)) toasts.success(`${what} copied`);
    else toasts.error("Couldn't copy", "Select it and copy it by hand.");
  }

  async function create() {
    if (!library) return;
    setCreating(true);
    try {
      const before = new Set(data?.targets.map((t) => t.id));
      const result = await IntegrationsApi.createPodiumTarget({ name, libraryId: library.id, folder, gameFolders });
      setData(result);
      setName("");
      const made = result.targets.find((t) => !before.has(t.id));
      if (made) await copy(made.token, "Token");
    } catch (error) {
      toasts.error("Couldn't make the target", (error as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function remove() {
    if (!removing) return;
    try {
      setData(await IntegrationsApi.removePodiumTarget(removing.id));
      setRemoving(null);
      toasts.success("Target removed", "Podium can't upload with its token anymore.");
    } catch (error) {
      toasts.error("Couldn't remove the target", (error as Error).message);
    }
  }

  function describe(t: PodiumTargetInfo) {
    if (!t.libraryName) return "Its library was removed, so it doesn't work";
    if (!t.createdBy) return "Made by a profile that has been removed, so it doesn't work";
    const where = [t.libraryName, t.folder].filter(Boolean).join(" › ");
    const games = t.gameFolders && libraries?.find((l) => l.id === t.libraryId)?.type === "clips" ? ", a folder per game" : "";
    return `Into ${where}${games} · ${t.lastUsedAt ? `last used ${timeAgo(t.lastUsedAt)}` : "not used yet"}`;
  }

  return (
    <section className="cn-settings__card">
      <h2>Podium</h2>
      <p className="cn-settings__row-text">
        <span>
          Podium can upload clips straight into a library. Make a target for each library to upload to, then add a
          Podium-compatible server in Podium with the server URL and the target's token. Clips keep the game Podium
          recorded, their title, when they were recorded and the names of their sound tracks. Podium uploads into any
          library; Clips libraries make the most of what it knows.
        </span>
      </p>
      {data && (
        <div className="cn-integrations__address">
          <TextField label="Server URL" value={data.serverUrl} readOnly onFocus={(e) => e.target.select()} spellCheck={false} className="cn-integrations__address-field" />
          <Button icon={<Copy />} onClick={() => copy(data.serverUrl, "Server URL")}>Copy</Button>
        </div>
      )}
      {data && data.targets.length > 0 && (
        <div className="cn-settings__list">
          {data.targets.map((t) => (
            <div key={t.id} className="cn-settings__item">
              <UploadCloud />
              <div className="cn-settings__item-text">
                <strong>{t.name}</strong>
                <span>{describe(t)}</span>
              </div>
              <IconButton label={`Copy the token for ${t.name}`} icon={<Copy />} onClick={() => copy(t.token, "Token")} />
              <IconButton label={`Remove ${t.name}`} icon={<Trash2 />} onClick={() => setRemoving(t)} />
            </div>
          ))}
        </div>
      )}
      {libraries && libraries.length > 0 && library && (
        <>
          <div className="cn-integrations__address">
            <Select
              label="New target for"
              value={String(library.id)}
              onChange={(e) => setLibraryId(Number(e.target.value))}
              options={libraries.map((l) => ({ value: String(l.id), label: l.name }))}
            />
            <TextField label="Name in Podium" value={name} placeholder={library.name} maxLength={60} onChange={(e) => setName(e.target.value)} className="cn-integrations__key-field" />
            <TextField label="Folder" value={folder} placeholder="The library folder itself" onChange={(e) => setFolder(e.target.value)} className="cn-integrations__key-field" />
            <Button icon={<Plus />} onClick={create} loading={creating}>Make target</Button>
          </div>
          <p className="cn-settings__row-text"><span>Uploads go into this folder inside {library.paths[0] ?? "the library's first folder"}. Cinemion needs write access to it, like for uploads from the browser.</span></p>
          {library.type === "clips" && (
            <Switch label="A folder per game" description="Puts each clip in a folder named after its game, the way recorders do." checked={gameFolders} onChange={setGameFolders} />
          )}
        </>
      )}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.name ?? ""}?`}
        description="Podium can't upload with its token anymore. What it uploaded stays in the library."
        confirmLabel="Remove target"
        danger
        onConfirm={remove}
      />
    </section>
  );
}
