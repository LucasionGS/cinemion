import { Fragment, StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/sora";
import "@fontsource-variable/manrope";
import "./main.scss";
import type { Permission } from "@shared/profiles.ts";
import { session } from "./Session.ts";
import { type Route, router, RouterView } from "./lib/Router.tsx";
import useController from "./lib/useController.ts";
import { deviceMode } from "./lib/DeviceMode.ts";
import { i18n, t } from "./i18n/I18n.ts";
// Applies the theme picked for this device and follows the system setting when asked to
import "./lib/Theme.ts";
import { initSpatialNavigation } from "./lib/spatialNavigation.ts";
import { initGamepad } from "./lib/gamepad.ts";
import { applyAmbient } from "./lib/ambient.ts";
import { musicPlayer } from "./lib/MusicPlayer.ts";
import offline from "./lib/Offline.ts";
import Toaster from "./components/Toaster/Toaster.tsx";
import MiniPlayer from "./components/MiniPlayer/MiniPlayer.tsx";
import NowPlaying from "./components/NowPlaying/NowPlaying.tsx";
import AddToPlaylist from "./components/AddToPlaylist/AddToPlaylist.tsx";
import AddToPhotoAlbum from "./components/AddToPhotoAlbum/AddToPhotoAlbum.tsx";
import Spinner from "./components/Spinner/Spinner.tsx";
import Button from "./components/Button/Button.tsx";
import Logo from "./components/Logo/Logo.tsx";

interface Requirement {
  signedIn?: boolean;
  permission?: Permission;
}

/**
 * Only render `route` when `requirement` is met; otherwise send the user somewhere they can go.
 */
function requirement(req: Requirement, route: Route): Route {
  return {
    path: route.path,
    component: (params) => {
      if ((req.signedIn || req.permission) && !session.user) return <Redirect to="/profiles" />;
      if (req.permission && !session.can(req.permission)) return <Redirect to="/" />;
      return route.component(params);
    },
  };
}

function Redirect(props: { to: string }) {
  useEffect(() => router.navigate(props.to, { replace: true }), [props.to]);
  return null;
}

const routes: Route[] = [
  {
    path: /^\/setup\/?$/,
    component: async () => {
      const Setup = (await import("./pages/Setup/Setup.tsx")).default;
      return <Setup />;
    },
  },
  {
    path: /^\/profiles\/?$/,
    component: async () => {
      const Profiles = (await import("./pages/Profiles/Profiles.tsx")).default;
      return <Profiles />;
    },
  },
  {
    path: /^\/sign-in\/?$/,
    component: async () => {
      const SignIn = (await import("./pages/SignIn/SignIn.tsx")).default;
      return <SignIn />;
    },
  },
  requirement({ signedIn: true }, {
    path: /^\/settings(?:\/([a-z]+))?\/?$/,
    component: async ([tab]) => {
      const Settings = (await import("./pages/Settings/Settings.tsx")).default;
      return <Settings tab={tab ?? "profile"} />;
    },
  }),
  requirement({ signedIn: true }, {
    path: /^\/library\/(\d+)\/?$/,
    component: async ([id]) => {
      const Library = (await import("./pages/Library/Library.tsx")).default;
      return <Library key={id} id={Number(id)} />;
    },
  }),
  requirement({ signedIn: true }, {
    path: /^\/item\/(\d+)\/?$/,
    component: async ([id]) => {
      const Item = (await import("./pages/Item/Item.tsx")).default;
      return <Item key={id} id={Number(id)} />;
    },
  }),
  requirement({ signedIn: true }, {
    path: /^\/watch\/(\d+)\/?$/,
    component: async ([id]) => {
      const Player = (await import("./pages/Player/Player.tsx")).default;
      return <Player key={id} id={Number(id)} />;
    },
  }),
  requirement({ signedIn: true }, {
    path: /^\/together(?:\/([A-Za-z0-9-]+))?\/?$/,
    component: async ([code]) => {
      const Together = (await import("./pages/Together/Together.tsx")).default;
      return <Together code={code ?? null} />;
    },
  }),
  requirement({ signedIn: true }, {
    path: /^\/collection\/(\d+)\/?$/,
    component: async ([id]) => {
      const Collection = (await import("./pages/Collection/Collection.tsx")).default;
      return <Collection key={id} id={Number(id)} />;
    },
  }),
  requirement({ signedIn: true }, {
    path: /^\/album\/(\d+)\/?$/,
    component: async ([id]) => {
      const Album = (await import("./pages/Music/Album.tsx")).default;
      return <Album key={id} id={Number(id)} />;
    },
  }),
  requirement({ signedIn: true }, {
    path: /^\/artist\/(\d+)\/?$/,
    component: async ([id]) => {
      const Artist = (await import("./pages/Music/Artist.tsx")).default;
      return <Artist key={id} id={Number(id)} />;
    },
  }),
  requirement({ signedIn: true }, {
    path: /^\/playlist\/(\d+)\/?$/,
    component: async ([id]) => {
      const Playlist = (await import("./pages/Music/Playlist.tsx")).default;
      return <Playlist key={id} id={Number(id)} />;
    },
  }),
  requirement({ signedIn: true }, {
    path: /^\/book\/(\d+)\/?$/,
    component: async ([id]) => {
      const Book = (await import("./pages/Books/Book.tsx")).default;
      return <Book key={id} id={Number(id)} />;
    },
  }),
  requirement({ signedIn: true }, {
    path: /^\/photos\/(folder|album)\/(\d+)\/?$/,
    component: async ([kind, id]) => {
      const PhotoAlbum = (await import("./pages/Photos/PhotoAlbum.tsx")).default;
      return <PhotoAlbum key={`${kind}-${id}`} kind={kind as "folder" | "album"} id={Number(id)} />;
    },
  }),
  requirement({ signedIn: true }, {
    path: /^\/read\/(\d+)\/?$/,
    component: async ([id]) => {
      const Reader = (await import("./pages/Books/Reader.tsx")).default;
      return <Reader key={id} id={Number(id)} />;
    },
  }),
  requirement({ signedIn: true }, {
    path: /^\/downloads\/?$/,
    component: async () => {
      const Downloads = (await import("./pages/Downloads/Downloads.tsx")).default;
      return <Downloads />;
    },
  }),
  {
    path: /^\/offline\/([\w.-]+)\/?$/,
    component: async ([key]) => {
      const OfflinePlayer = (await import("./pages/Downloads/OfflinePlayer.tsx")).default;
      return <OfflinePlayer key={key} downloadKey={key} />;
    },
  },
  requirement({ signedIn: true }, {
    path: /^\/person\/(\d+)\/?$/,
    component: async ([id]) => {
      const Person = (await import("./pages/Person/Person.tsx")).default;
      return <Person key={id} id={Number(id)} />;
    },
  }),
  requirement({ signedIn: true }, {
    path: /^\/search\/?$/,
    component: async () => {
      const Search = (await import("./pages/Search/Search.tsx")).default;
      return <Search />;
    },
  }),
  requirement({ signedIn: true }, {
    path: /^\/$/,
    component: async () => {
      const Home = (await import("./pages/Home/Home.tsx")).default;
      return <Home />;
    },
  }),
];

// When the server can't be reached, only what's on this device
const offlineRoutes: Route[] = [
  {
    path: /^\/downloads\/?$/,
    component: async () => {
      const Downloads = (await import("./pages/Downloads/Downloads.tsx")).default;
      return <Downloads offlineMode />;
    },
  },
  {
    path: /^\/offline\/([\w.-]+)\/?$/,
    component: async ([key]) => {
      const OfflinePlayer = (await import("./pages/Downloads/OfflinePlayer.tsx")).default;
      return <OfflinePlayer key={key} downloadKey={key} />;
    },
  },
];

function App() {
  const { ready, server, user, error } = useController(session);
  const { path } = useController(router);
  useController(deviceMode);
  const { language } = useController(i18n);

  useEffect(() => {
    session.init();
    offline.register();
    initSpatialNavigation();
    initGamepad();
    applyAmbient(null);
  }, []);

  // Send people where they belong: setup first, then the profile picker until someone signs in
  useEffect(() => {
    if (!ready || !server) return;
    if (server.needsSetup && path !== "/setup") router.navigate("/setup", { replace: true });
    else if (!server.needsSetup && path === "/setup" && !user) router.navigate("/profiles", { replace: true });
  }, [ready, server?.needsSetup, path, user]);

  // Each profile can pick its own language; before anyone signs in, the one used last on this device stays
  useEffect(() => {
    if (ready && user) i18n.use(user.preferences.language);
  }, [ready, user?.id, user?.preferences.language]);

  // Each profile has its own queue; switching profiles stops the music
  useEffect(() => {
    if (ready) musicPlayer.setUser(user?.id ?? null);
  }, [ready, user?.id]);

  // Downloads carry on, and what was watched offline goes to the server
  useEffect(() => {
    if (!ready || !user) return;
    offline.resumeAll();
    offline.sync(user.id);
  }, [ready, user?.id]);

  if (!ready) {
    return <div className="cn-boot"><Spinner size="2rem" label={t("app.boot.loading")} /></div>;
  }
  if ((error || !server) && offline.downloads.some((d) => d.status === "ready")) {
    return (
      <>
        <RouterView routes={offlineRoutes} fallback={<Redirect to="/downloads" />} />
        <Toaster />
      </>
    );
  }
  if (error || !server) {
    return (
      <div className="cn-boot">
        <Logo size={2.5} />
        <p>{error ?? t("app.boot.unreachable")}</p>
        <Button variant="primary" onClick={() => location.reload()} data-autofocus>{t("common.tryAgain")}</Button>
      </div>
    );
  }

  // Everything is drawn again in a new language, so lines don't need to listen for the change themselves
  return (
    <Fragment key={language}>
      <RouterView routes={routes} fallback={<Redirect to="/" />} />
      {user && (
        <>
          <MiniPlayer />
          <NowPlaying />
          <AddToPlaylist />
          <AddToPhotoAlbum />
        </>
      )}
      <Toaster />
    </Fragment>
  );
}

// The language used last on this device is loaded first, so the app doesn't start in English and then switch
i18n.init().finally(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
