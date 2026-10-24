# Future features

Planned, but not part of the first version. Roughly in the order they're likely to happen.

## Server & household

- **More translations**: the interface can be translated (see `docs/translating.md`) but only English exists. Next:
  actual languages, and the server's own messages (errors, the activity feed, task names) as translatable lines too.

## Statistics

- **Per profile**: time spent watching, listening and reading, per week, month and year. Top shows, movies, genres,
  artists and books, longest binge, and streaks.
- **A year in review**: a shareable recap at the end of the year, for each profile and for the whole household.
- **For the server owner**: the same numbers across everyone, plus which libraries and titles nobody touches.
  A profile can keep its own statistics private.

## Library upkeep

- **Missing episodes**: show which episodes of a season you don't have (from TMDB or TheTVDB), as greyed-out entries
  that can be hidden.
- **Duplicates**: the same movie or episode in several files, side by side with their quality, size and age.
- **Broken files**: files that can't be read, are cut short or fail to play, in one list, with the reason.
- **Space used**: disk use per library, per show and per file type, and the biggest files.
- **Deleting from Cinemion**: remove a file (or a whole season) from its page, for people with permission, behind a
  confirmation. Needs write access to the folder, like uploads.
- **Ready-made versions**: convert chosen titles ahead of time for devices that can't play them, so they play straight
  away without the server converting them live.

## Media types

- **Music extras**: artist pictures and bios from online sources, and music in the dashboard's "Now playing".
- **Photo extras**: place names from GPS (without an online lookup), a map view, RAW files (CR2, NEF, ARW, DNG), live photos, downloading a whole album as a zip, and faces.
- **Live TV & DVR**: tuner support, a guide, and recordings that land in a library.

### Clips extras

Clips libraries are there (see the handoff, milestone 21); ideas left over:

- **Share links**: a link to one clip that works for people without an account, with an expiry date.
- **Recorder extras**: turn long recordings into chapters where the recorder marked highlights, and read Steam's own
  recording folders (video split into pieces) without exporting them first.
- **Switch captures**: name the game from the id in the Switch's file names, with a table of ids.
- **Better guesses**: a larger image model as an option, for servers with the memory and CPU for it.

## Playback

- **Downloads over plain http**: offline downloads need https (browsers only allow service workers there). Built-in
  HTTPS covers most homes; a small companion app would make them work on plain LAN addresses too.

## Clients

- **Android TV / Google TV app**: a thin native wrapper around the TV layout, so Cinemion installs from the TV's app store and can use the TV's own video decoders.
- **Smart-TV browsers**: a lighter TV layout that works in the older built-in browsers of Samsung (Tizen) and LG (webOS) TVs, with IR remotes.
- **Chromecast / casting**: cast from the phone layout to a Chromecast or Google TV, using a registered receiver app.

## Access & integrations

- **Built-in remote access**: reach a server from outside the house without port forwarding, through a relay service on ionnet.io.
