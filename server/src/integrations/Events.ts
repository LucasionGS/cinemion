import type { ActivityKind, WebhookEvent, WebhookPayloads } from "@shared/admin.ts";
import { Activity } from "../models/index.ts";
import Webhooks from "./Webhooks.ts";
import log from "../lib/Logger.ts";

/**
 * Things that happen on the server, sent to webhooks and, when they're worth showing, to the activity feed.
 */
export namespace Events {
  export interface ActivityLine {
    kind: ActivityKind;
    message: string;
    userId?: number | null;
    itemId?: number | null;
    /**
     * Leave the line out when the same one was recorded within this many hours.
     */
    dedupeHours?: number;
  }

  /**
   * Report an event. Returns at once; nothing here may slow down or break the request that caused it.
   */
  export function emit<E extends WebhookEvent>(event: E, data: WebhookPayloads[E], activity?: ActivityLine) {
    (async () => {
      if (activity && !(activity.dedupeHours && await Activity.isRecent(activity.kind, activity.message, activity.dedupeHours))) {
        await Activity.record(activity.kind, activity.message, activity);
      }
      await Webhooks.send(event, data);
    })().catch((error) => log.warn(`Could not report ${event}`, { error }));
  }

  /**
   * Add a line to the activity feed that has no webhook event, like an import reported by Sonarr.
   */
  export function activity(line: ActivityLine) {
    (async () => {
      if (line.dedupeHours && await Activity.isRecent(line.kind, line.message, line.dedupeHours)) return;
      await Activity.record(line.kind, line.message, line);
    })().catch(() => { });
  }
}

export default Events;
