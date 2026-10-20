import { encodeHex } from "@std/encoding/hex";
import type { WebhookDelivery, WebhookEvent } from "@shared/admin.ts";
import AppSystem from "../AppSystem.ts";
import { Setting, Webhook } from "../models/index.ts";
import { errorMessage } from "../lib/http.ts";
import log from "../lib/Logger.ts";

/**
 * Sends events to the webhooks set up in Settings › Webhooks, as signed JSON, retrying failed sends with backoff.
 */
export namespace Webhooks {
  /**
   * Waits before the second, third and fourth try.
   */
  export const RETRY_DELAYS = [10_000, 60_000, 5 * 60_000];
  const TIMEOUT_MS = 10_000;

  export interface Result {
    ok: boolean;
    status: number | null;
    error: string | null;
    /**
     * Whether trying again could help: network errors, timeouts, 429 and 5xx answers.
     */
    retryable: boolean;
  }

  /**
   * HMAC-SHA256 of `body` with `secret`, as `sha256=<hex>`. Receivers compute the same over the raw body to check it.
   */
  export async function sign(secret: string, body: string) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    return `sha256=${encodeHex(new Uint8Array(signature))}`;
  }

  /**
   * The JSON a webhook receives.
   */
  export async function payload(event: WebhookEvent | "test", data: unknown, deliveryId: string) {
    return JSON.stringify({
      event,
      id: deliveryId,
      sentAt: new Date().toISOString(),
      server: { name: await Setting.get(Setting.Keys.SERVER_NAME, AppSystem.APP_NAME), version: AppSystem.VERSION },
      data,
    });
  }

  /**
   * Send once, without retrying.
   */
  export async function attempt(hook: Webhook, event: WebhookEvent | "test", body: string, deliveryId: string): Promise<Result> {
    try {
      const response = await fetch(hook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": `${AppSystem.APP_NAME}/${AppSystem.VERSION}`,
          "X-Cinemion-Event": event,
          "X-Cinemion-Delivery": deliveryId,
          "X-Cinemion-Signature": await sign(hook.secret, body),
        },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      await response.body?.cancel();
      if (response.ok) return { ok: true, status: response.status, error: null, retryable: false };
      return { ok: false, status: response.status, error: `The receiver answered ${response.status} ${response.statusText}`.trim() + ".", retryable: response.status === 429 || response.status === 408 || response.status >= 500 };
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === "TimeoutError";
      return { ok: false, status: null, error: timedOut ? "The receiver didn't answer within 10 seconds." : connectionError(hook.url, error), retryable: true };
    }
  }

  /**
   * A readable reason for a failed connection. fetch only says "fetch failed"; the cause has the details.
   */
  function connectionError(url: string, error: unknown) {
    const host = new URL(url).host;
    // Example cause: error sending request for url (...): client error (Connect): tcp connect error: Connection refused (os error 111)
    const detail = (error as { cause?: Error })?.cause?.message ?? errorMessage(error);
    if (/connection refused/i.test(detail)) return `Nothing answered at ${host}. Check the address, and that the receiving app is running.`;
    if (/dns error|lookup address/i.test(detail)) return `${new URL(url).hostname} couldn't be found. Check the address.`;
    if (/certificate|tls|ssl/i.test(detail)) return `The secure connection to ${host} failed: its certificate isn't trusted.`;
    return `Couldn't connect to ${host}: ${detail.split(": ").pop()}`;
  }

  async function saveDelivery(hookId: number, delivery: WebhookDelivery) {
    // Read again: the webhook may have been edited or removed while this was sending
    const hook = await Webhook.findByPk(hookId);
    if (hook) await hook.update({ lastDelivery: delivery }).catch(() => { });
  }

  async function deliver(hook: Webhook, event: WebhookEvent, data: unknown) {
    const deliveryId = crypto.randomUUID();
    const body = await payload(event, data, deliveryId);
    for (let i = 0; ; i++) {
      const result = await attempt(hook, event, body, deliveryId);
      const delay = !result.ok && result.retryable ? RETRY_DELAYS[i] : undefined;
      await saveDelivery(hook.id, {
        event,
        at: new Date().toISOString(),
        ok: result.ok,
        status: result.status,
        error: result.error,
        retryAt: delay !== undefined ? new Date(Date.now() + delay).toISOString() : null,
      });
      if (result.ok) return;
      if (delay === undefined) {
        log.warn(`Webhook "${hook.name}" couldn't deliver ${event}`, { url: hook.url, error: result.error });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      // Don't keep retrying for a webhook that was turned off or removed in the meantime
      const current = await Webhook.findByPk(hook.id);
      if (!current?.enabled) return;
      hook = current;
    }
  }

  /**
   * Send `event` to every enabled webhook that wants it. Returns at once; sends and retries happen in the background.
   */
  export async function send(event: WebhookEvent, data: unknown) {
    const hooks = (await Webhook.findAll({ where: { enabled: true } })).filter((h) => h.events.includes(event));
    for (const hook of hooks) deliver(hook, event, data).catch((error) => log.warn(`Webhook "${hook.name}" failed`, { error }));
  }

  /**
   * Send a `test` event now and say how it went.
   */
  export async function test(hook: Webhook): Promise<WebhookDelivery> {
    const deliveryId = crypto.randomUUID();
    const body = await payload("test", { message: `This is a test from ${AppSystem.APP_NAME}. It worked!` }, deliveryId);
    const result = await attempt(hook, "test", body, deliveryId);
    const delivery: WebhookDelivery = { event: "test", at: new Date().toISOString(), ok: result.ok, status: result.status, error: result.error, retryAt: null };
    await saveDelivery(hook.id, delivery);
    return delivery;
  }
}

export default Webhooks;
