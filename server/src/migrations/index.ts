import * as initial from "./20261020120000-initial.ts";

/**
 * Every migration, oldest first. Listed by hand (not globbed) so they're included in compiled binaries.
 * Add new migrations at the end with a timestamp-prefixed name.
 */
export const migrations = [
  { name: "20261020120000-initial", ...initial },
];
