import { useEffect, useState } from "react";
import type { PersonDetail } from "@shared/media.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import AppShell from "../../components/AppShell/AppShell.tsx";
import PosterCard, { fallbackColor } from "../../components/PosterCard/PosterCard.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import "./Person.scss";

export interface PersonProps {
  id: number;
}

const KIND_LABELS: Record<string, string> = {
  director: "Director",
  writer: "Writer",
  producer: "Producer",
  composer: "Music",
  author: "Author",
  narrator: "Narrator",
};

/**
 * Everything someone is in, in this server's libraries.
 */
export default function Person(props: PersonProps) {
  const { id } = props;
  const [person, setPerson] = useState<PersonDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ItemsApi.person(id).then(setPerson).catch((e: Error) => setError(e.message));
  }, [id]);

  return (
    <AppShell>
      {!person && !error && <Spinner size="2rem" />}
      {error && <p className="cn-person-page__error">{error}</p>}
      {person && (
        <div className="cn-person-page">
          <header className="cn-person-page__header">
            <span className="cn-person-page__photo" style={{ background: fallbackColor(person.name) }}>
              {person.photo
                ? <img src={ItemsApi.imageUrl(person.photo, 500)} alt="" />
                : <span>{person.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("")}</span>}
            </span>
            <div>
              <h1>{person.name}</h1>
              <p>{person.credits.length} {person.credits.length === 1 ? "title" : "titles"} in your libraries</p>
            </div>
          </header>
          <div className="cn-person-page__grid">
            {person.credits.map(({ item, kind, character }) => (
              <PosterCard key={item.id} item={item} subtitle={kind === "cast" ? character ?? (item.year ? String(item.year) : "") : KIND_LABELS[kind] ?? kind} />
            ))}
          </div>
        </div>
      )}
    </AppShell>
  );
}
