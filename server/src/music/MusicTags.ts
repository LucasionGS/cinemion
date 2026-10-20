import Path from "node:path";

/**
 * Reads what a music file is from its tags, or from its path when it has none: `Artist/Album/01 - Title.mp3`.
 */
export namespace MusicTags {
  export const AUDIO_EXTENSIONS = new Set([
    ".mp3", ".flac", ".m4a", ".m4b", ".aac", ".ogg", ".oga", ".opus", ".wav", ".wma", ".ape", ".aiff", ".aif", ".wv", ".mka", ".mpc", ".dsf",
  ]);

  export const UNKNOWN_ARTIST = "Unknown artist";
  export const UNKNOWN_ALBUM = "Unknown album";
  export const VARIOUS_ARTISTS = "Various Artists";

  export interface TrackDetails {
    title: string;
    /**
     * Who performs the track.
     */
    artist: string;
    /**
     * Whose album it is: the album artist tag, or the track's artist.
     */
    albumArtist: string;
    album: string;
    disc: number | null;
    number: number | null;
    year: number | null;
    genres: string[];
    /**
     * The artist's folder (`Artist` in `Artist/Album/track`), for an artist picture. `null` when the layout isn't like
     * that.
     */
    artistFolder: string | null;
  }

  // Tags too long or too personal to keep in the database; lyrics are read from the file when asked for
  const SKIPPED_TAGS = /^(lyrics|unsyncedlyrics|uslt|comment|description|encoder|encoded_by|itunsmpb|itunnorm|itunes_cddb|major_brand|minor_version|compatible_brands|handler_name|vendor_id)/;
  const MAX_TAG_LENGTH = 500;

  export function isAudio(path: string) {
    return AUDIO_EXTENSIONS.has(Path.extname(path).toLowerCase());
  }

  /**
   * Tags as stored: lowercase names, no lyrics or encoder noise. Ogg and Opus keep their tags on the audio stream
   * rather than the file, so both are merged.
   */
  export function clean(...sources: (Record<string, string> | undefined)[]) {
    const tags: Record<string, string> = {};
    for (const source of sources) {
      for (const [key, value] of Object.entries(source ?? {})) {
        const name = key.toLowerCase().replace(/ /g, "_");
        if (SKIPPED_TAGS.test(name) || typeof value !== "string" || value.length > MAX_TAG_LENGTH) continue;
        tags[name] ??= value.trim();
      }
    }
    return tags;
  }

  /**
   * The number before a slash: "3/12" gives 3. `null` when there's no number.
   */
  export function leadingNumber(value: string | undefined) {
    const match = value?.match(/^\s*(\d+)/);
    return match ? Number(match[1]) : null;
  }

  function year(value: string | undefined) {
    const match = value?.match(/(1[89]\d\d|20\d\d)/);
    return match ? Number(match[1]) : null;
  }

  function genres(value: string | undefined) {
    if (!value) return [];
    // Example: "Rock; Indie" or "Rock/Indie" or "Rock\0Indie"
    return [...new Set(value.split(/[;/\0]|\s,\s|,(?=\S)/).map((g) => g.trim()).filter(Boolean))].slice(0, 6);
  }

  /**
   * A file name without its track number and extension: "01 - Departure.mp3" gives "Departure".
   */
  export function titleFromFile(path: string) {
    const name = Path.basename(path, Path.extname(path));
    // Example: "01 - Departure", "1-03 Departure", "03. Departure", "Artist - 03 - Departure"
    const stripped = name.replace(/^(\d{1,2}[-.])?\d{1,3}\s*[-–._)]?\s+/, "").replace(/^.+? - \d{1,3} - /, "");
    return (stripped || name).replace(/_/g, " ").trim();
  }

  /**
   * What a file is, from its tags, with the folders as a fallback.
   * @param root The library folder the file was found in.
   */
  export function details(path: string, tags: Record<string, string>, root: string): TrackDetails {
    // Folders between the library folder and the file: [Artist, Album] in the usual layout
    const folders = Path.relative(root, Path.dirname(path)).split(Path.sep).filter((p) => p && p !== ".");
    const folderAlbum = folders.length ? folders[folders.length - 1].replace(/\s*[([]\d{4}[)\]]\s*$/, "").trim() : null;
    const folderArtist = folders.length >= 2 ? folders[folders.length - 2] : null;

    const artist = tags.artist || tags.album_artist || tags.albumartist || folderArtist || UNKNOWN_ARTIST;
    const albumArtist = tags.album_artist || tags.albumartist || (tags.compilation === "1" ? VARIOUS_ARTISTS : null) || artist;
    const album = tags.album || folderAlbum || UNKNOWN_ALBUM;
    const number = leadingNumber(tags.track ?? tags.tracknumber) ?? leadingNumber(Path.basename(path).replace(/^\d{1,2}-(?=\d)/, ""));
    const fileDisc = Path.basename(path).match(/^(\d{1,2})-\d{2}\b/);

    return {
      title: tags.title || titleFromFile(path),
      artist,
      albumArtist,
      album,
      disc: leadingNumber(tags.disc ?? tags.discnumber) ?? (fileDisc ? Number(fileDisc[1]) : null),
      number: number !== null && number < 1000 ? number : null,
      year: year(tags.date ?? tags.year ?? tags.originaldate),
      genres: genres(tags.genre),
      artistFolder: folders.length >= 2 ? Path.join(root, ...folders.slice(0, -1)) : null,
    };
  }

  /**
   * A name for grouping: case, spaces and accents don't make two artists or albums.
   */
  export function key(name: string) {
    return name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
  }
}

export default MusicTags;
