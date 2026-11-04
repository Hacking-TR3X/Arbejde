package dk.dashcam

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import android.widget.Toast
import dk.dashcam.cam.CamFile
import dk.dashcam.cam.CamMode
import dk.dashcam.cam.CamSettings
import dk.dashcam.cam.CameraClient
import dk.dashcam.cam.CameraProbe
import dk.dashcam.cam.CameraException
import dk.dashcam.cam.Cmd
import dk.dashcam.cam.ConnectionLostException
import dk.dashcam.cam.RangeReader
import dk.dashcam.cam.syncCamera
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.OutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * App-wide connection to the dash cam. Activities observe [state] and call the suspend
 * functions; the connection survives switching between screens.
 */
object CameraSession {
    enum class Status { DISCONNECTED, CONNECTING, CONNECTED }

    data class State(
        val status: Status = Status.DISCONNECTED,
        val message: String = "",
        val model: String? = null,
        val firmware: String? = null,
        val serial: String? = null,
        val recording: Boolean? = null,
        val settings: Map<Int, String> = emptyMap(),
        val busy: Boolean = false,
    )

    data class Download(
        val file: CamFile,
        val done: Long,
        val total: Long,
        val finished: Boolean = false,
        val error: String? = null,
        val startedAt: Long = System.currentTimeMillis(),
    ) {
        /** Average speed so far in bytes per second. */
        val bytesPerSecond: Double
            get() {
                val ms = System.currentTimeMillis() - startedAt
                return if (ms > 0) done * 1000.0 / ms else 0.0
            }
    }

    class LiveInfo(val rtspUrl: String, val mjpegUrls: List<String>)

    /** Last file list fetched from the camera, shown at once while a fresh one loads. */
    var cachedFiles: List<CamFile>? = null
        private set

    private const val TAG = "CameraSession"

    private lateinit var appContext: Context
    lateinit var prefs: Prefs
        private set
    private lateinit var wifi: CameraWifi

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private val _log = MutableStateFlow<List<String>>(emptyList())
    val log: StateFlow<List<String>> = _log.asStateFlow()

    private val _downloads = MutableStateFlow<Map<String, Download>>(emptyMap())
    val downloads: StateFlow<Map<String, Download>> = _downloads.asStateFlow()

    @Volatile
    private var client: CameraClient? = null
    private var connectJob: Job? = null

    /** The camera should be recording again when we are done with it. */
    private var keepRecording = true

    /** The user pressed "Afbryd" – don't silently reconnect. */
    var userDisconnected = false
        private set

    fun init(context: Context) {
        appContext = context.applicationContext
        prefs = Prefs(appContext)
        wifi = CameraWifi(appContext)
        wifi.onLost = { scope.launch { handleLost("Telefonen mistede kameraets Wi‑Fi") } }
        _state.value = State(message = "Ikke forbundet")
    }

    val isConnected: Boolean get() = _state.value.status == Status.CONNECTED

