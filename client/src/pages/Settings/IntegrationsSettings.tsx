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
import { rich, t, type TranslationKey } from "../../i18n/I18n.ts";
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
    }).catch((e: Error) => toasts.error(t("admin.integrations.loadFailed"), e.message));
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
    if (await copyText(address)) toasts.success(t("admin.integrations.arr.copied"));
    else toasts.error(t("admin.integrations.copyFailed"), t("admin.integrations.arr.copyByHand"));
  }

  async function newAddress() {
    try {
      const result = await IntegrationsApi.newAddress();
      setSettings(result);
      setConfirmNew(false);
      toasts.success(t("admin.integrations.arr.newAddress.made"), t("admin.integrations.arr.newAddress.madeDescription"));
    } catch (e) {
      toasts.error(t("admin.integrations.arr.newAddress.failed"), (e as Error).message);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const result = await IntegrationsApi.setPathMappings(mappings);
      setSettings(result);
      setMappings(result.pathMappings);
      toasts.success(t("admin.integrations.mappings.saved"));
    } catch (e) {
      toasts.error(t("common.couldntSave"), (e as Error).message);
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
          <h1>{t("admin.integrations.title")}</h1>
          <p>{t("admin.integrations.intro")}</p>
        </div>
        <Button variant="primary" onClick={save} loading={saving} disabled={!changed}>{t("admin.integrations.saveChanges")}</Button>
      </header>

      <section className="cn-settings__card">
        <h2>{t("admin.integrations.arr.title")}</h2>
        <div className="cn-integrations__address">
          <TextField label={t("admin.integrations.arr.address")} value={address} readOnly onFocus={(e) => e.target.select()} spellCheck={false} className="cn-integrations__address-field" />
          <Button icon={<Copy />} onClick={copy}>{t("common.copy")}</Button>
        </div>
        {isLocalhost && (
          <p className="cn-integrations__hint">
            {t("admin.integrations.arr.localhostHint", { host: location.hostname, example: "http://192.168.1.10:8600" })}
          </p>
        )}
        <ol className="cn-integrations__steps">
          <li>{rich("admin.integrations.arr.steps.connect", { strong })}</li>
          <li>{rich("admin.integrations.arr.steps.paste", { strong })}</li>
          <li>{rich("admin.integrations.arr.steps.events", { strong })}</li>
          <li>{rich("admin.integrations.arr.steps.test", { strong })}</li>
        </ol>
        <div className={cx("cn-integrations__status", event?.problem && "cn-integrations__status--problem")} role="status">
          {event ? (event.problem ? <CircleAlert /> : <CircleCheck />) : null}
          <span>
            {event
              ? rich("admin.integrations.arr.lastEvent", {
                event: <strong>{t("admin.integrations.arr.eventName", { app: event.app, eventType: event.eventType })}</strong>,
                ago: timeAgo(event.at),
                result: event.result,
              })
              : t("admin.integrations.arr.nothingReceived")}
          </span>
        </div>
        <div className="cn-settings__divider" />
        <div className="cn-settings__row">
          <p className="cn-settings__row-text">
            <strong>{t("admin.integrations.arr.newAddress.title")}</strong>
            <span>{t("admin.integrations.arr.newAddress.text")}</span>
          </p>
          <Button size="sm" variant="danger" onClick={() => setConfirmNew(true)}>{t("admin.integrations.arr.newAddress.button")}</Button>
        </div>
      </section>

      <section className="cn-settings__card">
        <h2>{t("admin.integrations.mappings.title")}</h2>
        <p className="cn-settings__row-text">
          <span>{rich("admin.integrations.mappings.text", { theirs: <code>/tv</code>, ours: <code>/media/shows</code> })}</span>
        </p>
        {mappings.map((m, i) => (
          <div key={i} className="cn-integrations__mapping">
            <TextField label={t("admin.integrations.mappings.theirFolder")} value={m.from} placeholder="/tv" onChange={(e) => updateMapping(i, { from: e.target.value })} spellCheck={false} />
            <TextField label={t("admin.integrations.mappings.ourFolder")} value={m.to} placeholder="/media/shows" onChange={(e) => updateMapping(i, { to: e.target.value })} spellCheck={false} />
            <IconButton label={t("admin.integrations.mappings.remove")} icon={<Trash2 />} onClick={() => setMappings(mappings.filter((_, j) => j !== i))} />
          </div>
        ))}
        <div>
          <Button size="sm" icon={<Plus />} onClick={() => setMappings([...mappings, { from: "", to: "" }])}>{t("admin.integrations.mappings.add")}</Button>
        </div>
      </section>

      {session.isAdmin() && <AppsCard />}
      <PodiumCard />

      <TraktAppCard />

      <ConfirmDialog
        open={confirmNew}
        onOpenChange={setConfirmNew}
        title={t("admin.integrations.arr.newAddress.confirmTitle")}
        description={t("admin.integrations.arr.newAddress.confirmDescription")}
        confirmLabel={t("admin.integrations.arr.newAddress.button")}
        danger
        onConfirm={newAddress}
      />
    </>
  );
}

