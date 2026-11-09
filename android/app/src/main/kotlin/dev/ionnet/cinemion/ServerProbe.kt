package dev.ionnet.cinemion

import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.cert.X509Certificate
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLException

/**
 * Asks an address whether a Cinemion server answers there. It reads `/api/server`, which every version has and which
 * needs no sign-in. Done natively so the web page's cross-origin rules don't get in the way.
 */
class ServerProbe(private val store: ServerStore) {
  class Server(val url: String, val name: String, val version: String)

  /**
   * The outcome of a probe. `reason` is `unreachable`, `notCinemion` or `certificate` when `server` is null.
   */
  class Result(val server: Server? = null, val reason: String? = null, val fingerprint: String? = null)

  /**
   * Probes `baseUrl` (as made by [Address.normalize]). A certificate the device doesn't know gives the
   * `certificate` reason and its fingerprint, unless the person already trusted exactly that certificate.
   */
  fun probe(baseUrl: String, timeoutMs: Int): Result {
    val trusted = if (baseUrl.startsWith("https://")) store.trustedFingerprint(Address.hostPort(baseUrl)) else null
    return try {
      val server = fetch(baseUrl, timeoutMs, trusted?.let { CertificateTrust.pinned(it) })
      if (server != null) Result(server = server) else Result(reason = "notCinemion")
    } catch (e: SSLException) {
      val fingerprint = captureFingerprint(baseUrl, timeoutMs)
      if (fingerprint != null) Result(reason = "certificate", fingerprint = fingerprint) else Result(reason = "unreachable")
    } catch (e: IOException) {
      Result(reason = "unreachable")
    }
  }

  /**
   * A probe for the network scan: any certificate is accepted, because only the public name and version are read and
   * the person decides about trust when they pick the server.
   */
  fun probeLenient(baseUrl: String, timeoutMs: Int): Server? = try {
    fetch(baseUrl, timeoutMs, if (baseUrl.startsWith("https://")) CertificateTrust.lenient() else null)
  } catch (e: IOException) {
    null
  }

  private fun open(baseUrl: String, path: String, timeoutMs: Int, tls: SSLContext?): HttpURLConnection {
    val connection = URL("$baseUrl$path").openConnection() as HttpURLConnection
    connection.connectTimeout = timeoutMs
    connection.readTimeout = timeoutMs
    connection.setRequestProperty("Accept", "application/json")
    connection.setRequestProperty("User-Agent", "CinemionTV/${BuildConfig.VERSION_NAME}")
    if (connection is HttpsURLConnection && tls != null) {
      connection.sslSocketFactory = tls.socketFactory
      connection.hostnameVerifier = CertificateTrust.anyHost
    }
    return connection
  }

  private fun fetch(baseUrl: String, timeoutMs: Int, tls: SSLContext?): Server? {
    val connection = open(baseUrl, "/api/server", timeoutMs, tls)
    try {
      if (connection.responseCode !in 200..299) return null
      val body = readLimited(connection)
      val json = try {
        JSONObject(body)
      } catch (e: JSONException) {
        return null
      }
      val name = json.opt("name") as? String ?: return null
      val version = json.opt("version") as? String ?: return null
      return Server(baseUrl, name, version)
    } finally {
      connection.disconnect()
    }
  }

  // A real answer is a few hundred bytes; a cap stops a stray web server from filling memory
  private fun readLimited(connection: HttpURLConnection): String {
    val buffer = ByteArray(8192)
    val out = java.io.ByteArrayOutputStream()
    connection.inputStream.use { input ->
      while (out.size() < MAX_BODY) {
        val read = input.read(buffer)
        if (read < 0) break
        out.write(buffer, 0, read)
      }
    }
    return out.toString(Charsets.UTF_8.name())
  }

  private fun captureFingerprint(baseUrl: String, timeoutMs: Int): String? {
    val connection = try {
      open(baseUrl, "/api/server", timeoutMs, CertificateTrust.lenient()) as? HttpsURLConnection
    } catch (e: IOException) {
      null
    } ?: return null
    return try {
      connection.connect()
      (connection.serverCertificates.firstOrNull() as? X509Certificate)?.let { CertificateTrust.fingerprint(it) }
    } catch (e: IOException) {
      null
    } finally {
      connection.disconnect()
    }
  }

  private companion object {
    const val MAX_BODY = 65536
  }
}
