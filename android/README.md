# Cinemion for Android TV

A thin native app for Android TV and Google TV. It is one screen: a list of your Cinemion servers, and a full-screen
web view that shows the chosen server's own interface. Because the interface comes from the server, updating the
server updates what you see on the TV, and the app itself rarely changes. It works with any Cinemion server version.

- Finds servers on your network, or takes an address (`192.168.1.31`, `host:port` or a full URL).
- Opens the last server straight away at start. Back on a server's page goes back, then to the server list; Back on
  the list leaves the app.
- Servers with their own HTTPS certificate: the app shows the certificate's fingerprint and remembers your choice.
- Updates itself from the GitHub releases (checked once a day, shown as a banner on the server list).

## Build

Needs a JDK 17 or newer (21 is what the releases use) and the Android SDK (platform 36, build-tools 36). Put the SDK
path in `android/local.properties` (`sdk.dir=/path/to/Sdk`, not committed) or set `ANDROID_HOME`.

```sh
cd android
./gradlew assembleDebug      # app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease    # app/build/outputs/tv/cinemion-tv-1.0.0.apk
```

The app has its own version, set in `app/build.gradle.kts`, that is independent of the server's.

## Install on a Chromecast with Google TV

Either:

- Put the APK somewhere reachable (a GitHub release) and open it with the **Downloader** app from the Play Store, after
  allowing Downloader to install unknown apps; or
- Turn on developer options (Settings > System > About, press Build several times), then Developer options >
  Network debugging, and from a computer:

  ```sh
  adb connect <tv-ip>:5555
  adb install -r cinemion-tv-1.0.0.apk
  ```

After the first install the app updates itself.

## Releases and signing

The release APK is signed with a key read from the environment, and falls back to the debug key when it isn't set:

| Variable | What |
|---|---|
| `CINEMION_TV_KEYSTORE` | Path to the keystore file |
| `CINEMION_TV_KEYSTORE_PASSWORD` | Keystore password |
| `CINEMION_TV_KEY_ALIAS` | Key alias |
| `CINEMION_TV_KEY_PASSWORD` | Key password |

Every update must be signed with the same key, or Android refuses to install it over the old version. Keep the
keystore safe and out of the repository.

When a `v*` tag is pushed, the `android` job in `.github/workflows/release.yml` builds the APK and attaches
`cinemion-tv-<version>.apk` to the release. It needs the secrets `CINEMION_TV_KEYSTORE_BASE64` (the keystore, with
`base64 -w0 keystore.jks`), `CINEMION_TV_KEYSTORE_PASSWORD`, `CINEMION_TV_KEY_ALIAS` and `CINEMION_TV_KEY_PASSWORD`, and
is skipped when the keystore secret is missing. The app only offers an update when the release's APK has a higher
version than the installed one, so bump `appVersion` in `app/build.gradle.kts` when the app changes. The Android `versionCode` is derived from it (1.2.3 gives 10203), so the two can't drift and downgrades are refused.
