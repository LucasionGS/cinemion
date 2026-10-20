import type { CreationOptional, InferAttributes, InferCreationAttributes } from "sequelize";
import { DataTypes, Model } from "sequelize";
import { encodeHex } from "@std/encoding/hex";
import { isWebhookEvent, type SaveWebhookRequest, type WebhookDelivery, type WebhookEvent, type WebhookInfo } from "@shared/admin.ts";
import sequelize, { ID_TYPE, jsonColumn } from "./sequelize.ts";

/**
 * An address Cinemion sends JSON to when things happen, like playback starting.
 */
export class Webhook extends Model<InferAttributes<Webhook>, InferCreationAttributes<Webhook>> {
  declare id: CreationOptional<number>;
  declare name: string;
  declare url: string;
  /**
   * Key for the `X-Cinemion-Signature` HMAC, so the receiver can check a request came from this server.
   */
  declare secret: string;
  declare events: WebhookEvent[];
  declare enabled: CreationOptional<boolean>;
  /**
   * How the last send went. `null` = nothing sent yet.
   */
  declare lastDelivery: CreationOptional<WebhookDelivery | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  public static newSecret() {
    return encodeHex(crypto.getRandomValues(new Uint8Array(24)));
  }

  /**
   * Check and tidy what the settings page sends.
   * @throws When a field is missing or invalid, with a message that says which.
   */
  public static validate(body: Partial<SaveWebhookRequest>): SaveWebhookRequest {
    let url: URL;
    try {
      url = new URL(String(body.url ?? "").trim());
    } catch {
      throw new Error("Enter the full address, starting with http:// or https://.");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("The address must start with http:// or https://.");

    const events = Array.isArray(body.events) ? [...new Set(body.events)] : [];
    if (events.length === 0) throw new Error("Pick at least one event to send.");
    const unknown = events.find((e) => !isWebhookEvent(e));
    if (unknown) throw new Error(`"${unknown}" isn't an event Cinemion sends.`);

    const name = String(body.name ?? "").trim() || url.hostname;
    if (name.length > 64) throw new Error("Keep the name under 64 characters.");
    return { name, url: url.toString(), events: events as WebhookEvent[], enabled: body.enabled !== false };
  }

  public toClientJSON(): WebhookInfo {
    return { id: this.id, name: this.name, url: this.url, secret: this.secret, events: this.events, enabled: this.enabled, lastDelivery: this.lastDelivery };
  }
}

Webhook.init({
  id: { type: ID_TYPE, autoIncrement: true, primaryKey: true },
  name: { type: DataTypes.STRING(64), allowNull: false },
  url: { type: DataTypes.STRING(2048), allowNull: false },
  secret: { type: DataTypes.STRING(128), allowNull: false },
  events: jsonColumn<WebhookEvent[], Webhook>("events", []),
  enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  lastDelivery: jsonColumn<WebhookDelivery | null, Webhook>("lastDelivery", null, true),
  createdAt: DataTypes.DATE,
  updatedAt: DataTypes.DATE,
}, { sequelize, tableName: "webhooks" });

export default Webhook;
