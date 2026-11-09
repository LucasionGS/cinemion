package dev.ionnet.cinemion

import android.net.http.SslCertificate
import java.io.ByteArrayInputStream
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

/**
 * Trust for servers that make their own certificate. A person trusts one exact certificate (by its SHA-256
 * fingerprint) for one host and port; nothing else is accepted, so a different certificate on the same address
 * is refused until they confirm it again.
 */
object CertificateTrust {
  /**
   * The SHA-256 fingerprint as upper-case hex pairs separated by colons, the way browsers show it.
   */
  fun fingerprint(certificate: X509Certificate): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(certificate.encoded)
    return digest.joinToString(":") { "%02X".format(it) }
  }

  /**
   * Fingerprints compare without colons and case, so what the page sends back always matches.
   */
  fun normalize(fingerprint: String): String = fingerprint.replace(":", "").lowercase()

  fun matches(certificate: X509Certificate, trusted: String?): Boolean =
    trusted != null && normalize(fingerprint(certificate)) == normalize(trusted)

  /**
   * A TLS context that accepts exactly the certificate with this fingerprint.
   */
  fun pinned(fingerprint: String): SSLContext = context(object : X509TrustManager {
    override fun checkClientTrusted(chain: Array<out X509Certificate>, authType: String) = Unit

    override fun checkServerTrusted(chain: Array<out X509Certificate>, authType: String) {
      if (!matches(chain[0], fingerprint)) throw CertificateException("The certificate isn't the one that was trusted.")
    }

    override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
  })

  /**
   * A TLS context that accepts anything. Only for reading a server's public details while looking for servers, or to
   * learn a certificate's fingerprint so the person can decide about it. Nothing private is ever sent over it.
   */
  fun lenient(): SSLContext = context(object : X509TrustManager {
    override fun checkClientTrusted(chain: Array<out X509Certificate>, authType: String) = Unit

    override fun checkServerTrusted(chain: Array<out X509Certificate>, authType: String) = Unit

    override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
  })

  /**
   * A pinned certificate is identified by its fingerprint, so its name doesn't have to match the address (servers
   * are usually reached by IP address).
   */
  val anyHost = HostnameVerifier { _, _ -> true }

  /**
   * The certificate a WebView SSL error is about.
   */
  fun fromWebView(certificate: SslCertificate): X509Certificate? {
    val bytes = SslCertificate.saveState(certificate).getByteArray("x509-certificate") ?: return null
    return CertificateFactory.getInstance("X.509").generateCertificate(ByteArrayInputStream(bytes)) as? X509Certificate
  }

  private fun context(manager: X509TrustManager): SSLContext {
    val context = SSLContext.getInstance("TLS")
    context.init(null, arrayOf(manager), null)
    return context
  }
}
