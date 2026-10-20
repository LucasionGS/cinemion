#!/bin/bash
##########################################
# Cinemion sample media, by Lucasion     #
##########################################
# Generates a small fake library with ffmpeg for trying out scanning, metadata and playback:
# tidy and messy file names, several codecs, multiple audio and subtitle tracks, NFO files,
# local artwork, multi-episode files, specials, extras and samples that should be skipped, a folder of
# home videos with recording dates, a folder picture and nested folders, and music: tagged albums with covers,
# a two-disc album, a compilation, lyrics, a format browsers can't play and an untagged file.
#
# Usage: scripts/make-sample-media.sh [FOLDER]
#   FOLDER         Where to create "movies", "shows", "videos" and "music". Default is data/media.
#   CLIP_SECONDS   Length of each clip (environment variable). Default is 90.
#   TRACK_SECONDS  Length of each music track (environment variable). Default is 30.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/data/media}"
MOVIES="$OUT/movies"
SHOWS="$OUT/shows"
VIDEOS="$OUT/videos"
MUSIC="$OUT/music"
SECONDS_PER_CLIP="${CLIP_SECONDS:-90}"
SECONDS_PER_TRACK="${TRACK_SECONDS:-30}"
# Running time burned into every clip, to check seeking and resume
TIMER="drawtext=text='%{pts\\:hms}':fontsize=36:fontcolor=white:box=1:boxcolor=black@0.5:x=24:y=24"

if ! command -v ffmpeg > /dev/null; then
  if [[ -f /etc/arch-release ]]; then echo "ffmpeg is needed. Install it with: sudo pacman -S ffmpeg" >&2
  elif [[ -f /etc/debian_version ]]; then echo "ffmpeg is needed. Install it with: sudo apt install ffmpeg" >&2
  else echo "ffmpeg is needed. Install it and try again." >&2
  fi
  exit 1
fi

# Make a short clip: test pattern plus tone, with the given codec arguments. With CHAPTERS set to an ffmetadata
# file, its chapters are added (pass -map_chapters 2 along with the other arguments).
# Usage: clip <output> <label> [extra ffmpeg output args...]
clip() {
  local OUTPUT="$1"
  local LABEL="$2"
  shift 2
  local CHAPTER_INPUT=()
  [[ -n "${CHAPTERS:-}" ]] && CHAPTER_INPUT=(-f ffmetadata -i "$CHAPTERS")
  mkdir -p "$(dirname "$OUTPUT")"
  ffmpeg -loglevel error -y \
    -f lavfi -i "testsrc2=size=1280x720:rate=24:duration=$SECONDS_PER_CLIP,$TIMER,drawtext=text='$LABEL':fontsize=48:fontcolor=white:box=1:boxcolor=black@0.5:x=(w-text_w)/2:y=h-120" \
    -f lavfi -i "sine=frequency=440:duration=$SECONDS_PER_CLIP" \
    "${CHAPTER_INPUT[@]}" \
    "$@" "$OUTPUT"
}

# The tunes every episode of a show shares, so intro and credits detection has something to find
OPENING_TUNE="aevalsrc='0.4*sin(2*PI*(330+110*floor(mod(t*3,6)))*t)+0.2*sin(2*PI*(660+55*floor(mod(t*1.5,4)))*t)':s=44100:d=20"
CREDITS_TUNE="aevalsrc='0.35*sin(2*PI*(262+131*floor(mod(t*2,5)))*t)+0.25*sin(2*PI*(523-65*floor(mod(t*4,3)))*t)':s=44100:d=15"

