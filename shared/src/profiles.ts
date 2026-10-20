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
] as const;

export type Permission = typeof PERMISSIONS[number];

export function isProfileColor(value: unknown): value is ProfileColor {
  return typeof value === "string" && value in PROFILE_COLORS;
}
