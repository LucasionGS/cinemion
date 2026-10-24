# Cinemion handoff

Everything an assistant needs to pick this project up with no earlier context. Read it fully before changing code.
Last updated 2026-10-24, after Clips libraries (milestone 21).

## 1. What Cinemion is

A self-hosted media server and player for movies and TV shows (and home videos, music, books and photos): very user friendly, with a fully custom, polished theme and
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
  `photos/` (made by `scripts/sample-photos.ts`, which writes its own EXIF) has Holiday 2024 › Lisbon/Algarve with
  GPS and a Pixel camera, a photo stored sideways (orientation 6), a panorama, a portrait phone video with a
  recording time, Mira turns 8 with a Canon and a PNG dated only by its name, loose photos dated by name
  (`IMG_20261012_101500`, WhatsApp `IMG-…-WA0004`), a HEIC (when `heif-enc` is installed), and an `@eaDir`
  thumbnail and a hidden file that scans must skip. Add it with `"type":"photos"` the same way.
- **Browser checks and the service worker:** built apps register `sw.js`, which can hand headless Chrome old
  chunks after a rebuild. Send `Network.setBypassServiceWorker` and `Network.setCacheDisabled` over CDP first.

## 4. Architecture

Deno workspace (`deno.json` at the root, members `shared`, `server`, `client`).
Library types: `movies`, `shows`, `videos`, `music`, `audiobooks`, `books`, `photos` and `clips`. Item types: movie,
show → season → episode; in Videos libraries folder (nested through `parentId`) and video; in Photos libraries folder,
photo and video; in Clips libraries game → video (a clip; `parentId` null = no game); artist → album → track;
audiobook and book. `isPlayable()` in `shared/src/media.ts` says which ones play
(never photos). Root tasks: `dev`, `dev:client`, `build`,
`start`, `migrate`, `cli`, `compile` (`scripts/compile.sh` → `dist/linux_x64/bin/cinemion`, ~131 MB with the client
embedded), `check`, `lint`.

### shared/src (types used by both sides, imported as `@shared/…`)
`api.ts` (setup, users, libraries, settings), `profiles.ts` (colours, permissions), `media.ts` (items, files, tracks,
home, search), `playback.ts` (device capabilities, playback info, playback/subtitle settings, trickplay),
`together.ts` (watch together protocol), `music.ts` (albums, artists, tracks, playlists, lyrics, `parseLrc`),
`photos.ts` (photo and album summaries, EXIF details, `SLIDESHOW_SECONDS`),
`languages.ts` (ISO 639-1/2 table), `mod.ts`.

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
  `media_items.editedAt`, `media_items.customArtwork`), …, photos, clips (`media_items.clip`, `watch_states.favorite`,
  `clip_embeddings`).
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
  CompatApi (the media server API Seerr and Homepage speak: ids, app keys, sign-in from their headers, item JSON;
  routes in `controllers/CompatController.ts`, mounted at the root in `app.ts`; see "App API" below).
- `subtitles/`: SubtitleProvider base, providers/OpenSubtitlesProvider (REST API v1, key + optional login),
  SubtitleManager (settings, OpenSubtitles file hash, search, download and save).
- `together/WatchTogether.ts`: in-memory rooms, WebSocket connection handling, sync state.
- `music/`: MusicTags (tags or folders → artist, album, disc, track), MusicLibrary (sorting tracks into albums,
  covers, artist pictures), MusicSummaries, AudioStream (direct or converted once to AAC), Lyrics (LRC files, tags).
- `photos/`: Exif (reads JPEG, PNG, WebP, TIFF and HEIC/HEIF/AVIF headers itself), PhotoLibrary (file types, dates,
  thumbnails, copies for viewing, `convert()`), PhotoSummaries. Model `PhotoAlbum` + `PhotoAlbumItem`, controller
  `PhotosController` (`/api/photos`). See Milestone 20.
- `clips/`: ClipNames (recorder file and folder names), GameInfo (Steam store + SteamGridDB), ClipSettings,
  ClipLibrary (sorting clips into games, game lookups, setting games by hand), ClipTools (keyframes, cutting, small
  copies), Recognition + RecognitionWorker + ClipTokenizer (picture recognition). Model `ClipEmbedding`, controller
  `ClipsController` (`/api/clips`). See Milestone 21.
- `cli.ts` maintenance CLI (`deno task cli help`), `test.ts` scratch checks.

### client/src (React 19 + Vite + SCSS, lucide-react icons, hls.js)
- `main.tsx` route table with regex paths, lazy pages and a `requirement()` guard. Routes: `/setup`, `/profiles`,
  `/sign-in`, `/`, `/library/:id`, `/item/:id`, `/collection/:id`, `/person/:id`, `/search`, `/settings/:tab`,
  `/watch/:id` (`?from=start`, `?together=CODE`), `/together[/:code]`, `/album/:id`, `/artist/:id`, `/playlist/:id`,
  `/photos/folder/:id` and `/photos/album/:id` (`?photo=ID` opens the viewer, `&slideshow=1` plays).
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
- `pages/`: Setup, Profiles, SignIn, Home, Library (16:9 grid for Videos libraries, Music/MusicLibrary for music), Item (also VideoView and
  FolderView with the folder path; GameView and ClipView from `pages/Clips/`), Clips (ClipsLibrary, ClipBrowser), Search, Person, Collection, Player, Together, Settings
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
| 9 | done | Automatic quality: adaptive HLS with several qualities at once (below) |
| 10 | done | Watch together chat and reactions (below) |
| 11 | done | Light theme (below) |
| 12 | done | Music libraries: artists, albums, tracks, a mini-player that keeps playing, playlists, lyrics (below) |
| 13 | done | Audiobooks and books: chapters, progress, sleep timer (below) |
| 14 | done | More metadata (TVDB, OMDb ratings) and Trakt scrobbling (below) |
| 15 | done | More subtitle sources and automatic subtitle downloads (below) |
| 16 | done | Offline downloads (below) |
| 16b | done | App API: Seerr and Homepage can use Cinemion as their media server (below) |
| 16c | done | Uploading media and zip files into libraries from the browser, resumable (below) |
| 16d | done | A TMDB key built into Cinemion, so TMDB works out of the box (below) |
| 17 | on hold | Casting to Chromecast / Google TV, and a lighter layout for old smart-TV browsers |
| 18 | on hold | Android TV app (WebView wrapper; the SDK is in `~/Android/Sdk` on this machine) |
| 19 | on hold | Live TV: IPTV playlists, a guide and recordings |
| 20 | done | Photos libraries: folders as albums, hand-made albums, timeline, viewer with details and slideshows (below) |
| 21 | done | Clips libraries: game clips sorted by game, picture recognition, cutting, small copies, stars (below) |
| 21b | done | Podium's upload protocol: Podium uploads into any library, with the clip's game and details (below) |

