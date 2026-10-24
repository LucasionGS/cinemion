/**
 * Turns text into the token ids the image model's text half reads: CLIP's byte-pair encoding, from the model's
 * `tokenizer.json`.
 */
export class ClipTokenizer {
  public static readonly START = 49406;
  public static readonly END = 49407;
  public static readonly MAX_LENGTH = 77;

  private _vocab: Record<string, number>;
  private _ranks: Map<string, number>;
  private _bytes: string[] = [];
  private _cache = new Map<string, number[]>();

  /**
   * @param config The parsed `tokenizer.json`.
   */
  constructor(config: { model: { vocab: Record<string, number>; merges: (string | [string, string])[] } }) {
    this._vocab = config.model.vocab;
    this._ranks = new Map(config.model.merges.map((m, i) => [Array.isArray(m) ? m.join(" ") : m, i]));
    // Every byte gets a printable character, the way GPT-2's tokenizer does it
    const printable: number[] = [];
    for (let b = 33; b <= 126; b++) printable.push(b);
    for (let b = 161; b <= 172; b++) printable.push(b);
    for (let b = 174; b <= 255; b++) printable.push(b);
    const chars = [...printable];
    let extra = 0;
    for (let b = 0; b < 256; b++) {
      if (printable.includes(b)) continue;
      printable.push(b);
      chars.push(256 + extra++);
    }
    printable.forEach((b, i) => this._bytes[b] = String.fromCodePoint(chars[i]));
  }

  private bpe(word: string): number[] {
    const known = this._cache.get(word);
    if (known) return known;
    const symbols = [...new TextEncoder().encode(word)].map((b) => this._bytes[b]);
    symbols[symbols.length - 1] += "</w>";
    let parts = symbols;
    while (parts.length > 1) {
      let best = -1;
      let bestRank = Infinity;
      for (let i = 0; i < parts.length - 1; i++) {
        const rank = this._ranks.get(`${parts[i]} ${parts[i + 1]}`);
        if (rank !== undefined && rank < bestRank) {
          bestRank = rank;
          best = i;
        }
      }
      if (best < 0) break;
      parts = [...parts.slice(0, best), parts[best] + parts[best + 1], ...parts.slice(best + 2)];
    }
    const ids = parts.map((p) => this._vocab[p]).filter((id) => id !== undefined);
    this._cache.set(word, ids);
    return ids;
  }

  /**
   * Token ids for `text`, with the start and end tokens, cut to the model's length.
   */
  public encode(text: string): number[] {
    const clean = text.normalize("NFC").replace(/\s+/g, " ").toLowerCase();
    const words = clean.match(/'s|'t|'re|'ve|'m|'ll|'d|[\p{L}]+|[\p{N}]|[^\s\p{L}\p{N}]+/gu) ?? [];
    const ids = [ClipTokenizer.START, ...words.flatMap((w) => this.bpe(w))].slice(0, ClipTokenizer.MAX_LENGTH - 1);
    ids.push(ClipTokenizer.END);
    return ids;
  }
}

export default ClipTokenizer;
