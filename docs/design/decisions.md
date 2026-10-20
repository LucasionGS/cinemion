# Design decisions

Picks from the design rounds. These become the client's design tokens (`client/src/theme/`).

## Round 1: identity and home

- **Logo:** A · Aperture. An open "C" lens ring with the "ion" as an accent-coloured dot in the gap. Used as the symbol, in the horizontal lockup (`cinemion` lowercase wordmark) and as the app icon / favicon.
- **Play button:** D · Marquee's ring with a play triangle is the play-button motif.
- **Fonts:** Sora (display: titles, headings, wordmark) / Manrope (body and UI).
- **Direction:** B · Ambient / adaptive. The UI takes its accent and background tint from the focused or selected title's artwork palette (extracted server-side). The home leads with the selected title (name, time left, Resume) above the continue-watching row.
- **Ambient strength:** Full by default (the artwork fades into the top of the page + colour glow).
- **Navigation:** top bar with pill tabs, transparent over the ambient backdrop. Mobile uses a floating bottom tab bar. On TV, the top bar hides when focus moves down into the rows.
- **Fallback accent:** Sky `#5B9DFF` (text on it `#06121F`). Used where there's no artwork palette (settings, admin), or when a user turns adaptive off. Other user-selectable accents: Amber `#F5B544`, Coral `#FF6B5A`, Violet `#9B7CFF`, Mint `#3DDC97`.
- **Theme:** dark only.

### Base palette (from the mockups)

| Token | Value | Use |
|---|---|---|
| `--cn-bg` | `#08090B` | page ground when no title palette is active |
| `--cn-surface` | `rgba(255,255,255,0.07)` | glass surfaces (search, pills, secondary buttons) |
| `--cn-border` | `rgba(255,255,255,0.10)` | hairlines on glass |
| `--cn-text` | `#F3F4F6` | primary text |
| `--cn-text-muted` | `#B4B9C3` | secondary text (on ambient grounds) |
| `--cn-ambient-base` | per title, e.g. `#100A07` | ambient page ground |
| `--cn-accent` / `--cn-on-accent` | per title, or the fallback | buttons, progress, active nav |

Mockups: https://claude.ai/artifact/9NUgHNobfRjcmVLzMkghhc

## Round 2: watching

- **Movie page:** Poster split. The poster sits beside the info, and the backdrop stays dimmed behind (about 45%) so the ambient colour still reads.
- **Show page:** episodes as a card grid (16:9 thumbnails, 4 columns on desktop), under season tabs. Watched episodes get a check, and in-progress ones a progress bar.
- **Player controls (desktop):** full-width bar along the bottom (kept the default).
- **TV scrubbing:** filmstrip of seek thumbnails around the target position (kept the default).
- **Track panel:** a glass side sheet with Subtitles / Audio / Quality tabs. The Quality tab shows whether the file plays directly or is being converted.
- **Subtitle search:** a dialog over the dimmed player. Results that match the exact file are marked and ranked first, and results that might be out of sync are flagged.

Mockups: https://claude.ai/artifact/LRkWtmzabA5uSKvRmninsN

## Round 3: people and admin

- **Profile avatars:** a rounded square (radius ≈ 21% of the size) showing the user's initial on their profile colour. If the user uploads a profile picture, it replaces the initial everywhere.
- **Profile pictures:** upload from the profile settings and crop with drag + zoom into the rounded square. The dialog shows live previews at picker, top bar and badge sizes. The server crops and scales the image to every size it serves (WebP). "Remove picture" falls back to initials. JPG, PNG, WebP and HEIC are accepted, up to 10 MB.
- **PIN entry:** a 4-dot PIN pad that also accepts keyboard and remote number keys. On TV, the same pad is navigated with the D-pad.
- **First-run setup:** four steps with a step list on the left: account → libraries (with a folder browser limited to mounted folders) → metadata sources in priority order → scanning progress.
- **Watch together:** a side panel in the player with the invite code, the people in the session with their device and sync status, and an "anyone can pause and seek" switch. Short notices like "Mira paused at 1:03:12" appear at the top. Joining by code is also possible on mobile, and watching along doesn't change your own progress.
- **Admin:** the app top bar plus a left settings nav. The dashboard shows streams (direct play or converting, with the reason), resource usage, tasks and activity. The Playback page shows hardware-acceleration options with detection status, which formats the GPU decodes, and a "Run a test" button.

Mockups: https://claude.ai/artifact/RxQLnPd51KADJ5pEWwnfKC

## Round 4: videos (picked in chat, no mockup)

- **Videos libraries:** for home videos and anything else that isn't a movie or show. Nothing is looked up online.
- **Folders:** each folder becomes a group (like an album), shown as a 16:9 card with two cards stacked behind it and its video count. Groups nest like the folders on disk; videos in the library folder itself sit next to the groups. Folders always come first.
- **Cards:** 16:9 thumbnails taken from the video (or a picture next to it), with the length in the corner and the date below.
- **Age limits:** each Videos library has a "rating for unrated videos" (e.g. G for family videos); single videos can get their own rating. A folder shows for anyone who may see a video in it.
- **Editing by hand:** title, date, description, tags, age rating and thumbnail (upload, pick a frame, or automatic), for videos and folders only. Movies and shows keep NFO, TMDB and Fix match.
