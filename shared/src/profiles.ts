import type { NotificationPreferences, NotifyMode } from "./notifications.ts";

/**
 * Colours a profile can use for its initials tile. `bg` is the tile, `fg` the initial on top of it.
 */
export const PROFILE_COLORS = {
  sky: { bg: "#5B9DFF", fg: "#06121F" },
  coral: { bg: "#FF6B5A", fg: "#1E0905" },
  mint: { bg: "#3DDC97", fg: "#04170F" },
  violet: { bg: "#9B7CFF", fg: "#120A26" },
  amber: { bg: "#F5B544", fg: "#1A1204" },
  rose: { bg: "#F29BC4", fg: "#22091A" },
  teal: { bg: "#6FD3E0", fg: "#04171A" },
  slate: { bg: "#A9B4C6", fg: "#0E1218" },
} as const;

export type ProfileColor = keyof typeof PROFILE_COLORS;

/**
 * Sizes, in pixels, that uploaded profile pictures are stored in.
 */
export const AVATAR_SIZES = [512, 256, 96] as const;

export type AvatarSize = typeof AVATAR_SIZES[number];

/**
 * Permission keys a role can grant. Admins pass every check.
 */
export const PERMISSIONS = [
  "LIBRARY_MANAGE",
  "USERS_MANAGE",
  "SERVER_MANAGE",
  "TRANSCODE_ALLOW",
  "SUBTITLES_DOWNLOAD",
  "MEDIA_DOWNLOAD",
] as const;

export type Permission = typeof PERMISSIONS[number];

export function isProfileColor(value: unknown): value is ProfileColor {
  return typeof value === "string" && value in PROFILE_COLORS;
}

/**
 * How subtitles look for a profile.
 */
export interface SubtitleStyle {
  size: "small" | "medium" | "large" | "huge";
  color: "white" | "yellow" | "cyan" | "green";
  /**
   * `shadow` is a soft outline, `box` a dark box behind the text.
   */
  background: "none" | "shadow" | "box";
  /**
   * Draw ASS subtitles with their own fonts, colours and positions instead of this style.
   */
  keepStyling: boolean;
}

/**
 * A profile's own preferences.
 */
export interface ProfilePreferences {
  subtitles: SubtitleStyle;
  notifications: NotificationPreferences;
  /**
   * The interface's language, like `en` or `pt-BR`. `null` = the browser's language.
   */
  language: string | null;
  /**
   * Keep this profile's statistics out of the server owner's view and the household's year in review.
   */
  privateStats: boolean;
}

export const DEFAULT_PREFERENCES: ProfilePreferences = {
  subtitles: { size: "medium", color: "white", background: "box", keepStyling: true },
  notifications: { mode: "all", libraries: {}, email: null },
  language: null,
  privateStats: false,
};

/**
 * Preferences with unknown or missing values replaced by the defaults, so stored and sent values are always complete.
 */
export function normalizePreferences(value: unknown): ProfilePreferences {
  const subtitles = ((value as Partial<ProfilePreferences> | null)?.subtitles ?? {}) as Partial<SubtitleStyle>;
  const language = (value as Partial<ProfilePreferences> | null)?.language;
  const notifications = ((value as Partial<ProfilePreferences> | null)?.notifications ?? {}) as Partial<NotificationPreferences>;
  const modes: NotifyMode[] = ["all", "following", "none"];
  const pick = <T extends string>(given: unknown, allowed: readonly T[], fallback: T): T => allowed.includes(given as T) ? given as T : fallback;
  const d = DEFAULT_PREFERENCES.subtitles;
  return {
    subtitles: {
      size: pick(subtitles.size, ["small", "medium", "large", "huge"], d.size),
      color: pick(subtitles.color, ["white", "yellow", "cyan", "green"], d.color),
      background: pick(subtitles.background, ["none", "shadow", "box"], d.background),
      keepStyling: typeof subtitles.keepStyling === "boolean" ? subtitles.keepStyling : d.keepStyling,
    },
    notifications: {
      mode: pick(notifications.mode, modes, DEFAULT_PREFERENCES.notifications.mode),
      libraries: Object.fromEntries(Object.entries(notifications.libraries ?? {}).filter(([id, mode]) => /^\d+$/.test(id) && modes.includes(mode))),
      email: typeof notifications.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notifications.email.trim()) ? notifications.email.trim().slice(0, 254) : null,
    },
    // Example: en, pt-BR, zh-Hant
    language: typeof language === "string" && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(language) ? language : null,
    privateStats: (value as Partial<ProfilePreferences> | null)?.privateStats === true,
  };
}
