import { BookOpen, Clapperboard, Gamepad2, Headphones, Images, Music, Tv, Video } from "lucide-react";
import type { LibraryType } from "@shared/api.ts";

export interface LibraryIconProps {
  type: LibraryType;
}

/**
 * The icon for a kind of library: a clapperboard for movies, a TV for shows, a camera for videos, a note for music,
 * headphones for audiobooks, an open book for books, a stack of pictures for photos and a controller for clips.
 */
export default function LibraryIcon(props: LibraryIconProps) {
  const { type } = props;
  const icons = { movies: <Clapperboard />, shows: <Tv />, videos: <Video />, music: <Music />, audiobooks: <Headphones />, books: <BookOpen />, photos: <Images />, clips: <Gamepad2 /> };
  return icons[type];
}
