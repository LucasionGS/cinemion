# Cinemion

Your movies and shows, beautifully served from your own machine: a self-hosted media server that feels at home on the couch, at a desk and on a phone.

> Cinemion is under active development. Everything below works; ready-made releases (GitHub, the AUR and GHCR) are next.

## Key Features

- **Looks like a cinema, not a file browser**: a dark, artwork-first interface that takes its colours from whatever you're about to watch.
- **Desktop, mobile and TV layouts**: one app that adapts to the screen. The TV layout is made for the couch, with big type and full remote, keyboard and game controller navigation.
- **Who's watching?**: a profile for everyone in the household, with optional PINs, age limits and profile pictures (upload a photo, crop it, done).
- **Set up in a minute**: a first-run wizard creates your account, points Cinemion at your movie and show folders, and picks where posters and plots come from.
- **Knows what your files are**: tidy folders, messy release names, multi-episode files and specials are all recognised. New and removed files are noticed by themselves.
- **Home videos too**: a Videos library takes anything that isn't a movie or show (holidays, drone footage, recordings) without looking anything up. Folders become groups, titles come from the file names and dates from the recording, thumbnails are picked from the video itself, and you can edit it all by hand.
- **Posters, plots and cast**: from NFO files and artwork next to your videos, from TMDB, or both, in the order you choose. Wrong match? Fix it in two clicks.
- **Plays (almost) anything, anywhere**: files your device can play go straight through untouched. Anything else is repackaged or converted on the fly, on the CPU or an Intel, AMD or NVIDIA GPU, with HDR turned into SDR for screens that need it. Pick audio tracks, subtitles and quality while you watch.
- **A player for every screen**: keyboard shortcuts on the desktop, big touch controls on phones, and remote-friendly scrubbing on the TV. The next episode lines itself up while the credits roll.
- **See where you're seeking**: thumbnails above the seek bar, and a filmstrip on the TV, so you land on the right scene.
- **Subtitles, sorted**: subtitle files next to your videos just show up, and anything missing is a search away (OpenSubtitles) without leaving the player.
- **Watch together**: start a session, share a code, and everyone's play, pause and seek stay in step, each on their own screen. Only the host's progress is saved, so nobody's "continue watching" gets spoiled.
- **Picks up where you left off**: continue watching, next up, recently added and "because you watched", per profile. Collections, cast pages and search across titles, episodes and people.
- **Safe for kids**: give a profile an age limit and anything rated above it (or not rated at all) simply isn't there. Family videos can get a library-wide rating so the kids see them too.
- **A dashboard for the server**: who's watching what and on which device, whether it plays directly or is being converted (and why), CPU, GPU and disk use, running tasks, and a feed of what happened lately. "Mira finished Paper Moons" included.
- **Sonarr and Radarr, connected**: paste one address into Sonarr or Radarr, and new downloads show up within seconds instead of at the next scan. Their folders look different in their container? A path mapping sorts that out.
- **Webhooks for everything else**: tell Home Assistant, a chat bot or your own script when playback starts, pauses or stops, a new episode arrives or someone signs in. Every message is signed, failed ones are retried, and there's a test button.
- **Tasks and logs at hand**: start scans and thumbnail jobs, choose how often libraries are scanned, and read the server log with filters, all in Settings. No terminal needed when something acts up.
- **One container, nothing else**: the Docker image includes everything. No database server, no extra services. There's also a single-file binary if you'd rather skip Docker.
- **Plays nice with MediaHub**: open it in MediaHub and it starts straight in the TV layout, controller included.

## Running it

### Docker

```sh
docker run -d --name cinemion \
  -p 8600:8600 \
  -v /path/to/config:/config \
  -v /path/to/movies:/media/movies:ro \
  -v /path/to/shows:/media/shows:ro \
  ghcr.io/lucasion/cinemion
```

Open `http://<your-server>:8600` and follow the setup. Add `--device /dev/dri:/dev/dri` to let an Intel or AMD GPU help with video conversion, then pick it under Settings › Playback (there's a test button to check it works). `PUID` and `PGID` set which user owns the files in `/config` (default 1000).

### Single binary

Grab `cinemion` for your platform, make sure `ffmpeg` is installed (`sudo pacman -S ffmpeg` or `sudo apt install ffmpeg`), and run it. For GPU conversion, also install your GPU's VA-API driver (`intel-media-driver` / `intel-media-va-driver-non-free` for Intel, `libva-mesa-driver` / `mesa-va-drivers` for AMD). Settings and the database go to `~/.cinemion`, and the folder browser starts in your home folder. See `.env.example` for everything you can change.

## Development

You need [Deno](https://deno.com) 2.9+ and ffmpeg.

```sh
cp .env.example .env    # APP_ENV=development makes the server proxy Vite
deno install
deno task dev:client    # Vite dev server (port 5173)
deno task dev           # API + app on http://localhost:8600
```

Other tasks:

| Task | What it does |
|---|---|
| `deno task build` | Build the web client into `client/dist` |
| `deno task start` | Run the server in production mode, serving `client/dist` |
| `deno task compile` | Build a single `cinemion` binary into `dist/<platform>/bin` |
| `deno task migrate` | Apply database migrations (`migrate down` reverts the last one) |
| `deno task cli help` | Maintenance commands, like resetting a password |
| `deno task check` / `lint` | Type-check and lint |

`docker compose up --build` builds and runs the image with everything kept in `./data`.

`scripts/make-sample-media.sh` fills `data/media` with a small fake library (short ffmpeg clips with tidy and messy names, NFO files, artwork, extras and samples) for trying things out. Add a TMDB API key in Settings › Metadata to see online matching.

`deno run -A server/src/test.ts` runs the scratch checks: file names, playback decisions, Sonarr/Radarr payloads, webhook signatures and more.

### Layout

```
shared/   Types shared by the server and the client
server/   Deno + Hono API, Sequelize models and Umzug migrations (SQLite by default, MariaDB optional)
client/   React + Vite + SCSS web app with Cinemion's own design system
docs/     Design decisions and future plans
```

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
