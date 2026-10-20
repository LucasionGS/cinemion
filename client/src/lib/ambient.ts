/**
 * Retints the app from a title's artwork palette (the ambient theme), or back to the fallback accent.
 */

export interface AmbientPalette {
  /**
   * Accent colour, as `#RRGGBB`.
   */
  accent: string;
  /**
   * Text colour on top of the accent.
   */
  onAccent: string;
  /**
   * Dark page ground tinted with the title's colour. The light theme works out its own from the accent.
   */
  base: string;
}

// Sky: used where there's no artwork, like settings and admin pages
export const FALLBACK_PALETTE: AmbientPalette = {
  accent: "#5B9DFF",
  onAccent: "#06121F",
  base: "#08090B",
};

function hexToRgb(hex: string) {
  const value = parseInt(hex.replace("#", ""), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/**
 * Lighten a colour towards white, for accent-coloured text on dark grounds.
 */
function lighten([r, g, b]: number[], amount: number) {
  return `rgb(${Math.round(r + (255 - r) * amount)}, ${Math.round(g + (255 - g) * amount)}, ${Math.round(b + (255 - b) * amount)})`;
}

function luminance(rgb: number[]) {
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Darken a colour until it reads as text on a light ground (a contrast of about 4.5:1 on white).
 */
function readableOnLight(rgb: number[]) {
  let factor = 1;
  while (factor > 0.2 && luminance(rgb.map((c) => c * factor)) > 0.17) factor -= 0.04;
  return `rgb(${rgb.map((c) => Math.round(c * factor)).join(", ")})`;
}

/**
 * The light theme's ground: off-white with a hint of the accent.
 */
function lightBase(rgb: number[]) {
  const ground = [243, 244, 246];
  return `rgb(${ground.map((c, i) => Math.round(c + (rgb[i] - c) * 0.07)).join(", ")})`;
}

/**
 * Apply `palette` to the whole app, or the fallback when `null`.
 */
export function applyAmbient(palette: AmbientPalette | null) {
  const p = palette ?? FALLBACK_PALETTE;
  const rgb = hexToRgb(p.accent);
  const style = document.documentElement.style;
  style.setProperty("--cn-accent", p.accent);
  style.setProperty("--cn-accent-rgb", rgb.join(", "));
  style.setProperty("--cn-on-accent", p.onAccent);
  style.setProperty("--cn-accent-text-dark", lighten(rgb, 0.45));
  style.setProperty("--cn-accent-text-light", readableOnLight(rgb));
  style.setProperty("--cn-ambient-base-dark", p.base);
  style.setProperty("--cn-ambient-base-light", palette ? lightBase(rgb) : "#F3F4F6");
  style.setProperty("--cn-ambient-glow", `rgba(${rgb.join(", ")}, ${palette ? 0.2 : 0.12})`);
}
