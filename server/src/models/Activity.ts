import type { CreationOptional, ForeignKey, InferAttributes, InferCreationAttributes } from "sequelize";
import { DataTypes, Model, Op } from "sequelize";
import type { ActivityInfo, ActivityKind } from "@shared/admin.ts";
import sequelize, { ID_TYPE } from "./sequelize.ts";
import type MediaItem from "./MediaItem.ts";
import type User from "./User.ts";

/**
 * Something that happened on the server, for the dashboard's activity feed: "Mira finished Paper Moons".
 */
export class Activity extends Model<InferAttributes<Activity>, InferCreationAttributes<Activity>> {
  declare id: CreationOptional<number>;
  declare kind: ActivityKind;
  declare message: string;
  declare userId: ForeignKey<User["id"]> | null;
  declare itemId: ForeignKey<MediaItem["id"]> | null;
  declare createdAt: CreationOptional<Date>;

  /**
   * Activity older than this is deleted.
   */
  public static readonly KEEP_DAYS = 60;

  /**
   * Add a line to the feed. Never throws; the feed must not break what it reports on.
   */
  public static async record(kind: ActivityKind, message: string, opts?: { userId?: number | null; itemId?: number | null }) {
    opts ??= {};
    try {
      await Activity.create({ kind, message: message.slice(0, 512), userId: opts.userId ?? null, itemId: opts.itemId ?? null });
    } catch {
      // A title deleted a moment ago fails the foreign key; the line isn't worth more than that
    }
  }

  /**
   * Whether the same line was recorded within `hours`, to keep repeats (like sign-ins on one TV) out of the feed.
   */
  public static async isRecent(kind: ActivityKind, message: string, hours: number) {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    return await Activity.count({ where: { kind, message, createdAt: { [Op.gte]: since } } }) > 0;
  }

  /**
   * Newest first. With `before`, only lines older than that id.
   */
  public static async recent(limit: number, before?: number) {
    return await Activity.findAll({
      where: before ? { id: { [Op.lt]: before } } : {},
      order: [["id", "DESC"]],
      limit,
    });
  }

  public static async prune() {
    await Activity.destroy({ where: { createdAt: { [Op.lt]: new Date(Date.now() - Activity.KEEP_DAYS * 24 * 60 * 60 * 1000) } } });
  }

  public override toJSON(): ActivityInfo {
    return { id: this.id, kind: this.kind, message: this.message, userId: this.userId, itemId: this.itemId, createdAt: this.createdAt.toISOString() };
  }
}

Activity.init({
  id: { type: ID_TYPE, autoIncrement: true, primaryKey: true },
  kind: { type: DataTypes.STRING(32), allowNull: false },
  message: { type: DataTypes.STRING(512), allowNull: false },
  userId: { type: ID_TYPE, allowNull: true },
  itemId: { type: ID_TYPE, allowNull: true },
  createdAt: DataTypes.DATE,
}, { sequelize, tableName: "activities", updatedAt: false });

export default Activity;
