import { useCallback, useEffect, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { Copy, EllipsisVertical, Pencil, Plus, Power, RefreshCw, Send, Trash2, Webhook as WebhookIcon } from "lucide-react";
import { WEBHOOK_EVENTS, type WebhookDelivery, type WebhookEvent, type WebhookInfo } from "@shared/admin.ts";
import WebhooksApi from "../../Api/WebhooksApi.ts";
import { toasts } from "../../lib/Toasts.ts";
import { copyText } from "../../lib/clipboard.ts";
import { timeAgo, timeUntil } from "../../lib/format.ts";
import cx from "../../lib/cx.ts";
import { rich, t, type TranslationKey } from "../../i18n/I18n.ts";
import Button from "../../components/Button/Button.tsx";
import TextField from "../../components/TextField/TextField.tsx";
import Switch from "../../components/Switch/Switch.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import Dialog, { ConfirmDialog } from "../../components/Dialog/Dialog.tsx";
import "./Admin.scss";

const ALL_EVENTS = Object.keys(WEBHOOK_EVENTS) as WebhookEvent[];

const EVENT_LABELS: Record<WebhookEvent, TranslationKey> = {
  "playback.started": "admin.webhooks.events.playbackStarted",
  "playback.paused": "admin.webhooks.events.playbackPaused",
  "playback.resumed": "admin.webhooks.events.playbackResumed",
  "playback.stopped": "admin.webhooks.events.playbackStopped",
  "item.watched": "admin.webhooks.events.itemWatched",
  "item.added": "admin.webhooks.events.itemAdded",
  "library.scanned": "admin.webhooks.events.libraryScanned",
  "user.signedIn": "admin.webhooks.events.userSignedIn",
  "together.started": "admin.webhooks.events.togetherStarted",
  "subtitles.downloaded": "admin.webhooks.events.subtitlesDownloaded",
};

/**
 * Outgoing webhooks: addresses that get signed JSON when things happen, for home automation and chat bots.
 */
export default function WebhooksSettings() {
  const { hooks, reload, replace } = useWebhooks();
  const [editing, setEditing] = useState<WebhookInfo | "new" | null>(null);
  const [removing, setRemoving] = useState<WebhookInfo | null>(null);
  const [testing, setTesting] = useState<number | null>(null);

  async function test(hook: WebhookInfo) {
    setTesting(hook.id);
    try {
      const result = await WebhooksApi.test(hook.id);
      replace(result);
      if (result.lastDelivery?.ok) toasts.success(t("admin.webhooks.testArrived"), t("admin.webhooks.testAnswered", { name: hook.name, status: String(result.lastDelivery.status) }));
      else toasts.error(t("admin.webhooks.testFailed"), result.lastDelivery?.error ?? undefined);
    } catch (e) {
      toasts.error(t("admin.webhooks.testSendFailed"), (e as Error).message);
    } finally {
      setTesting(null);
    }
  }

  async function toggle(hook: WebhookInfo) {
    try {
      replace(await WebhooksApi.update(hook.id, { enabled: !hook.enabled }));
    } catch (e) {
      toasts.error(t("admin.webhooks.toggleFailed"), (e as Error).message);
    }
  }

  async function remove() {
    if (!removing) return;
    try {
      await WebhooksApi.remove(removing.id);
      toasts.success(t("admin.webhooks.removed", { name: removing.name }));
      setRemoving(null);
      reload();
    } catch (e) {
      toasts.error(t("admin.webhooks.removeFailed"), (e as Error).message);
    }
  }

  return (
    <>
      <header className="cn-settings__header">
        <div>
          <h1>{t("admin.webhooks.title")}</h1>
          <p>{t("admin.webhooks.intro")}</p>
        </div>
        <Button variant="primary" icon={<Plus />} onClick={() => setEditing("new")}>{t("admin.webhooks.add")}</Button>
      </header>

      {!hooks && <Spinner size="2rem" />}
      {hooks?.length === 0 && (
        <section className="cn-settings__card">
          <p className="cn-settings__row-text">
            <strong>{t("admin.webhooks.empty.title")}</strong>
            <span>{t("admin.webhooks.empty.text")}</span>
          </p>
        </section>
      )}
      {hooks && hooks.length > 0 && (
        <div className="cn-settings__list">
          {hooks.map((h) => (
            <div key={h.id} className={cx("cn-settings__item", "cn-webhooks__item", !h.enabled && "cn-webhooks__item--off")}>
              <WebhookIcon />
              <div className="cn-settings__item-text">
                <strong>{h.name}{!h.enabled && <span className="cn-settings__badge cn-webhooks__off">{t("common.off")}</span>}</strong>
                <span>{h.url}</span>
                <span>{h.events.length === ALL_EVENTS.length ? t("admin.webhooks.everyEvent") : h.events.map((e) => t(EVENT_LABELS[e])).join(t("common.listSeparator"))}</span>
                <DeliveryStatus delivery={h.lastDelivery} />
              </div>
              <Button size="sm" icon={<Send />} onClick={() => test(h)} loading={testing === h.id}>{t("admin.webhooks.sendTest")}</Button>
              <Menu.Root>
                <Menu.Trigger className="cn-icon-button cn-icon-button--glass cn-icon-button--md" aria-label={t("admin.webhooks.more", { name: h.name })}><EllipsisVertical /></Menu.Trigger>
                <Menu.Portal>
                  <Menu.Positioner sideOffset={6} align="end" className="cn-menu__positioner">
                    <Menu.Popup className="cn-menu">
                      <Menu.Item className="cn-menu__item" onClick={() => setEditing(h)}><Pencil /> {t("common.edit")}</Menu.Item>
                      <Menu.Item className="cn-menu__item" onClick={() => toggle(h)}><Power /> {h.enabled ? t("admin.webhooks.turnOff") : t("admin.webhooks.turnOn")}</Menu.Item>
                      <Menu.Separator className="cn-menu__separator" />
                      <Menu.Item className="cn-menu__item" onClick={() => setRemoving(h)}><Trash2 /> {t("common.remove")}</Menu.Item>
                    </Menu.Popup>
                  </Menu.Positioner>
                </Menu.Portal>
              </Menu.Root>
            </div>
          ))}
        </div>
      )}

      <section className="cn-settings__card">
        <h2>{t("admin.webhooks.developers.title")}</h2>
        <p className="cn-settings__row-text">
          <span>
            {rich("admin.webhooks.developers.text", {
              method: <code>POST</code>,
              body: <code>{"{ event, id, sentAt, server, data }"}</code>,
              header: <code>X-Cinemion-Signature</code>,
              prefix: <code>sha256=</code>,
            })}
          </span>
        </p>
      </section>

      <WebhookDialog
        hook={editing === "new" ? null : editing}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        onSaved={(hook) => {
          replace(hook);
          setEditing(null);
        }}
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t("admin.webhooks.remove.title", { name: removing?.name ?? "" })}
        description={t("admin.webhooks.remove.description")}
        confirmLabel={t("admin.webhooks.remove.confirm")}
        danger
        onConfirm={remove}
      />
    </>
  );
}

