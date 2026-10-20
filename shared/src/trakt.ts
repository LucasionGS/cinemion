/**
 * Types for Trakt: the server's Trakt app (set up once by an admin) and each profile's own connection.
 * Profiles link with Trakt's device sign-in: Cinemion shows a code, the profile enters it on trakt.tv/activate.
 */

/**
 * The Trakt app the server uses. The secret is never sent back, only whether there is one.
 */
export interface TraktAppSettings {
  clientId: string | null;
  hasSecret: boolean;
}

export interface SaveTraktAppRequest {
  clientId?: string | null;
  /**
   * Leave out to keep the saved secret.
   */
  clientSecret?: string | null;
}

/**
 * A profile's Trakt connection.
 */
export interface TraktStatus {
  /**
   * Whether an admin set up the Trakt app, which linking needs.
   */
  available: boolean;
  connected: boolean;
  username: string | null;
}

/**
 * What to show while linking: go to `verificationUrl` and enter `userCode`.
 */
export interface TraktLinkStart {
  userCode: string;
  verificationUrl: string;
  /**
   * Unit is in seconds.
   */
  expiresIn: number;
  /**
   * How often to ask whether it's done. Unit is in seconds.
   */
  interval: number;
}

export interface TraktLinkPoll {
  status: "pending" | "linked" | "expired" | "denied";
  username: string | null;
}

export interface TraktImportResult {
  movies: number;
  episodes: number;
}
