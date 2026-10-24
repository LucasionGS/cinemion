#!/bin/bash
##########################################
# Cinemion binary build, by Lucasion     #
##########################################
# Compiles the server and the built web client into a single `cinemion` binary.
# The workspace's lockfile also holds the client's build tools, which `deno compile` would embed,
# so the server is compiled from a staging folder that only knows its own dependencies.
#
# Usage: scripts/compile.sh [TARGET] [OUTPUT]
#   TARGET  Deno target triple, e.g. x86_64-unknown-linux-gnu or aarch64-unknown-linux-gnu. Default is this machine.
#   OUTPUT  Path of the binary. Default is dist/<platform>/bin/cinemion.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-}"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# Work out the IPM-style platform name for the default output path
platform_for() {
  local TRIPLE="$1"
  case "$TRIPLE" in
    x86_64-unknown-linux-gnu) echo "linux_x64" ;;
    aarch64-unknown-linux-gnu) echo "linux_arm64" ;;
    x86_64-pc-windows-msvc) echo "windows_x64" ;;
    *) echo "unknown" ;;
  esac
}

if [[ -z "$TARGET" ]]; then
  case "$(uname -m)" in
    x86_64) TARGET="x86_64-unknown-linux-gnu" ;;
    aarch64 | arm64) TARGET="aarch64-unknown-linux-gnu" ;;
    *) echo "Unsupported architecture: $(uname -m). Pass a Deno target triple as the first argument." >&2; exit 1 ;;
  esac
fi
OUTPUT="${2:-$ROOT/dist/$(platform_for "$TARGET")/bin/cinemion}"

if [[ ! -f "$ROOT/client/dist/index.html" ]]; then
  echo "Building the web client..."
  (cd "$ROOT" && deno task build)
fi

echo "Staging the server..."
mkdir -p "$STAGE/server" "$STAGE/shared" "$STAGE/client"
cp -r "$ROOT/server/src" "$STAGE/server/src"
cp -r "$ROOT/shared/src" "$STAGE/shared/src"
cp -r "$ROOT/client/dist" "$STAGE/client/dist"
# The server's own imports, with @shared pointing at the staged copy
python3 -I - "$ROOT/server/deno.json" "$STAGE/server/deno.json" <<'EOF'
import json, sys
config = json.load(open(sys.argv[1]))
out = { "imports": config["imports"], "nodeModulesDir": "none", "compilerOptions": { "strict": True } }
json.dump(out, open(sys.argv[2], "w"), indent=2)
EOF

echo "Compiling for $TARGET..."
mkdir -p "$(dirname "$OUTPUT")"
# Workers are loaded by URL, so they have to be named to be compiled in
(cd "$STAGE/server" && deno compile -A --quiet --target "$TARGET" --include ../client/dist --include src/clips/RecognitionWorker.ts -o "$OUTPUT" src/index.ts)

echo "Done! Built $OUTPUT ($(du -h "$OUTPUT" | cut -f1))"
