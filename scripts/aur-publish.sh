#!/bin/bash
##########################################
# Cinemion AUR publish, by Lucasion      #
##########################################
# Publishes packaging/ as the cinemion-bin AUR package, for the version in the PKGBUILD. The GitHub release for
# that version must exist already (push the tag and wait for the Release workflow).
#
# Usage: scripts/aur-publish.sh [-y|--yes] [-n|--no-build]
#   -y, --yes       Push without asking
#   -n, --no-build  Skip the test build with makepkg

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AUR_REPO="ssh://aur@aur.archlinux.org/cinemion-bin.git"
YES=0
BUILD=1

# Print a line in green
printf_green() {
  printf "\e[32m%s\e[0m\n" "$1"
}

# Print a line in red, to stderr
printf_red() {
  printf "\e[31m%s\e[0m\n" "$1" >&2
}

for ARG in "$@"; do
  case "$ARG" in
    -y | --yes) YES=1 ;;
    -n | --no-build) BUILD=0 ;;
    -yn | -ny) YES=1; BUILD=0 ;;
    *)
      printf_red "Unknown option: $ARG"
      echo "Usage: scripts/aur-publish.sh [-y|--yes] [-n|--no-build]" >&2
      exit 2
      ;;
  esac
done

for TOOL in makepkg updpkgsums git curl; do
  if ! command -v "$TOOL" > /dev/null; then
    printf_red "$TOOL is needed. On Arch it comes with: sudo pacman -S base-devel pacman-contrib git curl"
    exit 1
  fi
done

VERSION="$(sed -n 's/^_version=//p' "$ROOT/packaging/PKGBUILD")"
URL="https://github.com/LucasionGS/cinemion/releases/download/v$VERSION/SHA256SUMS"
if ! curl -fsIL "$URL" > /dev/null; then
  printf_red "There's no GitHub release for $VERSION yet ($URL). Push the tag v$VERSION and wait for the Release workflow."
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
echo "Cloning the AUR package..."
git clone --quiet "$AUR_REPO" "$WORK/cinemion-bin"
cd "$WORK/cinemion-bin"
cp "$ROOT/packaging/"{PKGBUILD,cinemion.service,cinemion.sysusers,cinemion.env} .

echo "Filling in checksums for $VERSION..."
updpkgsums > /dev/null
makepkg --printsrcinfo > .SRCINFO

if [[ "$BUILD" == 1 ]]; then
  echo "Building the package to check it..."
  makepkg -f --noconfirm > "$WORK/build.log" 2>&1 || { printf_red "The test build failed:"; tail -20 "$WORK/build.log" >&2; exit 1; }
  rm -f ./*.pkg.tar.* ./*.tar.gz
  rm -rf src pkg
fi

git add PKGBUILD .SRCINFO cinemion.service cinemion.sysusers cinemion.env
if git diff --cached --quiet; then
  printf_green "The AUR package is already at $VERSION. Nothing to push."
  exit 0
fi
git --no-pager diff --cached --stat

if [[ "$YES" != 1 ]]; then
  read -r -p "Push cinemion-bin $VERSION to the AUR? [y/N]: " ANSWER
  if [[ "$ANSWER" != "y" ]]; then
    echo "Nothing was pushed."
    exit 0
  fi
fi

git commit --quiet -m "Bumped to $VERSION"
git push --quiet origin HEAD:master
printf_green "Done! Published cinemion-bin $VERSION to the AUR."
