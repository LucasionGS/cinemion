import type { ReactNode } from "react";
import LibrariesApi from "../../Api/LibrariesApi.ts";
import TopBar from "../TopBar/TopBar.tsx";
import "./AppShell.scss";

export interface AppShellProps {
  children: ReactNode;
}

/**
 * Page frame for signed-in screens: navigation, the ambient glow and the content area.
 */
export default function AppShell(props: AppShellProps) {
  const { children } = props;
  const libraries = LibrariesApi.useLibraries();
  return (
    <div className="cn-shell">
      <div className="cn-ambient-glow" aria-hidden="true" />
      <TopBar libraries={libraries ?? []} />
      <main className="cn-shell__main">{children}</main>
    </div>
  );
}