# Make an episode: a cold open, the 20 s opening tune, the story and 15 s of credits. The cold open and story are
# noise from their own seeds, so only the tunes are the same between episodes.
# Usage: episode <output> <label> <COLD_OPEN_SECONDS> <SEED> [extra ffmpeg output args...]
episode() {
  local OUTPUT="$1"
  local LABEL="$2"
  local COLD="$3"
  local SEED="$4"
  shift 4
  local BODY=$(( SECONDS_PER_CLIP - COLD - 35 ))
  (( BODY < 5 )) && BODY=5
  mkdir -p "$(dirname "$OUTPUT")"
  ffmpeg -loglevel error -y \
    -f lavfi -i "testsrc2=size=1280x720:rate=24:duration=$(( COLD + 35 + BODY )),$TIMER,drawtext=text='$LABEL':fontsize=48:fontcolor=white:box=1:boxcolor=black@0.5:x=(w-text_w)/2:y=h-120" \
    -f lavfi -i "anoisesrc=d=$COLD:c=pink:seed=$SEED:a=0.25" \
    -f lavfi -i "$OPENING_TUNE" \
    -f lavfi -i "anoisesrc=d=$BODY:c=brown:seed=$(( SEED + 1 )):a=0.25" \
    -f lavfi -i "$CREDITS_TUNE" \
    -filter_complex "[1:a][2:a][3:a][4:a]concat=n=4:v=0:a=1[a]" -map 0:v -map "[a]" \
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

# Make a music track: a little tune from a base note, with the given codec and tag arguments. With COVER set to a
# picture, it's embedded as the cover (pass the codec for it, like -c:v mjpeg, along with the other arguments).
# Usage: tune <output> <base frequency> [extra ffmpeg output args...]
tune() {
  local OUTPUT="$1"
  local BASE="$2"
  shift 2
  local COVER_INPUT=()
  local COVER_MAP=()
  if [[ -n "${COVER:-}" ]]; then
    COVER_INPUT=(-i "$COVER")
    COVER_MAP=(-map 0:a -map 1:v -disposition:v:0 attached_pic)
  fi
  mkdir -p "$(dirname "$OUTPUT")"
  ffmpeg -loglevel error -y \
    -f lavfi -i "aevalsrc='0.3*sin(2*PI*($BASE*(1+0.25*floor(mod(t*2,4))))*t)+0.15*sin(2*PI*($BASE*1.5)*t)':s=44100:d=$SECONDS_PER_TRACK" \
    "${COVER_INPUT[@]}" "${COVER_MAP[@]}" \
    "$@" "$OUTPUT"
}

echo "Creating sample media in $OUT..."
rm -rf "$MOVIES" "$SHOWS" "$VIDEOS" "$MUSIC"

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

# ID tag in the folder name, 5.1 AC3 audio, a styled (ASS) subtitle with its font attached, and a forced SRT one
GH="$MOVIES/Glass Harbor (2025) {imdb-tt0000001}"
mkdir -p "$GH"
ASS_FILE="$(mktemp --suffix=.ass)"
cat > "$ASS_FILE" <<'EOF'
[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,DejaVu Serif,44,&H0000E5FF,&H000000FF,&H00301000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,2,40,40,40,1
Style: Sign,DejaVu Serif,34,&H00FFFFFF,&H000000FF,&H00A05000,&H80000000,-1,-1,0,0,100,100,2,0,1,2,0,8,40,40,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:30.00,Sign,,0,0,0,,{\pos(1040,110)\frz-8}GLASS HARBOR
EOF
for (( i = 0; i * 10 < SECONDS_PER_CLIP; i++ )); do
  START=$(( i * 10 + 2 ))
  # The text goes in as an argument: printf would read the \c and \r of the ASS tags as its own escapes
  LINE="Styled line at $(( START / 60 )):$(printf '%02d' $(( START % 60 ))), in {\\c&H66CCFF&}its own colours{\\r} and font"
  printf 'Dialogue: 0,0:%02d:%02d.00,0:%02d:%02d.00,Default,,0,0,0,,%s\n' \
    "$(( START / 60 ))" "$(( START % 60 ))" "$(( (START + 4) / 60 ))" "$(( (START + 4) % 60 ))" "$LINE" >> "$ASS_FILE"
done
# Attach the font the subtitles use, when this system has it
FONT="$(fc-match -f '%{file}' 'DejaVu Serif:bold' 2>/dev/null || true)"
ATTACH=()
[[ -f "$FONT" && "$FONT" == *DejaVuSerif* ]] && ATTACH=(-attach "$FONT" -metadata:s:t:0 mimetype=application/x-truetype-font)
ffmpeg -loglevel error -y \
  -f lavfi -i "testsrc2=size=1280x720:rate=24:duration=$SECONDS_PER_CLIP,$TIMER" \
  -f lavfi -i "sine=frequency=220:duration=$SECONDS_PER_CLIP" \
  -i "$ASS_FILE" -i "/tmp/cinemion-sample-subs.srt" \
  -map 0 -map 1 -map 2 -map 3 -c:v libx264 -preset veryfast -crf 30 -c:a ac3 -ac 6 -c:s:0 copy -c:s:1 srt \
  -metadata:s:s:0 language=jpn -metadata:s:s:1 language=eng -disposition:s:1 forced "${ATTACH[@]}" \
  "$GH/Glass Harbor.mkv"
rm -f "$ASS_FILE"

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
# Each episode has its own cold open length, then the shared opening and credits tunes
episode "$SK/Season 01/Saltwater Kings - S01E01 - Spat.mkv" "S01E01" 6 101 -c:v libx264 -preset veryfast -crf 30 -c:a aac
episode "$SK/Season 01/Saltwater Kings - S01E02 - Brackish.mkv" "S01E02" 9 201 -c:v libx264 -preset veryfast -crf 30 -c:a aac
episode "$SK/Season 01/Saltwater Kings - S01E03 - Low Water.mkv" "S01E03" 4 301 -c:v libx264 -preset veryfast -crf 30 -c:a aac
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
episode "$SK/Season 02/Saltwater Kings - S02E01-E02 - Silt.mkv" "S02E01-E02" 7 401 -c:v libx264 -preset veryfast -crf 30 -c:a aac

IW="$SHOWS/Ironwood"
# Ironwood marks its opening and ending with chapters instead
CHAPTER_FILE="$(mktemp)"
cat > "$CHAPTER_FILE" <<EOF
;FFMETADATA1
[CHAPTER]
TIMEBASE=1/1000
START=0
END=8000
title=Recap
[CHAPTER]
TIMEBASE=1/1000
START=8000
END=30000
title=Opening
[CHAPTER]
TIMEBASE=1/1000
START=30000
END=$(( (SECONDS_PER_CLIP - 15) * 1000 ))
title=Episode
[CHAPTER]
TIMEBASE=1/1000
START=$(( (SECONDS_PER_CLIP - 15) * 1000 ))
END=$(( SECONDS_PER_CLIP * 1000 ))
title=Ending
EOF
CHAPTERS="$CHAPTER_FILE" clip "$IW/Season 1/Ironwood.S01E01.1080p.WEB-DL.x265.mkv" "Ironwood S01E01" -map 0:v -map 1:a -map_chapters 2 -c:v libx265 -preset ultrafast -crf 32 -c:a aac
CHAPTERS="$CHAPTER_FILE" clip "$IW/Season 1/Ironwood.S01E02.1080p.WEB-DL.x265.mkv" "Ironwood S01E02" -map 0:v -map 1:a -map_chapters 2 -c:v libx265 -preset ultrafast -crf 32 -c:a aac
rm -f "$CHAPTER_FILE"
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

#region Music
echo "Music..."
COVERS="$(mktemp -d)"

# MP3s with ID3 tags and the cover inside each file, and timed lyrics in an LRC file next to one track
HL="$MUSIC/Harbour Lights/Night Ferry (2021)"
art "$COVERS/night-ferry.jpg" 600 600 0x1B2A49 0xE07A5F "Night Ferry"
TRACK=1
for TITLE in "Departure" "Lanterns on the Water" "Below Deck" "Arrival"; do
  COVER="$COVERS/night-ferry.jpg" tune "$HL/0$TRACK - $TITLE.mp3" $(( 220 + TRACK * 30 )) -c:a libmp3lame -q:a 4 -c:v mjpeg -id3v2_version 3 \
    -metadata title="$TITLE" -metadata artist="Harbour Lights" -metadata album="Night Ferry" -metadata track="$TRACK/4" -metadata date=2021 -metadata genre="Indie; Folk"
  TRACK=$(( TRACK + 1 ))
done
cat > "$HL/02 - Lanterns on the Water.lrc" <<'EOF'
[ar:Harbour Lights]
[ti:Lanterns on the Water]
[00:00.50]Lanterns on the water
[00:05.00]Drifting past the pier
[00:10.00]Every light a story
[00:15.00]Of the ones who brought us here
[00:20.00](instrumental)
[00:25.00]Lanterns on the water
EOF

# FLAC across two discs, with the cover one folder up and plain lyrics in a tag
SM="$MUSIC/Saltmarsh/Low Tide (2019)"
art "$SM/cover.jpg" 600 600 0x2F4F4F 0x9AC1A6 "Low Tide"
for DISC in 1 2; do
  for TRACK in 1 2; do
    TITLE=$([[ $DISC == 1 ]] && echo "Mudflats $TRACK" || echo "Tidepool $TRACK")
    EXTRA=()
    [[ $DISC == 1 && $TRACK == 1 ]] && EXTRA=(-metadata "LYRICS=Out where the water goes
the reeds lean low
and the evening comes in slow")
    tune "$SM/CD$DISC/$DISC-0$TRACK $TITLE.flac" $(( 180 + DISC * 40 + TRACK * 20 )) -c:a flac \
      -metadata title="$TITLE" -metadata artist="Saltmarsh" -metadata album_artist="Saltmarsh" -metadata album="Low Tide" \
      -metadata disc="$DISC/2" -metadata track="$TRACK" -metadata date=2019-05-03 -metadata genre=Ambient "${EXTRA[@]}"
  done
done

# A compilation in M4A: each track by someone else, under "Various Artists"
CR="$MUSIC/Compilations/Coastal Roads"
art "$COVERS/coastal-roads.jpg" 600 600 0xF2C14E 0x2E8BC0 "Coastal Roads"
TRACK=1
for PAIR in "Harbour Lights|Seaside Motel" "June Okafor|Route 1" "The Tidewaters|Gull Song"; do
  COVER="$COVERS/coastal-roads.jpg" tune "$CR/0$TRACK ${PAIR#*|}.m4a" $(( 300 + TRACK * 25 )) -c:a aac -b:a 128k -c:v mjpeg \
    -metadata title="${PAIR#*|}" -metadata artist="${PAIR%%|*}" -metadata album_artist="Various Artists" -metadata album="Coastal Roads" \
    -metadata track="$TRACK" -metadata date=2022 -metadata genre=Pop -metadata compilation=1
  TRACK=$(( TRACK + 1 ))
done

# Apple Lossless, which most browsers can't play (Cinemion converts it), with an artist picture and folder.jpg
JO="$MUSIC/June Okafor"
art "$JO/artist.jpg" 600 600 0x6B3FA0 0xF0A6CA "June Okafor"
art "$JO/Paper Boats (2023)/folder.jpg" 600 600 0xF0A6CA 0x6B3FA0 "Paper Boats"
tune "$JO/Paper Boats (2023)/01 Paper Boats.m4a" 262 -c:a alac -metadata title="Paper Boats" -metadata artist="June Okafor" -metadata album="Paper Boats" -metadata track=1 -metadata date=2023 -metadata genre=Soul
tune "$JO/Paper Boats (2023)/02 Folded.m4a" 294 -c:a alac -metadata title="Folded" -metadata artist="June Okafor" -metadata album="Paper Boats" -metadata track=2 -metadata date=2023 -metadata genre=Soul

# No tags at all: the folder and file name have to do
tune "$MUSIC/Field recordings/03 Morning birds.ogg" 520 -c:a libopus -map_metadata -1
rm -rf "$COVERS"
#endregion

rm -f "/tmp/cinemion-sample-subs.srt"
echo "Done! Created $(find "$OUT" -type f | wc -l) files in $OUT"
