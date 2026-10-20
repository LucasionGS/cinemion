# Cinemion: one self-contained image with the server, the web client and ffmpeg. No database container needed.
ARG DENO_VERSION=2.9.7

# Web client + compiled server binary. This stage runs on the build machine's own architecture and cross-compiles
# for the target, so a multi-arch build only emulates the small runtime stage.
FROM --platform=$BUILDPLATFORM denoland/deno:${DENO_VERSION} AS build
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY deno.json deno.lock* ./
COPY shared/ shared/
COPY server/ server/
COPY client/ client/
COPY scripts/ scripts/
RUN deno install && deno task build
RUN case "$TARGETARCH" in \
      arm64) TARGET=aarch64-unknown-linux-gnu ;; \
      *) TARGET=x86_64-unknown-linux-gnu ;; \
    esac \
  && scripts/compile.sh "$TARGET" /out/cinemion

# Runtime
FROM debian:trixie-slim
ARG TARGETARCH
# The source label links the image to the repository on GitHub's container registry
LABEL org.opencontainers.image.title="Cinemion" \
  org.opencontainers.image.description="Self-hosted media server and player for movies, shows and home videos" \
  org.opencontainers.image.source="https://github.com/LucasionGS/cinemion" \
  org.opencontainers.image.licenses="GPL-3.0-or-later"
# ffmpeg for probing, profile pictures and conversion. The GPU drivers let Intel (VA-API and Quick Sync) and
# AMD (VA-API) graphics convert video when /dev/dri is passed in. Intel's full driver is in Debian's non-free
# section, and only exists for x86.
RUN sed -i 's/^Components: main$/Components: main non-free/' /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg mesa-va-drivers ca-certificates tzdata \
  && if [ "$TARGETARCH" = "amd64" ]; then apt-get install -y --no-install-recommends intel-media-va-driver-non-free libmfx-gen1.2; fi \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/cinemion /usr/local/bin/cinemion
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

ENV CINEMION_DOCKER=1 \
  APP_ENV=production \
  PORT=8600 \
  CONFIG_DIR=/config \
  CACHE_DIR=/cache \
  MEDIA_ROOTS=/media \
  PUID=1000 \
  PGID=1000

RUN mkdir -p /config /cache /media
VOLUME ["/config", "/cache"]
EXPOSE 8600
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD bash -c 'exec 3<>/dev/tcp/127.0.0.1/${PORT}' || exit 1
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["cinemion"]
