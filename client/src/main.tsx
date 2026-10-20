import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/sora";
import "@fontsource-variable/manrope";
import "./main.scss";
import type { Permission } from "@shared/profiles.ts";
import { session } from "./Session.ts";
import { type Route, router, RouterView } from "./lib/Router.tsx";
import useController from "./lib/useController.ts";
import { deviceMode } from "./lib/DeviceMode.ts";
import { initSpatialNavigation } from "./lib/spatialNavigation.ts";
import { initGamepad } from "./lib/gamepad.ts";
import { applyAmbient } from "./lib/ambient.ts";
import Toaster from "./components/Toaster/Toaster.tsx";
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
    path: /^\/$/,
    component: async () => {
      const Home = (await import("./pages/Home/Home.tsx")).default;
      return <Home />;
    },
  }),
];

function App() {
  const { ready, server, user, error } = useController(session);
  const { path } = useController(router);
  useController(deviceMode);

  useEffect(() => {
    session.init();
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

  if (!ready) {
    return <div className="cn-boot"><Spinner size="2rem" label="Loading Cinemion" /></div>;
  }
  if (error || !server) {
    return (
      <div className="cn-boot">
        <Logo size={2.5} />
        <p>{error ?? "Can't reach the Cinemion server."}</p>
        <Button variant="primary" onClick={() => location.reload()} data-autofocus>Try again</Button>
      </div>
    );
  }

  return (
    <>
      <RouterView routes={routes} fallback={<Redirect to="/" />} />
      <Toaster />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
