import { Clapperboard, Music, Tv, Video } from "lucide-react";
import type { LibraryType } from "@shared/api.ts";

export interface LibraryIconProps {
  type: LibraryType;
}

/**
 * The icon for a kind of library: a clapperboard for movies, a TV for shows, a camera for videos, a note for music.
 */
export default function LibraryIcon(props: LibraryIconProps) {
  const { type } = props;
  return type === "shows" ? <Tv /> : type === "videos" ? <Video /> : type === "music" ? <Music /> : <Clapperboard />;
}
