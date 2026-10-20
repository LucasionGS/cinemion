# Cinemion handoff

Everything an assistant needs to pick this project up with no earlier context. Read it fully before changing code.
Last updated 2026-10-20, after milestone 8.

## 1. What Cinemion is

A self-hosted media server and player for movies and TV shows: very user friendly, with a fully custom, polished theme and
proper desktop, mobile and TV (10-foot) layouts. It runs as **one self-contained Docker image** (no database container;
volumes for config, cache and media) or as **one compiled binary**. License GPL-3.0-or-later. Owner: Lucasion
(lucasion@hotmail.com). The GitHub repo is `LucasionGS/cinemion` (public), so the image is `ghcr.io/lucasiongs/cinemion`.

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
3. **Docker** with buildx, for the image (`docker build -t cinemion .`). On Arch, buildx is its own package: `sudo pacman -S docker-buildx`.
4. Optional, for GPU conversion on the host: Intel `sudo pacman -S intel-media-driver vpl-gpu-rt` (Debian:
   `intel-media-va-driver-non-free libmfx-gen1.2`), AMD `libva-mesa-driver` / `mesa-va-drivers`. The user must be in the
   `video`/`render` groups. Without host drivers, test GPU paths through the Docker image with `--device /dev/dri`
   (the image ships the Intel and Mesa drivers). The old machine has an Intel Arc GPU; VA-API and Quick Sync both worked
   through Docker.
   The second machine (set up for milestone 6) has an **NVIDIA RTX 4070** with the `nvidia-open` driver: NVENC works on
   the host (Settings › Playback › Run a test: about 10× real time), and the dashboard reads its usage from `nvidia-smi`.
   NVENC inside Docker needs the NVIDIA container toolkit and is still untested.
5. Optional: Python 3 (only used in throwaway shell one-liners), `lsof`, and `gamescope` + `google-chrome-stable` for
   screenshots while the owner's screen is locked (see below).

Then, in the repo:

```sh
deno install                      # npm packages into node_modules
scripts/make-sample-media.sh      # sample library into data/media (gitignored; about a minute, ~200 MB)
cp .env.example .env              # APP_ENV=development makes the server proxy Vite
deno task dev:client              # Vite on :5173
deno task dev                     # API + app on http://localhost:8600
```

Open `http://localhost:8600`, run the setup wizard (create an admin, add `data/media/movies` as a Movies library,
`data/media/shows` as Shows and `data/media/videos` as Videos, metadata source "Local"). There's no TMDB key on the old machine, so TMDB is untested;
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
- Stop servers with `lsof -ti tcp:PORT | xargs -r kill`. Avoid `pkill -f` and `ps | grep` on command text: they match
  the shell running the command itself and kill it (exit code 144). Save PIDs to a file and kill those instead.