Not planned in these rounds: **built-in remote access** (needs a relay service on ionnet.io that doesn't exist yet).
Photos were asked for on 2026-10-21 and became milestone 20. The owner asked for each milestone to be committed and pushed, and
for the work to continue unattended; releases go out with `./set_version.sh` + a tag when a milestone is worth one.
After milestone 13 the owner said to do up to and including 16 and leave 17–19 for now; don't start them until asked.
**0.2.0 released** after milestone 16 (milestones 8–16): GitHub release with both binaries, `ghcr.io/lucasiongs/cinemion:0.2.0`
(and `latest`), AUR `cinemion-bin` 0.2.0.
**0.2.1 released** with the app API (16b): GitHub release with both binaries and `ghcr.io/lucasiongs/cinemion:0.2.1`
(and `latest`). The AUR package skipped 0.2.1.
**0.3.0 released** with uploads from the browser (16c), the built-in TMDB key (16d), TMDB attribution and the About
page: GitHub release with both binaries, `ghcr.io/lucasiongs/cinemion:0.3.0` (and `0.3`, `latest`), AUR `cinemion-bin`
0.3.0.
**0.4.0 released** with Photos libraries (milestone 20): GitHub release with both binaries,
`ghcr.io/lucasiongs/cinemion:0.4.0` (and `0.4`, `latest`, with libheif for HEIC photos), AUR `cinemion-bin` 0.4.0.

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

### Milestone 9: what was built
- **Automatic quality** (`QualityPreset` "auto"): `PlaybackDecider.ladderFor()` picks up to three rungs from `LADDER`
  (1080p 8 Mb/s, 720p 4, 480p 1.5, 360p 0.8) no taller than the source, dropping rungs over the remote bitrate cap.
  `Decision.video.ladder` and `PlaybackInfo.video.ladder` list them.
- **One ffmpeg, several outputs**: shared filters (tone mapping, burned-in picture subtitles) run once, then `split`
  feeds one scale chain per rung (`-filter_complex`), each with its own `-b:v:N`/`-maxrate:v:N`; the audio is mapped
  once per rung. `-var_stream_map` + `-master_pl_name index.m3u8` write `v0/`, `v1/`… (`stream.m3u8`, `init_N.mp4`,
  `segNNNNN.m4s`); keyframes are forced every 4 s on every rung so hls.js can switch at any segment. Routes:
  `/session/:id/:variant{v[0-9]}/:file`.
- **Conversion limit**: an automatic session counts once per rung (`TranscodeSession.weight()`). With less room the
  server keeps the best rung and the smallest. A start that replaces a stream (same `playbackId`, like picking another
  quality) doesn't count the old conversion and stops it once the new one runs, or a 3-rung ladder would be refused
  next to the conversion it replaces.
- **Player**: hls.js ABR picks the rung; `PlayerController.currentHeight` follows `LEVEL_SWITCHED`, shown on the stream
  badge ("720p · Auto") and in the Quality tab ("Now 720p"). The dashboard shows "H.264 720p / 480p / 360p".

### Milestone 10: what was built
- **Chat** over the watch together socket (`chat` messages, `TogetherChatMessage` with the shared position it was sent
  at). Rooms keep the last 100 lines in memory and send them in `welcome`, so reloads and late joiners see the
  conversation. One line, control characters removed, at most `TOGETHER_CHAT_LIMIT` (500) characters, 5 messages per
  5 s per connection ("Slow down a little…" past that).
- **Reactions**: the fixed set `TOGETHER_REACTIONS` (8 per 4 s, extras dropped quietly) float up from the bottom
  right of everyone's player with the sender's name, in five lanes; reduced motion only fades them.
- **Panel**: in a session the watch together panel has Chat and People tabs (People first while alone). With the chat
  out of sight, new messages show as the top notice and as a count on the Watch together button. Player shortcuts
  ignore keys typed into text fields, except Escape.
- **Stale members**: pages kept in the back/forward cache used to stay in the room with their socket open. The
  client closes its socket on such a `pagehide` and rejoins on `pageshow`, and the server drops members silent for
  150 s (close code 3008, so a player that wakes up reconnects).

### Milestone 11: what was built
- **Tokens** (`theme/_tokens.scss`): every colour lives in the `dark-colors` and `light-colors` mixins. `:root` gets
  the dark set, `:root[data-theme="light"]` the light one, and `.cn-dark-theme` puts the dark set back on things
  that stay dark: the player, its loading and error pages, and card artwork (badges and progress over pictures).
  `--cn-fg-rgb` is the text colour as RGB for thin tints (`rgba(var(--cn-fg-rgb), 0.08)` instead of white at 8%).
  New tokens: `--cn-elevated`, `--cn-topbar-glass`, `--cn-shadow`, `--cn-text-placeholder`, `--cn-text-faint`. The
  focus ring is declared with the colours so it uses the colours where it's drawn. Colours on top of artwork stay
  hardcoded on purpose.
- **Ambient colours** (`lib/ambient.ts`) come in both versions: `--cn-accent-text-dark/-light` (light: the accent
  darkened to about 4.5:1 on white) and `--cn-ambient-base-dark/-light` (light: off-white with 7% of the accent).
  The theme picks one, so switching needs no re-tint. Hero backdrops fade to 28% on light pages.
- **Setting**: This device › Theme (Dark, Light, Match device), `lib/Theme.ts`, localStorage `cn-theme`. An inline
  script in `index.html` sets `data-theme` before the first paint; the controller updates the `theme-color` and
  `color-scheme` meta tags.

### Milestone 12: what was built
- **Model**: Music libraries (`LibraryType` "music") hold `artist` → `album` → `track` items through `parentId`.
  Tracks keep the disc in `seasonNumber`, the track number in `episodeNumber`, and who performs them in the new
  `media_items.artist` when that isn't the album's artist. `media_files.tags` keeps the file's tags (lowercase names,
  no lyrics). New tables `playlists` and `playlist_items` (per profile, ordered by `position`, a track can repeat).
  Migration `20261027090000-music`. Libraries' "rating for unrated" works for music too.
