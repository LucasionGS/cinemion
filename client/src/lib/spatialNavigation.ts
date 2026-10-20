import { deviceMode } from "./DeviceMode.ts";
import { router } from "./Router.tsx";

/**
 * D-pad navigation for TV mode: arrow keys move focus to the nearest focusable element in that direction,
 * Enter activates it, and Escape/Backspace goes back. Works with remotes, keyboards, gamepads and MediaHub.
 */

type Direction = "up" | "down" | "left" | "right";

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

const KEY_DIRECTIONS: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/**
 * The area focus has to stay in: the top-most open dialog, or the whole page.
 */
function currentScope(): ParentNode {
  const dialogs = document.querySelectorAll<HTMLElement>("[role=dialog][data-open], [role=alertdialog][data-open], [data-focus-scope]");
  return dialogs.length > 0 ? dialogs[dialogs.length - 1] : document;
}

function isVisible(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none" && !el.closest("[inert], [aria-hidden=true]");
}

function focusables(scope: ParentNode) {
  return [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(isVisible);
}

/**
 * Score a candidate: distance along the direction, plus a heavier penalty for being off to the side.
 */
function score(from: DOMRect, to: DOMRect, direction: Direction) {
  const fromCenter = { x: from.left + from.width / 2, y: from.top + from.height / 2 };
  const toCenter = { x: to.left + to.width / 2, y: to.top + to.height / 2 };

  let primary: number;
  let secondary: number;
  switch (direction) {
    case "up":
      primary = from.top - to.bottom;
      secondary = Math.abs(fromCenter.x - toCenter.x);
      break;
    case "down":
      primary = to.top - from.bottom;
      secondary = Math.abs(fromCenter.x - toCenter.x);
      break;
    case "left":
      primary = from.left - to.right;
      secondary = Math.abs(fromCenter.y - toCenter.y);
      break;
    case "right":
      primary = to.left - from.right;
      secondary = Math.abs(fromCenter.y - toCenter.y);
      break;
  }
  // Allow slight overlap, which happens with scaled or tightly packed items
  if (primary < -4) return Infinity;
  return Math.max(primary, 0) + secondary * 2;
}

/**
 * Move focus one step in `direction`. Returns whether focus moved.
 */
export function move(direction: Direction) {
  const scope = currentScope();
  const candidates = focusables(scope);
  const current = document.activeElement as HTMLElement | null;

  if (!current || current === document.body || !(scope as Node).contains(current)) {
    const first = (scope.querySelector<HTMLElement>("[data-autofocus]") ?? candidates[0]);
    first?.focus();
    return !!first;
  }

  const from = current.getBoundingClientRect();
  const horizontal = direction === "left" || direction === "right";
  let best: HTMLElement | null = null;

  if (horizontal) {
    let bestScore = Infinity;
    for (const candidate of candidates) {
      if (candidate === current) continue;
      const rect = candidate.getBoundingClientRect();
      // Left and right only move along the same row; jumping to the top bar from the end of a row feels broken
      if (!(rect.bottom > from.top + 1 && rect.top < from.bottom - 1)) continue;
      const s = score(from, rect, direction);
      if (s < bestScore) {
        bestScore = s;
        best = candidate;
      }
    }
  }
  else {
    // Up and down go to the nearest row first, then to the item in it closest to where focus is now
    const ahead = candidates
      .filter((c) => c !== current)
      .map((c) => ({ el: c, rect: c.getBoundingClientRect() }))
      .filter(({ rect }) => direction === "down" ? rect.top >= from.bottom - 4 : rect.bottom <= from.top + 4);
    if (ahead.length) {
      const edge = (r: DOMRect) => direction === "down" ? r.top : -r.bottom;
      const nearest = Math.min(...ahead.map(({ rect }) => edge(rect)));
      const row = ahead.filter(({ rect }) => edge(rect) - nearest < Math.max(24, from.height * 0.5));
      const center = from.left + from.width / 2;
      const offset = (r: DOMRect) => center < r.left ? r.left - center : center > r.right ? center - r.right : 0;
      // Entering a tab list or nav lands on the selected item, like a TV remote expects
      const selected = row.find(({ el }) => el.getAttribute("aria-selected") === "true" || (el.hasAttribute("aria-current") && el.getAttribute("aria-current") !== "false"));
      best = selected?.el ?? row.sort((a, b) => offset(a.rect) - offset(b.rect))[0].el;
    }
  }

  if (!best) return false;
  best.focus({ preventScroll: true });
  best.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  return true;
}

function isTextInput(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && !["checkbox", "radio", "range", "button", "submit"].includes(el.type);
}

function handleKey(e: KeyboardEvent) {
  if (!deviceMode.isTv() || e.defaultPrevented) return;
  const active = document.activeElement;

  const direction = KEY_DIRECTIONS[e.key];
  if (direction) {
    // Let the caret move inside text fields until it reaches the edge
    if (isTextInput(active) && (direction === "left" || direction === "right")) {
      const atStart = active.selectionStart === 0 && active.selectionEnd === 0;
      const atEnd = active.selectionStart === active.value.length;
      if ((direction === "left" && !atStart) || (direction === "right" && !atEnd)) return;
    }
    // Sliders handle their own arrow keys
    if (active?.getAttribute("role") === "slider" && (direction === "left" || direction === "right")) return;
    if (move(direction)) e.preventDefault();
    return;
  }

  if (e.key === "Enter" && active instanceof HTMLElement && active !== document.body) {
    // Synthetic key presses (gamepad) don't activate buttons by themselves
    if (!e.isTrusted || !(active instanceof HTMLButtonElement || active instanceof HTMLAnchorElement || isTextInput(active))) {
      e.preventDefault();
      active.click();
    }
    return;
  }

  if (e.key === "Escape" || (e.key === "Backspace" && !isTextInput(active))) {
    // Open dialogs close themselves on Escape; otherwise go back a screen
    if (currentScope() !== document) return;
    e.preventDefault();
    router.back();
  }
}

let initialised = false;

/**
 * Start listening for remote and arrow keys. Only acts while the device is in TV mode.
 */
export function initSpatialNavigation() {
  if (initialised) return;
  initialised = true;
  addEventListener("keydown", handleKey);
}
