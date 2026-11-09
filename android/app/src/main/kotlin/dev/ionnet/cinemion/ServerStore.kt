package dev.ionnet.cinemion

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.util.UUID

/**
 * The saved servers, the last one opened, the certificates the person trusted and the app's update state.
 * Everything lives in SharedPreferences, so it survives restarts.
 */
class ServerStore(context: Context) {
  class Server(val id: String, val url: String, val name: String, val version: String, val lastUsed: Long) {
    fun toJson(): JSONObject = JSONObject()
      .put("id", id)
      .put("url", url)
      .put("name", name)
      .put("version", version)
      .put("lastUsed", lastUsed)
  }

  private val prefs: SharedPreferences = context.getSharedPreferences("cinemion", Context.MODE_PRIVATE)

  @Synchronized
  fun list(): List<Server> {
    val array = try {
      JSONArray(prefs.getString(KEY_SERVERS, null) ?: "[]")
    } catch (e: JSONException) {
      JSONArray()
    }
    return (0 until array.length()).map { index ->
      val item = array.getJSONObject(index)
      Server(
        item.getString("id"),
        item.getString("url"),
        item.optString("name"),
        item.optString("version"),
        item.optLong("lastUsed"),
      )
    }
  }

  fun find(id: String?): Server? = if (id == null) null else list().firstOrNull { it.id == id }

  fun findByUrl(url: String): Server? = list().firstOrNull { it.url == url }

  /**
   * Saves a server, or refreshes its name and version when the address is already known.
   */
  @Synchronized
  fun save(url: String, name: String, version: String): Server {
    val servers = list().toMutableList()
    val existing = servers.indexOfFirst { it.url == url }
    val server = if (existing >= 0) {
      Server(servers[existing].id, url, name, version, servers[existing].lastUsed)
    } else {
      Server(UUID.randomUUID().toString(), url, name, version, 0L)
    }
    if (existing >= 0) servers[existing] = server else servers.add(server)
    write(servers)
    return server
  }

  /**
   * Records a successful open: refreshes the name and version, stamps the time and remembers it as the last server.
   */
  @Synchronized
  fun markOpened(id: String, name: String, version: String): Server? {
    val servers = list().toMutableList()
    val index = servers.indexOfFirst { it.id == id }
    if (index < 0) return null
    val server = Server(id, servers[index].url, name, version, System.currentTimeMillis())
    servers[index] = server
    write(servers)
    prefs.edit().putString(KEY_LAST, id).apply()
    return server
  }

  @Synchronized
  fun remove(id: String) {
    write(list().filter { it.id != id })
    if (lastServerId() == id) prefs.edit().remove(KEY_LAST).apply()
  }

  fun lastServerId(): String? = prefs.getString(KEY_LAST, null)

  private fun write(servers: List<Server>) {
    val array = JSONArray()
    servers.forEach { array.put(it.toJson()) }
    prefs.edit().putString(KEY_SERVERS, array.toString()).apply()
  }

  //#region Certificates
  @Synchronized
  fun trustedFingerprint(hostPort: String): String? = trusted().optString(hostPort.lowercase()).ifEmpty { null }

  @Synchronized
  fun trust(hostPort: String, fingerprint: String) {
    val trusted = trusted().put(hostPort.lowercase(), CertificateTrust.normalize(fingerprint))
    prefs.edit().putString(KEY_TRUSTED, trusted.toString()).apply()
  }

  @Synchronized
  fun untrust(hostPort: String) {
    val trusted = trusted()
    trusted.remove(hostPort.lowercase())
    prefs.edit().putString(KEY_TRUSTED, trusted.toString()).apply()
  }

  private fun trusted(): JSONObject = try {
    JSONObject(prefs.getString(KEY_TRUSTED, null) ?: "{}")
  } catch (e: JSONException) {
    JSONObject()
  }
  //#endregion

  //#region Updates
  fun updateCheckedAt(): Long = prefs.getLong(KEY_UPDATE_CHECKED, 0L)

  fun updateRelease(): String? = prefs.getString(KEY_UPDATE_RELEASE, null)

  fun saveUpdateCheck(release: String?) {
    prefs.edit()
      .putLong(KEY_UPDATE_CHECKED, System.currentTimeMillis())
      .putString(KEY_UPDATE_RELEASE, release)
      .apply()
  }
  //#endregion

  private companion object {
    const val KEY_SERVERS = "servers"
    const val KEY_LAST = "lastServerId"
    const val KEY_TRUSTED = "trustedCertificates"
    const val KEY_UPDATE_CHECKED = "updateCheckedAt"
    const val KEY_UPDATE_RELEASE = "updateRelease"
  }
}
