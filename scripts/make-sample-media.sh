#!/bin/bash
##########################################
# Cinemion sample media, by Lucasion     #
##########################################
# Generates a small fake library with ffmpeg for trying out scanning, metadata and playback:
# tidy and messy file names, several codecs, multiple audio and subtitle tracks, NFO files,
# local artwork, multi-episode files, specials, extras and samples that should be skipped, and a folder of
# home videos with recording dates, a folder picture and nested folders.
#
# Usage: scripts/make-sample-media.sh [FOLDER]
#   FOLDER        Where to create "movies", "shows" and "videos". Default is data/media.
#   CLIP_SECONDS  Length of each clip (environment variable). Default is 90.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/data/media}"
MOVIES="$OUT/movies"
SHOWS="$OUT/shows"
VIDEOS="$OUT/videos"
SECONDS_PER_CLIP="${CLIP_SECONDS:-90}"
# Running time burned into every clip, to check seeking and resume
TIMER="drawtext=text='%{pts\\:hms}':fontsize=36:fontcolor=white:box=1:boxcolor=black@0.5:x=24:y=24"

if ! command -v ffmpeg > /dev/null; then
  if [[ -f /etc/arch-release ]]; then echo "ffmpeg is needed. Install it with: sudo pacman -S ffmpeg" >&2
  elif [[ -f /etc/debian_version ]]; then echo "ffmpeg is needed. Install it with: sudo apt install ffmpeg" >&2
  else echo "ffmpeg is needed. Install it and try again." >&2
  fi
  exit 1
fi

# Make a short clip: test pattern plus tone, with the given codec arguments
# Usage: clip <output> <label> [extra ffmpeg output args...]
clip() {
  local OUTPUT="$1"
  local LABEL="$2"
  shift 2
  mkdir -p "$(dirname "$OUTPUT")"
  ffmpeg -loglevel error -y \
    -f lavfi -i "testsrc2=size=1280x720:rate=24:duration=$SECONDS_PER_CLIP,$TIMER,drawtext=text='$LABEL':fontsize=48:fontcolor=white:box=1:boxcolor=black@0.5:x=(w-text_w)/2:y=h-120" \
    -f lavfi -i "sine=frequency=440:duration=$SECONDS_PER_CLIP" \
    "$@" "$OUTPUT"
}

# Make an artwork image: a two-colour gradient with a title
# Usage: art <output> <width> <height> <colour1> <colour2> <title>
art() {
  local OUTPUT="$1"
  mkdir -p "$(dirname "$OUTPUT")"
  ffmpeg -loglevel error -y -f lavfi \
    -i "gradients=s=$2x$3:c0=$4:c1=$5:x0=0:y0=0:x1=$2:y1=$3:duration=1,drawtext=text='$6':fontsize=$(( $2 / 10 )):fontcolor=white:x=(w-text_w)/2:y=h*0.75" \
    -frames:v 1 "$OUTPUT"
}

echo "Creating sample media in $OUT..."
rm -rf "$MOVIES" "$SHOWS" "$VIDEOS"

#region Movies
echo "Movies..."

# Tidy folder with NFO and artwork, plus a second version in another codec
NB="$MOVIES/Northbound (2024)"
clip "$NB/Northbound (2024).mkv" "Northbound" -c:v libx264 -preset veryfast -crf 30 -c:a aac -metadata:s:a:0 language=por
# The second version is 10-bit HEVC tagged as HDR10, for checking tone mapping
clip "$NB/Northbound (2024) - 4K.mkv" "Northbound HDR version" -c:v libx265 -preset ultrafast -tag:v hvc1 -pix_fmt yuv420p10le \
  -x265-params "log-level=error:hdr10=1:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc" \
  -vf "setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc" -c:a ac3 -metadata:s:a:0 language=por
art "$NB/poster.jpg" 600 900 0xC8642E 0x2A1208 "Northbound"
art "$NB/fanart.jpg" 1920 1080 0xE08A4A 0x1E0E06 "Northbound"
cat > "$NB/movie.nfo" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<movie>
  <title>Northbound</title>
  <year>2024</year>
  <plot>Two estranged brothers drive a failing food truck from Lisbon to the Arctic Circle to scatter their father's ashes.</plot>
  <tagline>Some roads only go one way.</tagline>
  <runtime>128</runtime>
  <mpaa>12</mpaa>
  <genre>Drama</genre>
  <genre>Adventure</genre>
  <studio>Sample Pictures</studio>
  <set><name>Open Roads Collection</name><overview>Long drives and the people who take them.</overview></set>
  <director>Inês Valadares</director>
  <actor><name>Tomás Reis</name><role>Duarte</role><order>0</order></actor>
  <actor><name>Bruno Seixas</name><role>Rui</role><order>1</order></actor>
</movie>
EOF

