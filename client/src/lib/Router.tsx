import { type AnchorHTMLAttributes, type MouseEvent, type ReactNode, useEffect, useState } from "react";
import Controller from "./Controller.ts";
import useController from "./useController.ts";

export interface Route {
  path: RegExp;
  /**
   * Renders the page. Pages are imported lazily so each one is its own chunk.
   */
  component: (params: string[]) => Promise<ReactNode> | ReactNode;
}

/**
 * Client-side navigation on top of the History API.
 */
export class RouterController extends Controller {
  public path = location.pathname;
  public query = new URLSearchParams(location.search);

  constructor() {
    super();
    addEventListener("popstate", () => this.sync());
  }

  private sync() {
    this.path = location.pathname;
    this.query = new URLSearchParams(location.search);
    this.notify();
  }

  public navigate(to: string, opts?: { replace?: boolean }) {
    opts ??= {};
    if (to === location.pathname + location.search) return;
    if (opts.replace) history.replaceState(null, "", to);
    else history.pushState(null, "", to);
    this.sync();
    scrollTo({ top: 0 });
  }

  public back(fallback = "/") {
    if (history.length > 1) history.back();
    else this.navigate(fallback, { replace: true });
  }
}

export const router = new RouterController();

/**
 * Render the first route whose `path` matches the current location.
 */
export function RouterView(props: { routes: Route[]; fallback?: ReactNode }) {
  const { routes, fallback = null } = props;
  const { path } = useController(router);
  const [content, setContent] = useState<ReactNode>(null);

  useEffect(() => {
    let cancelled = false;
    for (const route of routes) {
      const match = route.path.exec(path);
      if (!match) continue;
      Promise.resolve(route.component(match.slice(1))).then((node) => {
        if (!cancelled) setContent(node);
      });
      return () => {
        cancelled = true;
      };
    }
    setContent(fallback);
  }, [path, routes]);

  return <>{content}</>;
}

/**
 * An `<a>` that navigates without reloading the page.
 */
export function Link(props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const { href, onClick, ...rest } = props;
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || href.startsWith("http")) return;
    e.preventDefault();
    router.navigate(href);
  };
  return <a href={href} onClick={handleClick} {...rest} />;
}