- **Scanning** (`music/MusicLibrary.ts`): audio files only (`MusicTags.AUDIO_EXTENSIONS`). Albums group by album
  artist (or `compilation=1` → "Various Artists") and album name, compared without case or accents
  (`MusicTags.key`). Without tags, `Artist/Album (Year)/01 - Title.ext` works, and `2-05 Title` gives disc 2.
  A re-tagged file keeps its track (playlists keep it) and moves album when needed. Covers: `cover`/`folder`/`front`/…
  pictures in the album folder (or one up from `CD1`), else the picture inside the first files; artists get
  `artist.jpg`/`folder.jpg` from their folder, otherwise the client draws initials. One activity line per album.
- **API**: `/api/music/libraries/:id/{albums,artists,tracks,overview,genres,shuffle}`, `/api/music/albums/:id`,
  `/api/music/artists/:id[/tracks]`, `/api/music/tracks/:id/{stream,played,lyrics}`, `/api/music/tracks?ids=`,
  `/api/music/stream/:token[?converted=1]`, `/api/playlists[/:id[/tracks|/entries/:entryId|/order]]`. Search returns
  artists, albums and tracks; home has `recentlyAddedMusic`. Stream tokens moved to `media/StreamGrants.ts` and range
  serving to `sendFile()` in `lib/http.ts`, shared with video.
- **Playing** (`client/src/lib/MusicPlayer.ts`): one `Audio` element for the whole app. The browser lists what it
  plays (`detectAudioFormats()`); anything else (ALAC on Chrome, WMA, APE) is converted to 256k AAC once into
  `CACHE_DIR/audio` before the URL is handed out, so seeking works; unplayed conversions go after 30 days. Queue,
  shuffle (only what comes after the current track; turning it off restores the order), repeat off/all/one, volume,
  a play counted after 30 s or half the track (`WatchState.recordPlay`), Media Session (lock screen, media keys),
  and the queue saved per profile in `localStorage["cn-music-<userId>"]`, restored paused. Media keys work on any page
  except the video player, which pauses the music when it opens.
- **UI**: MiniPlayer (floating bar, above the phone tab bar; pages get room through `:root[data-mini-player]`),
  NowPlaying (full screen, the cover's colours, Up next and Lyrics tabs; synced lyrics highlight and scroll, a click
  seeks), TrackList (album or list layout, disc headings, a menu with Play next, Add to queue, Add to playlist, Go to
  album/artist), MusicCard (`Cover`, AlbumCard, ArtistCard, PlaylistCard, play from the card), AddToPlaylist (one
  dialog at the app root, opened with `addToPlaylist.show(ids)`), pages Music/{MusicLibrary,Album,Artist,Playlist}.
- **Sample media**: `scripts/make-sample-media.sh` makes `music/` (MP3 with embedded covers and an LRC file, two-disc
  FLAC with a cover one folder up and lyrics in a tag, an M4A compilation, ALAC with an artist picture, an untagged
  Opus file).
- **Not done**: the dashboard's "Now playing" doesn't list music yet; no online artist/album info.

### Milestone 13: what was built
- **Library types** `audiobooks` and `books`, items `audiobook` and `book` (`shared/src/books.ts`). Code in
  `server/src/books/`: BookLibrary (sorting, details, covers), Epub (unzips with `fflate`, reads the OPF with regexes:
  title, authors, description, subjects, cover, reading order, chapter titles from nav or NCX), BookSummaries.
  Authors and narrators are `Credit`s with kinds `author`/`narrator`, so person pages list them.
- **Audiobooks**: a folder of audio files is one book (`CD1`/`Disc 2`… folders join their parent), a file in the
  library folder itself (like an `.m4b`) is its own. Files play in disc, track, then natural name order;
  `media_files.chapters` holds ffprobe's chapter marks (ffprobe now runs with `-show_chapters`), otherwise each file
  is a chapter. Narrator from `narrator`/`composer`/`performer`, description from the file or `desc.txt`.
- **Books**: EPUB and PDF, "Author - Title" names split when there's no author. PDF covers come from the first page
  when poppler's `pdftoppm` is there (added to the Docker image and the PKGBUILD's optdepends).
- **Progress** in `watch_states`: audiobooks keep seconds into the whole book; books keep `position` 0–1 with
  `duration` 1 plus `bookmark` (`chapter:fraction`). Migration `20261028090000-books`. Finished = `watched`
  (automatically near the end). Home has `continueBooks` ("Pick up your book"); "Continue watching" leaves books out.
- **API** `/api/books/libraries/:id/{books,genres}`, `/api/books/:id`, `PUT /:id/progress`,
  `POST /:id/parts/:fileId/stream`, `GET /:id/read` (`BookReading`), `/api/books/content/:token/*` (files inside an
  EPUB, or the PDF; sent with `script-src 'none'`).
- **Listening**: the music player's book mode (`musicPlayer.playBook()`): the parts are the queue, `timeline()` and
  `seekTimeline()` work over the whole book, chapters replace previous/next, ±30 s skips, speeds 0.75–2×, a sleep timer
  (minutes or end of chapter), the place saved every 15 s and on pause, and restored from `localStorage` after a
  reload. Now Playing shows the chapter list instead of the queue and lyrics.
