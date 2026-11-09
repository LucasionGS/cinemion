package dev.ionnet.cinemion

import android.graphics.Bitmap
import android.view.View
import android.webkit.WebChromeClient

/**
 * Lets a page's video go full screen (`requestFullscreen`), which the WebView hands to the app as a view to show.
 */
class TvChromeClient(private val activity: MainActivity) : WebChromeClient() {
  override fun onShowCustomView(view: View, callback: CustomViewCallback) = activity.showCustomView(view, callback)

  override fun onHideCustomView() = activity.hideCustomView()

  // Without a poster some WebView versions crash when a video goes full screen
  override fun getDefaultVideoPoster(): Bitmap = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
}