    fun note(text: String) {
        val time = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date())
        _log.update { (listOf("$time  $text") + it).take(60) }
    }

    // --- Connecting ----------------------------------------------------------------------------

    /**
     * Connects to the camera. With [interactive] = false we only look for a camera on the Wi-Fi
     * the phone is already on; with true we may ask Android to join the camera's Wi-Fi.
     */
    fun connect(interactive: Boolean) {
        if (connectJob?.isActive == true || isConnected) return
        if (interactive) userDisconnected = false
        connectJob = scope.launch {
            try {
                doConnect(interactive)
            } catch (e: CancellationException) {
                throw e
            } catch (e: CameraException) {
                cleanup()
                _state.value = State(message = e.message ?: "Kunne ikke forbinde")
                if (interactive) note(e.message ?: "Kunne ikke forbinde")
            }
        }
    }

    fun cancelConnect() {
        connectJob?.cancel()
        connectJob = null
        cleanup()
        _state.value = State(message = "Annulleret")
    }

    private suspend fun doConnect(interactive: Boolean) {
        _state.value = State(Status.CONNECTING, "Leder efter kameraet…")
        if (!wifi.useExisting(CameraClient.DEFAULT_HOST)) {
            if (!interactive) {
                _state.value = State(message = "Ikke forbundet")
                return
            }
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                throw CameraException(
                    "Gå på kameraets Wi‑Fi i telefonens indstillinger, og tryk så på Forbind igen"
                )
            }
            _state.update { it.copy(message = "Vælg kameraet i Androids Wi‑Fi-dialog…") }
            wifi.request(prefs.ssidPrefix, prefs.wifiPassword)
            delay(1_000) // let the camera's DHCP settle
        }

        _state.update { it.copy(message = "Forbinder til kameraet…") }
        val c = CameraClient(log = { Log.d(TAG, it) })
        c.onConnectionLost = { scope.launch { handleLost("Kameraet holdt op med at svare") } }
        client = c
        var attempt = 0
        while (true) {
            try {
                c.connect()
                break
            } catch (e: CameraException) {
                if (++attempt >= 3) throw e
                delay(1_500)
            }
        }

        val settings = c.readSettings()
        val recording = c.isRecording()
        keepRecording = recording || settings[AUTO_RECORD]?.trim() == "1"
        _state.value = State(
            status = Status.CONNECTED,
            message = "Forbundet",
            model = settings[Cmd.MODEL],
            firmware = settings[Cmd.FIRMWARE],
            serial = settings[Cmd.SERIAL],
            recording = recording,
            settings = settings,
        )
        note("Forbundet til kameraet" + (settings[Cmd.FIRMWARE]?.let { " (firmware $it)" } ?: ""))
        syncNow(automatic = true)
    }

    /**
     * Applies the remembered settings and sets the clock. Returns a short summary.
     * [automatic]: called right after connecting (respects the "auto-fix" switch).
     */
    suspend fun syncNow(automatic: Boolean): String {
        val c = client?.takeIf { it.connected } ?: return "Ikke forbundet"
        val wanted = if (automatic && !prefs.autoFix) emptyMap() else prefs.wanted
        if (wanted.isEmpty() && !prefs.setClock) return "Intet at gøre"
        _state.update { it.copy(busy = true, message = "Tjekker kameraets indstillinger…") }
        val summary = try {
            val r = syncCamera(c, wanted, prefs.setClock)
            if (r.clockSet) note("Uret er stillet efter telefonen")
            if (prefs.setClock && !r.clockSet) note("Kameraet ville ikke have uret stillet")
            if (r.changed.isNotEmpty()) {
                note("Rettede ${r.changed.size}: " + r.changed.joinToString("; ") { it.describe() })
            }
            if (r.failed.isNotEmpty()) {
                note("Kunne ikke ændre: " + r.failed.joinToString("; ") { it.describe() })
            }
            if (wanted.isNotEmpty() && r.changed.isEmpty() && r.failed.isEmpty()) {
                note("Alle huskede indstillinger var allerede rigtige")
            }
            _state.update { it.copy(settings = r.settingsAfter) }
            refreshRecording(c)
            when {
                r.failed.isNotEmpty() -> "Rettede ${r.changed.size}, men ${r.failed.size} ville ikke"
                r.changed.isNotEmpty() -> "Rettede ${r.changed.size} indstilling(er)"
                else -> "Alt var allerede rigtigt"
            }
        } catch (e: ConnectionLostException) {
            "Forbindelsen røg"
        } catch (e: CameraException) {
            note("Fejl under tjek af indstillinger: ${e.message}")
            e.message ?: "Fejl"
        }
        _state.update { it.copy(busy = false, message = if (isConnected) "Forbundet" else it.message) }
        return summary
    }

    private suspend fun refreshRecording(c: CameraClient) {
        val rec = try {
            c.isRecording()
        } catch (e: CameraException) {
            null
        }
        if (rec != null) _state.update { it.copy(recording = rec) }
    }

    /** Leaves the camera recording (if it was) and closes the connection. */
    fun disconnect() {
        userDisconnected = true
        connectJob?.cancel()
        scope.launch {
            val c = client
            if (c != null && c.connected) {
                _state.update { it.copy(busy = true, message = "Afbryder…") }
                try {
                    c.ensureMode(CamMode.VIDEO)
                    if (keepRecording && !c.isRecording()) c.startRecording()
                } catch (_: CameraException) {
                }
                c.disconnect()
            }
            cleanup()
            _state.value = State(message = "Afbrudt")
            note("Afbrudt fra kameraet")
        }
    }

    private fun handleLost(reason: String) {
        if (client == null) return
        cleanup()
        _state.value = State(message = reason)
        note(reason)
    }

    private fun cleanup() {
        client?.let {
            it.onConnectionLost = null
            it.close()
        }
        client = null
        wifi.release()
    }

    private fun requireClient(): CameraClient =
        client?.takeIf { it.connected } ?: throw CameraException("Ikke forbundet til kameraet")

    // --- Settings ------------------------------------------------------------------------------

    /** Remembers [value] for [cmd] and applies it now if connected. Returns false if refused. */
    suspend fun changeSetting(cmd: Int, value: Int): Boolean {
        prefs.want(cmd, value)
        val c = client?.takeIf { it.connected } ?: return true
        _state.update { it.copy(busy = true) }
        try {
            val r = syncCamera(c, mapOf(cmd to value), setClock = false)
            _state.update { it.copy(settings = r.settingsAfter) }
            r.changed.forEach { note(it.describe()) }
            refreshRecording(c)
            return r.failed.isEmpty()
        } finally {
            _state.update { it.copy(busy = false) }
        }
    }

    /** Remembers every setting exactly as the camera has it now. Returns how many. */
    fun rememberCurrent(): Int {
        val current = _state.value.settings
        val map = CamSettings.ALL.mapNotNull { def ->
            current[def.cmd]?.trim()?.toIntOrNull()?.let { def.cmd to it }
        }.toMap()
        prefs.wanted = map
        note("Husker nu ${map.size} indstillinger")
        return map.size
    }

    suspend fun changeWifiPassword(password: String) {
        requireClient().setWifiPassword(password)
        prefs.wifiPassword = password
        note("Kameraets Wi‑Fi-kode er sendt – genstart kameraet")
    }

    // --- Live view -----------------------------------------------------------------------------

    suspend fun prepareLive(): LiveInfo {
        val c = requireClient()
        c.ensureMode(CamMode.VIDEO)
        if (!c.startLiveStream()) note("Kameraet afviste live-kommandoen (2015) – prøver alligevel")
        return LiveInfo(c.liveUrl, c.mjpegUrls)
    }

    /** "Test forbindelsen": measures the camera and returns a report to share. */
    suspend fun runDiagnostics(): String {
        val c = requireClient()
        _state.update { it.copy(busy = true, message = "Tester forbindelsen – det tager op til et minut…") }
        try {
            val version = try {
                @Suppress("DEPRECATION")
                appContext.packageManager.getPackageInfo(appContext.packageName, 0).versionName
            } catch (e: Exception) {
                null
            }
            val header = listOf(
                "Dashcam-test " + SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).format(Date()),
                "Telefon: ${Build.MANUFACTURER} ${Build.MODEL}, Android ${Build.VERSION.RELEASE} · app ${version ?: "?"}",
                "Live-metode sidst: ${prefs.liveMethod ?: "ingen endnu"} · miniaturer: ${if (prefs.thumbnails) "til" else "fra"}",
            )
            val lines = CameraProbe(c).run()
            refreshRecording(c)
            note("Test af forbindelsen færdig")
            return (header + lines).joinToString("\n")
        } finally {
            _state.update {
                it.copy(busy = false, message = if (it.status == Status.CONNECTED) "Forbundet" else it.message)
            }
        }
    }

    suspend fun saveEmergencyClip() {
        requireClient().saveEmergencyClip()
        note("Nødklip gemt")
    }

    suspend fun takePhoto() {
        requireClient().takeVideoPhoto()
        note("Billede taget")
    }

    // --- Files ---------------------------------------------------------------------------------

    suspend fun listFiles(): List<CamFile> {
        val c = requireClient()
        _state.update { it.copy(recording = false) }
        val started = System.nanoTime()
        val files = c.listFiles()
        val ms = (System.nanoTime() - started) / 1_000_000
        cachedFiles = files
        note("Fil-liste: ${files.size} filer hentet på ${CameraProbe.secs(ms)}")
        return files
    }

    // --- Thumbnails ----------------------------------------------------------------------------

    private val thumbMutex = Mutex()

    /** Does the camera's own thumbnail command work? null = not known yet. */
    @Volatile
    private var cameraThumbsWork: Boolean? = null
    private var cameraThumbFailures = 0

    /** Can the camera send parts of files? null = not known yet. */
    @Volatile
    private var rangeSupported: Boolean? = null

    private fun thumbFile(file: CamFile): File {
        val dir = File(appContext.cacheDir, "thumbs").apply { mkdirs() }
        val key = "${file.path}|${file.size}|${file.time}".hashCode().toUInt().toString(16)
        return File(dir, "$key.jpg")
    }

    /** A thumbnail made earlier and kept on the phone – no camera needed. */
    suspend fun diskThumbnail(file: CamFile): Bitmap? = withContext(Dispatchers.IO) {
        val f = thumbFile(file)
        if (f.exists()) BitmapFactory.decodeFile(f.path) else null
    }

    private suspend fun cameraSupportsRange(c: CameraClient, file: CamFile): Boolean {
        rangeSupported?.let { return it }
        val ok = try {
            c.supportsRange(c.fileUrl(file))
        } catch (e: CameraException) {
            return false // couldn't tell – try again another time
        } catch (e: IOException) {
            return false
        }
        rangeSupported = ok
        if (!ok) note("Kameraet kan ikke sende dele af filer – klip kræver, at hele videoen hentes først")
        return ok
    }

    /**
     * One thumbnail at a time: the phone's own copy, else the camera's thumbnail command,
     * else made from the video itself (preferring the camera's small preview copy). Every
     * result is kept on the phone, so each thumbnail is only fetched once.
     */
    suspend fun thumbnailBitmap(file: CamFile, preview: CamFile?): Bitmap? = thumbMutex.withLock {
        diskThumbnail(file)?.let { return@withLock it }
        val c = client?.takeIf { it.connected } ?: return@withLock null
        var bitmap: Bitmap? = null
        if (cameraThumbsWork != false) {
            val bytes = c.thumbnail(file)
            bitmap = bytes?.let { withContext(Dispatchers.Default) { BitmapFactory.decodeByteArray(it, 0, it.size) } }
            if (bitmap != null) {
                cameraThumbsWork = true
            } else if (cameraThumbsWork == null && ++cameraThumbFailures >= 2) {
                cameraThumbsWork = false
                note("Kameraet laver ikke selv miniaturer – appen laver dem ud fra videoerne")
            }
        }
        if (bitmap == null) {
            bitmap = withContext(Dispatchers.IO) {
                if (file.isPhoto) {
                    val out = ByteArrayOutputStream()
                    c.download(file, out) { _, _ -> }
                    val bytes = out.toByteArray()
                    val opts = BitmapFactory.Options().apply { inSampleSize = 8 }
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)
                } else if (cameraSupportsRange(c, file)) {
                    ThumbnailMaker.fromVideo(c, preview ?: file)
                } else {
                    null
                }
            }
        }
        bitmap?.let { bmp ->
            val small = ThumbnailMaker.scale(bmp)
            withContext(Dispatchers.IO) {
                runCatching {
                    thumbFile(file).outputStream().use { small.compress(Bitmap.CompressFormat.JPEG, 80, it) }
                }
            }
            small
        }
    }

    // --- Playing and clipping ----------------------------------------------------------------

    /** A recording plus the camera's small preview copy of it, if there is one. */
    class PlayItem(val file: CamFile, val preview: CamFile?)

    /** The videos the player can step through (oldest first, like the drive itself). */
    var playlist: List<PlayItem> = emptyList()

    /**
     * Cuts [startMs]..[endMs] out of [file] and saves it in Film/Dashcam. Runs on even if the
     * player is closed. Progress shows up in [downloads] under the returned key.
     */
    fun exportClip(file: CamFile, startMs: Long, endMs: Long, durationMs: Long): String? {
        val c = client?.takeIf { it.connected } ?: return null
        val name = file.name.substringBeforeLast('.') + "_klip_${clock(startMs)}-${clock(endMs)}.mp4"
        val key = "clip:${file.path}:$startMs-$endMs"
        val running = _downloads.value[key]
        if (running != null && !running.finished) return key
        // Roughly how much has to come from the camera: the clip's share of the file + index.
        val estimate = if (durationMs > 0) {
            (file.size * (endMs - startMs) / durationMs + 1_000_000).coerceAtMost(file.size)
        } else {
            file.size
        }
        val outFile = CamFile(name, key, estimate, file.time, false)
        scope.launch {
            val start = Download(outFile, 0, estimate)
            _downloads.update { it + (key to start) }
            fun current() = _downloads.value[key] ?: start
            val temp = File(appContext.cacheDir, "klip_${System.currentTimeMillis()}.mp4")
            var whole: File? = null
            try {
                withContext(Dispatchers.IO) {
                    if (cameraSupportsRange(c, file)) {
                        val reader = RangeReader(c, c.fileUrl(file), file.size, blockSize = 1024 * 1024, maxBlocks = 8) { fetched ->
                            _downloads.update { it + (key to current().copy(done = fetched)) }
                        }
                        try {
                            ClipExporter.export(CameraMediaDataSource(reader), null, startMs * 1000, endMs * 1000, temp) { }
                        } catch (e: CameraException) {
                            throw (reader.lastError as? CameraException) ?: e
                        }
                    } else {
                        // The camera can't send parts: fetch the whole recording, then cut.
                        val full = File(appContext.cacheDir, "hel_${System.currentTimeMillis()}.mp4")
                        whole = full
                        full.outputStream().use { out ->
                            c.download(file, out) { done, total ->
                                _downloads.update { it + (key to current().copy(done = done, total = total)) }
                            }
                        }
                        ClipExporter.export(null, full.absolutePath, startMs * 1000, endMs * 1000, temp) { }
                    }
                }
                val fetched = current().done
                val where = saveToPhone(outFile) { out ->
                    withContext(Dispatchers.IO) { temp.inputStream().use { it.copyTo(out) } }
                }
                val finished = current().copy(done = fetched, total = fetched, finished = true)
                _downloads.update { it + (key to finished) }
                val secs = (System.currentTimeMillis() - finished.startedAt) / 1000
                note(
                    "Klip gemt: $where (${CameraProbe.mb(temp.length())}; hentede ${CameraProbe.mb(fetched)} " +
                        "fra kameraet på ${secs / 60}:${"%02d".format(secs % 60)})"
                )
                Toast.makeText(appContext, "Klip gemt: $where", Toast.LENGTH_LONG).show()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val msg = e.message ?: e.javaClass.simpleName
                _downloads.update { it + (key to current().copy(finished = true, error = msg)) }
                note("Klip af ${file.name} fejlede: $msg")
            } finally {
                temp.delete()
                whole?.delete()
            }
        }
        return key
    }

    /** 75 000 ms → "01m15s" (safe in file names). */
    fun clock(ms: Long): String {
        val s = ms / 1000
        return "%02dm%02ds".format(s / 60, s % 60)
    }

    suspend fun thumbnail(file: CamFile): ByteArray? = client?.takeIf { it.connected }?.thumbnail(file)

    fun fileUrl(file: CamFile): String? = client?.fileUrl(file)

    suspend fun fetch(file: CamFile): ByteArray {
        val out = ByteArrayOutputStream()
        requireClient().download(file, out) { _, _ -> }
        return out.toByteArray()
    }

    suspend fun delete(file: CamFile) {
        requireClient().delete(file)
        cachedFiles = cachedFiles?.filterNot { it.path == file.path || it.path == file.previewPath }
        note("Slettede ${file.name}")
    }

    val downloading: Boolean get() = _downloads.value.values.any { !it.finished }

    /** Back to normal driving mode after browsing files: video mode and recording again. */
    fun leaveFilesAsync() {
        scope.launch {
            val c = client?.takeIf { it.connected } ?: return@launch
            if (c.mode != CamMode.FILES) return@launch
            try {
                c.ensureMode(CamMode.VIDEO)
                if (keepRecording && !c.isRecording()) c.startRecording()
                refreshRecording(c)
            } catch (e: CameraException) {
                note("Kunne ikke starte optagelsen igen: ${e.message}")
            }
        }
    }

    /** Copies a file from the camera to the phone (Film/Dashcam or Billeder/Dashcam). */
    fun download(file: CamFile) {
        val c = client?.takeIf { it.connected } ?: return
        val running = _downloads.value[file.path]
        if (running != null && !running.finished) return
        scope.launch {
            val start = Download(file, 0, file.size)
            _downloads.update { it + (file.path to start) }
            fun current() = _downloads.value[file.path] ?: start
            try {
                val where = saveToPhone(file) { out ->
                    c.download(file, out) { done, total ->
                        _downloads.update { it + (file.path to current().copy(done = done, total = total)) }
                    }
                }
                val done = current().copy(done = file.size, finished = true)
                _downloads.update { it + (file.path to done) }
                val secs = (System.currentTimeMillis() - done.startedAt) / 1000
                note(
                    "Gemt på telefonen: $where (${CameraProbe.mb(file.size)} på " +
                        "${secs / 60}:${"%02d".format(secs % 60)} – ${speed(done.bytesPerSecond)})"
                )
                Toast.makeText(appContext, "Gemt: $where", Toast.LENGTH_LONG).show()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val msg = e.message ?: e.javaClass.simpleName
                _downloads.update { it + (file.path to current().copy(finished = true, error = msg)) }
                note("Download af ${file.name} fejlede: $msg")
            }
        }
    }

    private suspend fun saveToPhone(file: CamFile, write: suspend (OutputStream) -> Unit): String {
        val folder = if (file.isPhoto) Environment.DIRECTORY_PICTURES else Environment.DIRECTORY_MOVIES
        val mime = when {
            file.isPhoto -> "image/jpeg"
            file.name.endsWith(".mov", ignoreCase = true) -> "video/quicktime"
            else -> "video/mp4"
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            val dir = appContext.getExternalFilesDir(folder) ?: throw IOException("Intet lager")
            val target = File(dir, file.name)
            withContext(Dispatchers.IO) { target.outputStream() }.use { write(it) }
            return target.absolutePath
        }
        val resolver = appContext.contentResolver
        val collection = if (file.isPhoto) {
            MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        } else {
            MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        }
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, file.name)
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
            put(MediaStore.MediaColumns.RELATIVE_PATH, "$folder/Dashcam")
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val uri = withContext(Dispatchers.IO) { resolver.insert(collection, values) }
            ?: throw IOException("Kunne ikke oprette filen på telefonen")
        try {
            val out = withContext(Dispatchers.IO) { resolver.openOutputStream(uri) }
                ?: throw IOException("Kunne ikke skrive filen på telefonen")
            out.use { write(it) }
            val done = ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }
            withContext(Dispatchers.IO) { resolver.update(uri, done, null, null) }
        } catch (e: Exception) {
            withContext(Dispatchers.IO) { runCatching { resolver.delete(uri, null, null) } }
            throw e
        }
        val shownFolder = if (file.isPhoto) "Billeder" else "Film"
        return "$shownFolder/Dashcam/${file.name}"
    }

    fun speed(bytesPerSecond: Double): String =
        String.format(Locale.forLanguageTag("da"), "%.1f MB/s", bytesPerSecond / 1_000_000)

    private const val AUTO_RECORD = 2012
}
