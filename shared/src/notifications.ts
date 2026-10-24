/**
 * Types for notifications: "new in your library" and titles from "My list" arriving, in the bell in the top bar, as
 * browser push notifications, and by email.
 */

/**
 * How much a profile hears about a library: everything new, only shows they watch and titles on their list, or nothing.
 */
export type NotifyMode = "all" | "following" | "none";

export interface NotificationPreferences {
  mode: NotifyMode;
  /**
   * Libraries that differ from `mode`, by id.
   */
  libraries: Record<string, NotifyMode>;
  /**
   * Where emails go, or `null` for none. Only used when the server can send email.
   */
  email: string | null;
}

/**
 * What a notification is about, with the facts the text is made from, so every language can word it its own way.
 */
export type NotificationData =
  | { kind: "movie" | "album" | "audiobook" | "book" | "video"; title: string; artist?: string | null; libraryName: string }
  | { kind: "episodes"; showTitle: string; count: number; season: number | null; episode: number | null; episodeTitle: string | null }
  | { kind: "watchlist"; title: string };

export interface NotificationInfo {
  id: number;
  data: NotificationData;
  /**
   * What opening it shows. `null` when the title is gone.
   */
  itemId: number | null;
  /**
   * Artwork key for a small picture next to it.
   */
  image: string | null;
  read: boolean;
  /**
   * When it was last added to (a group of new episodes grows).
   */
  at: string;
}

export interface NotificationsList {
  items: NotificationInfo[];
  unread: number;
}

/**
 * How the server sends email. The password is never sent back, only whether there is one.
 */
export interface EmailSettings {
  host: string;
  port: number;
  /**
   * `tls` connects encrypted (usually port 465), `starttls` upgrades a plain connection (usually 587), `none` doesn't
   * encrypt.
   */
  security: "tls" | "starttls" | "none";
  username: string | null;
  hasPassword: boolean;
  from: string;
}

export interface EmailSettingsUpdate extends Partial<Omit<EmailSettings, "hasPassword">> {
  /**
   * A new password, `null` for none, or left out to keep the saved one.
   */
  password?: string | null;
}

/**
 * What the client needs to turn on push notifications and email.
 */
export interface NotificationSetup {
  /**
   * The key push services check messages against (base64url). `null` when push isn't available.
   */
  pushKey: string | null;
  /**
   * Whether the server can send email.
   */
  email: boolean;
  /**
   * Devices this profile gets push notifications on.
   */
  devices: { id: number; name: string; createdAt: string; current: boolean }[];
}
