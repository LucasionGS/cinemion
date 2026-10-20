import { type ReactNode, useState } from "react";
import type { Artwork, Palette } from "@shared/media.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import { fallbackColor } from "../PosterCard/PosterCard.tsx";
import "./ItemHero.scss";

export interface ItemHeroProps {
  title: string;
  artwork: Artwork;
  palette: Palette | null;
  /**
   * Small line above the title, like the show name on an episode page.
   */
  eyebrow?: ReactNode;
  /**
   * Hide the poster, e.g. for episodes, which have a still instead.
   */
  hidePoster?: boolean;
  children: ReactNode;
}

/**
 * The top of a detail page: the backdrop fading into the page, the poster beside the details (poster-split layout),
 * and the title as its logo when there is one.
 */
export default function ItemHero(props: ItemHeroProps) {
  const { title, artwork, palette, eyebrow, hidePoster = false, children } = props;
  const [logoBroken, setLogoBroken] = useState(false);
  const backdrop = artwork.backdrop ?? artwork.thumb;
  const showPoster = !hidePoster;

  return (
    <section className="cn-hero">
      <div className="cn-hero__backdrop" aria-hidden="true">
        {backdrop && <img src={ItemsApi.imageUrl(backdrop, 1920)} alt="" />}
      </div>
      <div className="cn-hero__content">
        {showPoster && (
          <div className="cn-hero__poster" style={artwork.poster ? undefined : { background: `linear-gradient(160deg, ${palette?.accent ?? fallbackColor(title)} 0%, ${palette?.base ?? "#0B0D12"} 110%)` }}>
            {artwork.poster ? <img src={ItemsApi.imageUrl(artwork.poster, 500)} srcSet={`${ItemsApi.imageUrl(artwork.poster, 500)} 500w, ${ItemsApi.imageUrl(artwork.poster, 780)} 780w`} sizes="18rem" alt="" /> : <span>{title}</span>}
          </div>
        )}
        <div className="cn-hero__info">
          {eyebrow && <div className="cn-hero__eyebrow">{eyebrow}</div>}
          {artwork.logo && !logoBroken
            ? (
              <h1 className="cn-hero__logo">
                <img src={ItemsApi.imageUrl(artwork.logo, 780)} alt={title} onError={() => setLogoBroken(true)} />
              </h1>
            )
            : <h1 className="cn-hero__title">{title}</h1>}
          {children}
        </div>
      </div>
    </section>
  );
}
