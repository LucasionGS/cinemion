import type { ReactNode } from "react";

export interface MusicHeaderProps {
  cover: ReactNode;
  /**
   * Small line above the title, like "Album" or "Playlist".
   */
  eyebrow: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}

/**
 * The top of an album, artist or playlist page: the cover beside the title, details and buttons.
 */
export default function MusicHeader(props: MusicHeaderProps) {
  const { cover, eyebrow, title, meta, actions } = props;
  return (
    <header className="cn-music-header">
      <div className="cn-music-header__cover">{cover}</div>
      <div className="cn-music-header__info">
        <span className="cn-music-header__eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {meta && <div className="cn-music-header__meta">{meta}</div>}
        {actions && <div className="cn-music-header__actions">{actions}</div>}
      </div>
    </header>
  );
}
