import AppSystem from "../AppSystem.ts";

/**
 * Audio fingerprints for finding the same music in different episodes, like an opening theme or end credits.
 * Each frame of sound becomes a 32-bit code that describes how the loudness of 33 frequency bands changes between
 * neighbouring bands and from the frame before. The same music gives (nearly) the same codes, whatever the volume.
 */
export namespace Fingerprint {
  export const SAMPLE_RATE = 11025;
  const FRAME = 2048;
  const HOP = 1024;
  /**
   * Seconds between frames.
   */
  export const FRAME_SECONDS = HOP / SAMPLE_RATE;
  const BANDS = 33;
  const LOW_HZ = 300;
  const HIGH_HZ = 3000;
  // Codes this close (in differing bits, out of 32) count as the same moment
  const MATCH_BITS = 10;
  // Frames quieter than this hold no music worth matching; silence would match everywhere
  const QUIET = 1e5;

  export interface Print {
    codes: Uint32Array;
    /**
     * Frames loud enough to compare.
     */
    loud: Uint8Array;
    /**
     * Where the print starts in the file. Unit is in seconds.
     */
    offset: number;
  }

  /**
   * A run of matching sound in two prints. Unit is in seconds, from the start of each file.
   */
  export interface Match {
    aStart: number;
    aEnd: number;
    bStart: number;
    bEnd: number;
  }

