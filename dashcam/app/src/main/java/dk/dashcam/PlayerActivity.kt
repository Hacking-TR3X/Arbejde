package dk.dashcam

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.os.Bundle
import android.text.format.Formatter
import android.view.WindowManager
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.isVisible
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.rtsp.RtspMediaSource
import dk.dashcam.cam.CameraException
import dk.dashcam.cam.MjpegReader
import dk.dashcam.databinding.ActivityPlayerBinding
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Live view from the camera, or recordings straight from the SD card.
 *
 * Recordings: every video of the chosen kind is queued oldest first, so you can step to the
 * previous/next clip (and it plays on into the next one, like the drive itself). "Hent"
 * saves the video, the small copy or a clip; "Klip" picks a start and an end and saves only
 * that piece – only that piece is fetched from the camera.
 *
 * Live view is unreliable on this camera, so several ways are tried in turn – RTSP over TCP,
 * RTSP over UDP, then MJPEG over HTTP – and the one that works is remembered for next time.
 */
@SuppressLint("UnsafeOptInUsageError")
class PlayerActivity : AppCompatActivity() {

    private sealed class Source(val label: String, val key: String) {
        class Rtsp(val url: String, val tcp: Boolean) :
            Source(if (tcp) "RTSP over TCP" else "RTSP over UDP", if (tcp) "rtsp-tcp" else "rtsp-udp")

        class Mjpeg(val url: String) : Source("MJPEG ($url)", "mjpeg:$url")
    }

    private lateinit var b: ActivityPlayerBinding
    private var player: ExoPlayer? = null
    private var startJob: Job? = null
    private var mjpegJob: Job? = null

    private val live: Boolean get() = intent.getBooleanExtra(EXTRA_LIVE, false)

    // Recordings
    private var items: List<CameraSession.PlayItem> = emptyList()
    private var resumeIndex = -1
    private var resumePositionMs = 0L
    private var pendingTrim = false
    private var durationMs = 0L

    /** Download or clip whose progress is shown under the video. */
    private var watchKey: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityPlayerBinding.inflate(layoutInflater)
        setContentView(b.root)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        b.titleText.setText(R.string.live)
        b.liveControls.isVisible = live
        b.fileControls.isVisible = !live
        b.playerView.useController = !live
        b.retryButton.setOnClickListener {
            rememberPosition()
            release()
            start()
        }

        // Live controls
        b.emergencyButton.setOnClickListener {
            camAction(R.string.emergency_saved) { CameraSession.saveEmergencyClip() }
        }
        b.photoButton.setOnClickListener {
            camAction(R.string.photo_taken) { CameraSession.takePhoto() }
        }

