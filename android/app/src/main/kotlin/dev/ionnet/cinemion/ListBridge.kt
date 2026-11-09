package dev.ionnet.cinemion

import android.net.Uri
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The server list page's private line to the app: the saved servers, probing, scanning, certificate trust and updates.
 *
 * It is a web message listener that exists only for the bundled page's origin and only answers its main frame, so no
 * server's page can reach it, however quickly it runs. The page sends `{ method, args, id }` and gets back
 * `{ type: "response", id, result }`; things that finish later arrive as `{ type: "event", detail }` where `detail.type`
 * is `probe`, `found`, `scanDone`, `update`, `updateProgress` or `error`.
 */
class ListBridge(private val activity: MainActivity) : WebViewCompat.WebMessageListener {
  val store = ServerStore(activity)
  private val probe = ServerProbe(store)
  private val scanner = NetworkScanner(activity, probe)
  private val updater = Updater(activity, store)
  private val io = Executors.newCachedThreadPool()
  private val installing = AtomicBoolean(false)

  // Only touched on the UI thread. Events wait in the queue until the page has said hello.
  private var reply: JavaScriptReplyProxy? = null
  private val waiting = ArrayDeque<String>()

  @Volatile
  private var release: Updater.Release? = null

  /**
   * Forgets the current page's channel. Called when any page starts loading, so nothing meant for one page reaches the next.
   */
  fun reset() {
    reply = null
    waiting.clear()
  }

  /**
   * Stops background work when the app closes.
   */
  fun shutdown() {
    io.shutdownNow()
  }

  /**
   * Opens the last server used. Called by the app at start, where the page isn't asking.
   */
  fun openLast(id: String) = execute { open(id) }

  /**
   * Sends an event to the list page. Dropped when another page is showing.
   */
  fun emit(detail: JSONObject) = send(JSONObject().put("type", "event").put("detail", detail))

  override fun onPostMessage(view: WebView, message: WebMessageCompat, sourceOrigin: Uri, isMainFrame: Boolean, replyProxy: JavaScriptReplyProxy) {
    if (!isMainFrame) return
    val request = try {
      JSONObject(message.data ?: return)
    } catch (e: JSONException) {
      return
    }
    attach(replyProxy)

    val args = request.optJSONArray("args") ?: JSONArray()
    when (request.optString("method")) {
      "getServers" -> {
        val servers = JSONArray()
        store.list().forEach { servers.put(it.toJson()) }
        send(JSONObject().put("type", "response").put("id", request.opt("id")).put("result", servers))
      }
      "addServer" -> execute { add(args.optString(0)) }
      "removeServer" -> remove(args.optString(0))
      "openServer" -> execute { open(args.optString(0)) }
      "scan" -> scan()
      "trustCertificate" -> {
        store.trust(args.optString(0), args.optString(1))
        activity.clearSslPreferences()
      }
      "checkUpdate" -> execute { check() }
      "installUpdate" -> execute { install() }
    }
  }

  private fun attach(proxy: JavaScriptReplyProxy) {
    if (reply === proxy) return
    reply = proxy
    while (waiting.isNotEmpty()) proxy.postMessage(waiting.removeFirst())
  }

  private fun send(message: JSONObject) {
    val text = message.toString()
    activity.runOnUiThread {
      if (!activity.isListShowing()) return@runOnUiThread
      val proxy = reply
      if (proxy != null) proxy.postMessage(text) else waiting.addLast(text)
    }
  }

  private fun execute(task: () -> Unit) {
    if (!io.isShutdown) io.execute(task)
  }

  private fun remove(id: String) {
    val server = store.find(id) ?: return
    store.remove(id)
    store.untrust(Address.hostPort(server.url))
    activity.clearSslPreferences()
  }

  private fun scan() {
    scanner.scan(
      onFound = { server ->
        emit(JSONObject().put("type", "found").put("server", JSONObject()
          .put("url", server.url)
          .put("name", server.name)
          .put("version", server.version)))
      },
      onDone = { emit(JSONObject().put("type", "scanDone")) },
      onError = { message -> emit(errorDetail(message)) },
    )
  }

  private fun add(address: String) {
    val url = Address.normalize(address)
    if (url == null) {
      emit(errorDetail("That doesn't look like an address. Try something like 192.168.1.31."))
      return
    }
    val result = probe.probe(url, ADD_TIMEOUT_MS)
    val found = result.server
    if (found == null) {
      emitFailure(url, result, null)
      return
    }
    val saved = store.save(found.url, found.name, found.version)
    emit(JSONObject().put("type", "probe").put("ok", true).put("address", url).put("server", saved.toJson()))
  }

  private fun open(id: String) {
    val server = store.find(id)
    if (server == null) {
      emit(errorDetail("That server isn't in your list any more."))
      return
    }
    val result = probe.probe(server.url, OPEN_TIMEOUT_MS)
    val found = result.server
    if (found == null) {
      emitFailure(server.url, result, id)
      return
    }
    store.markOpened(id, found.name, found.version)
    activity.runOnUiThread { activity.loadServer(server.url) }
  }

  private fun check() {
    val found = updater.check() ?: return
    release = found
    emit(JSONObject().put("type", "update").put("version", found.version).put("size", found.size))
  }

  private fun install() {
    // One download at a time, however many times the button is pressed
    if (!installing.compareAndSet(false, true)) return
    try {
      val target = release ?: updater.check()
      if (target == null) {
        emit(errorDetail("There's no newer version of the app to install."))
        return
      }
      val file = updater.download(target) { percent ->
        emit(JSONObject().put("type", "updateProgress").put("percent", percent))
      }
      activity.runOnUiThread { activity.installApk(file) }
    } catch (e: IOException) {
      emit(errorDetail("Couldn't download the update. Check the internet connection and try again."))
    } finally {
      installing.set(false)
    }
  }

  private fun emitFailure(address: String, result: ServerProbe.Result, id: String?) {
    val detail = JSONObject()
      .put("type", "probe")
      .put("ok", false)
      .put("reason", result.reason)
      .put("address", address)
      .put("hostPort", Address.hostPort(address))
    result.fingerprint?.let { detail.put("fingerprint", it) }
    id?.let { detail.put("id", it) }
    emit(detail)
  }

  private fun errorDetail(message: String) = JSONObject().put("type", "error").put("message", message)

  private companion object {
    const val ADD_TIMEOUT_MS = 3000
    const val OPEN_TIMEOUT_MS = 3000
  }
}
