package dk.loopcast

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import fi.iki.elonen.NanoHTTPD
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.URLDecoder
import java.net.URLEncoder
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * A tiny HTTP server on the phone that relays SoundCloud's stream to the Nest.
 *
 * SoundCloud's stream URLs are signed and expire after a while, which breaks an
 * overnight loop when the Nest is given the URL directly. Pointing the Nest at
 * http://<phone>:<port>/track/<key>/audio.mp3 instead lets us serve the MP3 from the
 * phone's local cache (downloaded once) and, if it is not cached yet, fetch a fresh
 * signed URL whenever the old one stops working, so the loop never dies.
 */
class StreamProxyServer private constructor(
    port: Int,
    private val resolver: SoundCloudResolver,
    private val prefs: SharedPreferences,
    private val cache: TrackCache,
) : NanoHTTPD(port) {

    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()

    /** key -> canonical SoundCloud permalink. */
    private val tracks = ConcurrentHashMap<String, String>()
    /** key -> most recent resolution (stream url etc). */
    private val resolvedTracks = ConcurrentHashMap<String, ResolvedTrack>()

    init {
        // Restore registered tracks so a restarted service can keep serving them.
        prefs.all.forEach { (key, value) -> if (value is String) tracks[key] = value }
    }

    /** Registers a track and returns the local URL the Nest should play, or null if the phone has no Wi‑Fi IP. */
    fun register(track: ResolvedTrack): String? {
        val key = keyFor(track.permalinkUrl)
        tracks[key] = track.permalinkUrl
        if (track.streamUrl.isNotEmpty()) resolvedTracks[key] = track
        prefs.edit().putString(key, track.permalinkUrl).apply()
        val ip = localIpAddress() ?: return null
        val file = if (track.isHls && !cache.has(key)) "playlist.m3u8" else "audio.mp3"
        return "http://$ip:$listeningPort/track/$key/$file"
    }

    override fun useGzipWhenAccepted(r: Response): Boolean = false

    override fun serve(session: IHTTPSession): Response {
        return try {
            route(session).also { cors(it) }
        } catch (e: Exception) {
            Log.w(TAG, "Proxy error for ${session.uri}", e)
            cors(text(Response.Status.INTERNAL_ERROR, "error: ${e.message}"))
        }
    }

    private fun route(session: IHTTPSession): Response {
        if (session.method == Method.OPTIONS) return text(Response.Status.NO_CONTENT, "")

        val parts = session.uri.trim('/').split('/')
        return when {
            parts.size == 3 && parts[0] == "track" && parts[2] == "audio.mp3" ->
                proxyAudio(session, parts[1])
            parts.size == 3 && parts[0] == "track" && parts[2] == "playlist.m3u8" ->
                proxyPlaylist(session, parts[1])
            parts.size == 1 && parts[0] == "seg" -> proxySegment(session)
            parts.size == 1 && parts[0].isEmpty() -> text(Response.Status.OK, "LoopCast relay is running")
            else -> text(Response.Status.NOT_FOUND, "not found")
        }
    }

    // --- Progressive MP3 -------------------------------------------------------------------

    private fun proxyAudio(session: IHTTPSession, key: String): Response {
        if (cache.has(key)) return serveFile(session, cache.fileFor(key))

        val range = session.headers["range"]
        var track = resolved(key, force = false)
        var upstream = fetch(track.streamUrl, range)
        if (isExpired(upstream.code)) {
            upstream.close()
            Log.i(TAG, "Stream URL expired (${upstream.code}); re-resolving")
            track = resolved(key, force = true)
            upstream = fetch(track.streamUrl, range)
        }
        return passThrough(upstream, "audio/mpeg")
    }

    // --- HLS ----------------------------------------------------------------------------------

    private fun proxyPlaylist(session: IHTTPSession, key: String): Response {
        if (cache.has(key)) return serveFile(session, cache.fileFor(key))
        var track = resolved(key, force = false)
        var upstream = fetch(track.streamUrl, null)
        if (isExpired(upstream.code)) {
            upstream.close()
            track = resolved(key, force = true)
            upstream = fetch(track.streamUrl, null)
        }
        upstream.use { response ->
            if (!response.isSuccessful) {
                return text(Response.Status.SERVICE_UNAVAILABLE, "upstream ${response.code}")
            }
            val base = response.request.url
            val body = response.body?.string() ?: ""
            val rewritten = body.lines().joinToString("\n") { line ->
                val trimmed = line.trim()
                if (trimmed.isEmpty() || trimmed.startsWith("#")) {
                    line
                } else {
                    val absolute = base.resolve(trimmed)?.toString() ?: trimmed
                    "/seg?u=" + URLEncoder.encode(absolute, "UTF-8")
                }
            }
            return newFixedLengthResponse(Response.Status.OK, "application/vnd.apple.mpegurl", rewritten)
        }
    }

    private fun proxySegment(session: IHTTPSession): Response {
        val encoded = session.parameters["u"]?.firstOrNull()
            ?: return text(Response.Status.NOT_FOUND, "missing u")
        val url = URLDecoder.decode(encoded, "UTF-8")
        val host = url.toHttpUrlOrNull()?.host?.lowercase() ?: ""
        if (!host.endsWith("sndcdn.com") && !host.endsWith("soundcloud.com")) {
            return text(Response.Status.NOT_FOUND, "host not allowed")
        }
        return passThrough(fetch(url, session.headers["range"]), "audio/mpeg")
    }

    // --- Helpers ----------------------------------------------------------------------------

    private fun resolved(key: String, force: Boolean): ResolvedTrack {
        val known = resolvedTracks[key]
        val fresh = known != null && known.streamUrl.isNotEmpty() &&
            System.currentTimeMillis() - known.resolvedAtMs < CACHE_TTL_MS
        if (!force && fresh) return known!!
        val permalink = tracks[key] ?: known?.permalinkUrl ?: throw IOException("Ukendt track")
        var lastError: IOException? = null
        repeat(3) { attempt ->
            try {
                return resolver.resolve(permalink).also { resolvedTracks[key] = it }
            } catch (e: IOException) {
                lastError = e
                Log.w(TAG, "Resolve attempt ${attempt + 1} failed", e)
                Thread.sleep(1_000L * (attempt + 1))
            }
        }
        throw lastError ?: IOException("Kunne ikke slå tracket op")
    }

    /** Serves a fully cached MP3 with HTTP range support (the receiver seeks with ranges). */
    private fun serveFile(session: IHTTPSession, file: File): Response {
        val total = file.length()
        var start = 0L
        var end = total - 1
        var partial = false
        val range = session.headers["range"]
        if (range != null && range.startsWith("bytes=")) {
            val spec = range.removePrefix("bytes=").split(',')[0].trim()
            val dash = spec.indexOf('-')
            if (dash >= 0) {
                val first = spec.substring(0, dash).trim()
                val last = spec.substring(dash + 1).trim()
                if (first.isEmpty() && last.isNotEmpty()) {
                    start = (total - (last.toLongOrNull() ?: 0L)).coerceAtLeast(0L)
                } else {
                    start = first.toLongOrNull() ?: 0L
                    if (last.isNotEmpty()) end = minOf(last.toLongOrNull() ?: end, total - 1)
                }
                partial = true
            }
        }
        if (start >= total || start > end) {
            val response = text(Response.Status.RANGE_NOT_SATISFIABLE, "range not satisfiable")
            response.addHeader("Content-Range", "bytes */$total")
            return response
        }
        val length = end - start + 1
        val input = FileInputStream(file)
        if (start > 0) input.channel.position(start)
        val response = newFixedLengthResponse(
            if (partial) Response.Status.PARTIAL_CONTENT else Response.Status.OK,
            "audio/mpeg",
            input,
            length,
        )
        if (partial) response.addHeader("Content-Range", "bytes $start-$end/$total")
        response.addHeader("Accept-Ranges", "bytes")
        response.addHeader("Cache-Control", "no-cache")
        return response
    }

    private fun fetch(url: String, range: String?): okhttp3.Response {
        val builder = Request.Builder().url(url).get()
            .header("User-Agent", "LoopCast/1.0")
            .header("Accept", "*/*")
        if (!range.isNullOrBlank()) builder.header("Range", range)
        return http.newCall(builder.build()).execute()
    }

    private fun isExpired(code: Int) = code == 401 || code == 403 || code == 410

    /** Streams the upstream response body straight through to the Nest, preserving range semantics. */
    private fun passThrough(upstream: okhttp3.Response, defaultMime: String): Response {
        val status = when (upstream.code) {
            200 -> Response.Status.OK
            206 -> Response.Status.PARTIAL_CONTENT
            416 -> Response.Status.RANGE_NOT_SATISFIABLE
            else -> {
                val code = upstream.code
                upstream.close()
                return text(Response.Status.SERVICE_UNAVAILABLE, "upstream $code")
            }
        }
        val body = upstream.body ?: run {
            upstream.close()
            return text(Response.Status.SERVICE_UNAVAILABLE, "empty upstream body")
        }
        val mime = upstream.header("Content-Type") ?: defaultMime
        val length = body.contentLength()
        val response = if (length >= 0) {
            newFixedLengthResponse(status, mime, body.byteStream(), length)
        } else {
            newChunkedResponse(status, mime, body.byteStream())
        }
        upstream.header("Content-Range")?.let { response.addHeader("Content-Range", it) }
        response.addHeader("Accept-Ranges", "bytes")
        response.addHeader("Cache-Control", "no-cache")
        return response
    }

    private fun text(status: Response.Status, message: String): Response =
        newFixedLengthResponse(status, "text/plain", message)

    private fun cors(response: Response): Response {
        response.addHeader("Access-Control-Allow-Origin", "*")
        response.addHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        response.addHeader("Access-Control-Allow-Headers", "Range, Content-Type")
        response.addHeader("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges")
        return response
    }

    companion object {
        private const val TAG = "StreamProxy"
        private const val PREFERRED_PORT = 8765
        private val CACHE_TTL_MS = TimeUnit.HOURS.toMillis(6)

        @Volatile
        private var instance: StreamProxyServer? = null

        /** Returns the running server, starting it if needed. */
        @Synchronized
        fun get(context: Context): StreamProxyServer {
            instance?.let { if (it.isAlive) return it }
            val appContext = context.applicationContext
            val resolver = SoundCloudResolver(appContext)
            val prefs = appContext.getSharedPreferences("proxy_tracks", Context.MODE_PRIVATE)
            val cache = TrackCache(appContext)
            val server = try {
                StreamProxyServer(PREFERRED_PORT, resolver, prefs, cache).also { it.start(SOCKET_READ_TIMEOUT, true) }
            } catch (e: IOException) {
                Log.w(TAG, "Port $PREFERRED_PORT busy, using a random port", e)
                StreamProxyServer(0, resolver, prefs, cache).also { it.start(SOCKET_READ_TIMEOUT, true) }
            }
            Log.i(TAG, "Relay listening on port ${server.listeningPort}")
            instance = server
            return server
        }

        @Synchronized
        fun shutdown() {
            instance?.stop()
            instance = null
        }

        fun keyFor(permalinkUrl: String): String {
            val digest = MessageDigest.getInstance("SHA-1").digest(permalinkUrl.toByteArray())
            return digest.take(8).joinToString("") { "%02x".format(it) }
        }

        /** The phone's IPv4 address on the local network (Wi‑Fi preferred). */
        fun localIpAddress(): String? {
            val interfaces = try {
                NetworkInterface.getNetworkInterfaces()?.toList() ?: return null
            } catch (e: Exception) {
                return null
            }
            val candidates = interfaces
                .filter { runCatching { it.isUp && !it.isLoopback }.getOrDefault(false) }
                .sortedBy { if (it.name.startsWith("wlan")) 0 else 1 }
            for (nif in candidates) {
                for (address in nif.inetAddresses) {
                    if (address is Inet4Address && address.isSiteLocalAddress) return address.hostAddress
                }
            }
            return null
        }
    }
}
