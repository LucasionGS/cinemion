package dev.ionnet.cinemion

import java.net.URI
import java.net.URISyntaxException

/**
 * Turns whatever a person types into a server address, and builds the keys used to remember servers.
 */
object Address {
  const val DEFAULT_PORT = 8600

  /**
   * Accepts `192.168.1.31`, `host:port` or a full URL and returns it as `scheme://host[:port][/path]`.
   * Without a scheme it is plain http on port 8600, because that is where a Cinemion server listens by default.
   */
  fun normalize(input: String): String? {
    var text = input.trim()
    if (text.isEmpty()) return null
    val hasScheme = text.contains("://")
    if (!hasScheme) text = "http://$text"

    val uri = try {
      URI(text)
    } catch (e: URISyntaxException) {
      return null
    }
    val scheme = uri.scheme?.lowercase() ?: return null
    if (scheme != "http" && scheme != "https") return null
    val host = uri.host?.lowercase() ?: return null

    val port = if (uri.port == -1 && !hasScheme) DEFAULT_PORT else uri.port
    val path = (uri.rawPath ?: "").trimEnd('/')
    return buildString {
      append(scheme).append("://").append(host)
      if (port != -1) append(':').append(port)
      append(path)
    }
  }

  /**
   * The `host:port` of an address, with the scheme's usual port filled in. Certificates are remembered per host and port.
   */
  fun hostPort(url: String): String {
    val uri = URI(url)
    val port = if (uri.port != -1) uri.port else if (uri.scheme == "https") 443 else 80
    return "${uri.host}:$port".lowercase()
  }
}
