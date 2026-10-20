# Cinemion handoff

Everything an assistant needs to pick this project up with no earlier context. Read it fully before changing code.
Last updated 2026-10-20, after milestone 5 (commit `e310344`).

## 1. What Cinemion is

A self-hosted media server and player for movies and TV shows: very user friendly, with a fully custom, polished theme and
proper desktop, mobile and TV (10-foot) layouts. It runs as **one self-contained Docker image** (no database container;
volumes for config, cache and media) or as **one compiled binary**. License GPL-3.0-or-later. Owner: Lucasion
(lucasion@hotmail.com, GitHub/GHCR user `lucasion`).

## 2. Rules from the owner (follow these exactly)

- **Never name the media servers that inspired this project** anywhere: code, comments, docs, commit messages, package
  names, UI text. The owner will tell you which names; before every commit, grep the repo for them (case-insensitive,
  whole words, excluding `node_modules`, `data`, `dist`, `.git`). Note that `filter_complex` (an ffmpeg option) matches a
  naive search for one of them; that's fine.
- **Fully custom theme.** Don't use the owner's Neutronic design system or any UI kit's styling. Base UI
  (`@base-ui/react`) is used only as an unstyled accessibility layer; all styling is our own SCSS with `--cn-*` tokens.
- **Commits:** one commit per milestone when asked. Plain `git commit -m "Short summary"`, no body, no Conventional
  Commit prefixes, **no AI attribution or Co-Authored-By lines**. This repo was committed with
  `git -c user.name="Lucasion" -c user.email="lucasion@hotmail.com" commit -q -m "..."`.
  Earlier messages: "Added project foundation", "Added library scanning and metadata", "Added browsing pages, watch state
  and search", "Added playback with direct play, conversion and GPU acceleration", "Added seek thumbnails, subtitle search
  and watch together".
- **Distribution:** binaries on GitHub Releases + an AUR package, Docker image on GHCR. **Not** the owner's IPM package
  manager (so no `ipm-package.yaml`).
- Before each commit run: `deno task check`, `deno lint`, `deno run -A server/src/test.ts`, `deno task build`, and the
  name grep. All must be clean.
- Show progress and ask for design picks with mockups: earlier UI was decided from HTML mockups ("design rounds",
  section 6). For new non-obvious UI, make a small mockup first.

### Coding conventions (from the owner's global instructions)

If `~/.claude/CLAUDE.md` from the owner's other machine is available, copy it over; it is the full version. Summary:

- Deno over Node. 2-space indent, semicolons, **double quotes**. Opening brace on the same line; **`else` / `else if`
  on a new line** after the closing brace; `catch` on the same line. Short guards on one line: `if (!x) return;`.
- **No Prettier or `deno fmt`** (they break the brace style). Lint only (`deno lint`).
- **No test frameworks.** Scratch runner `server/src/test.ts` (`deno run -A server/src/test.ts`) plus running the app.
- Named export **and** default export at the bottom (`export class X {}` … `export default X;`). Companion namespaces
  for related types (`export namespace X { export interface Options {} }`). Stateless helpers and API clients are
  namespaces too. `import type` for type-only imports. Node built-ins with the `node:` prefix as `fs`, `fsp`, `Path`, `os`.
- Explicit access modifiers on class members. Private helpers and backing fields start with `_`.
- Sequelize models use **`declare`** attributes (never `public x!:`), `InferAttributes` / `CreationOptional` /
  `ForeignKey` / `NonAttribute`; one file per model in `models/`; schema changes only through migrations.
- Errors are readable sentences that say how to fix things: `throw new Error("…")`. API errors are
  `{ message: "Readable sentence." }` with the right status code.
- JSDoc `/** … */` (multi-line even for one sentence) on public members. Comments explain *why*, not *what*.
  `//#region` to fold big files. "Example:" comments above parsing code. Never add commented-out code.
- React: functional components, `export default function Name()`, props interface `XxxProps` above it, destructure props
  on the first line. Shared state uses a `Controller` subclass with `notify()` + the `useController()` hook (no context or
  state libraries). Component styles live next to the component (`Name/Name.tsx` + `Name.scss`), kebab-case BEM classes
  with the `cn-` prefix, and colours only through `--cn-*` variables.
- User-facing text: plain, friendly English; no jargon (say "converted", not "transcoded").
- Keep each file's line endings.

