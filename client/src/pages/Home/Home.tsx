import { useEffect, useState } from "react";
import { FolderPlus } from "lucide-react";
import type { LibraryInfo } from "@shared/api.ts";
import type { ItemSummary } from "@shared/media.ts";
import LibrariesApi from "../../Api/LibrariesApi.ts";
import ItemsApi from "../../Api/ItemsApi.ts";
import { session } from "../../Session.ts";
import { Link, router } from "../../lib/Router.tsx";
import useController from "../../lib/useController.ts";
import AppShell from "../../components/AppShell/AppShell.tsx";
import Button from "../../components/Button/Button.tsx";
import PosterCard from "../../components/PosterCard/PosterCard.tsx";
import "./Home.scss";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function Home() {
  const { user } = useController(session);
  const libraries = LibrariesApi.useLibraries();
  const filled = libraries?.filter((l) => l.itemCount > 0) ?? [];

  return (
    <AppShell>
      <div className="cn-home">
        <header className="cn-home__header">
          <h1>{greeting()}, {user?.name}</h1>
        </header>

        {filled.map((library) => <RecentlyAdded key={library.id} library={library} />)}

        {libraries && libraries.length > 0 && filled.length === 0 && (
          <section className="cn-home__empty">
            <h2>Nothing to watch yet</h2>
            <p>{libraries.some((l) => l.scan) ? "Cinemion is scanning your libraries. Titles appear here as they're found." : "Movies and shows appear here once Cinemion has found them in your library folders."}</p>
          </section>
        )}

        {libraries && libraries.length === 0 && (
          <section className="cn-home__empty">
            <h2>No libraries yet</h2>
            <p>{session.can("LIBRARY_MANAGE") ? "Add a folder with movies or shows to get started." : "Ask the person who runs this server to add a library."}</p>
            {session.can("LIBRARY_MANAGE") && (
              <Button variant="primary" icon={<FolderPlus />} onClick={() => router.navigate("/settings/libraries")} data-autofocus>Add a library</Button>
            )}
          </section>
        )}
      </div>
    </AppShell>
  );
}

function RecentlyAdded(props: { library: LibraryInfo }) {
  const { library } = props;
  const [items, setItems] = useState<ItemSummary[] | null>(null);

  useEffect(() => {
    ItemsApi.list(library.id, { sort: "added", limit: 16 }).then((page) => setItems(page.items)).catch(() => setItems([]));
  }, [library.id]);

  if (!items?.length) return null;
  return (
    <section className="cn-home__row">
      <div className="cn-home__row-header">
        <h2>Recently added in {library.name}</h2>
        <Link href={`/library/${library.id}`}>See all</Link>
      </div>
      <div className="cn-home__row-items">
        {items.map((item) => <PosterCard key={item.id} item={item} className="cn-home__row-item" />)}
      </div>
    </section>
  );
}
