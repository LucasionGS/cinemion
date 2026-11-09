package dev.ionnet.cinemion

import android.graphics.Bitmap
import android.net.http.SslError
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader

/**
 * Serves the bundled server list, keeps navigation inside the app, and accepts a self-signed certificate only when it
 * is exactly the one the person trusted.
 */
class TvWebViewClient(private val activity: MainActivity) : WebViewClient() {
  private val assets = WebViewAssetLoader.Builder()
    .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(activity))
    .build()

  override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
    assets.shouldInterceptRequest(request.url)

  override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
    val scheme = request.url.scheme
    // Anything that isn't a web address (intent:, market:, …) has nowhere to go on a TV
    return scheme != "http" && scheme != "https"
  }

  override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
    activity.onPageStarted(url)
  }

  override fun onPageFinished(view: WebView, url: String) {
    activity.onPageFinished(url)
  }

  override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
    // -1 is a navigation replaced by another one, which isn't a failure
    if (!request.isForMainFrame || error.errorCode == ERROR_UNKNOWN) return
    activity.onServerPageFailed(request.url.toString(), null)
  }

  override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
    val certificate = CertificateTrust.fromWebView(error.certificate)
    val hostPort = try {
      Address.hostPort(error.url)
    } catch (e: Exception) {
      null
    }
    val trusted = if (hostPort != null) activity.trustedFingerprint(hostPort) else null
    if (certificate != null && CertificateTrust.matches(certificate, trusted)) {
      handler.proceed()
      return
    }
    handler.cancel()
    activity.onServerPageFailed(error.url, certificate?.let { CertificateTrust.fingerprint(it) })
  }

  override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
    // The web process is the first thing to go on a box with little memory. Start over instead of crashing.
    activity.restartWebView(view)
    return true
  }
}