## 3. Setting up a new machine

The owner develops on Arch Linux (deploys to Debian/Ubuntu). Needed:

1. **Deno 2.9 or newer** (`curl -fsSL https://deno.land/install.sh | sh`, or `sudo pacman -S deno`).
2. **ffmpeg and ffprobe** with libx264, libx265, libvpx, libopus, libwebp, zscale (zimg) and VA-API/QSV:
   `sudo pacman -S ffmpeg` (Arch) or `sudo apt install ffmpeg` (Debian/Ubuntu).
3. **Docker** with buildx, for the image (`docker build -t cinemion .`).
4. Optional, for GPU conversion on the host: Intel `sudo pacman -S intel-media-driver vpl-gpu-rt` (Debian:
   `intel-media-va-driver-non-free libmfx-gen1.2`), AMD `libva-mesa-driver` / `mesa-va-drivers`. The user must be in the
   `video`/`render` groups. Without host drivers, test GPU paths through the Docker image with `--device /dev/dri`
   (the image ships the Intel and Mesa drivers). The old machine has an Intel Arc GPU; VA-API and Quick Sync both worked
   through Docker.
5. Optional: Python 3 (only used in throwaway shell one-liners), `lsof`.

Then, in the repo:

```sh
deno install                      # npm packages into node_modules
scripts/make-sample-media.sh      # sample library into data/media (gitignored; about a minute, ~200 MB)
cp .env.example .env              # APP_ENV=development makes the server proxy Vite
deno task dev:client              # Vite on :5173
deno task dev                     # API + app on http://localhost:8600
```

Open `http://localhost:8600`, run the setup wizard (create an admin, add `data/media/movies` as a Movies library and
`data/media/shows` as Shows, metadata source "Local"). There's no TMDB key on the old machine, so TMDB is untested;
set one in Settings › Metadata or `TMDB_API_KEY`.

### Handy testing patterns used so far

- Isolated test servers: `CONFIG_DIR=<scratch>/config MEDIA_ROOTS=$(pwd)/data/media PORT=86xx APP_ENV=production deno run -A server/src/index.ts`
  (production mode serves `client/dist`, so run `deno task build` first; or `APP_ENV=development` with Vite running).
  Then set up through the API:
  `curl -X POST localhost:86xx/api/setup -H 'Content-Type: application/json' -d '{"serverName":"Test","admin":{"name":"Ion","username":"ion","password":"test-pass-77"},"libraries":[{"name":"Movies","type":"movies","paths":["<abs>/data/media/movies"]},{"name":"Shows","type":"shows","paths":["<abs>/data/media/shows"]}],"metadata":{"tmdbApiKey":null,"language":"en","country":"US","providers":["local"]}}'`
  The response's `token` is a bearer token; in a browser, put it in `localStorage["cn-token"]`.
- Second profile: `POST /api/users {"name":"Mira","color":"coral","showOnPicker":true}` (admin token), then
  `POST /api/auth/profile {"userId":2}` gives Mira's token. Browser tabs share `localStorage`, and the client reads the token
  once at startup, so set the token right before loading each tab.
- Stop servers with `lsof -ti tcp:PORT | xargs -r kill` (avoid `pkill -f`).
- Browser automation quirks seen: hover actions don't fire pointer events, and key presses sometimes stop reaching the
  page; dispatching `KeyboardEvent`s from JavaScript works. Phone and TV layouts can be tested in an iframe
  (390×844, or 1920×1080) or with `?mode=mobile` / `?mode=tv` (note: `?mode=` is remembered in localStorage).
- OpenSubtitles without a real key: the provider reads `OPENSUBTITLES_API_URL`, so a small local mock of `/subtitles`,
  `/download` and the download link works for end-to-end tests.
- Sample media facts: 90-second 720p clips with a running timer burned in (to check seeking/resume); Northbound has an
  H.264 version and a 10-bit HEVC HDR10 version; Glass Harbor has AC3 5.1 audio, an ASS and a forced SRT subtitle;
  Paper Moons is an MP4 with two audio tracks, a mov_text subtitle and two subtitle files next to it (one Windows-1252);
  Home Movie Night is VP9/Opus WebM; the shows include HEVC episodes, a multi-episode file and a special.

## 4. Architecture

