import type { Palette as PaletteColors } from "@shared/media.ts";
import Ffmpeg from "../lib/Ffmpeg.ts";
import ImageCache from "./ImageCache.ts";

/**
 * Picks the ambient theme's colours from a title's artwork: a vivid accent, dark text for on top of it,
 * and a near-black page ground tinted with the same hue.
 */
export namespace Palette {
  const SAMPLE_SIZE = 24;
  const HUE_BUCKETS = 18;

  function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h: number;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return [h / 6, s, l];
  }

  function hslToHex(h: number, s: number, l: number) {
    const hueToRgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const channels = [hueToRgb(p, q, h + 1 / 3), hueToRgb(p, q, h), hueToRgb(p, q, h - 1 / 3)];
    return "#" + channels.map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
  }

  /**
   * Build the palette from raw RGB pixels.
   */
  export function fromPixels(pixels: Uint8Array): PaletteColors {
    // Weigh each hue by how colourful and how mid-toned its pixels are, so the accent is a colour you notice
    const weights = new Array(HUE_BUCKETS).fill(0);
    const hueSums = new Array(HUE_BUCKETS).fill(0);
    const satSums = new Array(HUE_BUCKETS).fill(0);
    for (let i = 0; i + 2 < pixels.length; i += 3) {
      const [h, s, l] = rgbToHsl(pixels[i], pixels[i + 1], pixels[i + 2]);
      if (s < 0.2 || l < 0.12 || l > 0.92) continue;
      const weight = s * (1 - Math.abs(l - 0.5) * 1.6);
      const bucket = Math.min(HUE_BUCKETS - 1, Math.floor(h * HUE_BUCKETS));
      weights[bucket] += weight;
      hueSums[bucket] += h * weight;
      satSums[bucket] += s * weight;
    }

    const best = weights.indexOf(Math.max(...weights));
    if (weights[best] <= 0.5) {
      // Black-and-white or very muted artwork: a soft neutral accent
      return { accent: hslToHex(0.6, 0.12, 0.78), onAccent: "#0B0D12", base: "#08090B" };
    }

    const hue = hueSums[best] / weights[best];
    const saturation = Math.min(0.85, Math.max(0.55, satSums[best] / weights[best]));
    // Light enough to read as an accent on the dark UI and to carry dark text on top
    return {
      accent: hslToHex(hue, saturation, 0.68),
      onAccent: hslToHex(hue, 0.6, 0.08),
      base: hslToHex(hue, 0.35, 0.05),
    };
  }

  /**
   * Read the palette from a cached image. `null` when the image can't be read.
   */
  export async function fromImage(key: string): Promise<PaletteColors | null> {
    const path = ImageCache.original(key);
    if (!path) return null;
    try {
      return fromPixels(await Ffmpeg.rawPixels(path, SAMPLE_SIZE));
    } catch {
      return null;
    }
  }
}

export default Palette;
