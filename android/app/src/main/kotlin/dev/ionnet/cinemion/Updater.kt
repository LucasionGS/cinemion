package dev.ionnet.cinemion

import android.content.Context
import org.json.JSONException
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * Finds newer releases of this app on GitHub and downloads them. The release assets are named
 * `cinemion-tv-<version>.apk`, so the app can update without the server being involved.
 */
class Updater(private val context: Context, private val store: ServerStore) {
  class Release(val version: String, val size: Long, val url: String) {
    fun toJson(): JSONObject = JSONObject().put("version", version).put("size", size).put("url", url)
  }

  /**
   * The newest release when it is newer than this app, else null. Goes to GitHub at most once a day and answers from
   * the saved result in between, so opening the app often doesn't cost a request every time.
   */
  fun check(): Release? {
    val checkedAt = store.updateCheckedAt()
    if (System.currentTimeMillis() - checkedAt < CHECK_INTERVAL_MS) return newerOrNull(cached())
    val release = try {
      fetchLatest()
    } catch (e: IOException) {
      return newerOrNull(cached())
    } catch (e: JSONException) {
      return newerOrNull(cached())
    }
    store.saveUpdateCheck(release?.toJson()?.toString())
    return newerOrNull(release)
  }

  /**
   * Downloads the release into the cache and returns the file. `onProgress` gets 0 to 100. The file is written under a
   * temporary name and only renamed once every byte is there, so a cut-off download is never handed to the installer.
   * Only one download should run at a time.
   */
  fun download(release: Release, onProgress: (Int) -> Unit): File {
    val dir = File(context.cacheDir, "updates")
    dir.mkdirs()
    val target = File(dir, "cinemion-tv-${release.version}.apk")
    val part = File(dir, "${target.name}.part")
    // Leftovers from older versions and failed tries. The current file is left alone, as the installer may be reading it.
    dir.listFiles()?.filter { it.name != target.name && it.name != part.name }?.forEach { it.delete() }

    val connection = URL(release.url).openConnection() as HttpURLConnection
    connection.connectTimeout = 10000
    connection.readTimeout = 20000
    try {
      if (connection.responseCode !in 200..299) throw IOException("GitHub answered ${connection.responseCode}.")
      val expected = if (release.size > 0) release.size else connection.contentLengthLong
      var done = 0L
      var lastPercent = -1
      connection.inputStream.use { input ->
        part.outputStream().use { output ->
          val buffer = ByteArray(64 * 1024)
          while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            output.write(buffer, 0, read)
            done += read
            val percent = if (expected > 0) (done * 100 / expected).toInt().coerceAtMost(100) else 0
            if (percent != lastPercent) {
              lastPercent = percent
              onProgress(percent)
            }
          }
        }
      }
      if (expected > 0 && done != expected) throw IOException("The download stopped early.")
      if (!part.renameTo(target)) throw IOException("The download couldn't be saved.")
    } catch (e: IOException) {
      part.delete()
      throw e
    } finally {
      connection.disconnect()
    }
    return target
  }

  private fun cached(): Release? {
    val saved = store.updateRelease() ?: return null
    return try {
      parseRelease(JSONObject(saved))
    } catch (e: JSONException) {
      null
    }
  }

  private fun parseRelease(json: JSONObject): Release? {
    val version = json.optString("version")
    val url = json.optString("url")
    return if (version.isEmpty() || url.isEmpty()) null else Release(version, json.optLong("size"), url)
  }

  private fun newerOrNull(release: Release?): Release? =
    if (release != null && isNewer(release.version, BuildConfig.VERSION_NAME)) release else null

  private fun fetchLatest(): Release? {
    val connection = URL(BuildConfig.UPDATE_URL).openConnection() as HttpURLConnection
    connection.connectTimeout = 8000
    connection.readTimeout = 8000
    connection.setRequestProperty("Accept", "application/vnd.github+json")
    connection.setRequestProperty("User-Agent", "CinemionTV/${BuildConfig.VERSION_NAME}")
    try {
      // Nothing published yet is a normal answer, not a failure
      if (connection.responseCode == 404) return null
      if (connection.responseCode !in 200..299) throw IOException("GitHub answered ${connection.responseCode}.")
      val release = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
      val assets = release.optJSONArray("assets") ?: return null
      var best: Release? = null
      for (index in 0 until assets.length()) {
        val asset = assets.getJSONObject(index)
        val match = ASSET_NAME.matchEntire(asset.optString("name")) ?: continue
        val candidate = Release(match.groupValues[1], asset.optLong("size"), asset.getString("browser_download_url"))
        if (best == null || isNewer(candidate.version, best.version)) best = candidate
      }
      return best
    } finally {
      connection.disconnect()
    }
  }

  private companion object {
    const val CHECK_INTERVAL_MS = 24L * 60 * 60 * 1000
    val ASSET_NAME = Regex("""cinemion-tv-(\d+\.\d+\.\d+)\.apk""")

    fun isNewer(candidate: String, current: String): Boolean {
      val a = candidate.split('.').map { it.toIntOrNull() ?: 0 }
      val b = current.split('.').map { it.toIntOrNull() ?: 0 }
      for (index in 0 until maxOf(a.size, b.size)) {
        val diff = a.getOrElse(index) { 0 } - b.getOrElse(index) { 0 }
        if (diff != 0) return diff > 0
      }
      return false
    }
  }
}