# Release-style name straight in the library folder, MP4 with two audio tracks and a text subtitle
# One cue every 5 seconds that names its own start time, so a wrong subtitle offset is easy to spot
: > "/tmp/cinemion-sample-subs.srt"
for (( i = 0; i * 5 + 1 < SECONDS_PER_CLIP; i++ )); do
  START=$(( i * 5 + 1 ))
  printf "%d\n00:%02d:%02d,000 --> 00:%02d:%02d,000\nSubtitle at %d:%02d\n\n" "$(( i + 1 ))" "$(( START / 60 ))" "$(( START % 60 ))" "$(( (START + 3) / 60 ))" "$(( (START + 3) % 60 ))" "$(( START / 60 ))" "$(( START % 60 ))" >> "/tmp/cinemion-sample-subs.srt"
done
ffmpeg -loglevel error -y \
  -f lavfi -i "testsrc2=size=1280x720:rate=24:duration=$SECONDS_PER_CLIP,$TIMER" \
  -f lavfi -i "sine=frequency=330:duration=$SECONDS_PER_CLIP" \
  -f lavfi -i "sine=frequency=550:duration=$SECONDS_PER_CLIP" \
  -i "/tmp/cinemion-sample-subs.srt" \
  -map 0 -map 1 -map 2 -map 3 -c:v libx264 -preset veryfast -crf 30 -c:a aac -c:s mov_text \
  -metadata:s:a:0 language=eng -metadata:s:a:1 language=eng -metadata:s:a:1 title="Commentary" -metadata:s:s:0 language=eng \
  "$MOVIES/Paper.Moons.2024.1080p.WEB-DL.x264-CINEMION.mp4"

# Subtitle files next to the video: a forced English one, and a Dutch one in Windows-1252 like many downloads
PM="$MOVIES/Paper.Moons.2024.1080p.WEB-DL.x264-CINEMION"
printf '1\n00:00:02,000 --> 00:00:05,000\nForced English line from a file\n\n' > "$PM.en.forced.srt"
printf '1\n00:00:02,000 --> 00:00:05,000\nCaf\xe9 en cr\xe8me, uit een los bestand\n\n' > "$PM.nl.srt"

# ID tag in the folder name, 5.1 AC3 audio, a styled (ASS) subtitle and a forced SRT one
GH="$MOVIES/Glass Harbor (2025) {imdb-tt0000001}"
mkdir -p "$GH"
ffmpeg -loglevel error -y \
  -f lavfi -i "testsrc2=size=1280x720:rate=24:duration=$SECONDS_PER_CLIP,$TIMER" \
  -f lavfi -i "sine=frequency=220:duration=$SECONDS_PER_CLIP" \
  -i "/tmp/cinemion-sample-subs.srt" -i "/tmp/cinemion-sample-subs.srt" \
  -map 0 -map 1 -map 2 -map 3 -c:v libx264 -preset veryfast -crf 30 -c:a ac3 -ac 6 -c:s:0 ass -c:s:1 srt \
  -metadata:s:s:0 language=jpn -metadata:s:s:1 language=eng -disposition:s:1 forced \
  "$GH/Glass Harbor.mkv"

# Extras and samples that must be skipped
TLM="$MOVIES/The Long Meridian (2023)"
clip "$TLM/The Long Meridian (2023).mkv" "The Long Meridian" -c:v libx264 -preset veryfast -crf 30 -c:a aac
cat > "$TLM/movie.nfo" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<movie>
  <title>The Long Meridian</title>
  <year>2023</year>
  <plot>A surveyor walks the length of a forgotten border to settle a bet with his dead brother.</plot>
  <mpaa>PG</mpaa>
  <genre>Western</genre>
  <genre>Drama</genre>
  <set><name>Open Roads Collection</name></set>
  <actor><name>Tomás Reis</name><role>Elias</role></actor>
</movie>
EOF
clip "$TLM/Extras/Behind the Scenes.mkv" "Extra - should be skipped" -c:v libx264 -preset veryfast -crf 30 -c:a aac
clip "$TLM/sample.mkv" "Sample - should be skipped" -c:v libx264 -preset veryfast -crf 30 -c:a aac
clip "$TLM/The Long Meridian-trailer.mkv" "Trailer - should be skipped" -c:v libx264 -preset veryfast -crf 30 -c:a aac

# A VP9/Opus WebM with no year at all
clip "$MOVIES/Home Movie Night.webm" "Home Movie Night" -c:v libvpx-vp9 -deadline realtime -cpu-used 8 -b:v 1M -c:a libopus
#endregion

#region Shows
echo "Shows..."

