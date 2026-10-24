import type { CreationOptional, ForeignKey, InferAttributes, InferCreationAttributes } from "sequelize";
import { DataTypes, Model } from "sequelize";
import type { NotificationData, NotificationInfo } from "@shared/notifications.ts";
import sequelize, { ID_TYPE, jsonColumn } from "./sequelize.ts";
import type MediaItem from "./MediaItem.ts";
import type User from "./User.ts";

/**
 * Something a profile is told about, like new episodes of a show it watches. Shown in the bell in the top bar, and
 * sent as push notifications and email when the profile wants them.
 */
export class Notification extends Model<InferAttributes<Notification>, InferCreationAttributes<Notification>> {
  declare id: CreationOptional<number>;
  declare userId: ForeignKey<User["id"]>;
  declare itemId: ForeignKey<MediaItem["id"]> | null;
  declare data: NotificationData;
  /**
   * Notifications with the same key (like `show:12`) are joined while unread.
   */
  declare groupKey: string | null;
  declare image: string | null;
  declare readAt: CreationOptional<Date | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  /**
   * Notifications older than this are deleted.
   */
  public static readonly KEEP_DAYS = 60;

  public toInfo(): NotificationInfo {
    return { id: this.id, data: this.data, itemId: this.itemId, image: this.image, read: this.readAt !== null, at: this.updatedAt.toISOString() };
  }
}

Notification.init({
  id: { type: ID_TYPE, autoIncrement: true, primaryKey: true },
  userId: { type: ID_TYPE, allowNull: false },
  itemId: { type: ID_TYPE, allowNull: true, defaultValue: null },
  data: jsonColumn<NotificationData, Notification>("data", { kind: "watchlist", title: "" }),
  groupKey: { type: DataTypes.STRING(128), allowNull: true, defaultValue: null },
  image: { type: DataTypes.STRING(64), allowNull: true, defaultValue: null },
  readAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
  createdAt: DataTypes.DATE,
  updatedAt: DataTypes.DATE,
}, { sequelize, tableName: "notifications" });

/**
 * A browser that gets push notifications for a profile: where to send them, and the keys to encrypt them with.
 */
export class PushSubscription extends Model<InferAttributes<PushSubscription>, InferCreationAttributes<PushSubscription>> {
  declare id: CreationOptional<number>;
  declare userId: ForeignKey<User["id"]>;
  declare endpoint: string;
  declare endpointHash: string;
  /**
   * The browser's public key (base64url).
   */
  declare p256dh: string;
  /**
   * The browser's auth secret (base64url).
   */
  declare auth: string;
  /**
   * Like "Chrome on a phone", for the settings page.
   */
  declare device: string;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

PushSubscription.init({
  id: { type: ID_TYPE, autoIncrement: true, primaryKey: true },
  userId: { type: ID_TYPE, allowNull: false },
  endpoint: { type: DataTypes.TEXT, allowNull: false },
  endpointHash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
  p256dh: { type: DataTypes.STRING(128), allowNull: false },
  auth: { type: DataTypes.STRING(64), allowNull: false },
  device: { type: DataTypes.STRING(128), allowNull: false },
  createdAt: DataTypes.DATE,
  updatedAt: DataTypes.DATE,
}, { sequelize, tableName: "push_subscriptions" });

export default Notification;
