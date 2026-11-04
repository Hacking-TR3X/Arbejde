package dk.dashcam

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.os.Bundle
import android.view.WindowManager
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.isVisible
import androidx.lifecycle.lifecycleScope
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
 * Live view from the camera, or playback of a recording straight from the SD card.
 *
 * Live view is unreliable on this camera, so several ways are tried in turn – RTSP over TCP,
 * RTSP over UDP, then MJPEG over HTTP – and the one that works is remembered for next time.
 * Every attempt is written to the event log on the front page.
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
    private val screenTitle: String get() = intent.getStringExtra(EXTRA_TITLE) ?: getString(R.string.live)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityPlayerBinding.inflate(layoutInflater)
        setContentView(b.root)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        b.titleText.text = screenTitle
        b.liveControls.isVisible = live
        b.playerView.useController = !live
        b.retryButton.setOnClickListener {
            release()
            start()
        }
        b.emergencyButton.setOnClickListener {
            camAction(R.string.emergency_saved) { CameraSession.saveEmergencyClip() }
        }
        b.photoButton.setOnClickListener {
            camAction(R.string.photo_taken) { CameraSession.takePhoto() }
        }
    }

    override fun onStart() {
        super.onStart()
        start()
    }

    override fun onStop() {
        super.onStop()
        release()
    }

    private fun start() {
        b.errorBox.isVisible = false
        b.loading.isVisible = true
        startJob = lifecycleScope.launch {
            if (live) startLive() else startFile()
        }
    }

    // --- Recording from the SD card ------------------------------------------------------------

    private fun startFile() {
        val url = intent.getStringExtra(EXTRA_URL) ?: return
        val p = newPlayer(lowLatency = false)
        p.addListener(object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
                val text = describe(error)
                CameraSession.note("Afspilning fejlede: $text")
                showError(getString(R.string.playback_error, text))
            }
        })
        p.setMediaItem(MediaItem.fromUri(url))
        p.playWhenReady = true
        p.prepare()
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
        private const val EXTRA_URL = "url"
        private const val EXTRA_TITLE = "title"
        private const val EXTRA_LIVE = "live"

        fun startLive(context: Context) {
            context.startActivity(
                Intent(context, PlayerActivity::class.java).putExtra(EXTRA_LIVE, true)
            )
        }

        fun startFile(context: Context, url: String, title: String) {
            context.startActivity(
                Intent(context, PlayerActivity::class.java)
                    .putExtra(EXTRA_URL, url)
                    .putExtra(EXTRA_TITLE, title)
            )
        }
    }
}
