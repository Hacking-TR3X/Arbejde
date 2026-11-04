package dk.dashcam

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import android.widget.Toast
import dk.dashcam.cam.CamFile
import dk.dashcam.cam.CamMode
import dk.dashcam.cam.CamSettings
import dk.dashcam.cam.CameraClient
import dk.dashcam.cam.CameraException
import dk.dashcam.cam.Cmd
import dk.dashcam.cam.ConnectionLostException
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
    )

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

    suspend fun prepareLive(): String {
        val c = requireClient()
        c.ensureMode(CamMode.VIDEO)
        return c.liveUrl
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
        return c.listFiles()
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
        note("Slettede ${file.name}")
    }

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
            _downloads.update { it + (file.path to Download(file, 0, file.size)) }
            try {
                val where = saveToPhone(file) { out ->
                    c.download(file, out) { done, total ->
                        _downloads.update { it + (file.path to Download(file, done, total)) }
                    }
                }
                _downloads.update { it + (file.path to Download(file, file.size, file.size, finished = true)) }
                note("Gemt på telefonen: $where")
                Toast.makeText(appContext, "Gemt: $where", Toast.LENGTH_LONG).show()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val msg = e.message ?: e.javaClass.simpleName
                _downloads.update { it + (file.path to Download(file, 0, file.size, finished = true, error = msg)) }
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

    private const val AUTO_RECORD = 2012
}