  /**
   * Decode `seconds` of the first audio track from `start` to mono samples.
   * @returns `null` when the file has no audio or ffmpeg can't read it.
   */
  export async function decode(path: string, start: number, seconds: number): Promise<Int16Array | null> {
    const result = await new Deno.Command(AppSystem.config.FFMPEG_PATH, {
      args: ["-hide_banner", "-loglevel", "error", "-ss", String(start), "-t", String(seconds), "-i", path, "-map", "0:a:0", "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "s16le", "-acodec", "pcm_s16le", "pipe:1"],
      stdin: "null",
      stdout: "piped",
      stderr: "null",
    }).output().catch(() => null);
    if (!result?.success || result.stdout.length < FRAME * 2) return null;
    const bytes = result.stdout;
    return new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  }

  /**
   * In-place radix-2 FFT of `re`/`im` (length a power of two).
   */
  function fft(re: Float64Array, im: Float64Array) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const angle = -2 * Math.PI / size;
      const wr = Math.cos(angle);
      const wi = Math.sin(angle);
      for (let start = 0; start < n; start += size) {
        let cr = 1;
        let ci = 0;
        for (let k = 0; k < size / 2; k++) {
          const a = start + k;
          const b = a + size / 2;
          const tr = re[b] * cr - im[b] * ci;
          const ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
          const next = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = next;
        }
      }
    }
  }

  /**
   * Which FFT bins make up each band: log-spaced between LOW_HZ and HIGH_HZ, where music carries most of its tune.
   */
  const BAND_EDGES = (() => {
    const edges: number[] = [];
    for (let i = 0; i <= BANDS; i++) {
      const hz = LOW_HZ * Math.pow(HIGH_HZ / LOW_HZ, i / BANDS);
      edges.push(Math.round(hz * FRAME / SAMPLE_RATE));
    }
    return edges;
  })();

  const WINDOW = (() => {
    const w = new Float64Array(FRAME);
    for (let i = 0; i < FRAME; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FRAME - 1));
    return w;
  })();

  /**
   * The fingerprint of some samples.
   * @param offset Where the samples start in the file. Unit is in seconds.
   */
  export function compute(samples: Int16Array, offset: number): Print {
    const frames = Math.max(0, Math.floor((samples.length - FRAME) / HOP) + 1);
    const codes = new Uint32Array(frames);
    const loud = new Uint8Array(frames);
    const re = new Float64Array(FRAME);
    const im = new Float64Array(FRAME);
    let previous = new Float64Array(BANDS);
    for (let f = 0; f < frames; f++) {
      const at = f * HOP;
      for (let i = 0; i < FRAME; i++) {
        re[i] = samples[at + i] * WINDOW[i];
        im[i] = 0;
      }
      fft(re, im);
      const energy = new Float64Array(BANDS);
      let total = 0;
      for (let b = 0; b < BANDS; b++) {
        let sum = 0;
        for (let k = BAND_EDGES[b]; k < Math.max(BAND_EDGES[b + 1], BAND_EDGES[b] + 1); k++) sum += re[k] * re[k] + im[k] * im[k];
        energy[b] = sum;
        total += sum;
      }
      let code = 0;
      for (let b = 0; b < BANDS - 1; b++) {
        const now = energy[b] - energy[b + 1];
        const before = previous[b] - previous[b + 1];
        if (now - before > 0) code |= 1 << b;
      }
      codes[f] = code >>> 0;
      // A steady sound (a held tone, hum) barely changes from frame to frame, so its code is almost all zeros and
      // would match any other steady sound; only frames with some movement are worth comparing
      const set = bitsDiffer(codes[f], 0);
      loud[f] = f > 0 && total / BANDS > QUIET && set >= 4 && set <= 28 ? 1 : 0;
      previous = energy;
    }
    return { codes, loud, offset };
  }

  function bitsDiffer(x: number, y: number) {
    let v = (x ^ y) >>> 0;
    v = v - ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }

  function matches(a: Print, b: Print, i: number, j: number) {
    return a.loud[i] === 1 && b.loud[j] === 1 && bitsDiffer(a.codes[i], b.codes[j]) <= MATCH_BITS;
  }

  /**
   * How many frames line up when `b` is shifted by `shift` frames against `a`, looking at every `step`th frame.
   */
  function score(a: Print, b: Print, shift: number, step: number) {
    let count = 0;
    const from = Math.max(0, shift);
    const to = Math.min(a.codes.length, b.codes.length + shift);
    for (let i = from; i < to; i += step) if (matches(a, b, i, i - shift)) count++;
    return count;
  }

  /**
   * The longest stretch of the same sound in both prints, at least `minSeconds` long. `null` when there's none.
   */
  export function longestMatch(a: Print, b: Print, minSeconds: number): Match | null {
    if (a.codes.length === 0 || b.codes.length === 0) return null;
    // Rough pass over every shift, then a full count around the best few
    const rough: { shift: number; score: number }[] = [];
    for (let shift = -(b.codes.length - 1); shift < a.codes.length; shift++) {
      rough.push({ shift, score: score(a, b, shift, 4) });
    }
    rough.sort((x, y) => y.score - x.score);

    let best: Match | null = null;
    let bestLength = 0;
    const tried = new Set<number>();
    for (const candidate of rough.slice(0, 6)) {
      for (let shift = candidate.shift - 3; shift <= candidate.shift + 3; shift++) {
        if (tried.has(shift)) continue;
        tried.add(shift);
        const run = longestRun(a, b, shift);
        if (run && run.length > bestLength) {
          bestLength = run.length;
          best = {
            aStart: a.offset + run.start * FRAME_SECONDS,
            aEnd: a.offset + (run.start + run.length) * FRAME_SECONDS,
            bStart: b.offset + (run.start - shift) * FRAME_SECONDS,
            bEnd: b.offset + (run.start - shift + run.length) * FRAME_SECONDS,
          };
        }
      }
    }
    return best && bestLength * FRAME_SECONDS >= minSeconds ? best : null;
  }

  /**
   * The longest run of frames (in `a`'s numbering) that mostly match at one shift. Short gaps are bridged, since
   * dialogue or sound effects over the music, or frames that line up a little differently, break up the matches.
   */
  function longestRun(a: Print, b: Print, shift: number) {
    const from = Math.max(0, shift);
    const to = Math.min(a.codes.length, b.codes.length + shift);
    // Share of matching frames in a sliding window of about 1.5 s
    const WINDOW_FRAMES = 16;
    // Runs closer together than about 2 s are one run
    const GAP_FRAMES = 22;
    const hits: number[] = [];
    for (let i = from; i < to; i++) hits.push(matches(a, b, i, i - shift) ? 1 : 0);

    const runs: { first: number; last: number }[] = [];
    let runStart = -1;
    let sum = 0;
    for (let k = 0; k < hits.length; k++) {
      sum += hits[k];
      if (k >= WINDOW_FRAMES) sum -= hits[k - WINDOW_FRAMES];
      const inRun = k >= WINDOW_FRAMES - 1 && sum / WINDOW_FRAMES >= 0.4;
      if (inRun && runStart < 0) runStart = k - WINDOW_FRAMES + 1;
      if ((!inRun || k === hits.length - 1) && runStart >= 0) {
        // The window starts a run a little early and ends it a little late; trim to the real first and last match
        let first = runStart;
        let last = inRun ? k : k - 1;
        while (first < last && !hits[first]) first++;
        while (last > first && !hits[last]) last--;
        const previous = runs[runs.length - 1];
        if (previous && first - previous.last <= GAP_FRAMES) previous.last = last;
        else runs.push({ first, last });
        runStart = -1;
      }
    }

    let best: { start: number; length: number } | null = null;
    for (const run of runs) {
      const length = run.last - run.first + 1;
      if (!best || length > best.length) best = { start: from + run.first, length };
    }
    return best;
  }
}

export default Fingerprint;
