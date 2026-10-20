import { useState } from "react";
import ItemsApi from "../../Api/ItemsApi.ts";
import { Link } from "../../lib/Router.tsx";
import { fallbackColor } from "../PosterCard/PosterCard.tsx";
import "./PersonCard.scss";

export interface PersonCardProps {
  person: { personId?: number; id?: number; name: string; photo: string | null };
  /**
   * Character or job under the name.
   */
  role?: string | null;
}

/**
 * A round photo with a name, linking to everything the person is in.
 */
export default function PersonCard(props: PersonCardProps) {
  const { person, role } = props;
  const [broken, setBroken] = useState(false);
  const id = person.personId ?? person.id;
  const initials = person.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  return (
    <Link href={`/person/${id}`} className="cn-person">
      <span className="cn-person__photo" style={{ background: fallbackColor(person.name) }}>
        {person.photo && !broken
          ? <img src={ItemsApi.imageUrl(person.photo, 342)} alt="" loading="lazy" onError={() => setBroken(true)} />
          : <span className="cn-person__initials">{initials}</span>}
      </span>
      <span className="cn-person__name">{person.name}</span>
      {role && <span className="cn-person__role">{role}</span>}
    </Link>
  );
}