Deno workspace (`deno.json` at the root, members `shared`, `server`, `client`). Root tasks: `dev`, `dev:client`, `build`,
`start`, `migrate`, `cli`, `compile` (`scripts/compile.sh` → `dist/linux_x64/bin/cinemion`, ~123 MB with the client
embedded), `check`, `lint`.

### shared/src (types used by both sides, imported as `@shared/…`)
`api.ts` (setup, users, libraries, settings), `profiles.ts` (colours, permissions), `media.ts` (items, files, tracks,
home, search), `playback.ts` (device capabilities, playback info, playback/subtitle settings, trickplay),
`together.ts` (watch together protocol), `languages.ts` (ISO 639-1/2 table), `mod.ts`.

### server/src
- `index.ts` startup (AppSystem → DB → migrations → transcode cleanup → Hono app on `Deno.serve` → watcher + scheduler;
  graceful shutdown). `app.ts` (API under `/api`, dev proxy to Vite, production static client with SPA fallback).
- `AppSystem.ts` config from env (see `.env.example`), folders (`CONFIG_DIR`, `CACHE_DIR`, avatars, images, temp),
  `isDocker` via `CINEMION_DOCKER=1`, JWT secret generated into `secret.key`. Version constant `VERSION = "0.1.0"`.
- `lib/`: `sqlite.ts` (Sequelize dialect shim over Deno's `node:sqlite`, so `deno compile` works), `Ffmpeg.ts`,
  `Tasks.ts` (background jobs with progress and queues), `Logger.ts`, `Network.ts` (LAN vs remote, trusts
  X-Forwarded-For only from private proxies), `RateLimit.ts`, `Avatars.ts`, `MediaRoots.ts`, `http.ts`, `async.ts`.
- `models/`: Role, User (bcrypt, JWT, `User.$middleware({ required, admin, permissions })`, `User.fromToken`),
  Setting (JSON per key, `Setting.Keys`), Library, MediaItem (movie/show/season/episode), MediaFile (probe data,
  `sidecars`, `allSubtitles()`; subtitle files get track indexes from 10000), Person, Credit, WatchState, Collection.
  `models/index.ts` has associations. Primary keys are auto-increment integers.
- `migrations/` (Umzug; listed by hand in `migrations/index.ts` so they compile into the binary): initial, media,
  browsing, extras (`media_files.sidecars`).
- `controllers/` (one namespace per resource exporting a Hono `router`, mounted in `ApiController.ts`): server, setup,
  auth, profiles, users, libraries, fs, items, images, settings, home, search, collections, people, playback, subtitles,
  together.
- `library/`: NameParser, Scanner (walk → probe → sidecar subtitles → sort into items → metadata → queue thumbnails),
  LibraryWatcher (`Deno.watchFs`, 15 s debounce), ScanScheduler (every 6 h), Sidecars (subtitle files), Visibility
  (library access + age limits), Summaries, ContentRatings.
- `metadata/`: MetadataProvider base, providers/LocalProvider (NFO + local artwork), providers/TmdbProvider,
  MetadataManager (priority merge, artwork, palettes, credits, collections, "Fix match"), Nfo.
- `images/`: ImageCache (WebP variants via ffmpeg), Palette (ambient colours).
- `media/`: Probe, HardwareAcceleration (GPU detection, test encode, playback settings), PlaybackDecider (direct /
  remux / transcode with plain-language reasons), TranscodeSession (ffmpeg HLS fMP4 sessions in `CACHE_DIR/transcodes`,
  idle reaper, GPU → GPU-encode-only → CPU fallback), Subtitles (WebVTT extraction), Trickplay (seek thumbnail sheets
  in `CACHE_DIR/trickplay`).
- `subtitles/`: SubtitleProvider base, providers/OpenSubtitlesProvider (REST API v1, key + optional login),
  SubtitleManager (settings, OpenSubtitles file hash, search, download and save).
- `together/WatchTogether.ts`: in-memory rooms, WebSocket connection handling, sync state.
- `cli.ts` maintenance CLI (`deno task cli help`), `test.ts` scratch checks.

### client/src (React 19 + Vite + SCSS, lucide-react icons, hls.js)
- `main.tsx` route table with regex paths, lazy pages and a `requirement()` guard. Routes: `/setup`, `/profiles`,
  `/sign-in`, `/`, `/library/:id`, `/item/:id`, `/collection/:id`, `/person/:id`, `/search`, `/settings/:tab`,
  `/watch/:id` (`?from=start`, `?together=CODE`), `/together[/:code]`.
- `theme/` tokens (`--cn-*`, TV scales rem with `calc(100vw/80)`) and base styles. Fonts Sora + Manrope via @fontsource.
- `lib/`: Controller + useController, Router, DeviceMode (desktop/mobile/TV, MediaHub detection), spatialNavigation
  (TV D-pad focus engine), gamepad, ambient (title colours), Toasts, playback helpers, capabilities (what the browser
  decodes), vtt parser, Together (watch together client session).
- `Api/`: BaseApi (token in `localStorage["cn-token"]`), plus one namespace per resource (Server, Auth, Users,
  Libraries, Items, Settings, Playback, Subtitles).
- `components/`: buttons, fields, dialogs, avatar + editor, top bar, app shell, cards, rows, hero, item actions,
  folder browser, fix-match dialog, and `Player/` (PlayerController, PlayerView, Scrubber, Thumbnail, TrackPanel,
  SubtitleSearchDialog, TogetherPanel, Player.scss).
- `pages/`: Setup, Profiles, SignIn, Home, Library, Item, Search, Person, Collection, Player, Together, Settings
  (Profile, Device, Users, Libraries, Metadata, Playback, Subtitles tabs).

### Other files
`Dockerfile` (deno 2.9.7 build stage compiles the binary → `debian:trixie-slim` with Debian ffmpeg, Mesa VA driver,
and on amd64 Intel's non-free VA driver + Quick Sync runtime), `docker/entrypoint.sh` (PUID/PGID, GPU groups),
`docker-compose.yml`, `.env.example`, `scripts/compile.sh`, `scripts/make-sample-media.sh`, `README.md` (app style),
`docs/future-features.md`, `docs/design/decisions.md`, `LICENSE`.

## 5. Milestones

| # | Status | Content |
|---|---|---|
| 0 | done | Design rounds 1–3 (section 6) |
| 1 | done `76ee503` | Foundation: workspace, config, SQLite shim, models/migrations, auth, roles, profiles with PINs and profile pictures, setup wizard, theme, device modes, spatial navigation, Docker |
| 2 | done `8e01fd8` | Libraries & metadata: folder browser, scanner, name parser, watcher, scheduled scans, TMDB + local providers, artwork cache, palettes, Fix match |
| 3 | done `fbabbdd` | Browsing: home rows, library grids with sort/filter, movie/show/season/episode pages, collections, people, search, watch state, age limits |
| 4 | done `8265cbe` | Playback: decision engine, direct play, remux, HLS conversion, GPU acceleration, HDR→SDR, remote limit, player for all layouts, track panel, resume, next-episode countdown, Settings › Playback |
| 5 | done `e310344` | Seek thumbnails (scrubber + TV filmstrip), subtitle files next to videos, OpenSubtitles search/download, watch together, Settings › Subtitles |
| 6 | **next** | Admin & integrations (below) |
| 7 | to do | Distribution (below) |

### Milestone 6: admin & integrations (nothing written yet)
Follow the Round 3 admin mockup: app top bar + the existing left settings nav. Planned nav: Dashboard, Libraries,
Users, Playback, Metadata, Subtitles, Integrations, Webhooks, Tasks, Logs (several already exist as Settings tabs in
`client/src/pages/Settings/`).
- **Dashboard** (`SERVER_MANAGE`): header "server name · Cinemion version · up N days" and a "Scan all libraries"
  button; four stat tiles (streams with direct/converting split, CPU, GPU if known, storage of the media folders);
  "Now playing" cards (profile, device, title, direct/converting badge with the reason, codec details, progress, bitrate);
  tasks (running with progress, plus the next scheduled scan); an activity feed ("Mira finished Paper Moons",
  "Glass Harbor was added to Movies", "Sonarr imported …", "Subtitles downloaded for …", new sign-ins).
  Needs: an in-memory registry of active playback (from `/api/playback/:id/start`, progress reports, session pings,
  direct streams), an activity log (probably a small `activities` table via a new migration), system stats
  (`Deno.systemMemoryInfo`, `/proc/stat` or `os.loadavg()`, `Deno.statfs`-like disk usage for media roots).
  Refresh by polling, or push over a WebSocket.
- **Tasks page:** running and recent tasks (keep a short history in `lib/Tasks.ts`), scheduled scans, buttons to scan or
  refresh metadata, regenerate thumbnails.
- **Logs page:** keep the last ~1000 log lines in memory in `lib/Logger.ts` and show them with level filters.
- **Sonarr/Radarr receiver:** a webhook endpoint (token in the URL, generated and shown in Settings › Integrations).
  On "Download"/"Import"/"Rename"/"Delete" events, map the reported path through configurable path mappings
  (their path prefix → our path prefix) and rescan only the affected folder (the scanner needs a "scan these folders"
  mode). Show the URL to paste into Sonarr/Radarr (Settings → Connect → Webhook).
- **Outgoing webhooks:** configurable URLs with event selection (playback started/stopped, item added, user signed in,
  together session started…), JSON payloads signed with HMAC-SHA256 (header like `X-Cinemion-Signature`), retries with
  backoff, a "Send test" button and a last-delivery status.

### Milestone 7: distribution
- `.github/workflows/release.yml`: on a version tag, build binaries for linux_x64 and linux_arm64 (`deno compile`
  targets via `scripts/compile.sh`), attach them to a GitHub Release, and build/push a multi-arch (amd64 + arm64) image to
  `ghcr.io/lucasion/cinemion`.
- `packaging/PKGBUILD` (AUR, installs the binary + `cinemion.service` systemd unit, depends on ffmpeg), the systemd unit
  (runs as a `cinemion` user, data in `/var/lib/cinemion`).
- `set_version.sh <version>`: updates `AppSystem.VERSION`, the `deno.json` versions and the PKGBUILD in one go.
- README polish with screenshots (`<sup>` captions), install instructions per method.
- MediaHub preset (in the owner's separate MediaHub project, `mediahub/src/shared/presets.ts`): Cinemion at
  `http://localhost:8600/?mode=tv` with `gamepadKeys: true`.

## 6. Design decisions

All picks are in `docs/design/decisions.md`, with links to the three mockup artifacts on claude.ai (owner's account).
Short version: logo "Aperture" (an open C lens ring), Sora + Manrope, ambient/adaptive theme taking colours from the
selected title (fallback accent Sky `#5B9DFF`), dark only, top bar navigation (floating tab bar on phones), poster-split
movie page, episode cards, full-width player control bar, TV filmstrip scrubbing, rounded-square initials avatars with
optional uploaded pictures, watch together as a side panel.

## 7. Things learned the hard way

- **Copying video into HLS starts at a keyframe.** `TranscodeSession.copyStart` finds the keyframe before the requested
  time and aims `-ss` a little past it (MKV seeks by decode time, so the exact keyframe time can land one keyframe early).
  The player then gets the real `startOffset`.
- **hls.js with growing EVENT playlists** must not jump to the "live edge": the config sets
  `liveSyncDurationCount` huge, `liveMaxLatencyDurationCount: Infinity`, and `startPosition` to the local start.
- **GPU tone mapping** (`tonemap_vaapi`, `vpp_qsv tonemap`) needs HDR metadata many files lack, or passes HDR through,
  so HDR→SDR always runs through zscale + tonemap on the CPU before the GPU encoder.
- **Quick Sync** ignores forced keyframes without `-forced_idr 1`, and segments come out 10 s long.
- **React StrictMode** runs effects twice in development; `PlayerController.attach()` must work after `destroy()`.
- Dialogs inside the player must render into the player element (`Dialog` has a `container` prop), or they're hidden in
  full screen.
- Watch together guests never save progress. The check uses the global `together` session, not the player's link to it,
  because the player stops following a moment before it moves on to the next episode.
- Subtitle files from the web are often Windows-1252; `Subtitles.ts` detects non-UTF-8 and passes `-sub_charenc CP1252`.
- `deno lint` enforces `verbatim-module-syntax`: use `import type` when only types are used.

## 8. Open items

- **OpenSubtitles needs a real API key** (free at opensubtitles.com, "API consumers"); set it in Settings › Subtitles
  or `OPENSUBTITLES_API_KEY`. Only tested against a local mock so far.
- **TMDB is untested** (no key).
- **Not tested:** picture subtitles (PGS) drawn into the video (no sample can be generated with ffmpeg), NVENC
  (no NVIDIA GPU), older iPhones (native HLS without MSE), watch together across two real devices, the TV remote inside
  the watch together panel.
- Ideas for later live in `docs/future-features.md`.