- **Reading** (`pages/Books/Reader.tsx`, `/read/:id`): each EPUB chapter loads in an `<iframe sandbox="allow-same-origin">`
  (no scripts run; this page still styles it), with text size, light/sepia/dark pages (`.cn-light-theme` keeps the
  reader's buttons readable on light pages), chapter picker, arrow keys, and the place saved while scrolling. PDFs
  use the browser's viewer with "Mark as finished".

### Milestone 14: what was built
- **TheTVDB** (`metadata/providers/TvdbProvider.ts`, API v4): shows only. Logs in with the project key (+ subscriber
  PIN) and keeps the token for 20 days, logging in again on a 401. Finds the series by `ids.tvdb`, then the IMDb id
  (`/search/remoteid`), then a title/year search scored like TMDB's. Uses `/series/:id/extended`, translations and
  `/series/:id/episodes/default/:lang` (ISO 639-2/T codes via `TvdbProvider.languageCode`), artwork by type (2
  poster, 3 background, 23 clear logo), age ratings by country (`usa`, `nld`… mapped from the 2-letter setting),
  actors as cast. "Fix match" lists TheTVDB results too, and matching by hand stores `{ tvdb: id }`.
- **Settings**: `MetadataSettings` gained `tvdbApiKey`, `tvdbPin`, `omdbApiKey`. `MetadataManager.normalizeSettings()`
  fills in missing keys and appends providers added in newer versions to a saved order (unknown ids are dropped);
  setup, the settings API and `activeProviders()` all go through it. Env fallbacks `TVDB_API_KEY`, `TVDB_PIN`,
  `OMDB_API_KEY`.
- **OMDb** (`metadata/Omdb.ts`): after a movie's or show's details are saved, its IMDb id is looked up once
  (`media_items.ratings`: IMDb score and votes, Tomatometer, Metascore; migration `20261029090000-trakt-ratings`).
  A failed lookup keeps the old ratings. The title page shows them as small "IMDb 7.1 · RT 91% · MC 68" scores and
  hides TMDB's star when there's an IMDb score.
- **Trakt** (`integrations/Trakt.ts`): the admin sets the app's client ID and secret in Settings › Integrations (setting
  `trakt`, env `TRAKT_CLIENT_ID`/`TRAKT_CLIENT_SECRET`). Profiles link in Settings › Your profile with Trakt's
  device sign-in (`/api/trakt/link`, then `/api/trakt/link/poll` every `interval` seconds); tokens live in
  `users.trakt` and are never sent to clients, refreshed a day before they run out, and dropped when the refresh
  fails. Scrobbles go out from `ActivePlayback`'s playback events (start/resume → start, pause, stop; Trakt counts a
  stop past 80% as watched). Marking watched/unwatched by hand updates `/sync/history`. "Bring it in" imports
  `/sync/watched/movies|shows`, matching by TMDB, TheTVDB or IMDb id, only marking what isn't watched yet.
  Only movies and episodes with ids are sent; videos, music and books never are.
- **Testing**: no real keys were available. `TVDB_API_URL`, `OMDB_API_URL` and `TRAKT_API_URL` point the server at
  a mock instead (the scratch `mocks.ts` served all three), the same way `OPENSUBTITLES_API_URL` did.

### Milestone 15: what was built
- **Sources** (`subtitles/providers/`): SubDL (API key, searches by IMDb/TMDB id or title, `languages=EN,BR_PT`,
  season packs marked "Whole-season pack") and Podnapisi (no key, on by default; the XML `search/old` API that
  subliminal and Bazarr use, `sL`/`sK`/`sY`/`sTS`/`sTE`; `n` in `flags` = hearing impaired). Both download zips;
  `SubtitleProvider.fromZip()` takes the episode's file out of a season pack (S01E02 or 1x02 in the name) and
  refuses a pack without one. `download()` now gets the episode. Search order: OpenSubtitles, SubDL, Podnapisi.
  Settings `podnapisiEnabled`, `subdlApiKey` (env `SUBDL_API_KEY`); test URLs `PODNAPISI_URL`, `SUBDL_API_URL`,
  `SUBDL_DOWNLOAD_URL`.
- **Automatic downloads** (`subtitles/SubtitleAutomation.ts`, setting `autoDownload`, languages = the subtitle
  languages): movies and episodes (not videos) without a non-forced track in a language get the best result
  (`rank()`: made for the file, not SDH, provider order, downloads; AI translations and foreign-parts-only are never
  picked, nor results in another language). Runs after a scan that added files (only never-searched files), once a
  day (first ten minutes after startup), when the setting is turned on, and from Tasks › "Download missing
  subtitles" (everything, ignoring waits). `media_files.subtitleSearches` (migration
  `20261030090000-subtitle-searches`) keeps per-language `{ at, attempts, found }`; a miss waits 1, 3, 7, 14, 30,
  30 days, then stops; a changed file starts over. A provider that reports a daily limit is skipped for the rest of
  the run. Downloads go through `SubtitleManager.download()` like manual ones; `SubtitleManager.report()` sends the
  webhook (`subtitles.downloaded` now has `user: null` and `automatic: true` for these) and one activity line for
  runs with more than five.

### Milestone 16: what was built
- **Server** (`controllers/DownloadsController.ts`, permission `MEDIA_DOWNLOAD`, given to the `user` role by migration
  `20261031090000-downloads`): `POST /api/downloads/options` offers the original when `PlaybackDecider` says this
  browser plays it directly, plus 1080p/720p/480p copies no taller than the source (480p always), with size guesses.
  `POST /api/downloads` starts one; download ids describe themselves (`<fileId>.<quality>.<audio or d>`), so there's
  no table. Copies (`media/OfflineCopies.ts`) are H.264 + stereo AAC MP4s with faststart, tone-mapped from HDR,
  made in the `downloads` task queue with progress from `-progress pipe:1`, shared between profiles, kept in
  `CACHE_DIR/downloads` and deleted after a week without fetches. `GET /:id/file` serves ranges (with the sign-in
  header, since `fetch` can send one) and `GET /:id/subtitles/:index.vtt` the text tracks. One activity line per
  download ("Ion saved X to watch offline", de-duplicated for 12 hours; `Events.activity()` now honours
  `dedupeHours`).
