import LibrariesApi from "../../Api/LibrariesApi.ts";
import AppShell from "../../components/AppShell/AppShell.tsx";
import Spinner from "../../components/Spinner/Spinner.tsx";
import "../Home/Home.scss";

export interface LibraryProps {
  id: number;
}

/**
 * One library's titles. Until it has been scanned, this explains why it's empty.
 */
export default function Library(props: LibraryProps) {
  const { id } = props;
  const libraries = LibrariesApi.useLibraries();
  const library = libraries?.find((l) => l.id === id);

  return (
    <AppShell>
      <div className="cn-home">
        {!libraries && <Spinner size="2rem" />}
        {libraries && !library && (
          <section className="cn-home__empty">
            <h2>Library not found</h2>
            <p>It may have been removed, or your profile doesn't have access to it.</p>
          </section>
        )}
        {library && (
          <>
            <header className="cn-home__header"><h1>{library.name}</h1></header>
            <section className="cn-home__empty">
              <h2>Nothing in here yet</h2>
              <p>{library.type === "shows" ? "Shows" : "Movies"} from {library.paths.join(", ")} will appear here once Cinemion has scanned them.</p>
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
