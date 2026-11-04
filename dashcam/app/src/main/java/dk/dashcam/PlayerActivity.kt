package dk.dashcam

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
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
import dk.dashcam.databinding.ActivityPlayerBinding
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/** Live view from the camera (RTSP) or playback of a recording straight from the SD card. */
@SuppressLint("UnsafeOptInUsageError")
class PlayerActivity : AppCompatActivity() {

    private lateinit var b: ActivityPlayerBinding
    private var player: ExoPlayer? = null
    private var startJob: Job? = null

    private val live: Boolean get() = intent.getBooleanExtra(EXTRA_LIVE, false)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityPlayerBinding.inflate(layoutInflater)
        setContentView(b.root)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        b.titleText.text = intent.getStringExtra(EXTRA_TITLE) ?: getString(R.string.live)
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
            val url = if (live) {
                try {
                    CameraSession.prepareLive()
                } catch (e: CameraException) {
                    showError(e.message ?: getString(R.string.error))
                    return@launch
                }
            } else {
                intent.getStringExtra(EXTRA_URL) ?: return@launch
            }
            val builder = ExoPlayer.Builder(this@PlayerActivity)
            if (live) {
                // Keep the live picture as close to real time as possible.
                builder.setLoadControl(
                    DefaultLoadControl.Builder()
                        .setBufferDurationsMs(500, 2_000, 250, 250)
                        .build()
                )
            }
            val p = builder.build()
            player = p
            b.playerView.player = p
            p.addListener(object : Player.Listener {
                override fun onPlaybackStateChanged(state: Int) {
                    b.loading.isVisible = state == Player.STATE_BUFFERING
                    if (state == Player.STATE_READY) b.errorBox.isVisible = false
                }

                override fun onPlayerError(error: PlaybackException) {
                    val cause = error.cause?.message?.let { " ($it)" } ?: ""
                    showError(getString(R.string.playback_error, error.errorCodeName + cause))
                }
            })
            val item = MediaItem.fromUri(url)
            if (live) {
                p.setMediaSource(RtspMediaSource.Factory().setTimeoutMs(10_000).createMediaSource(item))
            } else {
                p.setMediaItem(item)
            }
            p.playWhenReady = true
            p.prepare()
        }
    }

    private fun release() {
        startJob?.cancel()
        startJob = null
        b.playerView.player = null
        player?.release()
        player = null
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
