export interface Cue {
  /**
   * Unit is in seconds.
   */
  start: number;
  end: number;
  text: string;
}

// Example: 00:01:02.500 or 01:02.500
const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})/;

function parseTime(value: string) {
  const match = value.match(TIME);
  if (!match) return null;
  const [, h, m, s, ms] = match;
  return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
}

/**
 * Read the cues of a WebVTT file. Styling tags are dropped except `<i>`, `<b>` and `<u>`, which the player shows.
 */
export function parseVtt(text: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of text.replace(/\r/g, "").split(/\n{2,}/)) {
    const lines = block.split("\n");
    // Example: 00:00:01.000 --> 00:00:04.000 position:10%
    const timing = lines.findIndex((l) => l.includes("-->"));
    if (timing < 0) continue;
    const [from, to] = lines[timing].split("-->");
    const start = parseTime(from);
    const end = parseTime(to);
    if (start === null || end === null) continue;
    const body = lines.slice(timing + 1).join("\n").replace(/<(?!\/?[ibu]>)[^>]+>/g, "").trim();
    if (body) cues.push({ start, end, text: body });
  }
  return cues.sort((a, b) => a.start - b.start);
}

/**
 * Cues showing at `time` seconds.
 */
export function activeCues(cues: Cue[], time: number) {
  return cues.filter((c) => c.start <= time && time < c.end);
}