- **Client storage** (`lib/Offline.ts`): videos go into Cache Storage `cn-media-v1` in 32 MB pieces
  (`/offline-media/<id>/chunk/<n>`, fetched with `Range`), then a `manifest` entry; an interrupted download carries
  on from the first missing piece (`resumeAll()` after sign-in). Poster and VTT subtitles sit next to them. The list
  is in `localStorage["cn-offline"]`, with the profile that saved each one; offline progress is sent with the
  regular progress call only for that profile (`sync(userId)`, on sign-in, coming back online, and leaving the
  player).
- **Service worker** (`client/public/sw.js`, registered only in built apps): pages network-first with the cached app
  as the fallback, `/assets/*` cache-first, `/api` never cached, and `/offline-media/*/video` answered from the
  pieces for whatever range the video element asks (`Blob.slice`, so it doesn't load the whole file).
- **UI**: a Download button on title pages (a ring fills while it downloads) with a size picker, Downloads in the
  profile menu (`/downloads`: progress, pause/carry on, retry, delete, space used), and `/offline/:id`: native video
  controls with the saved subtitles, resuming at the saved place. When the server can't be reached and something is
  downloaded, the app opens to an offline Downloads page instead of the "can't reach the server" screen.
- **https only**: service workers and Cache Storage need a secure context (https, or localhost). On a plain http LAN
  address the button explains that instead of downloading.

### App API (16b): what was built
Asked for so the owner's Cinemionstack (`~/development/cinemionstack`, a Docker stack with Seerr, Sonarr, Radarr and
friends) can run Seerr and Homepage against Cinemion. Those apps only know other media servers, so Cinemion answers
the part of that API they call. Remember the naming rule: say "apps that speak another media server's API", never
the server's name, in code, docs and commits.
- **Routes** (`controllers/CompatController.ts`, mounted at `/` before the web client; paths are case-sensitive and
  capitalised, so they never clash with the app's lowercase routes): `GET /System/Info/Public` and `/System/Info`,
  `POST /Users/AuthenticateByName` (`{ Username, Pw }`, rate limited like `/api/auth/login`, returns a normal sign-in
  token as `AccessToken`), `/Users`, `/Users/Me`, `/Users/:id`, `/Users/:id/Images/Primary` (redirect to the
  profile picture), `/Users/:id/Views`, `/Library/MediaFolders`, `/Items` (`ids`, `ParentId` library or item,
  `IncludeItemTypes`, `Recursive`, `StartIndex`, `Limit`, `fields=MediaSources`), `/Items/:id`, `/Items/Latest`
  (new episodes count once for their show), `/Items/Counts`, `/Shows/:id/Seasons`, `/Shows/:id/Episodes`
  (`seasonId`), `GET/POST/DELETE /Auth/Keys`, `/Sessions` (from `ActivePlayback`), and `/web/index.html`, a tiny page
  that reads the id from the `#!/details?id=…` link the apps make and opens `/item/<id>`.
- **Ids** are 32 hex characters (the apps check that): a kind letter (`a` user, `b` library, `c` item, `d` file)
  and the number, so item 18 is `c0000000000000000000000000000012`. `CompatApi.encodeId()` / `decodeId()`.
- **Auth** (`CompatApi.userOf()`): a token from any `…Authorization` header's `Token="…"` (URL-decoded, as Homepage
  encodes it), `Bearer`, any `…-Token` header, or `api_key` in the query. App keys act as the admin who made them;
  anything else is checked as a Cinemion sign-in token. Library access and age limits apply as everywhere else.
- **App keys** live in the `compatApi` setting with the server id (made once). Seerr makes its own key with
  `POST /Auth/Keys?App=Seerr` when its owner signs in; Settings › Integrations ("Seerr, Homepage and other apps")
  lists them, makes new ones (admins only) and removes them (`/api/integrations/keys`).
- **Matching in Seerr** needs provider ids: TMDB/TVDB matches, NFO files, or `{tmdb-603}` / `{tvdb-81189}` in folder
  names (Cinemionstack sets Sonarr and Radarr to name folders that way). Seerr marks titles available from these
  scans and links back to them.
- **Tested** with a real Seerr container (setup, user import, library sync, full and recent scans, availability for
  a movie and a partly downloaded show, play links) and the `/Sessions` + `/Items/Counts` shapes Homepage's widget
  reads. `test.ts` checks the ids and item type names.

