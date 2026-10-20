#!/bin/bash
##########################################
# Cinemion version bump, by Lucasion     #
##########################################
# Sets the version everywhere it's written down: the server constant, the workspace members' deno.json files
# and the AUR package. Then commit it as "Bumped to x.y.z" and tag it "vx.y.z" to release.
#
# Usage: ./set_version.sh <VERSION>
#   VERSION  A semver version, like 1.3.0 or 2.0.0-alpha.0

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
VERSION="${1:-}"

# Print a line in green
printf_green() {
  printf "\e[32m%s\e[0m\n" "$1"
}

# Print a line in red, to stderr
printf_red() {
  printf "\e[31m%s\e[0m\n" "$1" >&2
}

# Replace the first match of a sed expression in a file, and fail when nothing matched
replace_in() {
  local FILE="$1"
  local PATTERN="$2"
  local REPLACEMENT="$3"
  if ! grep -qE "$PATTERN" "$FILE"; then
    printf_red "Couldn't find the version in $FILE. Was the line changed by hand?"
    return 1
  fi
  sed -i -E "s|$PATTERN|$REPLACEMENT|" "$FILE"
}

if [[ -z "$VERSION" ]]; then
  echo "Set Cinemion's version everywhere at once."
  echo "Usage: ./set_version.sh <VERSION>"
  exit 2
fi

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]]; then
  printf_red "\"$VERSION\" isn't a valid version. Must match the regex: ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$"
  exit 3
fi

replace_in "$ROOT/server/src/AppSystem.ts" 'export const VERSION = "[^"]*";' "export const VERSION = \"$VERSION\";"
for MEMBER in server client shared; do
  replace_in "$ROOT/$MEMBER/deno.json" '"version": "[^"]*"' "\"version\": \"$VERSION\""
done
# pacman versions can't hold a dash, so the AUR package keeps the release name in _version
replace_in "$ROOT/packaging/PKGBUILD" '^_version=.*$' "_version=$VERSION"
replace_in "$ROOT/packaging/PKGBUILD" '^pkgrel=.*$' "pkgrel=1"

printf_green "Done! Cinemion is now version $VERSION."
echo "To release it:"
echo "  git commit -am \"Bumped to $VERSION\""
echo "  git tag v$VERSION"
echo "  git push && git push origin v$VERSION"
