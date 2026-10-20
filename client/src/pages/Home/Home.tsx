import { Clapperboard, FolderPlus, Tv } from "lucide-react";
import LibrariesApi from "../../Api/LibrariesApi.ts";
import { session } from "../../Session.ts";
import { router } from "../../lib/Router.tsx";
import useController from "../../lib/useController.ts";
import AppShell from "../../components/AppShell/AppShell.tsx";
import Button from "../../components/Button/Button.tsx";
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

  return (
    <AppShell>
      <div className="cn-home">
        <header className="cn-home__header">
          <h1>{greeting()}, {user?.name}</h1>
        </header>

        {libraries && libraries.length > 0 && (
          <section className="cn-home__empty">
            <h2>Nothing to watch yet</h2>
            <p>Movies and shows will appear here once Cinemion has scanned your libraries.</p>
            <div className="cn-home__libraries">
              {libraries.map((library) => (
                <div key={library.id} className="cn-home__library">
                  {library.type === "shows" ? <Tv /> : <Clapperboard />}
                  <div>
                    <strong>{library.name}</strong>
                    <span>{library.paths.length === 1 ? library.paths[0] : `${library.paths.length} folders`}</span>
                  </div>
                </div>
              ))}
            </div>
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
