/**
 * API keys that ship with Cinemion, so online sources work out of the box. A key set in Settings or the environment
 * always wins over these.
 *
 * To rotate a key, replace its value here and release a new version. An empty string means there's no built-in key.
 */
export namespace BuiltInKeys {
  /**
   * TMDB API Read Access Token (v4, read-only), from the Cinemion account's API settings on themoviedb.org.
   */
  export const TMDB = "";
}

export default BuiltInKeys;