- **Screenshots without a screen:** run Chrome inside a headless gamescope and drive it over the DevTools protocol:
  `env -u WAYLAND_DISPLAY XDG_RUNTIME_DIR=/run/user/1000 gamescope --backend headless -W 1440 -H 1000 -- google-chrome-stable --ozone-platform=x11 --autoplay-policy=no-user-gesture-required --user-data-dir=<scratch>/chrome --remote-debugging-port=9222 about:blank`
  (without `XDG_RUNTIME_DIR` gamescope can't open its socket; without `--ozone-platform=x11` Chrome finds no display).
  A small Deno script then takes `http://127.0.0.1:9222/json/list`, opens the page's WebSocket, sets
  `localStorage["cn-token"]`, navigates, and calls `Page.captureScreenshot` (`Emulation.setDeviceMetricsOverride` for
  phone and TV sizes and full-page shots).
- Webhook receiver for tests: a few lines of `Deno.serve` that log each request and check `X-Cinemion-Signature` with
  the webhook's secret. Sonarr/Radarr events can be sent by hand with curl to the address in Settings › Integrations;
  the payload shapes are in `server/src/integrations/ArrWebhook.ts` and the checks in `test.ts`.
- Browser automation quirks seen: hover actions don't fire pointer events, and key presses sometimes stop reaching the
  page; dispatching `KeyboardEvent`s from JavaScript works. Phone and TV layouts can be tested in an iframe
  (390×844, or 1920×1080) or with `?mode=mobile` / `?mode=tv` (note: `?mode=` is remembered in localStorage).
- OpenSubtitles without a real key: the provider reads `OPENSUBTITLES_API_URL`, so a small local mock of `/subtitles`,
  `/download` and the download link works for end-to-end tests.
- Sample media facts: 90-second 720p clips with a running timer burned in (to check seeking/resume); Northbound has an
  H.264 version and a 10-bit HEVC HDR10 version; Glass Harbor has AC3 5.1 audio, an ASS and a forced SRT subtitle;
  Paper Moons is an MP4 with two audio tracks, a mov_text subtitle and two subtitle files next to it (one Windows-1252);
  Home Movie Night is VP9/Opus WebM; the shows include HEVC episodes, a multi-episode file and a special.
  `videos/` has nested folders (Holiday 2024 › Day 2) with recording times in the files, a `folder.jpg`, HEVC drone
  clips with a picture next to one of them (used as its thumbnail), a WebM with an NFO ("Mira turns 8"), and a
  "-trailer" file that a Videos library keeps. To add a Videos library through the API:
  `POST /api/libraries {"name":"Home videos","type":"videos","paths":["<abs>/data/media/videos"],"defaultRating":"G"}`.

## 4. Architecture

Deno workspace (`deno.json` at the root, members `shared`, `server`, `client`).
Library types: `movies`, `shows` and `videos`. Item types: movie, show → season → episode, and in Videos libraries
folder (nested through `parentId`) and video; `isPlayable()` in `shared/src/media.ts` says which ones play. Root tasks: `dev`, `dev:client`, `build`,
`start`, `migrate`, `cli`, `compile` (`scripts/compile.sh` → `dist/linux_x64/bin/cinemion`, ~123 MB with the client
embedded), `check`, `lint`.

### shared/src (types used by both sides, imported as `@shared/…`)
`api.ts` (setup, users, libraries, settings), `profiles.ts` (colours, permissions), `media.ts` (items, files, tracks,
home, search), `playback.ts` (device capabilities, playback info, playback/subtitle settings, trickplay),
`together.ts` (watch together protocol), `languages.ts` (ISO 639-1/2 table), `mod.ts`.

### server/src
- `index.ts` startup (AppSystem → DB → migrations → transcode cleanup → Hono app on `Deno.serve` → watcher + scheduler
  → daily activity pruning; graceful shutdown). `app.ts` (API under `/api`, dev proxy to Vite, production static client with SPA fallback).
- `AppSystem.ts` config from env (see `.env.example`), folders (`CONFIG_DIR`, `CACHE_DIR`, avatars, images, temp),
  `isDocker` via `CINEMION_DOCKER=1`, JWT secret generated into `secret.key`. Version constant `VERSION = "0.1.0"`,
  `startedAt` for the dashboard's uptime.
- `lib/`: `sqlite.ts` (Sequelize dialect shim over Deno's `node:sqlite`, so `deno compile` works), `Ffmpeg.ts`,
  `Tasks.ts` (background jobs with progress and queues, plus the last 50 finished ones), `Logger.ts` (also keeps the
  last 1000 lines for the Logs page), `Network.ts` (LAN vs remote, trusts X-Forwarded-For only from private proxies),
  `RateLimit.ts`, `Avatars.ts`, `MediaRoots.ts`, `http.ts`, `async.ts`, `SystemStats.ts` (CPU from `/proc/stat`
  deltas, memory, GPU usage from `nvidia-smi` / AMD `gpu_busy_percent` / Intel idle residency, disk use via `df -P`),
  `UserAgent.ts` (device names like "TV · Chrome" from the user agent plus the client's `X-Cinemion-Device-Mode` header).
- `models/`: Role, User (bcrypt, JWT, `User.$middleware({ required, admin, permissions })`, `User.fromToken`),
  Setting (JSON per key, `Setting.Keys`), Library, MediaItem (movie/show/season/episode), MediaFile (probe data,
  `sidecars`, `allSubtitles()`; subtitle files get track indexes from 10000), Person, Credit, WatchState, Collection,
  Activity (the dashboard feed, messages stored ready to show, kept 60 days), Webhook (URL, secret, events, last delivery).
  Library has `defaultRating` (Videos libraries: the rating unrated videos count as); MediaItem has `editedAt` and
  `customArtwork`, which keep hand-made details and thumbnails of videos and folders through refreshes.
  `models/index.ts` has associations. Primary keys are auto-increment integers.
- `migrations/` (Umzug; listed by hand in `migrations/index.ts` so they compile into the binary): initial, media,
  browsing, extras (`media_files.sidecars`), admin (`activities`, `webhooks`), videos (`libraries.defaultRating`,
  `media_items.editedAt`, `media_items.customArtwork`).
- `controllers/` (one namespace per resource exporting a Hono `router`, mounted in `ApiController.ts`): server, setup,
  auth, profiles, users, libraries, fs, items, images, settings, home, search, collections, people, playback, subtitles,
  together, admin (dashboard, activity, tasks, logs), integrations (Sonarr/Radarr receiver + path mappings), webhooks.
- `library/`: NameParser, Scanner (walk → probe → sidecar subtitles → sort into items → metadata → queue thumbnails →
  report new titles; `queueFolders()` scans only some folders, debounced 5 s, for Sonarr/Radarr), LibraryWatcher
  (`Deno.watchFs`, 15 s debounce), ScanScheduler (interval setting, `upcoming()`), Sidecars (subtitle files), Visibility
  (library access + age limits), Summaries, ContentRatings, ItemLabels ("Saltwater Kings · S1 E3", show posters for
  episodes, webhook item payloads), VideoDetails (titles from file names, recording dates from `creation_time` or the
  file date, `<name>.nfo` and pictures next to videos, `folder.jpg`/`cover.jpg`, automatic thumbnails with ffmpeg's
  `thumbnail` filter a tenth of the way in, frames for the picker, uploads, folder summaries: newest date, lowest age
  rating, thumbnail), FolderTree (folders and videos as a tree from parent ids, so no path `LIKE` queries).
  In Videos libraries the scanner keeps extras, trailers and samples (only hidden files are skipped), makes one video
  per file and a folder item per folder, and removes emptied folders bottom-up.
- `metadata/`: MetadataProvider base, providers/LocalProvider (NFO + local artwork), providers/TmdbProvider,
  MetadataManager (priority merge, artwork, palettes, credits, collections, "Fix match"), Nfo.
- `images/`: ImageCache (WebP variants via ffmpeg), Palette (ambient colours).
- `media/`: Probe, HardwareAcceleration (GPU detection, test encode, playback settings), PlaybackDecider (direct /
  remux / transcode with plain-language reasons), TranscodeSession (ffmpeg HLS fMP4 sessions in `CACHE_DIR/transcodes`,
  idle reaper, GPU → GPU-encode-only → CPU fallback), Subtitles (WebVTT extraction), Trickplay (seek thumbnail sheets
  in `CACHE_DIR/trickplay`), ActivePlayback (in-memory registry of who's watching what: registered by `/start`, reported
  every 10 s by the player, ended on close or after 150 s of silence; fires the playback webhooks).
- `integrations/`: Events (one call sends a webhook event and, optionally, an activity line with de-duplication),
  Webhooks (HMAC-SHA256 `X-Cinemion-Signature: sha256=…`, retries after 10 s / 1 min / 5 min for network errors, 429
  and 5xx, a test send), ArrWebhook (Sonarr/Radarr payload parsing, path mappings with Windows paths, token in the URL).
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
  decodes), vtt parser, Together (watch together client session), format (bytes, bitrates, relative times), usePoll
  (load every N ms while the tab is visible), clipboard (falls back to `execCommand` on plain-http LAN addresses).
- `Api/`: BaseApi (token in `localStorage["cn-token"]`, sends `X-Cinemion-Device-Mode`), plus one namespace per
  resource (Server, Auth, Users, Libraries, Items, Settings, Playback, Subtitles, Admin, Integrations, Webhooks).
- `components/`: buttons, fields, dialogs, avatar + editor, top bar, app shell, cards (WideCard has a `video`
  variant: length in the corner, folders as a stack with a count), rows, hero, item actions, folder browser, fix-match
  dialog, EditDetailsDialog (videos and folders, with the thumbnail picker), LibraryIcon, and `Player/` (PlayerController, PlayerView, Scrubber, Thumbnail, TrackPanel,
  SubtitleSearchDialog, TogetherPanel, Player.scss).
- `pages/`: Setup, Profiles, SignIn, Home, Library (16:9 grid for Videos libraries), Item (also VideoView and
  FolderView with the folder path), Search, Person, Collection, Player, Together, Settings
  (nav groups "You": Profile, Device; "Server": Dashboard, Libraries, Users, Playback, Metadata, Subtitles,
  Integrations, Webhooks, Tasks (badge with the running count), Logs; the server pages share `Admin.scss`).
  The top bar's profile menu has "Server dashboard" for people with `SERVER_MANAGE`.

### Other files
`Dockerfile` (deno 2.9.7 build stage compiles the binary → `debian:trixie-slim` with Debian ffmpeg, Mesa VA driver,
and on amd64 Intel's non-free VA driver + Quick Sync runtime), `docker/entrypoint.sh` (PUID/PGID, GPU groups),
`docker-compose.yml`, `.env.example`, `scripts/compile.sh`, `scripts/make-sample-media.sh`, `scripts/archive.sh`,
`scripts/aur-publish.sh`, `set_version.sh`, `.github/workflows/` (ci, release), `packaging/` (AUR + systemd),
`README.md` (app style), `docs/screenshots/`, `docs/future-features.md`, `docs/design/decisions.md`, `LICENSE`.

## 5. Milestones

| # | Status | Content |
|---|---|---|
| 0 | done | Design rounds 1–3 (section 6) |
| 1 | done `76ee503` | Foundation: workspace, config, SQLite shim, models/migrations, auth, roles, profiles with PINs and profile pictures, setup wizard, theme, device modes, spatial navigation, Docker |
| 2 | done `8e01fd8` | Libraries & metadata: folder browser, scanner, name parser, watcher, scheduled scans, TMDB + local providers, artwork cache, palettes, Fix match |
| 3 | done `fbabbdd` | Browsing: home rows, library grids with sort/filter, movie/show/season/episode pages, collections, people, search, watch state, age limits |
| 4 | done `8265cbe` | Playback: decision engine, direct play, remux, HLS conversion, GPU acceleration, HDR→SDR, remote limit, player for all layouts, track panel, resume, next-episode countdown, Settings › Playback |
| 5 | done `e310344` | Seek thumbnails (scrubber + TV filmstrip), subtitle files next to videos, OpenSubtitles search/download, watch together, Settings › Subtitles |
| 6 | done | Admin & integrations: dashboard, activity feed, tasks and logs pages, Sonarr/Radarr receiver with path mappings, outgoing webhooks (below) |
| 6b | done | Videos libraries: folders as groups, no online lookups, Edit details, automatic thumbnails, per-library rating for unrated videos (Round 4 in `docs/design/decisions.md`) |
| 7 | done | Distribution: CLI in the binary, CI and Release workflows, GHCR image (amd64 + arm64), AUR `cinemion-bin` with a systemd unit, `set_version.sh`, README with screenshots, MediaHub preset. **0.1.0 released** (GitHub release, `ghcr.io/lucasiongs/cinemion:0.1.0`, AUR `cinemion-bin`) |
| 8 | done | Playback extras: skip intro and credits (audio fingerprints across a season, plus chapter names), surround sound per device, subtitle styling per profile, ASS subtitles drawn with their own styling (below) |
| 9 | **next** | Automatic quality: adaptive HLS with several qualities at once |
| 10 | planned | Watch together chat and reactions |
| 11 | planned | Light theme |
| 12 | planned | Music libraries: artists, albums, tracks, a mini-player that keeps playing, playlists, lyrics |
| 13 | planned | Audiobooks and books: chapters, progress, sleep timer |
| 14 | planned | More metadata (TVDB, OMDb ratings) and Trakt scrobbling |
| 15 | planned | More subtitle sources and automatic subtitle downloads |
| 16 | planned | Offline downloads |
| 17 | planned | Casting to Chromecast / Google TV, and a lighter layout for old smart-TV browsers |
| 18 | planned | Android TV app (WebView wrapper; the SDK is in `~/Android/Sdk` on this machine) |
| 19 | planned | Live TV: IPTV playlists, a guide and recordings |

Not planned in these rounds: **photos** (the owner wants them later; see section 8) and **built-in remote access** (needs a
relay service on ionnet.io that doesn't exist yet). The owner asked for each milestone to be committed and pushed, and
for the work to continue unattended; releases go out with `./set_version.sh` + a tag when a milestone is worth one.

### Milestone 6: what was built
Follows the Round 3 admin mockup (artboard `Admin.dc.html` in the Round 3 canvas): app top bar + left settings nav.
- **Dashboard** (`/settings/dashboard`, `SERVER_MANAGE`, polls every 3 s): "server name · Cinemion version · up N";
  "Scan all libraries"; tiles for streams (direct/converting split, meter = conversions vs. the limit), CPU (+ memory),
  GPU when hardware acceleration is on (otherwise a memory tile) and storage of the library folders; "Now playing"
  cards (poster, profile, device, badge, codec line like "HEVC → H.264 480p with NVENC · AAC stereo", the decider's
  reason, progress, bitrate, a pause icon); running tasks + the next scheduled scan; the last 12 activity lines.
- **Activity feed** (`activities` table): new titles (grouped per show; the first scan of a library is one line),
  "Mira finished Paper Moons", sign-ins (the same profile on the same device only once per 6 h), Sonarr/Radarr imports
  and deletes, subtitle downloads, watch together sessions.
- **Tasks page**: running tasks, buttons (scan all, refresh all details, make missing / remake all seek thumbnails),
  the scan interval (1–48 h, the existing `scanIntervalHours` setting) with each library's next scan, and recent tasks.
- **Logs page**: the last 1000 lines (newest first), level filter, search, download as a text file; only new lines are
  fetched every 3 s, and a server restart is noticed.
- **Settings › Integrations**: the Sonarr/Radarr address (`/api/integrations/arr/<token>`, copy button, warning when
  the page was opened as localhost, "Make new address"), setup steps, the last event received, and path mappings.
  Download/Rename/Delete events rescan only the affected folders (nearest existing folder for deletes); a reported
  folder outside every library is flagged in the UI and the log. Wrong tokens are rate limited per address.
- **Settings › Webhooks**: add/edit (name, URL, events as chips, on/off, secret with copy and "New"), "Send test",
  last delivery status with the retry time. Events: `playback.started|paused|resumed|stopped`, `item.watched`,
  `item.added`, `library.scanned`, `user.signedIn`, `together.started`, `subtitles.downloaded` (types and payloads in
  `shared/src/admin.ts`). Body `{ event, id, sentAt, server: { name, version }, data }`.
- Fixed on the way: a scan finishing while another library's seek thumbnails were being made deleted that
  half-made folder (`Trickplay.cleanup()` now keeps `.tmp` folders of current files); `.cn-settings__row-text` grew to
  14rem tall inside cards (its flex basis is meant for rows), visible on Settings › Subtitles.

### Milestone 7: what was built
- **The binary is also the maintenance CLI**: `cinemion help|version|users|reset-password|remove-pin` (`index.ts`
  hands any arguments to `cli.ts`). `help` and `version` don't touch the config folder, so packaging checks can run them.
- **`.github/workflows/ci.yml`**: check, lint, `test.ts` and the client build on pushes to main and on pull requests.
- **`.github/workflows/release.yml`** on `v*` tags: refuses a tag that doesn't match `AppSystem.VERSION`, runs the
  checks, compiles linux_x64 + linux_arm64 (cross-compiling with `deno compile --target`), packs them with
  `scripts/archive.sh` (reproducible tarballs: binary + LICENSE + README), writes `SHA256SUMS`, creates the release with
  `gh release create` (a dash in the version makes it a prerelease), and pushes the amd64 + arm64 image to
  `ghcr.io/lucasiongs/cinemion` (tags `x.y.z`, `x.y`, and `latest` for non-prereleases). The Dockerfile's build stage
  runs on `$BUILDPLATFORM` and cross-compiles, so only the small runtime stage is emulated for arm64. Both workflows pass
  actionlint (`docker run --rm -v "$(pwd):/repo" -w /repo rhysd/actionlint:latest`).
- **`packaging/`**: `PKGBUILD` for `cinemion-bin` (`_version` holds the release name, `pkgver` swaps a dash for an
  underscore; `!strip`, since stripping cuts the app off a `deno compile` binary; `check()` runs `cinemion version`),
  `cinemion.service` (user `cinemion`, `StateDirectory`/`CacheDirectory`, `ProtectSystem=strict`, `ProtectHome=read-only`,
  GPU groups; never add `MemoryDenyWriteExecute`, V8 needs it off), `cinemion.sysusers`, `cinemion.env` (backed up,
  0640, `MEDIA_ROOTS=/srv:/mnt:/media:/home`). The checksums stay `SKIP` in the repo; `scripts/aur-publish.sh` fills
  them from the published release, writes `.SRCINFO`, test-builds and asks before pushing (`-y` to skip).
- **`set_version.sh <version>`** at the root: `AppSystem.VERSION`, the three `deno.json` versions and the PKGBUILD.
- README: CI and release badges, screenshots in `docs/screenshots/*.webp` (made from the sample media with headless
  Chrome), install per method (Docker, Compose, AUR, binary), maintenance commands, and how to release.
- MediaHub (`~/development/mediahub`, `src/shared/presets.ts`): a Cinemion preset at `http://localhost:8600/?mode=tv`
  with `gamepadKeys`, second in the list (the first is added to new hubs by default). Pushed there as `7fbc2c1`.

### Milestone 8: what was built
- **Intro and credits detection** (`media/Fingerprint.ts`, `media/Markers.ts`): mono 11 kHz audio, 2048-sample
  frames every 1024 samples, 33 log-spaced bands from 300 to 3000 Hz, one 32-bit code per frame from how the band
  differences change over time. Two prints are compared at every time shift (a rough pass on every 4th frame, then the
  best six shifts in full); frames match within 10 differing bits, runs come from a 1.5 s sliding window at 40% and are
  merged across gaps under 2 s, then trimmed to their first and last real match. Quiet frames and frames with fewer
  than 4 or more than 28 set bits (steady tones, hum) never match. Each episode is compared with the next one, then the
  one before: the first 10 minutes for intros (12–180 s long, starting in the first third), the last 8 minutes for
  credits (running to the end when they end within 20 s of it). Chapters named Intro/Opening/OP or
  Credits/Ending/ED/Outro win over audio. Results go in `media_files.markers` with `markersVersion` (bump
  `Markers.VERSION` to look at everything again; a changed file resets to 0). Runs in the `markers` queue after each
  scan; Tasks › "Find intros and credits again". Sample media: Saltwater Kings episodes share a 20 s opening tune and
  15 s credits tune after cold opens of different lengths; Ironwood has chapters.
- **Player**: `PlaybackInfo.markers`; "Skip intro" (bottom right, raised above the controls when they show, focused
  on TV), or skipping by itself (once per intro). With credits known, the up-next card shows when they start and the
  next episode starts 10 s in (`CREDITS_COUNTDOWN`); without, the old 30 s before the end.
- **This device › Playback** (`lib/DevicePrefs.ts`, localStorage `cn-device-prefs`): Speakers (automatic, stereo,
  5.1, 7.1, receiver: passes AC3/E-AC3 through even when the browser doesn't claim it) feeds `detectCapabilities()`;
  Intros (show Skip / skip by itself / off).
- **Subtitle style per profile** (`users.preferences` JSON, `normalizePreferences()` in `shared/src/profiles.ts`, saved
  with `PATCH /api/users/me`): size, colour (`--cn-subtitle-*` tokens), background (box, outline, none), with a live
  preview in Settings › Your profile that uses the player's own classes.
- **Styled ASS subtitles** with JASSUB 2.5.18 (libass in WebAssembly, loaded lazily; ~2 MB wasm): `SubtitleOption.styledUrl`
  (`/stream/:token/subtitles/:index.ass`), fonts attached to MKVs from `/stream/:token/fonts` (`media/Fonts.ts` dumps
  them once into `CACHE_DIR/fonts`), `timeOffset` = the stream's start, so conversions starting mid-file stay in sync.
  The profile switch "Keep the look of styled subtitles" turns it off. The server serves `.wasm` as `application/wasm`.

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
- **Closing a tab doesn't unmount React**, so cleanup in `destroy()` never runs. The player also listens to `pagehide`
  (save progress, stop the conversion, end the dashboard entry) and reloads its stream on a back/forward-cache `pageshow`.
- **Background tabs run timers about once a minute**, so the dashboard keeps a silent player for 150 s before
  ending it.
- **Deno's `fetch` errors say only "fetch failed"**; the reason ("Connection refused", a DNS error) is in
  `error.cause.message`. `Webhooks.ts` turns those into readable sentences.
- A webhook test receiver must check the signature over the raw body, before any JSON parsing.
- **A file can only be in one library** (`media_files.path` is unique). Overlapping libraries used to be allowed and
  then failed every scan with a bare "Validation error". Now creating, editing and setup refuse folders that are the
  same as, inside or around another library's (`Library.overlapProblem`). Scans skip files another library already
  has, the library list shows a warning for overlaps made before the check, and Edit library can change folders.
  `errorMessage()` adds the details Sequelize keeps in `error.errors` ("path must be unique").

## 8. Open items

- **OpenSubtitles needs a real API key** (free at opensubtitles.com, "API consumers"); set it in Settings › Subtitles
  or `OPENSUBTITLES_API_KEY`. Only tested against a local mock so far.
- **TMDB is untested** (no key).
- **Not tested:** picture subtitles (PGS) drawn into the video (no sample can be generated with ffmpeg), NVENC
  (no NVIDIA GPU), older iPhones (native HLS without MSE), watch together across two real devices, the TV remote inside
  the watch together panel.
- **Sonarr and Radarr are only tested with hand-made payloads** (shapes from their docs: `series.path`,
  `episodeFile.path`, `movie.folderPath`, `movieFile.path`, `renamedEpisodeFiles`, `deleteReason`, `deletedFiles`).
  Worth one run against real instances, especially Sonarr v4's season-pack imports.
- **Dashboard GPU usage**: NVIDIA (`nvidia-smi`) is tested; AMD (`gpu_busy_percent`) and Intel (i915 `rc6_residency_ms`
  / xe `idle_residency_ms` deltas) are written to the kernel docs but untested. The Intel value needs two looks, so the
  first poll shows "—". Storage uses `df -P`, so it shows "—" where `df` is missing (Windows).
- Possible later additions: a full activity history page (the API already pages with `before`), stopping a stream from
  the dashboard, and pushing dashboard updates over a WebSocket instead of polling.
- **Videos:** moving a video to another folder makes it a new video (like movies), so its hand-made details and
  watch progress stay behind. Editing by hand isn't there for movies and shows (the owner chose videos only for now).
  The phone tab bar has room for three libraries; a fourth is only reachable through the top bar on bigger screens.
- **Photos are planned, but not yet** (the owner's words: later, not now). Keep types and shared code ready for them,
  and don't build photo features until asked. Where they would plug in:
  - Types: a `photos` `LibraryType` and a `photo` `ItemType`. Reuse the `folder` item type for albums.
    `isPlayable()` must stay false for photos.
  - `FolderTree` loads `folder` + `video` items; it would load `photo` too, and `videosUnder()` would become a general
    "items under".
  - Scanner: `walk()` only collects `NameParser.isVideo()` files, so photos need an image check. `assignVideos()` is
    the model to copy, with EXIF dates instead of `creation_time`.
  - Images go through `ImageCache`; originals stay on disk like videos do.
  - `Visibility`, the per-library `defaultRating`, Edit details and the 16:9 grids already work per item, not per
    media kind.
- Ideas for later live in `docs/future-features.md`.
