package dk.dashcam

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiNetworkSpecifier
import android.os.Build
import android.os.PatternMatcher
import android.util.Log
import androidx.annotation.RequiresApi
import dk.dashcam.cam.CameraException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Gets the phone onto the camera's Wi-Fi and – the important part – makes this app use it.
 *
 * The camera's Wi-Fi has no internet, so modern Android quietly keeps sending app traffic over
 * mobile data instead. That is why the old YI app "can't find" the camera. We bind the whole
 * app process to the camera network, so every connection (commands, files, live video) goes
 * there.
 */
class CameraWifi(context: Context) {
    private val cm = context.getSystemService(ConnectivityManager::class.java)
    private var callback: ConnectivityManager.NetworkCallback? = null

    /** Called when Android drops the camera network we asked for. */
    var onLost: (() -> Unit)? = null

    /**
     * Looks for a Wi-Fi network the phone is already on where the camera answers, and binds
     * the app to it. Returns false if there is none.
     */
    suspend fun useExisting(host: String): Boolean = withContext(Dispatchers.IO) {
        @Suppress("DEPRECATION")
        val wifiNetworks = cm.allNetworks.filter { n ->
            cm.getNetworkCapabilities(n)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
        }
        val network = wifiNetworks.firstOrNull { looksLikeCamera(it, host) }
            ?: return@withContext false
        cm.bindProcessToNetwork(network)
        true
    }

    /**
     * Asks for the firmware version over [network]. Only a Novatek camera answers with
     * `<Cmd>…</Cmd>` XML, so a home router that happens to use the same IP is not mistaken
     * for the camera.
     */
    private fun looksLikeCamera(network: Network, host: String): Boolean = try {
        val conn = network.openConnection(URL("http://$host/?custom=1&cmd=3012")) as HttpURLConnection
        conn.connectTimeout = 1_500
        conn.readTimeout = 2_500
        try {
            conn.inputStream.bufferedReader().use { it.readText() }.contains("<Cmd>")
        } finally {
            conn.disconnect()
        }
    } catch (e: IOException) {
        false
    }

    /**
     * Asks Android to join the camera's Wi-Fi. Android shows its own dialog listing the
     * networks whose name starts with [ssidPrefix]; after the first approval it usually
     * reconnects without asking.
     */
    @RequiresApi(Build.VERSION_CODES.Q)
    suspend fun request(ssidPrefix: String, password: String): Network =
        suspendCancellableCoroutine { cont ->
            release()
            val specifier = WifiNetworkSpecifier.Builder()
                .setSsidPattern(PatternMatcher(ssidPrefix, PatternMatcher.PATTERN_PREFIX))
                .apply { if (password.isNotEmpty()) setWpa2Passphrase(password) }
                .build()
            val request = NetworkRequest.Builder()
                .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .setNetworkSpecifier(specifier)
                .build()
            val cb = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    cm.bindProcessToNetwork(network)
                    if (cont.isActive) cont.resume(network)
                }

                override fun onUnavailable() {
                    if (cont.isActive) {
                        cont.resumeWithException(
                            CameraException("Telefonen kunne ikke komme på kameraets Wi‑Fi")
                        )
                    }
                }

                override fun onLost(network: Network) {
                    Log.i(TAG, "Camera Wi-Fi lost")
                    onLost?.invoke()
                }
            }
            callback = cb
            try {
                cm.requestNetwork(request, cb)
            } catch (e: RuntimeException) {
                callback = null
                cont.resumeWithException(CameraException("Android afviste Wi‑Fi-forespørgslen: ${e.message}", e))
                return@suspendCancellableCoroutine
            }
            cont.invokeOnCancellation { release() }
        }

    /** Stops using the camera network (and lets Android leave it if we asked to join it). */
    fun release() {
        callback?.let { runCatching { cm.unregisterNetworkCallback(it) } }
        callback = null
        cm.bindProcessToNetwork(null)
    }

    private companion object {
        const val TAG = "CameraWifi"
    }
}
