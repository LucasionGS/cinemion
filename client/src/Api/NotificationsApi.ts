import type { EmailSettings, EmailSettingsUpdate, NotificationSetup, NotificationsList } from "@shared/notifications.ts";
import BaseApi from "./BaseApi.ts";

/**
 * The bell, push notifications on this device, and (for admins) how the server sends email.
 */
export namespace NotificationsApi {
  export function list() {
    return BaseApi.GET<NotificationsList>("/notifications");
  }

  /**
   * Mark some read, or all of them without `ids`.
   */
  export function markRead(ids?: number[]) {
    return BaseApi.POST<NotificationsList>("/notifications/read", ids ? { ids } : {});
  }

  export function setup(endpoint?: string | null) {
    return BaseApi.GET<NotificationSetup>(`/notifications/setup${endpoint ? `?endpoint=${encodeURIComponent(endpoint)}` : ""}`);
  }

  export function subscribe(subscription: PushSubscriptionJSON) {
    return BaseApi.POST<NotificationSetup>("/notifications/push", subscription);
  }

  export function unsubscribe(by: { id?: number; endpoint?: string }) {
    const query = by.id !== undefined ? `id=${by.id}` : `endpoint=${encodeURIComponent(by.endpoint ?? "")}`;
    return BaseApi.DELETE<NotificationSetup>(`/notifications/push?${query}`);
  }

  export function testPush() {
    return BaseApi.POST<{ sent: number }>("/notifications/push/test");
  }

  export function email() {
    return BaseApi.GET<EmailSettings | null>("/notifications/email");
  }

  export function updateEmail(changes: EmailSettingsUpdate) {
    return BaseApi.PUT<EmailSettings | null>("/notifications/email", changes);
  }

  export function testEmail(to: string) {
    return BaseApi.POST<{ sent: boolean }>("/notifications/email/test", { to });
  }
}

export default NotificationsApi;
