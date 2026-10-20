import { BookOpen, Clapperboard, Headphones, Music, Tv, Video } from "lucide-react";
import type { LibraryType } from "@shared/api.ts";

export interface LibraryIconProps {
  type: LibraryType;
}

/**
 * The icon for a kind of library: a clapperboard for movies, a TV for shows, a camera for videos, a note for music,
 * headphones for audiobooks and an open book for books.
 */
export default function LibraryIcon(props: LibraryIconProps) {
  const { type } = props;
  const icons = { movies: <Clapperboard />, shows: <Tv />, videos: <Video />, music: <Music />, audiobooks: <Headphones />, books: <BookOpen /> };
  return icons[type];
}