        // Recording controls
        items = if (live) emptyList() else CameraSession.playlist
        pendingTrim = !live && savedInstanceState == null && intent.getBooleanExtra(EXTRA_TRIM, false)
        b.prevButton.setOnClickListener { player?.seekToPreviousMediaItem() }
        b.nextButton.setOnClickListener { player?.seekToNextMediaItem() }
        b.downloadButton.setOnClickListener {
            val item = currentItem() ?: return@setOnClickListener
            DownloadOptions.show(
                this, item,
                onDownload = { file ->
                    CameraSession.download(file)
                    watchKey = file.path
                    renderWatch()
                },
                onClip = { showTrim() },
            )
        }
        b.clipButton.setOnClickListener { if (b.trimPanel.isVisible) hideTrim() else showTrim() }
        b.trimStartButton.setOnClickListener { setTrim(start = positionS()) }
        b.trimEndButton.setOnClickListener { setTrim(end = positionS()) }
        b.trimSaveButton.setOnClickListener { saveClip() }
        b.trimSlider.setLabelFormatter { value -> mmss((value * 1000).toLong()) }
        b.trimSlider.addOnChangeListener { _, value, fromUser ->
            if (fromUser) player?.seekTo((value * 1000).toLong()) // show the frame at the handle
            updateTrimText()
        }

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                CameraSession.downloads.collect { renderWatch() }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        start()
    }

    override fun onStop() {
        super.onStop()
        rememberPosition()
        release()
    }

    private fun rememberPosition() {
        val p = player ?: return
        if (live) return
        resumeIndex = p.currentMediaItemIndex
        resumePositionMs = p.currentPosition
    }

    private fun start() {
        b.errorBox.isVisible = false
        b.loading.isVisible = true
        startJob = lifecycleScope.launch {
            if (live) startLive() else startFiles()
        }
    }

    // --- Recordings from the SD card ----------------------------------------------------------

    private fun startFiles() {
        if (items.isEmpty() || !CameraSession.isConnected) {
            showError(getString(if (items.isEmpty()) R.string.no_videos else R.string.connect_first))
            return
        }
        val p = newPlayer(lowLatency = false)
        p.addListener(object : Player.Listener {
            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) = onItemChanged()

            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_READY) {
                    durationMs = p.duration.takeIf { it != C.TIME_UNSET && it > 0 } ?: 0
                    if (pendingTrim) showTrim()
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                val text = describe(error)
                CameraSession.note("Afspilning fejlede: $text")
                showError(getString(R.string.playback_error, text))
            }
        })
        // Stream the camera's small preview copy when there is one – smoother over its Wi-Fi.
        val mediaItems = items.map { item ->
            MediaItem.Builder()
                .setUri(CameraSession.fileUrl(item.preview ?: item.file).orEmpty())
                .setMediaId(item.file.path)
                .build()
        }
        val index = (if (resumeIndex >= 0) resumeIndex else intent.getIntExtra(EXTRA_INDEX, 0))
            .coerceIn(0, items.size - 1)
        p.setMediaItems(mediaItems, index, resumePositionMs)
        p.playWhenReady = true
        p.prepare()
        onItemChanged()
    }

    private fun currentItem(): CameraSession.PlayItem? =
        player?.currentMediaItemIndex?.let { items.getOrNull(it) }

    private fun onItemChanged() {
        val i = player?.currentMediaItemIndex ?: return
        val item = items.getOrNull(i) ?: return
        b.titleText.text = getString(R.string.player_title, FileAdapter.prettyTime(item.file), i + 1, items.size)
        b.prevButton.isEnabled = i > 0
        b.nextButton.isEnabled = i < items.size - 1
        b.errorBox.isVisible = false
        durationMs = 0
        hideTrim()
    }

    // --- Clip ----------------------------------------------------------------------------------

    private fun positionS(): Float = (player?.currentPosition ?: 0L) / 1000f

    private fun showTrim() {
        val p = player ?: return
        val dur = p.duration
        if (dur == C.TIME_UNSET || dur <= 0) {
            pendingTrim = true
            Toast.makeText(this, R.string.wait_for_video, Toast.LENGTH_SHORT).show()
            return
        }
        pendingTrim = false
        durationMs = dur
        val durS = dur / 1000f
        val from = (positionS() - 10f).coerceIn(0f, maxOf(0f, durS - 1f))
        val to = (from + 20f).coerceAtMost(durS)
        b.trimSlider.valueFrom = 0f
        b.trimSlider.valueTo = durS
        b.trimSlider.values = listOf(from, to)
        b.trimPanel.isVisible = true
        updateTrimText()
    }

    private fun hideTrim() {
        b.trimPanel.isVisible = false
    }

    private fun setTrim(start: Float? = null, end: Float? = null) {
        if (!b.trimPanel.isVisible) return
        val max = b.trimSlider.valueTo
        val v = b.trimSlider.values
        var s = (start ?: v[0]).coerceIn(0f, max)
        var e = (end ?: v[1]).coerceIn(0f, max)
        if (s > e) {
            if (start != null) e = s else s = e
        }
        b.trimSlider.values = listOf(s, e)
        updateTrimText()
    }

    private fun updateTrimText() {
        if (!b.trimPanel.isVisible) return
        val item = currentItem() ?: return
        val v = b.trimSlider.values
        val lengthMs = ((v[1] - v[0]) * 1000).toLong()
        val estimate = if (durationMs > 0) item.file.size * lengthMs / durationMs + 1_000_000 else item.file.size
        b.trimText.text = getString(
            R.string.trim_text,
            mmss((v[0] * 1000).toLong()),
            mmss((v[1] * 1000).toLong()),
            (lengthMs / 1000).toInt(),
            Formatter.formatShortFileSize(this, estimate.coerceAtMost(item.file.size)),
        )
    }

    private fun saveClip() {
        val item = currentItem() ?: return
        val v = b.trimSlider.values
        val startMs = (v[0] * 1000).toLong()
        val endMs = (v[1] * 1000).toLong()
        if (endMs - startMs < 1_000) {
            Toast.makeText(this, R.string.trim_too_short, Toast.LENGTH_SHORT).show()
            return
        }
        // Give the camera's Wi-Fi to the clip instead of to playback.
        player?.pause()
        val key = CameraSession.exportClip(item.file, startMs, endMs, durationMs)
        if (key == null) {
            Toast.makeText(this, R.string.connect_first, Toast.LENGTH_SHORT).show()
            return
        }
        watchKey = key
        hideTrim()
        renderWatch()
    }

    private fun renderWatch() {
        val d = watchKey?.let { CameraSession.downloads.value[it] }
        if (d == null) {
            b.exportStatus.isVisible = false
            return
        }
        b.exportStatus.isVisible = true
        b.exportStatus.text = when {
            d.error != null -> getString(R.string.export_failed, d.file.name, d.error)
            d.finished -> getString(R.string.export_done, d.file.name)
            else -> {
                val pct = if (d.total > 0) (d.done * 100 / d.total).toInt().coerceAtMost(99) else 0
                getString(R.string.export_running, d.file.name, pct, CameraSession.speed(d.bytesPerSecond))
            }
        }
    }

    // --- Live view -----------------------------------------------------------------------------

    private suspend fun startLive() {
        val info = try {
            CameraSession.prepareLive()
        } catch (e: CameraException) {
            showError(e.message ?: getString(R.string.error))
            return
        }
        val sources = ArrayList<Source>()
        sources += Source.Rtsp(info.rtspUrl, tcp = true)
        sources += Source.Rtsp(info.rtspUrl, tcp = false)
        info.mjpegUrls.forEach { sources += Source.Mjpeg(it) }
        val preferred = CameraSession.prefs.liveMethod
        sources.sortBy { if (it.key == preferred) 0 else 1 }

        val failures = ArrayList<String>()
        for (source in sources) {
            b.titleText.text = getString(R.string.live_trying, source.label)
            val error = when (source) {
                is Source.Rtsp -> tryRtsp(source)
                is Source.Mjpeg -> tryMjpeg(source)
            }
            if (error == null) {
                if (preferred != source.key) CameraSession.note("Live-billede virker med ${source.label}")
                CameraSession.prefs.liveMethod = source.key
                b.titleText.text = getString(R.string.live_via, source.label)
                return
            }
            failures += "• ${source.label}: $error"
            CameraSession.note("Live via ${source.label} virkede ikke: $error")
        }
        showError(getString(R.string.live_failed) + "\n\n" + failures.joinToString("\n"))
    }

    /** Returns null when the picture is running, otherwise why it failed. */
    private suspend fun tryRtsp(source: Source.Rtsp): String? {
        stopMjpeg()
        val p = newPlayer(lowLatency = true)
        val result = CompletableDeferred<String>()
        p.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_READY) result.complete("")
            }

            override fun onPlayerError(error: PlaybackException) {
                val text = describe(error)
                if (!result.complete(text)) {
                    // It was running and then stopped.
                    CameraSession.note("Live-billedet stoppede: $text")
                    showError(getString(R.string.playback_error, text))
                }
            }
        })
        p.setMediaSource(
            RtspMediaSource.Factory()
                .setForceUseRtpTcp(source.tcp)
                .setTimeoutMs(6_000)
                .createMediaSource(MediaItem.fromUri(source.url))
        )
        p.playWhenReady = true
        p.prepare()
        val r = withTimeoutOrNull(12_000) { result.await() }
        val error = when {
            r == null -> "intet billede efter 12 sekunder"
            r.isEmpty() -> null
            else -> r
        }
        if (error != null) releasePlayer()
        return error
    }

    private suspend fun tryMjpeg(source: Source.Mjpeg): String? {
        releasePlayer()
        b.playerView.isVisible = false
        val firstFrame = CompletableDeferred<String>()
        mjpegJob = lifecycleScope.launch {
            try {
                MjpegReader.read(source.url) { jpeg ->
                    val bitmap = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size) ?: return@read
                    withContext(Dispatchers.Main) {
                        b.mjpegView.isVisible = true
                        b.mjpegView.setImageBitmap(bitmap)
                        b.loading.isVisible = false
                        firstFrame.complete("")
                    }
                }
                if (!firstFrame.complete("strømmen sluttede uden billeder")) {
                    showError(getString(R.string.playback_error, "live-strømmen sluttede"))
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val text = "${e.javaClass.simpleName}: ${e.message}"
                if (!firstFrame.complete(text)) showError(getString(R.string.playback_error, text))
            }
        }
        val r = withTimeoutOrNull(6_000) { firstFrame.await() }
        val error = when {
            r == null -> "intet billede efter 6 sekunder"
            r.isEmpty() -> null
            else -> r
        }
        if (error != null) stopMjpeg()
        return error
    }

    // --- Helpers -------------------------------------------------------------------------------

    private fun newPlayer(lowLatency: Boolean): ExoPlayer {
        releasePlayer()
        val builder = ExoPlayer.Builder(this)
        if (lowLatency) {
            // Keep the live picture as close to real time as possible.
            builder.setLoadControl(
                DefaultLoadControl.Builder()
                    .setBufferDurationsMs(500, 2_000, 250, 250)
                    .build()
            )
        }
        val p = builder.build()
        p.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                b.loading.isVisible = state == Player.STATE_BUFFERING
                if (state == Player.STATE_READY) b.errorBox.isVisible = false
            }
        })
        player = p
        b.mjpegView.isVisible = false
        b.playerView.isVisible = true
        b.playerView.player = p
        return p
    }

    private fun describe(error: PlaybackException): String =
        error.errorCodeName + (error.cause?.message?.let { " ($it)" } ?: "")

    private fun releasePlayer() {
        b.playerView.player = null
        player?.release()
        player = null
    }

    private fun stopMjpeg() {
        mjpegJob?.cancel()
        mjpegJob = null
    }

    private fun release() {
        startJob?.cancel()
        startJob = null
        stopMjpeg()
        releasePlayer()
    }

    private fun showError(text: String) {
        b.loading.isVisible = false
        b.errorText.text = text
        b.errorBox.isVisible = true
    }

    private fun camAction(doneText: Int, action: suspend () -> Unit) {
        lifecycleScope.launch {
            try {
                action()
                Toast.makeText(this@PlayerActivity, doneText, Toast.LENGTH_SHORT).show()
            } catch (e: CameraException) {
                Toast.makeText(this@PlayerActivity, e.message, Toast.LENGTH_LONG).show()
            }
        }
    }

    companion object {
        private const val EXTRA_LIVE = "live"
        private const val EXTRA_INDEX = "index"
        private const val EXTRA_TRIM = "trim"

        fun mmss(ms: Long): String {
            val s = (ms / 1000).coerceAtLeast(0)
            return "%d:%02d".format(s / 60, s % 60)
        }

        fun startLive(context: Context) {
            context.startActivity(
                Intent(context, PlayerActivity::class.java).putExtra(EXTRA_LIVE, true)
            )
        }

        /** Plays [CameraSession.playlist] from [index]; [trim] opens the clip tool right away. */
        fun startFiles(context: Context, index: Int, trim: Boolean) {
            context.startActivity(
                Intent(context, PlayerActivity::class.java)
                    .putExtra(EXTRA_INDEX, index)
                    .putExtra(EXTRA_TRIM, trim)
            )
        }
    }
}