### Uploads from the browser (16c): what was built
Asked for by the owner: upload media (or zip files with whole seasons) from Settings › Libraries into a library folder,
through a temporary spot, "done properly, ideally resumable" since files can be huge.
- **Server** (`library/Uploads.ts`, `controllers/UploadsController.ts`, `LIBRARY_MANAGE`): each upload is a folder in
  `AppSystem.uploadsDir` (`UPLOAD_DIR`, default `<CACHE_DIR>/uploads`) with `data` and `info.json`, so uploads survive
  restarts (`Uploads.init()` reloads them, takes `received` from the data file's size and restarts ones that were being
  added). `POST /api/uploads` starts one or returns the unfinished upload for the same library, folder, path, size,
  date and fingerprint (a quick hash of the first and last MB; `crypto.subtle` isn't there on plain http).
  `PUT /api/uploads/:id?offset=N` streams a piece (≤ 64 MB) to disk and counts bytes as they're written, so a piece cut
  off halfway keeps what arrived; a wrong offset answers 409 with the upload. Checks before starting: path cleaned
  (`Uploads.cleanPath`: no `..`, hidden parts, drive letters), file type per library type (`Uploads.extensions`, served
  at `/rules`), the folder is inside the library (real paths, symlinked folders can't lead out), write access
  (`GET /check`, shown in the dialog before anything is picked), free space via `df` (`SystemStats.freeSpace`) with a
  256 MB margin, and `UPLOAD_MAX_GB`. Unfinished uploads are deleted after 3 days, finished ones after a day.
- **Adding to the library** runs in the `uploads` task queue (visible on the Tasks page). Single files are renamed into
  place, or copied across drives (EXDEV) after a space check. Zip files are read by `lib/ZipReader.ts` straight from
  disk (central directory, zip64, stored and deflate through `DecompressionStream("deflate-raw")`, CRC and size
  checked per entry); entries keep their folders, `__MACOSX`/`.DS_Store`/`Thumbs.db` are dropped quietly, others the
  library doesn't take, encrypted or unsupported ones, and existing files (unless "replace") are listed as left out.
  Everything is written as a hidden `.<name>.cinemion-upload` next to its target and renamed, so scans and the watcher
  never see half a file. Then `Scanner.queueFolders()` scans where the files went, and the activity feed gets
  "Ion uploaded 10 files to Shows" (new kind `upload`). A failed add keeps the data, so `POST /:id/retry` (optionally
  with `replace`) can try again.
- **Client** (`lib/Uploads.ts` controller `uploads`, `Api/UploadsApi.ts`, `components/UploadDialog/`): one file at a
  time, pieces over XHR for progress (speed, time left), 32 MB pieces halved on a 413 down to 256 KB (nginx allows 1 MB
  by default), connection drops retried with backoff (1–30 s, 40 tries) after asking the server how much arrived.
  Uploads keep going with the dialog closed (the library row shows "Uploading 2 files · 45%"), `beforeunload` warns.
  After a reload, unfinished uploads show as "Stopped at 38%" with "Pick the file"; the same file dropped again also
  carries on. Dialog: FolderBrowser limited to the library (`roots`, `onNavigate`, `onSelect` now optional), an optional
  new subfolder ("Saltwater Kings/Season 1"), drop zone for files and folders (`webkitGetAsEntry`), choose files or a
  folder, a "Replace files that are already there" switch, and the library's uploads with left-out files listed.
- **Read-only media** is the default in the README's Docker examples (`:ro`) and the systemd unit (`ProtectSystem=strict`),
  so the dialog says how to allow writing (drop `:ro`, or `ReadWritePaths=` via `systemctl edit cinemion`); the README
  has a section for it. Defaults were left read-only on purpose.
- **Tested**: `test.ts` (paths, types, zip stored/deflate/zip64/damaged); end to end against a scratch server (cut-off
  piece, wrong offset, server restart mid-upload, zip into Shows with a stray `.exe`, byte-identical results); in
  headless Chrome (throttled upload with progress, reload mid-upload and carry on, wrong file refused, a mock proxy
  with a 1 MB body limit, phone layout).

### Built-in TMDB key (16d)
- `server/src/metadata/BuiltInKeys.ts` holds `BuiltInKeys.TMDB`, a read-only TMDB API Read Access Token (v4) shipped
  with Cinemion (from the owner's free, non-commercial TMDB developer account). To rotate it, replace the value and release.
- `TmdbProvider.apiKey()` order: the key in Settings › Metadata, then `TMDB_API_KEY`, then the built-in one. A 401 on
  the built-in key says to update Cinemion or add an own key.
- `ServerInfo.hasBuiltInTmdbKey` (public, never the key itself) lets the metadata form (setup and Settings) call the
  field "Your own API key (optional)" with "Uses the key built into Cinemion" as the placeholder.
- The repo is public, so the key is readable on GitHub and from the binary; that's accepted for a read-only token.
- **TMDB attribution** (their API terms): the notice "This product uses TMDB and the TMDB APIs but is not endorsed,
  certified, or otherwise approved by TMDB." word for word, plus their logo, less prominent than Cinemion's.
  `components/TmdbCredit/` (logo from TMDB's logos page, unchanged, in `client/public/credits/tmdb.svg`) shows under
  the TMDB source in the metadata form (setup and Settings › Metadata) and in Credits on the new Settings › About page
  (every profile: version, license, links). The README has a Credits section too.
- **Open:** TMDB's terms also say not to keep their data longer than 6 months. Cinemion stores details until someone
  uses "Refresh all details", so a periodic re-fetch of TMDB details older than 6 months would close that gap.

### Milestone 20: Photos libraries
Picked in design round 5 (`docs/design/decisions.md`, mockups on claude.ai): albums first, both viewers, folders plus
hand-made albums, videos mixed in.
- **Model**: library type `photos`; items `photo` and `video` inside `folder`s (the Videos code: `assignVideos()`,
  `FolderTree.itemsUnder()`, `VideoDetails.refreshFolders()`, which picks the newest by `takenAt` for photos).
  Migration `20261101090000-photos`: `media_items.takenAt` (`YYYY-MM-DDTHH:MM:SS` on the camera's clock, indexed with
  `libraryId`, so photos sort by the minute without time zone trouble), `media_files.photo` (EXIF as `PhotoMeta`),
  tables `photo_albums` (library, maker, title, description, cover) and `photo_album_items`.
- **Scanning**: walk mode `photos` (pictures + videos; hidden files and NAS folders like `@eaDir`, `#recycle` are
  skipped, also in Videos libraries). Pictures aren't ffprobed: `PhotoLibrary.readFile()` stores the EXIF and the
  size as shown (sideways orientations swapped). Dates: EXIF `DateTimeOriginal`, then the file name
  (`takenFromName()`: IMG_20240713_143210, PXL_…, Screenshot 2025-03-02 at 18.04.10, IMG-…-WA0004), then the file
  date. Videos get `takenAt` from `creation_time` (`VideoDetails.recordedAt()`) and their shown size from the
  rotation side data. Thumbnails (longest side 1920, plus the 500 px grid size made right away) are stored under the
  identity `photo:<path>:<size>:<mtime>`, so a changed file gets a new one; "Refresh details" reads the EXIF again.
  No webhook per photo; one activity line per folder ("12 photos and 1 video were added to Lisbon in Photos").
- **Decoding** (`PhotoLibrary.convert()`): ffmpeg's own turning differs between versions (9 turns PNG/WebP/AVIF by
  EXIF, Debian's 7.1 only JPEG), so it runs with `-noautorotate` and the EXIF orientation is applied as filters.
  HEIC/HEIF/AVIF go through `heif-convert` (libheif) when it's installed: Debian's ffmpeg 7.1 shows only one 512 px
  tile of a phone's HEIC and ignores HEIF rotation. The Docker image installs `libheif-examples` with the libde265
  and dav1d plugins (they're only "recommended"); the PKGBUILD lists libheif as optional. Checked in a trixie
  container with the sample files.
- **Viewing**: the viewer shows the 1920 thumbnail at once, then the full picture from `/api/photos/view/<token>`
  (StreamGrants, `reuse()` hands out the same token for a while so the browser cache works): the original for
  JPEG/PNG/WebP/GIF/AVIF/BMP, a JPEG copy (longest side 4096) in `CACHE_DIR/photos` for HEIC/TIFF/JXL, deleted
  after 30 days unused. `?download=1` sends the original. Slideshows stay on thumbnails.
- **API** `/api/photos`: `libraries/:id` (overview: top-level folders + hand-made albums, counts, `sort`),
  `libraries/:id/items?scope=all|loose` (newest first), `folders/:id`, `folders/:id/items[?all=1]` (oldest first;
  `all` takes subfolders in, for slideshows), `PUT folders/:id/cover`, `albums` CRUD, `albums/:id/items`,
  `POST albums/:id/remove`, `/:id` (`PhotoDetail`). Caption, date (keeps the time of day), tags and rating are
  edited with `PUT /api/items/:id/details` (photos are allowed there now). Home has `recentlyAddedPhotos`; search
  has `photoAlbums` (photo-library folders left out of `videos`).
- **Client**: `pages/Photos/` (PhotosLibrary with `?view=timeline`, PhotoAlbum for both kinds, `usePhotoList` with
  `loadAll()`, `usePhotoViewer`, SelectionBar), `components/PhotoGrid` (justified rows from `lib/justify.ts`,
  `content-visibility: auto` sections), `PhotoAlbumCard` (WideCard's folder look), `PhotoViewer` (+ PhotoInfo,
  InlineVideo through PlayerController with the browser's own controls), `AddToPhotoAlbum` (one dialog at the root,
  like AddToPlaylist). `router.navigate(…, { keepScroll: true })` keeps the page where it was when the viewer opens.
  `/item/:id` sends photos and photo folders to the photo pages.
- **Fixed on the way**: folder cards (Videos too) grew taller than 16:9 with a portrait picture; the card's image is
  now positioned absolutely.

### Milestone 21: Clips libraries
Asked for on 2026-10-24 ("being able to tag a game, and if possible auto detect a game by analysing the video"). Picks
(round 6 in `docs/design/decisions.md`): games first, picture recognition as an add-on, cutting, small copies, tags and
stars; no public share links.
- **Model**: library type `clips`. Clips are `video` items (so the player, downloads, Edit details and thumbnails work
  as for videos) whose parent is a `game` item, or none. `media_items.clip` (JSON, `MediaItem.ClipInfo`): the name the
  game was found under (`hint`), a Steam app id, `found` (folder, file, tags, steam, manual), `titled`, `desktop`, the
  picture `suggestion` and `notGames` (suggestions someone turned down). `ItemSummary.clip` (`ClipExtras`) carries the
  game, `takenAt`, the length in seconds and the suggestion to lists. Stars are `watch_states.favorite` per profile
  (`UserData.favorite`). Games keep their Steam/SteamGridDB ids in `externalIds.steam` / `steamgriddb`.
- **Finding the game** (`ClipNames.parse`): the date patterns of NVIDIA (`Game 2025.03.15 - 21.04.33.02.DVR`), AMD
  (`Game_replay_2025.03.15-21.04`), Xbox Game Bar / OBS (`2025-03-15 21-04-33`), PlayStation (`Game_20250315210433`),
  Outplayed (US dates) and Steam (`clip_<appid>_<date>_<time>`); the text before the date is the game, after it the
  clip's own title. Otherwise the nearest folder that isn't generic (recorder folders, years, months). Glued names
  ("RocketLeague") lose to the folder's. "Desktop" recordings get no game and no suggestions. Short and program names
  (CS2, r5apex, VALORANT-Win64-Shipping) go through `ClipNames.ALIASES` / `cleanGameName`. A `game` tag inside the file
  counts too. These name patterns come from how the recorders are known to name files and are only tested with the
  sample clips, not real recordings.
- **Games** (`ClipLibrary`): `GameIndex` finds a new clip's game by name key, the names other clips gave it, or an
  online id; new games are made unmatched and looked up in the scan (`refreshGames`): Steam store search (exact name
  key match only) or `appdetails` by id, then SteamGridDB with a key. Artwork: Steam's `library_600x900_2x.jpg`,
  `library_hero.jpg` and `logo.png` on `shared.steamstatic.com`, SteamGridDB filling gaps. A lookup that finds a game
  the library already has merges the two. No connection = tried again next scan. `lookups: false` turns all of it off.
  Games are removed when they have no clips; their age rating is the lowest of their clips.
- **Picture recognition** (`Recognition`): CLIP ViT-B/16, quantized (Xenova's ONNX export, pinned to a revision with
  SHA-256 checks), plus ONNX Runtime Web 1.20.1's `ort.bundle.min.mjs` and wasm from jsDelivr: about 166 MB, downloaded
  into `CONFIG_DIR/models/clip-vit-b16-q8` from Settings › Metadata. Bundling ONNX Runtime as an npm package added
  ~100 MB to the binary, so it's downloaded and loaded with a dynamic `import()` in a Worker
  (`RecognitionWorker.ts`, listed with `--include` in `scripts/compile.sh`); threads don't work that way, so it runs
  on one thread (about 0.65 s a frame). Four frames per clip are averaged into one vector (`clip_embeddings`).
  Suggestions: the nearest clips that have a game vote (`similar`), and zero-shot against the library's games plus
  `POPULAR_GAMES` (`picture`, counted at 80%); shown from 35% sure. Runs after scans (`autoSuggest`) and after games are
  set by hand. Tested on Steam store screenshots: zero-shot alone got 47% of 40 right, so it's a best guess; matching
  against tagged clips is the strong part.
- **Cutting** (`ClipTools.trim`): ffmpeg stream copy from the keyframe at or before the start (keyframes from packet
  flags), saved next to the original as "<name> (cut)" (a new clip with the same game, tags and date) or over it
  (asks first). Needs write access to the folder, like uploads. Runs in the `clips` task queue, then scans the folder
  through the `scan` queue.
- **Small copies** (`ClipTools.startShare`): two-pass x264 + AAC in MP4 sized to 10–500 MB (`plan()` picks bitrate,
  height and 30/60 fps; one retry if it comes out too big), the main sound track, one track or all mixed. Kept in
  `CACHE_DIR/shares` for a day, downloadable by their random id without signing in (`MEDIA_DOWNLOAD` to make one).
- **Client**: `pages/Clips/` (ClipsLibrary with `?view=clips&game=`, ClipBrowser by month with filters and selection,
  GameView, ClipView), `components/` ClipCard (star on the art), SetGameDialog, ClipRange (preview through
  PlayerController, keyframe ticks, handles), TrimDialog, ShareCopyDialog; `pages/Settings/GamesSettings.tsx` on the
  Metadata page. Home has a "New in …" row per Clips library; search has Games.
- **Tested**: `test.ts` (names, copy sizes, tokenizer); against a scratch server with `scripts/make-sample-media.sh`'s
  clips (scan, Steam lookups, merging CS2 into Counter-Strike 2, suggestions, set game, cut, small copy with mixed
  sound); picture recognition in the compiled binary; pages in headless Chrome (desktop, phone, TV).

### Podium uploads (21b): what was built
Asked for on 2026-10-24: Podium (the owner's clip recorder, `~/development/podium`, protocol in its
`docs/upload-protocol.md` with a reference server) uploads to "Podium-compatible" servers.
- **Targets** (`integrations/Podium.ts`, Settings › Integrations, `SERVER_MANAGE` to make): a name, a library, a folder
  inside its first folder, and for Clips libraries a folder per game; each has its own token (stored like app keys, in
  the `podium` setting). The protocol has no library field, so one target = one library; the server URL is the same
  for all (`<SITE_URL or the request's origin>/api/podium`). Uploads act as the profile that made the target, which
  must still have `LIBRARY_MANAGE`. Wrong tokens are rate limited per address.
- **Protocol** (`controllers/PodiumController.ts`, mounted at `/api/podium`, Podium's `{ error: { code, message } }`
  errors): `GET /server`, `POST /uploads` (an unfinished upload of the same file from the same target carries on; a
  file the library already has, by `media_files.sha256`, answers `200` with its clip), `PUT` pieces of 8 MiB with
  `Content-Range`, `GET` the offset, `POST …/complete` (SHA-256 checked while reading the file, then moved in, the
  folder scanned through the scan queue, details applied; answers within 40 s with the item's link, or the library's
  when the scan takes longer, and the same answer when asked again), `DELETE`.
- **On top of `Uploads`**: sessions can wait for an explicit `complete()` (`manualFinish`) and keep `extra` data in
  `info.json`, so Podium uploads survive restarts like browser uploads, and also show in a library's upload list.
- **Details** (`Podium.applyDetails`): sound track names fill in tracks without a title. Clips: the game Podium names
  (`steam:<appid>` ids match by Steam id, others by name) is set with `found: "upload"` (`ClipLibrary.setGameFromUpload`,
  which adds and looks up an unknown game); a title that isn't just a game and date becomes the clip's own; Podium's
  `recordedAt` is used only when the file name has no time, since names are on the recording computer's clock.
  Videos and Photos libraries get the title and date as hand-made details. Movies and shows rely on the file name.
- **Tested** with a Podium-like client script (three pieces, a repeated piece, early complete, repeated complete, the
  same file again, a wrong checksum, a wrong type, a wrong token) against a scratch server: a known game by Steam id,
  a new game looked up on Steam, a desktop recording, and a Videos library. Not tested with Podium itself.

## 6. Design decisions

All picks are in `docs/design/decisions.md`, with links to the three mockup artifacts on claude.ai (owner's account).
Short version: logo "Aperture" (an open C lens ring), Sora + Manrope, ambient/adaptive theme taking colours from the
selected title (fallback accent Sky `#5B9DFF`), dark by default with a light theme per device, top bar navigation (floating tab bar on phones), poster-split
movie page, episode cards, full-width player control bar, TV filmstrip scrubbing, rounded-square initials avatars with
optional uploaded pictures, watch together as a side panel.

## 7. Things learned the hard way

- **A positioned element's shadow paints over later siblings that aren't positioned**, like the Now Playing cover's
  shadow over the title under it. Give the sibling `position: relative`.
- **`scrollIntoView` scrolls every scrollable parent**, the page too. To scroll inside a panel only, set its
  `scrollTop` (`scrollInside()` in NowPlaying).
- **CDP network throttling ends when its connection closes.** Throttle and watch from the same connection.
  The sample videos are 90 s long, so the player finishing and going back can look like a bug in long tests.

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

- **SubDL and Podnapisi are only tested against a mock** written from what their APIs return (Podnapisi's XML fields,
  SubDL's `subtitles[]`); worth a real run.
- **OpenSubtitles needs a real API key** (free at opensubtitles.com, "API consumers"); set it in Settings › Subtitles
  or `OPENSUBTITLES_API_KEY`. Only tested against a local mock so far.
- **TMDB is untested** (no key). **TheTVDB, OMDb and Trakt** are only tested against a mock written from their API
  docs; worth a run with real keys (TVDB's `/series/:id/extended` and episode paging, Trakt's token refresh).
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
- **Photos**: RAW files (CR2, NEF, ARW, DNG) aren't picked up; place names need an offline lookup (only coordinates
  and an OpenStreetMap link now); no album download as a zip; overview counts load the whole `FolderTree` per
  request, which is fine for tens of thousands of photos but could be cached; the timeline has no date scrubber
  (mockup B had one). Real iPhone HEICs and Live Photos haven't been tried, only `heif-enc` files.
- **Uploads** only take zip files, not RAR or 7z. Files go up one at a time; parallel pieces could be faster on
  high-latency links.
- **Clips**: recorder name patterns are from documentation and memory, not real files (worth checking with real
  NVIDIA, AMD, Xbox, Medal and Steam exports). SteamGridDB is untested (no key). Recognition confidence numbers are
  tuned on test patterns and store screenshots, not real gameplay. Steam's own recording folders (DASH pieces) aren't
  read; only exported files are.
- Ideas for later live in `docs/future-features.md`.
