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
   * Dark page ground tinted with the title's colour.
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
  style.setProperty("--cn-accent-text", lighten(rgb, 0.45));
  style.setProperty("--cn-ambient-base", p.base);
  style.setProperty("--cn-ambient-glow", `rgba(${rgb.join(", ")}, ${palette ? 0.2 : 0.12})`);
}
