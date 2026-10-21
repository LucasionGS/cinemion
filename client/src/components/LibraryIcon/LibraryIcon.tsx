import { BookOpen, Clapperboard, Headphones, Images, Music, Tv, Video } from "lucide-react";
import type { LibraryType } from "@shared/api.ts";

export interface LibraryIconProps {
  type: LibraryType;
}

/**
 * The icon for a kind of library: a clapperboard for movies, a TV for shows, a camera for videos, a note for music,
 * headphones for audiobooks, an open book for books and a stack of pictures for photos.
 */
export default function LibraryIcon(props: LibraryIconProps) {
  const { type } = props;
  const icons = { movies: <Clapperboard />, shows: <Tv />, videos: <Video />, music: <Music />, audiobooks: <Headphones />, books: <BookOpen />, photos: <Images /> };
  return icons[type];
}
