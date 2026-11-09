package dev.ionnet.cinemion

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.os.SystemClock
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.core.content.FileProvider
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.io.File

/**
 * The whole app: one WebView that shows either the bundled server list or a server's own web page.
 */
class MainActivity : Activity() {
  private lateinit var root: FrameLayout
  private lateinit var webView: WebView
  private lateinit var bridge: TvBridge
  private lateinit var listBridge: ListBridge

  private var customView: View? = null
  private var customViewCallback: WebChromeClient.CustomViewCallback? = null

  // The address being opened, so an error on its page can be told apart from one on some other host
  private var currentServerUrl: String? = null
  private var serverFailed = false
  private var clearHistoryOnFinish = false
  private var loadToken = 0

  private var destroyed = false
  private val restarts = ArrayDeque<Long>()

  // Set while the list page is loading and handled once it is ready to hear about them
  private var pendingFailure: JSONObject? = null
  private var startupServerId: String? = null

  // An update waiting for the person to allow installs from this app
  private var pendingApk: File? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    root = FrameLayout(this).apply { setBackgroundColor(BACKGROUND) }
    setContentView(root)

    bridge = TvBridge(this)
    listBridge = ListBridge(this)
    attachWebView()
    startUp(true)
  }

  //#region Pages
  private fun startUp(autoConnect: Boolean) {
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
      webView.loadData(UNSUPPORTED_PAGE, "text/html", "utf-8")
      return
    }
    val last = if (autoConnect) listBridge.store.find(listBridge.store.lastServerId()) else null
    // Straight to the last server; the list page only shows a "connecting" state until it answers
    startupServerId = last?.id
    loadList(last?.id)
  }

  private fun loadList(connecting: String?) {
    val query = if (connecting != null) "?connecting=${Uri.encode(connecting)}" else ""
    webView.loadUrl("$LIST_URL$query")
  }

  /**
   * Shows the bundled server list.
   */
  fun showServerList() {
    if (destroyed) return
    loadToken++
    currentServerUrl = null
    hideCustomView()
    loadList(null)
  }

  /**
   * Opens a server's own web page.
   */
  fun loadServer(url: String) {
    if (destroyed) return
    val token = ++loadToken
    currentServerUrl = url
    serverFailed = false
    clearHistoryOnFinish = true
    webView.loadUrl("$url/")
    // A server that answers with "no content" or a download never replaces the list, which would stay stuck on "opening"
    webView.postDelayed({
      if (!destroyed && token == loadToken && isListShowing()) onServerPageFailed(url, null)
    }, SERVER_LOAD_TIMEOUT_MS)
  }

  fun trustedFingerprint(hostPort: String): String? = listBridge.store.trustedFingerprint(hostPort)

  /**
   * Whether the bundled server list is the page on screen, as opposed to one that is still loading.
   */
  fun isListShowing(): Boolean = webView.url?.let { isListUrl(it) } ?: false

  /**
   * Forgets certificate decisions the WebView made, so a changed or removed trust takes effect at once.
   */
  fun clearSslPreferences() {
    runOnUiThread { if (!destroyed) webView.clearSslPreferences() }
  }

  fun onPageStarted(url: String) {
    listBridge.reset()
    // A page asks for the screen to stay on again when it needs it
    setKeepAwake(false)
  }

  fun onPageFinished(url: String) {
    if (clearHistoryOnFinish && !isListUrl(url)) {
      clearHistoryOnFinish = false
      // So Back never returns to the list page's "connecting" state
      webView.clearHistory()
    }
    if (!isListUrl(url)) return

    pendingFailure?.let {
      pendingFailure = null
      listBridge.emit(it)
    }
    startupServerId?.let {
      startupServerId = null
      listBridge.openLast(it)
    }
  }

  /**
   * A server's page couldn't be loaded. Shows the list again with the reason, or with the question about trusting
   * the certificate when `fingerprint` is given.
   */
  fun onServerPageFailed(failedUrl: String, fingerprint: String?) {
    val server = currentServerUrl ?: return
    if (serverFailed) return
    val sameHost = try {
      Address.hostPort(failedUrl) == Address.hostPort(server)
    } catch (e: Exception) {
      false
    }
    if (!sameHost) return
    serverFailed = true

    val detail = JSONObject()
      .put("type", "probe")
      .put("ok", false)
      .put("reason", if (fingerprint != null) "certificate" else "unreachable")
      .put("address", server)
      .put("hostPort", Address.hostPort(server))
    fingerprint?.let { detail.put("fingerprint", it) }
    pendingFailure = detail
    runOnUiThread { showServerList() }
  }

  private fun isListUrl(url: String): Boolean {
    val uri = Uri.parse(url)
    return uri.scheme == "https" && uri.host == LIST_HOST
  }
  //#endregion

  //#region WebView
  @SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
  private fun attachWebView() {
    webView = WebView(this).apply {
      setBackgroundColor(BACKGROUND)
      isFocusable = true
      isFocusableInTouchMode = true
      webViewClient = TvWebViewClient(this@MainActivity)
      webChromeClient = TvChromeClient(this@MainActivity)
      addJavascriptInterface(bridge, "CinemionTV")
      if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
        // The list's private calls only exist for the bundled page's own origin, never for a server's page
        WebViewCompat.addWebMessageListener(this, "CinemionList", setOf(LIST_ORIGIN), listBridge)
      }

      settings.apply {
        javaScriptEnabled = true
        domStorageEnabled = true
        mediaPlaybackRequiresUserGesture = false
        // Allowing plain http inside an https page would undo a pinned certificate; Cinemion's pages are same-origin
        mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        setSupportZoom(false)
        textZoom = 100
        // Servers in the wild treat "Android TV" in the user agent as the cue for their TV layout
        userAgentString = "$userAgentString CinemionTV/${BuildConfig.VERSION_NAME} (Android TV)"
      }
    }
    CookieManager.getInstance().apply {
      setAcceptCookie(true)
      setAcceptThirdPartyCookies(webView, true)
    }
    if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)

    root.addView(webView, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    webView.requestFocus()
  }

  /**
   * Replaces a WebView whose web process died (low memory) with a fresh one and starts over.
   */
  fun restartWebView(dead: WebView) {
    runOnUiThread {
      if (destroyed || dead !== webView) return@runOnUiThread
      root.removeView(dead)
      dead.destroy()
      customView = null
      customViewCallback = null

      // A server that keeps killing the web process would loop forever, so after a second crash in a minute stay on the list
      val now = SystemClock.elapsedRealtime()
      restarts.addLast(now)
      while (restarts.isNotEmpty() && now - restarts.first() > RESTART_WINDOW_MS) restarts.removeFirst()
      attachWebView()
      startUp(restarts.size < 2)
    }
  }

  /**
   * Keeps the screen from sleeping, for a page that is playing video. Cleared whenever a new page starts.
   */
  fun setKeepAwake(on: Boolean) {
    if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
  }

  fun showCustomView(view: View, callback: WebChromeClient.CustomViewCallback) {
    if (customView != null) {
      callback.onCustomViewHidden()
      return
    }
    customView = view
    customViewCallback = callback
    root.addView(view, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    webView.visibility = View.GONE
    view.requestFocus()
  }

  fun hideCustomView() {
    val view = customView ?: return
    root.removeView(view)
    customView = null
    customViewCallback?.onCustomViewHidden()
    customViewCallback = null
    webView.visibility = View.VISIBLE
    webView.requestFocus()
  }
  //#endregion

  //#region Keys
  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    if (event.keyCode == KeyEvent.KEYCODE_BACK) {
      // Handled once, on release, and never passed on, so the page doesn't get a second Back of its own
      if (event.action == KeyEvent.ACTION_UP && !event.isCanceled) handleBack()
      return true
    }
    return super.dispatchKeyEvent(event)
  }

  /**
   * Back goes to the page first as an Escape key press, which the web client already uses to close things and go back.
   * When the page doesn't handle it: leave full screen, go back a page, or return to the server list. On a server's
   * first screens (home, profile picker, sign-in, setup) with nothing open, Back goes straight to the server list, because
   * the client there takes Escape but has nowhere to go back to.
   */
  private fun handleBack() {
    var answered = false
    val goOn = { result: String? ->
      if (!answered) {
        answered = true
        navigateBack(result)
      }
    }
    // A page that is stuck or gone never answers, and Back must still do something
    webView.postDelayed({ goOn(null) }, BACK_ANSWER_TIMEOUT_MS)
    webView.evaluateJavascript(BACK_SCRIPT) { result -> goOn(result) }
  }

  private fun navigateBack(result: String?) {
    if (destroyed) return
    if (result == "\"handled\"") {
      // The page took the key, but one that stays full screen would leave Back doing nothing
      if (customView != null) webView.postDelayed({ hideCustomView() }, FULLSCREEN_GRACE_MS)
      return
    }
    when {
      customView != null -> hideCustomView()
      isListShowing() -> finishAffinity()
      result == "\"top\"" -> showServerList()
      webView.canGoBack() -> webView.goBack()
      else -> showServerList()
    }
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (!hasFocus) return
    WindowCompat.setDecorFitsSystemWindows(window, false)
    WindowInsetsControllerCompat(window, window.decorView).apply {
      hide(WindowInsetsCompat.Type.systemBars())
      systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }
  }
  //#endregion

  //#region Updates
  /**
   * Hands a downloaded update to the system installer. Installing from an app needs a one-time permission, so the first
   * time this opens that settings screen and finishes when the person comes back.
   */
  fun installApk(file: File) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !packageManager.canRequestPackageInstalls()) {
      pendingApk = file
      try {
        startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
      } catch (e: ActivityNotFoundException) {
        pendingApk = null
        listBridge.emit(JSONObject().put("type", "error").put("message", "Allow Cinemion to install apps in this device's settings, then try the update again."))
      }
      return
    }
    val uri = FileProvider.getUriForFile(this, "$packageName.updates", file)
    val intent = Intent(Intent.ACTION_VIEW)
      .setDataAndType(uri, "application/vnd.android.package-archive")
      .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
      startActivity(intent)
    } catch (e: ActivityNotFoundException) {
      listBridge.emit(JSONObject().put("type", "error").put("message", "This device has no installer for apps. Download the update from the Cinemion releases page instead."))
    }
  }

  override fun onResume() {
    super.onResume()
    val waiting = pendingApk ?: return
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || packageManager.canRequestPackageInstalls()) {
      pendingApk = null
      installApk(waiting)
    }
  }
  //#endregion

  override fun onPause() {
    CookieManager.getInstance().flush()
    super.onPause()
  }

  override fun onDestroy() {
    destroyed = true
    listBridge.shutdown()
    root.removeAllViews()
    webView.destroy()
    super.onDestroy()
  }

  private companion object {
    const val LIST_HOST = "appassets.androidplatform.net"
    const val LIST_ORIGIN = "https://$LIST_HOST"
    const val LIST_URL = "$LIST_ORIGIN/index.html"
    const val BACKGROUND = 0xFF08090B.toInt()

    // How long a page gets to leave full screen on its own after Back
    const val FULLSCREEN_GRACE_MS = 600L

    // How long Back waits for the page's answer, and how long a server gets to replace the list once opened
    const val BACK_ANSWER_TIMEOUT_MS = 1500L
    const val SERVER_LOAD_TIMEOUT_MS = 15000L
    const val RESTART_WINDOW_MS = 60000L

    // Shown when the device's WebView is too old for the list page's private channel
    const val UNSUPPORTED_PAGE = "<body style='background:#08090B;color:#F3F4F6;font:24px sans-serif;padding:10%'>" +
      "<h1>Update Android System WebView</h1><p>Cinemion needs a newer Android System WebView. " +
      "Update it from the Play Store, then open Cinemion again.</p>"

    // Paths where the web client has nothing to go back to, and what counts as "something open" on them
    const val TOP_PATHS = "['/','/profiles','/sign-in','/setup']"
    const val OPEN_SELECTOR = "[role=dialog],[role=alertdialog],[role=menu],[role=listbox],.cn-menu,.cn-dialog,.cn-profiles__entry"

    // "top" on a first screen with nothing open, otherwise "handled" or "unhandled" after an Escape key press.
    // `which` and `keyCode` are there for code that still reads the old fields.
    const val BACK_SCRIPT = "(function(){if($TOP_PATHS.indexOf(location.pathname)>=0&&!document.querySelector('$OPEN_SELECTOR'))return 'top';" +
      "var e=new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true,cancelable:true});" +
      "(document.activeElement||document.body).dispatchEvent(e);return e.defaultPrevented?'handled':'unhandled'})()"
  }
}