SK="$SHOWS/Saltwater Kings (2023)"
art "$SK/poster.jpg" 600 900 0x1F6F86 0x061A22 "Saltwater Kings"
art "$SK/fanart.jpg" 1920 1080 0x5FA9BC 0x061A22 "Saltwater Kings"
art "$SK/season01-poster.jpg" 600 900 0x2C7A90 0x061A22 "Season 1"
cat > "$SK/tvshow.nfo" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<tvshow>
  <title>Saltwater Kings</title>
  <year>2023</year>
  <plot>A family of oyster farmers on a shrinking island gets pulled into smuggling to keep the business, and the island, afloat.</plot>
  <mpaa>16</mpaa>
  <genre>Crime</genre>
  <genre>Drama</genre>
  <actor><name>Marta Couto</name><role>Mara</role></actor>
</tvshow>
EOF
clip "$SK/Season 01/Saltwater Kings - S01E01 - Spat.mkv" "S01E01" -c:v libx264 -preset veryfast -crf 30 -c:a aac
clip "$SK/Season 01/Saltwater Kings - S01E02 - Brackish.mkv" "S01E02" -c:v libx264 -preset veryfast -crf 30 -c:a aac
clip "$SK/Season 01/Saltwater Kings - S01E03 - Low Water.mkv" "S01E03" -c:v libx264 -preset veryfast -crf 30 -c:a aac
art "$SK/Season 01/Saltwater Kings - S01E03 - Low Water-thumb.jpg" 1280 720 0x2A6A78 0x061A22 "Low Water"
cat > "$SK/Season 01/Saltwater Kings - S01E03 - Low Water.nfo" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<episodedetails>
  <title>Low Water</title>
  <season>1</season>
  <episode>3</episode>
  <plot>A shipment goes missing at the worst possible tide.</plot>
  <aired>2023-03-14</aired>
</episodedetails>
EOF
clip "$SK/Season 02/Saltwater Kings - S02E01-E02 - Silt.mkv" "S02E01-E02" -c:v libx264 -preset veryfast -crf 30 -c:a aac

IW="$SHOWS/Ironwood"
clip "$IW/Season 1/Ironwood.S01E01.1080p.WEB-DL.x265.mkv" "Ironwood S01E01" -c:v libx265 -preset ultrafast -crf 32 -c:a aac
clip "$IW/Season 1/Ironwood.S01E02.1080p.WEB-DL.x265.mkv" "Ironwood S01E02" -c:v libx265 -preset ultrafast -crf 32 -c:a aac
clip "$IW/Specials/Ironwood S00E01 Making Of.mkv" "Ironwood special" -c:v libx264 -preset veryfast -crf 30 -c:a aac
#endregion

#region Videos
echo "Videos..."

# Phones write the recording time into the file; Cinemion uses it as the video's date
HOL="$VIDEOS/Holiday 2024"
clip "$HOL/Beach day.mp4" "Beach day" -c:v libx264 -preset veryfast -crf 30 -c:a aac -metadata creation_time=2024-07-12T14:03:22Z -movflags +faststart
clip "$HOL/Day 2/Fireworks.mov" "Fireworks" -c:v libx264 -preset veryfast -crf 30 -c:a aac -metadata creation_time=2024-07-13T21:40:00Z
clip "$HOL/Day 2/Boat trip.mp4" "Boat trip" -c:v libx264 -preset veryfast -crf 30 -c:a aac -metadata creation_time=2024-07-13T10:15:00Z -movflags +faststart
art "$HOL/folder.jpg" 1280 720 0x2E8BC0 0xF2C14E "Holiday 2024"

# Camera names, HEVC, and a picture next to one of them that's used as its thumbnail
DR="$VIDEOS/Drone shots"
clip "$DR/DJI_0042.MP4" "DJI 0042" -c:v libx265 -preset ultrafast -crf 32 -tag:v hvc1 -c:a aac
clip "$DR/DJI_0043.MP4" "DJI 0043" -c:v libx265 -preset ultrafast -crf 32 -tag:v hvc1 -c:a aac
art "$DR/DJI_0043.jpg" 1280 720 0x3A5F3A 0xA3C77A "Over the dunes"

# Loose in the library folder, with an NFO; names that a movie library would skip are just videos here
clip "$VIDEOS/Birthday_party_2025.webm" "Birthday party" -c:v libvpx-vp9 -deadline realtime -cpu-used 8 -b:v 1M -c:a libopus
cat > "$VIDEOS/Birthday_party_2025.nfo" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<movie>
  <title>Mira turns 8</title>
  <plot>Cake, candles and far too many balloons.</plot>
  <premiered>2025-03-02</premiered>
  <genre>Family</genre>
</movie>
EOF
clip "$VIDEOS/Our short film-trailer.mkv" "Our short film (trailer)" -c:v libx264 -preset veryfast -crf 30 -c:a aac
#endregion

rm -f "/tmp/cinemion-sample-subs.srt"
echo "Done! Created $(find "$OUT" -type f | wc -l) files in $OUT"
