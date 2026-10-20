import { useState } from "react";
import { AVATAR_SIZES, PROFILE_COLORS, type ProfileColor } from "@shared/profiles.ts";
import UsersApi from "../../Api/UsersApi.ts";
import cx from "../../lib/cx.ts";
import "./Avatar.scss";

export interface AvatarProps {
  profile: { id: number; name: string; color: ProfileColor; avatar: string | null };
  /**
   * Edge length in rem, so it scales with the TV layout. Default is 2.5.
   */
  size?: number;
  className?: string;
}

/**
 * Pick the smallest stored picture that still looks sharp at this size on this screen.
 */
function pictureSize(rem: number) {
  const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const needed = rem * rootPx * (devicePixelRatio || 1);
  return [...AVATAR_SIZES].sort((a, b) => a - b).find((s) => s >= needed) ?? AVATAR_SIZES[0];
}

/**
 * A profile's picture, or their initial on their colour when they have none.
 */
export default function Avatar(props: AvatarProps) {
  const { profile, size = 2.5, className } = props;
  const [broken, setBroken] = useState(false);
  const colors = PROFILE_COLORS[profile.color] ?? PROFILE_COLORS.sky;
  const showPicture = profile.avatar && !broken;

  return (
    <span
      className={cx("cn-avatar", className)}
      style={{ width: `${size}rem`, height: `${size}rem`, background: colors.bg, color: colors.fg, fontSize: `${size * 0.42}rem` }}
      aria-hidden="true"
    >
      {showPicture
        ? <img src={UsersApi.avatarUrl(profile.id, profile.avatar!, pictureSize(size))} alt="" draggable={false} onError={() => setBroken(true)} />
        : <span className="cn-avatar__initial">{profile.name.trim().charAt(0).toUpperCase() || "?"}</span>}
    </span>
  );
}
