package dk.dashcam.cam

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import java.io.IOException
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

/** Runs the call asynchronously; cancelling the coroutine cancels the HTTP request. */
private suspend fun Call.await(): Response = suspendCancellableCoroutine { cont ->
    cont.invokeOnCancellation { cancel() }
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
            if (cont.isActive) cont.resumeWithException(e)
        }

        override fun onResponse(call: Call, response: Response) {
            if (cont.isActive) cont.resume(response) else response.close()
        }
    })
}

open class CameraException(message: String, cause: Throwable? = null) : Exception(message, cause)

class ConnectionLostException : CameraException("Forbindelsen til kameraet blev afbrudt")

/**
 * Talks to the YI Smart Dash Camera over its own Wi-Fi.
 *
 * Protocol (Novatek): HTTP GET commands on port 80 plus a TCP "heartbeat" on port 3333 that
 * must receive `02:001:0` at least every ~10 seconds, otherwise the camera drops the app
 * connection and answers further commands with status -256.
 *
 * Pure JVM code (no Android imports) so it can be tested against a fake camera on a PC.
 */
class CameraClient(
    val host: String = DEFAULT_HOST,
    private val httpPort: Int = 80,
    private val heartbeatPort: Int = 3333,
    private val rtspPort: Int = 554,
    private val log: (String) -> Unit = {},
) {
    private val http = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()
    private val downloadHttp = http.newBuilder()
        .readTimeout(30, TimeUnit.SECONDS)
        .build()
    private val thumbHttp = http.newBuilder()
        .readTimeout(6, TimeUnit.SECONDS)
        .callTimeout(8, TimeUnit.SECONDS)
        .build()

    private val commandLock = Mutex()
    private val thumbnailLock = Mutex()
    private var scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    @Volatile
    private var heartbeat: Socket? = null

    /** Mode the camera was last put in; `null` while not connected. */
    @Volatile
    var mode: CamMode? = null
        private set

    val connected: Boolean get() = mode != null

    /** Called (on a background thread) when the camera stops answering the heartbeat. */
    @Volatile
    var onConnectionLost: (() -> Unit)? = null

    val baseUrl: String get() = if (httpPort == 80) "http://$host" else "http://$host:$httpPort"

    val liveUrl: String
        get() = if (rtspPort == 554) "rtsp://$host/xxx.mov" else "rtsp://$host:$rtspPort/xxx.mov"

    /** Candidate addresses for an MJPEG live picture over HTTP (some Novatek firmwares). */
    val mjpegUrls: List<String> get() = listOf("http://$host:8192/", "http://$host:8000/")

    // --- Low level -----------------------------------------------------------------------------

    /** Builds a command URL. The camera insists that `custom=1` is the first parameter. */
    fun url(path: String = "/", cmd: Int? = null, par: Int? = null, str: String? = null): String {
        val sb = StringBuilder(baseUrl).append('/').append(path.trimStart('/'))
        val query = ArrayList<String>()
        if (cmd != null) {
            query += "custom=1"
            query += "cmd=$cmd"
        }
        if (par != null) query += "par=$par"
        if (str != null) query += "str=" + URLEncoder.encode(str, "UTF-8")
        if (query.isNotEmpty()) sb.append('?').append(query.joinToString("&"))
        return sb.toString()
    }

    /** Sends one command and returns the raw XML answer. Commands are never sent in parallel. */
    suspend fun send(cmd: Int, par: Int? = null, str: String? = null): String =
        commandLock.withLock {
            withContext(Dispatchers.IO) { sendNow(cmd, par, str) }
        }

    private fun sendNow(cmd: Int, par: Int?, str: String?): String {
        val request = Request.Builder()
            .url(url(cmd = cmd, par = par, str = str))
            .header("Connection", "close")
            .build()
        val body = try {
            http.newCall(request).execute().use { resp ->
                if (!resp.isSuccessful) {
                    throw CameraException("Kameraet svarede HTTP ${resp.code} på kommando $cmd")
                }
                resp.body?.string().orEmpty()
            }
        } catch (e: IOException) {
            throw CameraException("Kunne ikke nå kameraet (kommando $cmd): ${e.message}", e)
        }
        val shown = if (par != null) "$cmd par=$par" else "$cmd"
        log("→ $shown  ← ${body.replace(Regex("\\s+"), " ").take(160)}")

        val reply = CameraXml.parseReply(body)
        val status = reply.status
        if (reply.cmd == cmd && status != null) {
            if (status == -256) {
                connectionLost()
                throw ConnectionLostException()
            }
            if (status < 0) throw CameraException("Kameraet afviste kommando $cmd (status $status)")
        }
        return body
    }

    private suspend fun sendText(cmd: Int, par: Int? = null): String? =
        CameraXml.parseReply(send(cmd, par)).text

    // --- Connection ----------------------------------------------------------------------------

    suspend fun connect() {
        if (connected) return
        scope.cancel()
        scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        send(Cmd.CONNECT)
        withContext(Dispatchers.IO) { openHeartbeat() }
        setMode(CamMode.VIDEO)
    }

    private fun openHeartbeat() {
        val socket = Socket()
        try {
            socket.tcpNoDelay = true
            socket.connect(InetSocketAddress(host, heartbeatPort), 5_000)
        } catch (e: IOException) {
            runCatching { socket.close() }
            throw CameraException("Kameraets heartbeat-port svarer ikke: ${e.message}", e)
        }
        heartbeat = socket
        scope.launch {
            val out = socket.getOutputStream()
            try {
                while (isActive) {
                    out.write(HEARTBEAT)
                    out.flush()
                    delay(HEARTBEAT_INTERVAL_MS)
                }
            } catch (e: IOException) {
                if (heartbeat === socket) {
                    log("Heartbeat fejlede: ${e.message}")
                    connectionLost()
                }
            }
        }
        // The camera may push status messages on the same socket; read them so its buffer
        // never fills up.
        scope.launch {
            val buf = ByteArray(256)
            try {
                val input = socket.getInputStream()
                while (isActive) {
                    val n = input.read(buf)
                    if (n < 0) break
                    log("Kameraet meddeler: ${String(buf, 0, n).trim()}")
                }
            } catch (_: IOException) {
            }
        }
    }

    private fun closeHeartbeat() {
        val socket = heartbeat
        heartbeat = null
        runCatching { socket?.close() }
        scope.cancel()
    }

    private fun connectionLost() {
        if (mode == null && heartbeat == null) return
        mode = null
        closeHeartbeat()
        onConnectionLost?.invoke()
    }

    suspend fun disconnect() {
        if (!connected) {
            closeHeartbeat()
            return
        }
        closeHeartbeat()
        try {
            send(Cmd.DISCONNECT)
        } catch (_: CameraException) {
            // The camera ends the session by itself when the heartbeat stops.
        }
        mode = null
    }

    // --- Camera control ------------------------------------------------------------------------

    suspend fun setMode(newMode: CamMode) {
        send(Cmd.MODE, par = newMode.par)
        mode = newMode
    }

    /** Puts the camera in [newMode] if needed and gives it time to settle. */
    suspend fun ensureMode(newMode: CamMode, settleMs: Long = MODE_SETTLE_MS) {
        if (mode == newMode) return
        setMode(newMode)
        delay(settleMs)
    }

    suspend fun isRecording(): Boolean = sendText(Cmd.RECORDING_STATE)?.trim() == "1"

    suspend fun startRecording() {
        ensureMode(CamMode.VIDEO)
        send(Cmd.RECORD, par = 1)
    }

    /** Stops recording and waits until the camera confirms it. */
    suspend fun stopRecording() {
        repeat(10) {
            send(Cmd.RECORD, par = 0)
            delay(300)
            if (!isRecording()) return
        }
        throw CameraException("Kameraet ville ikke stoppe optagelsen")
    }

    /** All settings and info values, keyed by command number (see [CamSettings]). */
    suspend fun readSettings(): Map<Int, String> = CameraXml.parseSettings(send(Cmd.ALL_SETTINGS))

    suspend fun setSetting(cmd: Int, value: Int) {
        send(cmd, par = value)
    }

    /** Asks the camera to write its menu settings to flash. Not every firmware knows it. */
    suspend fun saveSettings(): Boolean = try {
        send(Cmd.SAVE_SETTINGS)
        true
    } catch (e: ConnectionLostException) {
        throw e
    } catch (_: CameraException) {
        false
    }

    suspend fun setClock(date: Date = Date()) {
        val text = SimpleDateFormat("yyyy-MM-dd_HH:mm:ss", Locale.US).format(date)
        send(Cmd.SET_CLOCK, str = text)
    }

    suspend fun saveEmergencyClip() {
        ensureMode(CamMode.VIDEO)
        send(Cmd.EMERGENCY_CLIP)
    }

    /** Saves a still from the running recording. */
    suspend fun takeVideoPhoto() {
        if (!isRecording()) throw CameraException("Kameraet optager ikke lige nu")
        send(Cmd.VIDEO_PHOTO)
    }

    suspend fun setWifiPassword(password: String) {
        send(Cmd.SET_WIFI_PASSWORD, str = password)
    }

    // --- Files ---------------------------------------------------------------------------------

    /** Lists the SD card. Note: the camera stops recording while it is in file mode. */
    suspend fun listFiles(): List<CamFile> {
        ensureMode(CamMode.FILES)
        return CameraXml.parseFiles(send(Cmd.FILE_LIST))
    }

    suspend fun delete(file: CamFile) {
        val force = file.readOnly || file.kind == CamFile.Kind.EMERGENCY
        send(if (force) Cmd.FORCE_DELETE else Cmd.DELETE, str = file.path)
        if (file.kind == CamFile.Kind.VIDEO && file.previewPath != file.path) {
            try {
                send(Cmd.DELETE, str = file.previewPath)
            } catch (e: ConnectionLostException) {
                throw e
            } catch (_: CameraException) {
                // No preview copy – fine.
            }
        }
    }

    fun fileUrl(file: CamFile): String = baseUrl + file.urlPath

    fun fileUrl(path: String): String = fileUrl(CamFile("", path, 0, "", false))

    /**
     * Small JPEG thumbnail of a video or photo, or `null` if the camera has none.
     *
     * One at a time, short timeout, and cancelling the coroutine cancels the HTTP request: the
     * camera's web server handles one request at a time, so a queue of thumbnails nobody looks
     * at any more would hold up playback and downloads.
     */
    suspend fun thumbnail(file: CamFile): ByteArray? = thumbnailLock.withLock {
        val request = Request.Builder().url(url(file.urlPath, cmd = Cmd.THUMBNAIL)).build()
        val resp = try {
            thumbHttp.newCall(request).await()
        } catch (_: IOException) {
            return@withLock null
        }
        withContext(Dispatchers.IO) {
            resp.use {
                val type = it.header("Content-Type").orEmpty()
                if (!it.isSuccessful || type.contains("xml") || type.contains("html")) null
                else it.body?.bytes()
            }
        }
    }

    /**
     * Blocking: fetches bytes [from]..[to] (inclusive) of a file with an HTTP Range request.
     * Throws [RangeNotSupportedException] if the camera ignores the Range header.
     */
    fun fetchRange(url: String, from: Long, to: Long): ByteArray {
        val request = Request.Builder().url(url).header("Range", "bytes=$from-$to").build()
        downloadHttp.newCall(request).execute().use { resp ->
            if (resp.header("Content-Type").orEmpty().contains("html")) {
                throw CameraException("Filen findes ikke på kameraet")
            }
            val body = resp.body ?: throw IOException("Tomt svar fra kameraet")
            return when (resp.code) {
                206 -> body.bytes()
                200 -> {
                    // Whole file instead of a part: only usable for the very first block.
                    if (from != 0L) throw RangeNotSupportedException()
                    val want = (to - from + 1).toInt()
                    val out = java.io.ByteArrayOutputStream(want)
                    val buf = ByteArray(64 * 1024)
                    body.byteStream().use { input ->
                        while (out.size() < want) {
                            val n = input.read(buf, 0, minOf(buf.size, want - out.size()))
                            if (n < 0) break
                            out.write(buf, 0, n)
                        }
                    }
                    out.toByteArray()
                }
                else -> throw CameraException("Kameraet svarede HTTP ${resp.code}")
            }
        }
    }

    /** Whether the camera can send parts of [url] (needed for quick clips and thumbnails). */
    suspend fun supportsRange(url: String): Boolean = withContext(Dispatchers.IO) {
        try {
            fetchRange(url, 1, 2)
            true
        } catch (_: RangeNotSupportedException) {
            false
        }
    }

    /** Asks the camera to start its live stream (Novatek "movie live view"). */
    suspend fun startLiveStream(): Boolean = try {
        send(Cmd.LIVE_STREAM, par = 1)
        true
    } catch (e: ConnectionLostException) {
        throw e
    } catch (_: CameraException) {
        false
    }

    // --- Diagnostics -------------------------------------------------------------------------

    class HttpProbe(
        val code: Int,
        val headers: Map<String, String>,
        val body: ByteArray,
        val millis: Long,
    )

    /** GETs [url] and reads at most [maxBytes] of the answer. Throws IOException on failure. */
    suspend fun probeHttp(
        url: String,
        maxBytes: Int,
        range: String? = null,
        timeoutMs: Long = 5_000,
    ): HttpProbe = withContext(Dispatchers.IO) {
        val client = http.newBuilder()
            .connectTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .build()
        val builder = Request.Builder().url(url)
        if (range != null) builder.header("Range", range)
        val started = System.nanoTime()
        client.newCall(builder.build()).execute().use { resp ->
            val out = java.io.ByteArrayOutputStream()
            val buf = ByteArray(64 * 1024)
            resp.body?.byteStream()?.use { input ->
                while (out.size() < maxBytes) {
                    val n = input.read(buf, 0, minOf(buf.size, maxBytes - out.size()))
                    if (n < 0) break
                    out.write(buf, 0, n)
                }
            }
            val headers = resp.headers.names().associateWith { resp.header(it).orEmpty() }
            HttpProbe(resp.code, headers, out.toByteArray(), (System.nanoTime() - started) / 1_000_000)
        }
    }

    /** Sends an RTSP DESCRIBE for the live stream and returns the raw answer (headers + SDP). */
    suspend fun rtspDescribe(): String = withContext(Dispatchers.IO) {
        Socket().use { socket ->
            socket.connect(InetSocketAddress(host, rtspPort), 3_000)
            socket.soTimeout = 4_000
            val request = "DESCRIBE $liveUrl RTSP/1.0\r\nCSeq: 2\r\nAccept: application/sdp\r\n" +
                "User-Agent: Dashcam\r\n\r\n"
            socket.getOutputStream().apply {
                write(request.toByteArray())
                flush()
            }
            val input = socket.getInputStream()
            val out = java.io.ByteArrayOutputStream()
            val buf = ByteArray(4096)
            while (out.size() < 16 * 1024) {
                val n = try {
                    input.read(buf)
                } catch (_: java.net.SocketTimeoutException) {
                    break
                }
                if (n < 0) break
                out.write(buf, 0, n)
                val text = out.toString("ISO-8859-1")
                val headerEnd = text.indexOf("\r\n\r\n")
                if (headerEnd >= 0) {
                    val length = Regex("(?im)^Content-Length:\\s*(\\d+)").find(text)
                        ?.groupValues?.get(1)?.toInt() ?: 0
                    if (text.length - headerEnd - 4 >= length) break
                }
            }
            out.toString("ISO-8859-1")
        }
    }

    /** Copies a file from the SD card to [out]. [progress] gets (bytes so far, total). */
    suspend fun download(file: CamFile, out: OutputStream, progress: (Long, Long) -> Unit) =
        withContext(Dispatchers.IO) {
            val request = Request.Builder().url(fileUrl(file)).build()
            try {
                downloadHttp.newCall(request).execute().use { resp ->
                    val type = resp.header("Content-Type").orEmpty()
                    if (!resp.isSuccessful || type.contains("html")) {
                        throw CameraException("Filen findes ikke på kameraet: ${file.name}")
                    }
                    val body = resp.body ?: throw CameraException("Tomt svar fra kameraet")
                    val total = body.contentLength().takeIf { it > 0 } ?: file.size
                    val buf = ByteArray(64 * 1024)
                    var done = 0L
                    var lastReport = 0L
                    body.byteStream().use { input ->
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            out.write(buf, 0, n)
                            done += n
                            if (done - lastReport >= 512 * 1024) {
                                lastReport = done
                                progress(done, total)
                            }
                        }
                    }
                    progress(done, total)
                }
            } catch (e: IOException) {
                throw CameraException("Overførslen blev afbrudt: ${e.message}", e)
            }
        }

    fun close() {
        mode = null
        closeHeartbeat()
    }

    companion object {
        const val DEFAULT_HOST = "192.168.1.254"
        const val MODE_SETTLE_MS = 2_000L
        const val HEARTBEAT_INTERVAL_MS = 10_000L
        private val HEARTBEAT = "02:001:0".toByteArray()
    }
}
