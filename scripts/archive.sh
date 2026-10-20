#!/bin/bash
##########################################
# Cinemion release archive, by Lucasion  #
##########################################
# Packs a compiled binary with the license and readme into dist/cinemion-<VERSION>-<PLATFORM>.tar.gz, the files
# GitHub releases and the AUR package use.
#
# Usage: scripts/archive.sh <PLATFORM>
#   PLATFORM  linux_x64 or linux_arm64. The binary must be at dist/<PLATFORM>/bin/cinemion (scripts/compile.sh).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLATFORM="${1:-}"

if [[ -z "$PLATFORM" ]]; then
  echo "Pack a compiled binary for a release." >&2
  echo "Usage: scripts/archive.sh <PLATFORM>" >&2
  echo "  PLATFORM  linux_x64 or linux_arm64" >&2
  exit 2
fi

BINARY="$ROOT/dist/$PLATFORM/bin/cinemion"
if [[ ! -f "$BINARY" ]]; then
  echo "There's no binary at $BINARY. Build it first with scripts/compile.sh." >&2
  exit 1
fi

VERSION="$(sed -n 's/.*export const VERSION = "\(.*\)";.*/\1/p' "$ROOT/server/src/AppSystem.ts")"
if [[ -z "$VERSION" ]]; then
  echo "Couldn't read the version from server/src/AppSystem.ts." >&2
  exit 1
fi

OUTPUT="$ROOT/dist/cinemion-$VERSION-$PLATFORM.tar.gz"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp "$BINARY" "$ROOT/LICENSE" "$ROOT/README.md" "$STAGE/"
# Fixed owner and times, so the same binary always gives the same archive
tar --owner=0 --group=0 --numeric-owner --mtime="@0" -C "$STAGE" -czf "$OUTPUT" cinemion LICENSE README.md

echo "Done! Packed $OUTPUT ($(du -h "$OUTPUT" | cut -f1))"
