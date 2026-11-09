package dev.ionnet.cinemion

import android.content.Context
import android.net.ConnectivityManager
import java.net.Inet4Address
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Looks for Cinemion servers on the device's own IPv4 /24 network, on the ports a server normally uses. It only needs
 * `/api/server`, so servers of any version are found.
 */
class NetworkScanner(private val context: Context, private val probe: ServerProbe) {
  private val running = AtomicBoolean(false)

  /**
   * Starts a scan in the background and returns at once. `onFound` is called for each server as it answers, from
   * several threads. `onDone` is called when the sweep has covered every address; `onError` is called instead when there is no network to scan. A scan already in progress is left to finish.
   */
  fun scan(onFound: (ServerProbe.Server) -> Unit, onDone: () -> Unit, onError: (String) -> Unit) {
    if (!running.compareAndSet(false, true)) return
    Thread {
      try {
        val prefix = localPrefix()
        if (prefix == null) {
          onError("Couldn't tell which network this is on. Connect to Wi-Fi or Ethernet and try again.")
        } else {
          sweep(prefix, onFound)
          onDone()
        }
      } finally {
        running.set(false)
      }
    }.start()
  }

  private fun sweep(prefix: String, onFound: (ServerProbe.Server) -> Unit) {
    val pool = Executors.newFixedThreadPool(CONCURRENCY)
    try {
      val tasks = (1..254).flatMap { host ->
        TARGETS.map { (scheme, port, timeout) ->
          Callable {
            probe.probeLenient("$scheme://$prefix.$host:$port", timeout)?.let(onFound)
          }
        }
      }
      pool.invokeAll(tasks)
    } finally {
      pool.shutdownNow()
    }
  }

  // The first three numbers of this device's IPv4 address, like "192.168.1"
  private fun localPrefix(): String? {
    val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    val network = manager.activeNetwork ?: return null
    val address = manager.getLinkProperties(network)?.linkAddresses
      ?.map { it.address }
      ?.firstOrNull { it is Inet4Address && !it.isLoopbackAddress && !it.isLinkLocalAddress }
      ?: return null
    return address.hostAddress?.substringBeforeLast('.')
  }

  private companion object {
    const val CONCURRENCY = 32

    // Scheme, port and timeout in ms. A closed port answers at once and a missing host costs the whole timeout; the
    // https port gets longer because a TLS handshake on a slow TV box can take several hundred ms.
    val TARGETS = listOf(Triple("http", 8600, 400), Triple("https", 8443, 1200))
  }
}