function DeliveryStatus(props: { delivery: WebhookDelivery | null }) {
  const { delivery } = props;
  if (!delivery) return <span>{t("admin.webhooks.delivery.nothingSent")}</span>;
  const event = t(delivery.event === "test" ? "admin.webhooks.delivery.test" : EVENT_LABELS[delivery.event]);
  const ago = timeAgo(delivery.at);
  if (delivery.ok) return <span className="cn-webhooks__status cn-webhooks__status--ok">{t("admin.webhooks.delivery.delivered", { event, ago, status: String(delivery.status) })}</span>;
  const error = delivery.error ?? "";
  return (
    <span className="cn-webhooks__status cn-webhooks__status--failed">
      {delivery.retryAt ? t("admin.webhooks.delivery.failedRetry", { event, ago, error, retry: timeUntil(delivery.retryAt) }) : t("admin.webhooks.delivery.failed", { event, ago, error })}
    </span>
  );
}

function WebhookDialog(props: { hook: WebhookInfo | null; open: boolean; onOpenChange: (open: boolean) => void; onSaved: (hook: WebhookInfo) => void }) {
  const { hook, open, onOpenChange, onSaved } = props;
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [secret, setSecret] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(hook?.name ?? "");
    setUrl(hook?.url ?? "");
    setEvents(hook?.events ?? ["playback.started", "playback.stopped"]);
    setEnabled(hook?.enabled ?? true);
    setSecret(hook?.secret ?? null);
  }, [open, hook]);

  function toggleEvent(event: WebhookEvent) {
    setEvents(events.includes(event) ? events.filter((e) => e !== event) : [...events, event]);
  }

  async function save() {
    setSaving(true);
    try {
      const data = { name, url, events, enabled };
      const saved = hook ? await WebhooksApi.update(hook.id, data) : await WebhooksApi.create(data);
      toasts.success(hook ? t("admin.webhooks.dialog.saved") : t("admin.webhooks.dialog.added"), hook ? undefined : t("admin.webhooks.dialog.addedDescription"));
      onSaved(saved);
    } catch (e) {
      toasts.error(t("admin.webhooks.dialog.saveFailed"), (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function newSecret() {
    if (!hook) return;
    try {
      const updated = await WebhooksApi.newSecret(hook.id);
      setSecret(updated.secret);
      toasts.success(t("admin.webhooks.dialog.newSecretMade"), t("admin.webhooks.dialog.newSecretDescription"));
    } catch (e) {
      toasts.error(t("admin.webhooks.dialog.newSecretFailed"), (e as Error).message);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={hook ? t("admin.webhooks.dialog.editTitle", { name: hook.name }) : t("admin.webhooks.dialog.addTitle")}
      size="lg"
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
        <Button variant="primary" onClick={save} loading={saving} disabled={!url.trim() || events.length === 0}>{hook ? t("common.save") : t("admin.webhooks.dialog.add")}</Button>
      </>}
    >
      <div className="cn-playback__fields">
        <TextField label={t("admin.webhooks.dialog.name")} description={t("admin.webhooks.dialog.nameDescription")} value={name} onChange={(e) => setName(e.target.value)} placeholder="Home Assistant" />
        <TextField label={t("admin.webhooks.dialog.address")} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://homeassistant.local:8123/api/webhook/…" spellCheck={false} />
      </div>
      <div className="cn-webhooks__events">
        <div className="cn-webhooks__events-head">
          <span className="cn-field__label">{t("admin.webhooks.dialog.events")}</span>
          <button type="button" className="cn-webhooks__all" onClick={() => setEvents(events.length === ALL_EVENTS.length ? [] : ALL_EVENTS)}>
            {events.length === ALL_EVENTS.length ? t("admin.webhooks.dialog.clearAll") : t("admin.webhooks.dialog.pickAll")}
          </button>
        </div>
        <div className="cn-playback__chips">
          {ALL_EVENTS.map((e) => {
            const on = events.includes(e);
            return (
              <button key={e} type="button" aria-pressed={on} className={cx("cn-playback__chip", on && "cn-playback__chip--on")} onClick={() => toggleEvent(e)}>
                {t(EVENT_LABELS[e])}
              </button>
            );
          })}
        </div>
      </div>
      <Switch label={t("admin.webhooks.dialog.enabled")} description={t("admin.webhooks.dialog.enabledDescription")} checked={enabled} onChange={setEnabled} />
      {secret
        ? (
          <div className="cn-integrations__address">
            <TextField label={t("admin.webhooks.dialog.secret")} description={t("admin.webhooks.dialog.secretDescription", { header: "X-Cinemion-Signature" })} value={secret} readOnly onFocus={(e) => e.target.select()} spellCheck={false} className="cn-integrations__address-field" />
            <Button icon={<Copy />} onClick={async () => (await copyText(secret)) ? toasts.success(t("admin.webhooks.dialog.secretCopied")) : toasts.error(t("admin.webhooks.dialog.copyFailed"), t("admin.webhooks.dialog.copyByHand"))}>{t("common.copy")}</Button>
            <Button icon={<RefreshCw />} onClick={newSecret}>{t("admin.webhooks.dialog.newSecret")}</Button>
          </div>
        )
        : <p className="cn-settings__row-text"><span>{t("admin.webhooks.dialog.secretLater")}</span></p>}
    </Dialog>
  );
}

/**
 * The webhook list, refreshed every few seconds so retries and their results show up.
 */
function useWebhooks() {
  const [hooks, setHooks] = useState<WebhookInfo[] | null>(null);

  const reload = useCallback(() => {
    WebhooksApi.list().then(setHooks).catch((e: Error) => toasts.error(t("admin.webhooks.loadFailed"), e.message));
  }, []);

  useEffect(() => {
    reload();
    const timer = setInterval(() => document.visibilityState === "visible" && reload(), 5000);
    return () => clearInterval(timer);
  }, [reload]);

  const replace = useCallback((hook: WebhookInfo) => {
    setHooks((current) => current?.some((h) => h.id === hook.id) ? current.map((h) => h.id === hook.id ? hook : h) : [...current ?? [], hook]);
  }, []);

  return { hooks, reload, replace };
}