function strong(text: string) {
  return <strong>{text}</strong>;
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
      toasts.success(t("admin.integrations.trakt.setUp"), t("admin.integrations.trakt.setUpDescription"));
    } catch (error) {
      toasts.error(t("common.couldntSave"), (error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const changed = !!settings && (clientId !== (settings.clientId ?? "") || !!clientSecret);
  return (
    <section className="cn-settings__card">
      <h2>{t("admin.integrations.trakt.title")}</h2>
      <p className="cn-settings__row-text">
        <span>
          {rich("admin.integrations.trakt.text", {
            link: <a href="https://trakt.tv/oauth/applications/new" target="_blank" rel="noreferrer">trakt.tv/oauth/applications</a>,
            redirect: <code>urn:ietf:wg:oauth:2.0:oob</code>,
          })}
        </span>
      </p>
      <div className="cn-integrations__trakt">
        <TextField label={t("admin.integrations.trakt.clientId")} value={clientId} autoComplete="off" spellCheck={false} onChange={(e) => setClientId(e.target.value)} />
        <TextField
          label={t("admin.integrations.trakt.clientSecret")}
          type="password"
          value={clientSecret}
          autoComplete="new-password"
          placeholder={settings?.hasSecret ? t("admin.integrations.trakt.secretSaved") : ""}
          onChange={(e) => setClientSecret(e.target.value)}
        />
      </div>
      <div>
        <Button variant="primary" size="sm" onClick={save} loading={saving} disabled={!changed}>{t("admin.integrations.trakt.save")}</Button>
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

  async function copy(text: string, copied: TranslationKey) {
    if (await copyText(text)) toasts.success(t(copied));
    else toasts.error(t("admin.integrations.copyFailed"), t("admin.integrations.copyItByHand"));
  }

  async function create() {
    setCreating(true);
    try {
      const key = await IntegrationsApi.createAppKey(app);
      setKeys([...keys ?? [], key]);
      setApp("");
      await copy(key.token, "admin.integrations.apps.keyCopied");
    } catch (error) {
      toasts.error(t("admin.integrations.apps.makeFailed"), (error as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function remove() {
    if (!removing) return;
    try {
      setKeys(await IntegrationsApi.removeAppKey(removing.id));
      setRemoving(null);
      toasts.success(t("admin.integrations.apps.removed"), t("admin.integrations.apps.removedDescription", { app: removing.app }));
    } catch (error) {
      toasts.error(t("admin.integrations.apps.removeFailed"), (error as Error).message);
    }
  }

  return (
    <section className="cn-settings__card">
      <h2>{t("admin.integrations.apps.title")}</h2>
      <p className="cn-settings__row-text">
        <span>{t("admin.integrations.apps.text")}</span>
      </p>
      <div className="cn-integrations__address">
        <TextField label={t("admin.integrations.apps.serverAddress")} value={location.origin} readOnly onFocus={(e) => e.target.select()} spellCheck={false} className="cn-integrations__address-field" />
        <Button icon={<Copy />} onClick={() => copy(location.origin, "admin.integrations.apps.addressCopied")}>{t("common.copy")}</Button>
      </div>
      {keys && keys.length > 0 && (
        <div className="cn-settings__list">
          {keys.map((k) => (
            <div key={k.id} className="cn-settings__item">
              <KeyRound />
              <div className="cn-settings__item-text">
                <strong>{k.app}</strong>
                <span>{k.createdBy ? t("admin.integrations.apps.madeBy", { name: k.createdBy, ago: timeAgo(k.createdAt) }) : t("admin.integrations.apps.madeByRemoved", { ago: timeAgo(k.createdAt) })}</span>
              </div>
              <IconButton label={t("admin.integrations.apps.copyKey", { app: k.app })} icon={<Copy />} onClick={() => copy(k.token, "admin.integrations.apps.keyCopied")} />
              <IconButton label={t("admin.integrations.apps.removeKey", { app: k.app })} icon={<Trash2 />} onClick={() => setRemoving(k)} />
            </div>
          ))}
        </div>
      )}
      <div className="cn-integrations__address">
        <TextField label={t("admin.integrations.apps.newKeyFor")} value={app} placeholder="Homepage" maxLength={60} onChange={(e) => setApp(e.target.value)} className="cn-integrations__key-field" />
        <Button icon={<Plus />} onClick={create} loading={creating} disabled={!app.trim()}>{t("admin.integrations.apps.makeKey")}</Button>
      </div>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t("admin.integrations.apps.confirmTitle", { app: removing?.app ?? "" })}
        description={t("admin.integrations.apps.confirmDescription")}
        confirmLabel={t("admin.integrations.apps.confirm")}
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

  async function copy(text: string, copied: TranslationKey) {
    if (await copyText(text)) toasts.success(t(copied));
    else toasts.error(t("admin.integrations.copyFailed"), t("admin.integrations.copyItByHand"));
  }

  async function create() {
    if (!library) return;
    setCreating(true);
    try {
      const before = new Set(data?.targets.map((target) => target.id));
      const result = await IntegrationsApi.createPodiumTarget({ name, libraryId: library.id, folder, gameFolders });
      setData(result);
      setName("");
      const made = result.targets.find((target) => !before.has(target.id));
      if (made) await copy(made.token, "admin.integrations.podium.tokenCopied");
    } catch (error) {
      toasts.error(t("admin.integrations.podium.makeFailed"), (error as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function remove() {
    if (!removing) return;
    try {
      setData(await IntegrationsApi.removePodiumTarget(removing.id));
      setRemoving(null);
      toasts.success(t("admin.integrations.podium.removed"), t("admin.integrations.podium.removedDescription"));
    } catch (error) {
      toasts.error(t("admin.integrations.podium.removeFailed"), (error as Error).message);
    }
  }

  function describe(target: PodiumTargetInfo) {
    if (!target.libraryName) return t("admin.integrations.podium.libraryRemoved");
    if (!target.createdBy) return t("admin.integrations.podium.creatorRemoved");
    const where = [target.libraryName, target.folder].filter(Boolean).join(" › ");
    const games = target.gameFolders && libraries?.find((l) => l.id === target.libraryId)?.type === "clips";
    if (target.lastUsedAt) return t(games ? "admin.integrations.podium.intoGames" : "admin.integrations.podium.into", { where, ago: timeAgo(target.lastUsedAt) });
    return t(games ? "admin.integrations.podium.intoGamesNotUsed" : "admin.integrations.podium.intoNotUsed", { where });
  }

  return (
    <section className="cn-settings__card">
      <h2>{t("admin.integrations.podium.title")}</h2>
      <p className="cn-settings__row-text">
        <span>{t("admin.integrations.podium.text")}</span>
      </p>
      {data && (
        <div className="cn-integrations__address">
          <TextField label={t("admin.integrations.podium.serverUrl")} value={data.serverUrl} readOnly onFocus={(e) => e.target.select()} spellCheck={false} className="cn-integrations__address-field" />
          <Button icon={<Copy />} onClick={() => copy(data.serverUrl, "admin.integrations.podium.serverUrlCopied")}>{t("common.copy")}</Button>
        </div>
      )}
      {data && data.targets.length > 0 && (
        <div className="cn-settings__list">
          {data.targets.map((target) => (
            <div key={target.id} className="cn-settings__item">
              <UploadCloud />
              <div className="cn-settings__item-text">
                <strong>{target.name}</strong>
                <span>{describe(target)}</span>
              </div>
              <IconButton label={t("admin.integrations.podium.copyToken", { name: target.name })} icon={<Copy />} onClick={() => copy(target.token, "admin.integrations.podium.tokenCopied")} />
              <IconButton label={t("admin.integrations.podium.remove", { name: target.name })} icon={<Trash2 />} onClick={() => setRemoving(target)} />
            </div>
          ))}
        </div>
      )}
      {libraries && libraries.length > 0 && library && (
        <>
          <div className="cn-integrations__address">
            <Select
              label={t("admin.integrations.podium.newTargetFor")}
              value={String(library.id)}
              onChange={(e) => setLibraryId(Number(e.target.value))}
              options={libraries.map((l) => ({ value: String(l.id), label: l.name }))}
            />
            <TextField label={t("admin.integrations.podium.nameInPodium")} value={name} placeholder={library.name} maxLength={60} onChange={(e) => setName(e.target.value)} className="cn-integrations__key-field" />
            <TextField label={t("admin.integrations.podium.folder")} value={folder} placeholder={t("admin.integrations.podium.folderPlaceholder")} onChange={(e) => setFolder(e.target.value)} className="cn-integrations__key-field" />
            <Button icon={<Plus />} onClick={create} loading={creating}>{t("admin.integrations.podium.makeTarget")}</Button>
          </div>
          <p className="cn-settings__row-text"><span>{library.paths[0] ? t("admin.integrations.podium.uploadsInto", { path: library.paths[0] }) : t("admin.integrations.podium.uploadsIntoFirst")}</span></p>
          {library.type === "clips" && (
            <Switch label={t("admin.integrations.podium.gameFolders")} description={t("admin.integrations.podium.gameFoldersDescription")} checked={gameFolders} onChange={setGameFolders} />
          )}
        </>
      )}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t("admin.integrations.podium.confirmTitle", { name: removing?.name ?? "" })}
        description={t("admin.integrations.podium.confirmDescription")}
        confirmLabel={t("admin.integrations.podium.confirm")}
        danger
        onConfirm={remove}
      />
    </section>
  );
}
