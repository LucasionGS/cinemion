import { deviceMode } from "./DeviceMode.ts";

/**
 * Turns gamepad input into key presses in TV mode, so a controller works like a remote.
 * Skipped inside MediaHub, which already sends its own key presses for the controller.
 */

const BUTTON_KEYS: Record<number, string> = {
  0: "Enter", // A / Cross
  1: "Escape", // B / Circle
  9: "MediaPlayPause", // Start / Options
  12: "ArrowUp",
  13: "ArrowDown",
  14: "ArrowLeft",
  15: "ArrowRight",
};
const DIRECTIONS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
const STICK_THRESHOLD = 0.6;
const REPEAT_DELAY_MS = 400;
const REPEAT_RATE_MS = 110;

const held = new Map<string, number>(); // key -> time of the next repeat

function press(key: string) {
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  target.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }));
}

function poll() {
  requestAnimationFrame(poll);
  if (!deviceMode.isTv() || deviceMode.host === "mediahub" || !document.hasFocus()) {
    held.clear();
    return;
  }

  const pressed = new Set<string>();
  for (const pad of navigator.getGamepads()) {
    if (!pad) continue;
    for (const [index, key] of Object.entries(BUTTON_KEYS)) {
      if (pad.buttons[Number(index)]?.pressed) pressed.add(key);
    }
    const [x = 0, y = 0] = pad.axes;
    if (y < -STICK_THRESHOLD) pressed.add("ArrowUp");
    else if (y > STICK_THRESHOLD) pressed.add("ArrowDown");
    if (x < -STICK_THRESHOLD) pressed.add("ArrowLeft");
    else if (x > STICK_THRESHOLD) pressed.add("ArrowRight");
  }

  const now = performance.now();
  for (const key of pressed) {
    const next = held.get(key);
    if (next === undefined) {
      press(key);
      held.set(key, now + REPEAT_DELAY_MS);
    }
    // Only directions repeat; repeating Enter would activate things twice
    else if (now >= next && DIRECTIONS.includes(key)) {
      press(key);
      held.set(key, now + REPEAT_RATE_MS);
    }
  }
  for (const key of [...held.keys()]) {
    if (!pressed.has(key)) held.delete(key);
  }
}

let started = false;

export function initGamepad() {
  if (started || !("getGamepads" in navigator)) return;
  started = true;
  // Polling starts once a controller is connected, so pages without one don't spin
  addEventListener("gamepadconnected", () => requestAnimationFrame(poll), { once: true });
}
