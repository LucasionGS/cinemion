package dev.ionnet.cinemion

import android.webkit.JavascriptInterface

/**
 * `window.CinemionTV`, the small contract between this app and the web pages it shows. It is on every page, so it holds
 * only what a server's own page may do. The server list's private calls go through [ListBridge] instead.
 */
class TvBridge(private val activity: MainActivity) {
  /**
   * The app's version, like `1.0.0`.
   */
  @JavascriptInterface
  fun version(): String = BuildConfig.VERSION_NAME

  /**
   * Leaves the current server and shows the server list.
   */
  @JavascriptInterface
  fun showServers() = activity.runOnUiThread { activity.showServerList() }

  /**
   * Closes the app.
   */
  @JavascriptInterface
  fun exit() = activity.runOnUiThread { activity.finishAffinity() }

  /**
   * Keeps the screen on while a page plays video. Cleared whenever a new page starts loading.
   */
  @JavascriptInterface
  fun keepAwake(on: Boolean) = activity.runOnUiThread { activity.setKeepAwake(on) }
}
