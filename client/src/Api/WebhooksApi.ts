import type { SaveWebhookRequest, WebhookInfo } from "@shared/admin.ts";
import BaseApi from "./BaseApi.ts";

/**
 * Outgoing webhooks.
 */
export namespace WebhooksApi {
  export function list() {
    return BaseApi.GET<WebhookInfo[]>("/webhooks");
  }

  export function create(data: SaveWebhookRequest) {
    return BaseApi.POST<WebhookInfo>("/webhooks", data);
  }

  export function update(id: number, data: Partial<SaveWebhookRequest>) {
    return BaseApi.PUT<WebhookInfo>(`/webhooks/${id}`, data);
  }

  export function remove(id: number) {
    return BaseApi.DELETE<void>(`/webhooks/${id}`);
  }

  /**
   * Send a test event now. The returned webhook's `lastDelivery` says how it went.
   */
  export function test(id: number) {
    return BaseApi.POST<WebhookInfo>(`/webhooks/${id}/test`);
  }

  export function newSecret(id: number) {
    return BaseApi.POST<WebhookInfo>(`/webhooks/${id}/secret`);
  }
}

export default WebhooksApi;
