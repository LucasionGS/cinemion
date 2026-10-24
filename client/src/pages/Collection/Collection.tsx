import { useEffect, useState } from "react";
import type { CollectionDetail } from "@shared/media.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import { applyAmbient } from "../../lib/ambient.ts";
import { t } from "../../i18n/I18n.ts";
import AppShell from "../../components/AppShell/AppShell.tsx";
import ItemHero from "../../components/ItemHero/ItemHero.tsx";
import PosterCard from "../../components/PosterCard/PosterCard.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import "../Item/Item.scss";
import "../Search/Search.scss";

export interface CollectionProps {
  id: number;
}

/**
 * Movies that belong together, oldest first.
 */
export default function Collection(props: CollectionProps) {
  const { id } = props;
  const [collection, setCollection] = useState<CollectionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ItemsApi.collection(id).then(setCollection).catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (collection) applyAmbient(collection.palette);
    return () => applyAmbient(null);
  }, [collection?.palette?.accent]);

  const watched = collection?.items.filter((i) => i.userData?.watched).length ?? 0;

  return (
    <AppShell>
      {!collection && !error && <Spinner size="2rem" />}
      {error && <p className="cn-item__overview">{error}</p>}
      {collection && (
        <div className="cn-item">
          <ItemHero title={collection.name} artwork={collection.artwork} palette={collection.palette}>
            <div className="cn-meta">
              <span>{t("collection.movies", { count: collection.itemCount })}</span>
              {watched > 0 && <span>{t("collection.watched", { count: watched })}</span>}
            </div>
            {collection.overview && <p className="cn-item__overview">{collection.overview}</p>}
          </ItemHero>
          <div className="cn-search__grid">
            {collection.items.map((item) => <PosterCard key={item.id} item={item} />)}
          </div>
        </div>
      )}
    </AppShell>
  );
}
