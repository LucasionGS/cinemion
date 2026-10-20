#!/bin/bash
##########################################
# Cinemion container entrypoint          #
##########################################
# Runs Cinemion as PUID:PGID, so files in /config and /cache belong to the host user,
# and adds that user to the groups of any passed-in GPU devices for hardware conversion.

set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

if [[ "$(id -u)" != "0" ]]; then
  # Started with --user already: nothing to set up
  exec "$@"
fi

# Create the group and user with the requested ids, reusing existing ones
if ! getent group "$PGID" > /dev/null; then
  groupadd -g "$PGID" cinemion
fi
if ! getent passwd "$PUID" > /dev/null; then
  useradd -u "$PUID" -g "$PGID" -d /config -s /usr/sbin/nologin -M cinemion
fi
USER_NAME="$(getent passwd "$PUID" | cut -d: -f1)"

# Give the user access to GPU devices (VA-API / Quick Sync / NVENC) passed in with --device
EXTRA_GROUPS=""
for DEVICE in /dev/dri/* /dev/nvidia*; do
  [[ -e "$DEVICE" ]] || continue
  GID="$(stat -c %g "$DEVICE")"
  if ! getent group "$GID" > /dev/null; then
    groupadd -g "$GID" "gpu$GID"
  fi
  EXTRA_GROUPS="$EXTRA_GROUPS,$GID"
done

mkdir -p "${CONFIG_DIR:-/config}" "${CACHE_DIR:-/cache}"
chown "$PUID:$PGID" "${CONFIG_DIR:-/config}" "${CACHE_DIR:-/cache}"

exec setpriv --reuid="$PUID" --regid="$PGID" --groups="$PGID$EXTRA_GROUPS" --inh-caps=-all env HOME=/config USER="$USER_NAME" "$@"
