import * as initial from "./20261020120000-initial.ts";
import * as media from "./20261021090000-media.ts";
import * as browsing from "./20261022090000-browsing.ts";

/**
 * Every migration, oldest first. Listed by hand (not globbed) so they're included in compiled binaries.
 * Add new migrations at the end with a timestamp-prefixed name.
 */
export const migrations = [
  { name: "20261020120000-initial", ...initial },
  { name: "20261021090000-media", ...media },
  { name: "20261022090000-browsing", ...browsing },
];
