import { useCallback, useEffect, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { Copy, EllipsisVertical, Pencil, Plus, Power, RefreshCw, Send, Trash2, Webhook as WebhookIcon } from "lucide-react";
import { WEBHOOK_EVENTS, type WebhookDelivery, type WebhookEvent, type WebhookInfo } from "@shared/admin.ts";
import WebhooksApi from "../../Api/WebhooksApi.ts";
import { toasts } from "../../lib/Toasts.ts";
import { copyText } from "../../lib/clipboard.ts";
import { timeAgo, timeUntil } from "../../lib/format.ts";
import cx from "../../lib/cx.ts";
import Button from "../../components/Button/Button.tsx";
import TextField from "../../components/TextField/TextField.tsx";
import Switch from "../../components/Switch/Switch.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import Dialog, { ConfirmDialog } from "../../components/Dialog/Dialog.tsx";
import "./Admin.scss";

const ALL_EVENTS = Object.keys(WEBHOOK_EVENTS) as WebhookEvent[];

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
      if (result.lastDelivery?.ok) toasts.success("The test arrived", `${hook.name} answered ${result.lastDelivery.status}.`);
      else toasts.error("The test didn't arrive", result.lastDelivery?.error ?? undefined);
    } catch (e) {
      toasts.error("Couldn't send the test", (e as Error).message);
    } finally {
      setTesting(null);
    }
  }

  async function toggle(hook: WebhookInfo) {
    try {
      replace(await WebhooksApi.update(hook.id, { enabled: !hook.enabled }));
    } catch (e) {
      toasts.error("Couldn't change the webhook", (e as Error).message);
    }
  }

  async function remove() {
    if (!removing) return;
    try {
      await WebhooksApi.remove(removing.id);
      toasts.success(`${removing.name} was removed`);
      setRemoving(null);
      reload();
    } catch (e) {
      toasts.error("Couldn't remove the webhook", (e as Error).message);
    }
  }

  return (
    <>
      <header className="cn-settings__header">
        <div>
          <h1>Webhooks</h1>
          <p>Send events like "playback started" to other apps, such as Home Assistant or a chat bot.</p>
        </div>
        <Button variant="primary" icon={<Plus />} onClick={() => setEditing("new")}>Add webhook</Button>
      </header>

      {!hooks && <Spinner size="2rem" />}
      {hooks?.length === 0 && (
        <section className="cn-settings__card">
          <p className="cn-settings__row-text">
            <strong>No webhooks yet</strong>
            <span>A webhook is an address Cinemion sends a short JSON message to whenever something you pick happens. Dim the lights when a movie starts, or post new episodes to a chat.</span>
          </p>
        </section>
      )}
      {hooks && hooks.length > 0 && (
        <div className="cn-settings__list">
          {hooks.map((h) => (
            <div key={h.id} className={cx("cn-settings__item", "cn-webhooks__item", !h.enabled && "cn-webhooks__item--off")}>
              <WebhookIcon />
              <div className="cn-settings__item-text">
                <strong>{h.name}{!h.enabled && <span className="cn-settings__badge cn-webhooks__off">Off</span>}</strong>
                <span>{h.url}</span>
                <span>{h.events.length === ALL_EVENTS.length ? "Every event" : h.events.map((e) => WEBHOOK_EVENTS[e]).join(", ")}</span>
                <DeliveryStatus delivery={h.lastDelivery} />
              </div>
              <Button size="sm" icon={<Send />} onClick={() => test(h)} loading={testing === h.id}>Send test</Button>
              <Menu.Root>
                <Menu.Trigger className="cn-icon-button cn-icon-button--glass cn-icon-button--md" aria-label={`More for ${h.name}`}><EllipsisVertical /></Menu.Trigger>
                <Menu.Portal>
                  <Menu.Positioner sideOffset={6} align="end" className="cn-menu__positioner">
                    <Menu.Popup className="cn-menu">
                      <Menu.Item className="cn-menu__item" onClick={() => setEditing(h)}><Pencil /> Edit</Menu.Item>
                      <Menu.Item className="cn-menu__item" onClick={() => toggle(h)}><Power /> {h.enabled ? "Turn off" : "Turn on"}</Menu.Item>
                      <Menu.Separator className="cn-menu__separator" />
                      <Menu.Item className="cn-menu__item" onClick={() => setRemoving(h)}><Trash2 /> Remove</Menu.Item>
                    </Menu.Popup>
                  </Menu.Positioner>
                </Menu.Portal>
              </Menu.Root>
            </div>
          ))}
        </div>
      )}

      <section className="cn-settings__card">
        <h2>For developers</h2>
        <p className="cn-settings__row-text">
          <span>
            Each event is a <code>POST</code> with a JSON body: <code>{"{ event, id, sentAt, server, data }"}</code>. The{" "}
            <code>X-Cinemion-Signature</code> header is <code>sha256=</code> followed by the HMAC-SHA256 of the raw body,
            keyed with the webhook's secret, so the receiver can check it came from this server. Failed sends are tried
            again after 10 seconds, 1 minute and 5 minutes.
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
        title={`Remove ${removing?.name}?`}
        description="Cinemion stops sending events to this address."
        confirmLabel="Remove webhook"
        danger
        onConfirm={remove}
      />
    </>
  );
}

