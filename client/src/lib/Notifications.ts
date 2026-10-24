import type { NotificationInfo } from "@shared/notifications.ts";
import NotificationsApi from "../Api/NotificationsApi.ts";
import Controller from "./Controller.ts";
import useController from "./useController.ts";

/**
 * The signed-in profile's notifications, for the bell in the top bar. Asks the server every minute while the page is
 * visible, and again when it comes back into view.
 */
export class NotificationsController extends Controller {
  public items: NotificationInfo[] = [];
  public unread = 0;
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _started = false;

  /**
   * Start asking. Called once a profile is signed in; `stop()` on signing out.
   */
  public start() {
    if (this._started) return;
    this._started = true;
    this.load();
    this._timer = setInterval(() => {
      if (document.visibilityState === "visible") this.load();
    }, 60_000);
    document.addEventListener("visibilitychange", this._onVisible);
  }

  public stop() {
    this._started = false;
    if (this._timer !== null) clearInterval(this._timer);
    this._timer = null;
    document.removeEventListener("visibilitychange", this._onVisible);
    this.items = [];
    this.unread = 0;
    this.notify();
  }

  private _onVisible = () => {
    if (document.visibilityState === "visible") this.load();
  };

  public async load() {
    try {
      const list = await NotificationsApi.list();
      this.items = list.items;
      this.unread = list.unread;
      this.notify();
    } catch {
      // The bell just keeps what it had
    }
  }

  public async markRead(ids?: number[]) {
    const list = await NotificationsApi.markRead(ids);
    this.items = list.items;
    this.unread = list.unread;
    this.notify();
  }
}

export const notifications = new NotificationsController();

export function useNotifications() {
  return useController(notifications);
}

/**
 * Push notifications on this browser: they need https (or localhost), a service worker and the Push API. iPhones and
 * iPads only have them for Cinemion added to the home screen.
 */
export namespace Push {
  export function isSupported() {
    return isSecureContext && "serviceWorker" in navigator && "PushManager" in globalThis && "Notification" in globalThis;
  }

  async function registration() {
    if (!isSupported()) return null;
    // The service worker only runs in built apps; without one there's nothing to receive pushes
    const found = await navigator.serviceWorker.getRegistration();
    return found ? await navigator.serviceWorker.ready : null;
  }

  /**
   * This browser's push subscription, when it has one.
   */
  export async function current() {
    return await (await registration())?.pushManager.getSubscription() ?? null;
  }

  function keyBytes(base64url: string) {
    const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64url.length / 4) * 4, "=");
    return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  }

  /**
   * Ask for permission and subscribe this browser.
   * @throws With a reason the settings page can show.
   */
  export async function subscribe(pushKey: string) {
    const reg = await registration();
    if (!reg) throw new Error("no-worker");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("denied");
    const existing = await reg.pushManager.getSubscription();
    if (existing) await existing.unsubscribe();
    const subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(pushKey) });
    return subscription.toJSON();
  }

  export async function unsubscribe() {
    const subscription = await current();
    if (!subscription) return null;
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    return endpoint;
  }
}