function DeliveryStatus(props: { delivery: WebhookDelivery | null }) {
  const { delivery } = props;
  if (!delivery) return <span>Nothing sent yet</span>;
  const event = delivery.event === "test" ? "Test" : WEBHOOK_EVENTS[delivery.event];
  if (delivery.ok) return <span className="cn-webhooks__status cn-webhooks__status--ok">{event} delivered {timeAgo(delivery.at)} · {delivery.status}</span>;
  return (
    <span className="cn-webhooks__status cn-webhooks__status--failed">
      {event} failed {timeAgo(delivery.at)}: {delivery.error}{delivery.retryAt && ` Trying again ${timeUntil(delivery.retryAt)}.`}
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
      toasts.success(hook ? "Webhook saved" : "Webhook added", hook ? undefined : "Use Send test to check that it arrives.");
      onSaved(saved);
    } catch (e) {
      toasts.error("Couldn't save the webhook", (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function newSecret() {
    if (!hook) return;
    try {
      const updated = await WebhooksApi.newSecret(hook.id);
      setSecret(updated.secret);
      toasts.success("New secret made", "Update it in the receiving app too.");
    } catch (e) {
      toasts.error("Couldn't make a new secret", (e as Error).message);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={hook ? `Edit ${hook.name}` : "Add webhook"}
      size="lg"
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="primary" onClick={save} loading={saving} disabled={!url.trim() || events.length === 0}>{hook ? "Save" : "Add webhook"}</Button>
      </>}
    >
      <div className="cn-playback__fields">
        <TextField label="Name" description="Optional. Defaults to the address's host." value={name} onChange={(e) => setName(e.target.value)} placeholder="Home Assistant" />
        <TextField label="Address" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://homeassistant.local:8123/api/webhook/…" spellCheck={false} />
      </div>
      <div className="cn-webhooks__events">
        <div className="cn-webhooks__events-head">
          <span className="cn-field__label">Events</span>
          <button type="button" className="cn-webhooks__all" onClick={() => setEvents(events.length === ALL_EVENTS.length ? [] : ALL_EVENTS)}>
            {events.length === ALL_EVENTS.length ? "Clear all" : "Pick all"}
          </button>
        </div>
        <div className="cn-playback__chips">
          {ALL_EVENTS.map((e) => {
            const on = events.includes(e);
            return (
              <button key={e} type="button" aria-pressed={on} className={cx("cn-playback__chip", on && "cn-playback__chip--on")} onClick={() => toggleEvent(e)}>
                {WEBHOOK_EVENTS[e]}
              </button>
            );
          })}
        </div>
      </div>
      <Switch label="On" description="Turned off, nothing is sent." checked={enabled} onChange={setEnabled} />
      {secret
        ? (
          <div className="cn-integrations__address">
            <TextField label="Secret" description="For checking the X-Cinemion-Signature header." value={secret} readOnly onFocus={(e) => e.target.select()} spellCheck={false} className="cn-integrations__address-field" />
            <Button icon={<Copy />} onClick={async () => (await copyText(secret)) ? toasts.success("Secret copied") : toasts.error("Couldn't copy", "Select it and copy it by hand.")}>Copy</Button>
            <Button icon={<RefreshCw />} onClick={newSecret}>New</Button>
          </div>
        )
        : <p className="cn-settings__row-text"><span>A secret for checking signatures is made when you add the webhook.</span></p>}
    </Dialog>
  );
}

/**
 * The webhook list, refreshed every few seconds so retries and their results show up.
 */
function useWebhooks() {
  const [hooks, setHooks] = useState<WebhookInfo[] | null>(null);

  const reload = useCallback(() => {
    WebhooksApi.list().then(setHooks).catch((e: Error) => toasts.error("Couldn't load webhooks", e.message));
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
