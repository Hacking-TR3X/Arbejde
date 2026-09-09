package dk.loopcast

import android.Manifest
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import android.view.Menu
import android.view.MenuItem
import android.view.inputmethod.EditorInfo
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.MenuItemCompat
import androidx.core.view.isVisible
import androidx.lifecycle.lifecycleScope
import androidx.mediarouter.app.MediaRouteActionProvider
import androidx.recyclerview.widget.LinearLayoutManager
import com.google.android.gms.cast.HlsSegmentFormat
import com.google.android.gms.cast.MediaInfo
import com.google.android.gms.cast.MediaLoadRequestData
import com.google.android.gms.cast.MediaMetadata
import com.google.android.gms.cast.MediaQueueData
import com.google.android.gms.cast.MediaQueueItem
import com.google.android.gms.cast.MediaStatus
import com.google.android.gms.cast.framework.CastButtonFactory
import com.google.android.gms.cast.framework.CastContext
import com.google.android.gms.cast.framework.CastSession
import com.google.android.gms.cast.framework.media.RemoteMediaClient
import com.google.android.gms.common.images.WebImage
import com.google.android.material.snackbar.Snackbar
import dk.loopcast.databinding.ActivityMainBinding
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.IOException

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var store: SavedTracksStore
    private lateinit var resolver: SoundCloudResolver
    private lateinit var adapter: TrackAdapter

    private var castContext: CastContext? = null
    private var castSession: CastSession? = null
    private var mediaRouteMenuItem: MenuItem? = null

    /** URL to start playing as soon as the user has picked a cast device. */
    private var pendingUrl: String? = null
    private var playJob: Job? = null

    private val notificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    private val sessionListener = object : SimpleSessionListener() {
        override fun onSessionStarted(session: CastSession, sessionId: String) = onConnected(session)
        override fun onSessionResumed(session: CastSession, wasSuspended: Boolean) = onConnected(session)
        override fun onSessionEnded(session: CastSession, error: Int) = onDisconnected()
        override fun onSessionResumeFailed(session: CastSession, error: Int) = onDisconnected()
        override fun onSessionStartFailed(session: CastSession, error: Int) {
            onDisconnected()
            setStatus(getString(R.string.status_cast_failed))
        }
    }

    private val mediaCallback = object : RemoteMediaClient.Callback() {
        override fun onStatusUpdated() {
            val client = castSession?.remoteMediaClient ?: return
            val status = client.mediaStatus ?: return
            if (status.playerState != MediaStatus.PLAYER_STATE_IDLE) return
            when (status.idleReason) {
                // Safety net: the receiver should repeat by itself, but if it ever
                // reports "finished" we simply load the track again.
                MediaStatus.IDLE_REASON_FINISHED -> if (PlaybackState.track != null) {
                    Log.i(TAG, "Receiver finished; restarting loop")
                    loadOnReceiver(client)
                }
                MediaStatus.IDLE_REASON_ERROR -> setStatus(getString(R.string.status_playback_error))
            }
        }
    }

    // --- Lifecycle ----------------------------------------------------------------------------

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        setSupportActionBar(binding.toolbar)

        store = SavedTracksStore(this)
        resolver = SoundCloudResolver(this)

        castContext = try {
            CastContext.getSharedInstance(this)
        } catch (e: Exception) {
            Log.e(TAG, "Cast SDK unavailable", e)
            null
        }
        if (castContext == null) setStatus(getString(R.string.status_no_play_services))

        adapter = TrackAdapter(onPlay = { playUrl(it.url) }, onDelete = { confirmDelete(it) })
        binding.savedList.layoutManager = LinearLayoutManager(this)
        binding.savedList.adapter = adapter
        refreshList()

        binding.playButton.setOnClickListener { playUrl(currentInput()) }
        binding.saveButton.setOnClickListener { saveOnly(currentInput()) }
        binding.pasteButton.setOnClickListener { pasteFromClipboard() }
        binding.stopButton.setOnClickListener { stopPlayback() }
        binding.urlInput.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_GO) {
                playUrl(currentInput())
                true
            } else {
                false
            }
        }

        if (savedInstanceState == null) {
            store.lastUrl?.let { binding.urlInput.setText(it) }
            handleIntent(intent)
        }
        showNowPlaying(PlaybackState.track)
        requestNotificationPermission()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        val manager = castContext?.sessionManager ?: return
        manager.addSessionManagerListener(sessionListener, CastSession::class.java)
        val session = manager.currentCastSession
        if (session != null && session.isConnected) onConnected(session) else updateCastUi()
    }

    override fun onPause() {
        castContext?.sessionManager?.removeSessionManagerListener(sessionListener, CastSession::class.java)
        castSession?.remoteMediaClient?.unregisterCallback(mediaCallback)
        super.onPause()
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.main_menu, menu)
        mediaRouteMenuItem = if (castContext != null) {
            try {
                CastButtonFactory.setUpMediaRouteButton(applicationContext, menu, R.id.media_route_menu_item)
            } catch (e: Exception) {
                Log.e(TAG, "Could not set up cast button", e)
                null
            }
        } else {
            menu.findItem(R.id.media_route_menu_item)?.isVisible = false
            null
        }
        menu.findItem(R.id.action_direct_mode)?.isChecked = store.directMode
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean = when (item.itemId) {
        R.id.action_direct_mode -> {
            item.isChecked = !item.isChecked
            store.directMode = item.isChecked
            true
        }
        R.id.action_battery -> {
            requestIgnoreBatteryOptimizations()
            true
        }
        else -> super.onOptionsItemSelected(item)
    }

    // --- Cast session -------------------------------------------------------------------------

    private fun onConnected(session: CastSession) {
        castSession = session
        session.remoteMediaClient?.registerCallback(mediaCallback)
        updateCastUi()
        pendingUrl?.let {
            pendingUrl = null
            playUrl(it)
        }
    }

    private fun onDisconnected() {
        castSession?.remoteMediaClient?.unregisterCallback(mediaCallback)
        castSession = null
        PlaybackState.clear()
        showNowPlaying(null)
        updateCastUi()
    }

    private fun deviceName(): String =
        castSession?.castDevice?.friendlyName ?: getString(R.string.media_route_menu_title)

    private fun updateCastUi() {
        val connected = castSession?.isConnected == true
        if (connected) {
            if (PlaybackState.track != null) {
                setStatus(getString(R.string.status_playing_on, deviceName()))
            } else {
                setStatus(getString(R.string.status_connected, deviceName()))
            }
        } else if (castContext != null) {
            setStatus(getString(R.string.status_idle))
        }
        binding.stopButton.isEnabled = connected
    }

    private fun openCastDialog() {
        val item = mediaRouteMenuItem ?: return
        val provider = MenuItemCompat.getActionProvider(item) as? MediaRouteActionProvider
        provider?.mediaRouteButton?.performClick()
    }

    // --- Playback -----------------------------------------------------------------------------

    private fun playUrl(rawUrl: String) {
        val url = rawUrl.trim()
        if (url.isEmpty()) {
            snack(getString(R.string.error_empty_url))
            return
        }
        if (!looksLikeSoundCloud(url)) {
            snack(getString(R.string.error_not_soundcloud))
            return
        }
        if (binding.urlInput.text?.toString()?.trim() != url) binding.urlInput.setText(url)

        val session = castSession
        if (session == null || !session.isConnected) {
            pendingUrl = url
            setStatus(getString(R.string.status_pick_device))
            openCastDialog()
            return
        }

        playJob?.cancel()
        playJob = lifecycleScope.launch {
            binding.playButton.isEnabled = false
            try {
                setStatus(getString(R.string.status_resolving))
                val track = withContext(Dispatchers.IO) {
                    resolver.resolve(resolver.canonicalTrackUrl(url))
                }
                store.upsert(
                    SavedTrack(
                        url = track.permalinkUrl,
                        title = track.title,
                        artist = track.artist,
                        artworkUrl = track.artworkUrl,
                        addedAt = System.currentTimeMillis(),
                    )
                )
                store.lastUrl = track.permalinkUrl
                binding.urlInput.setText(track.permalinkUrl)
                refreshList()

                val contentUrl = if (store.directMode) {
                    track.streamUrl
                } else {
                    ProxyService.start(this@MainActivity)
                    withContext(Dispatchers.IO) { StreamProxyServer.get(this@MainActivity).register(track) }
                        ?: throw IOException(getString(R.string.error_no_wifi_ip))
                }
                Log.i(TAG, "Casting $contentUrl")

                PlaybackState.track = track
                PlaybackState.contentUrl = contentUrl
                val client = castSession?.remoteMediaClient
                    ?: throw IOException(getString(R.string.error_session_lost))
                loadOnReceiver(client)
                showNowPlaying(track)
                setStatus(getString(R.string.status_playing_on, deviceName()))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.e(TAG, "Playback failed", e)
                setStatus(getString(R.string.status_error, e.message ?: e.javaClass.simpleName))
            } finally {
                binding.playButton.isEnabled = true
            }
        }
    }

    /** Loads the current track on the receiver as a one-item queue set to repeat forever. */
    private fun loadOnReceiver(client: RemoteMediaClient) {
        val track = PlaybackState.track ?: return
        val contentUrl = PlaybackState.contentUrl ?: return

        val metadata = MediaMetadata(MediaMetadata.MEDIA_TYPE_MUSIC_TRACK).apply {
            putString(MediaMetadata.KEY_TITLE, track.title)
            putString(MediaMetadata.KEY_ARTIST, track.artist)
            track.artworkUrl?.let { addImage(WebImage(Uri.parse(it))) }
        }
        val infoBuilder = MediaInfo.Builder(contentUrl)
            .setStreamType(MediaInfo.STREAM_TYPE_BUFFERED)
            .setContentType(if (track.isHls) "application/x-mpegURL" else "audio/mpeg")
            .setMetadata(metadata)
        if (track.durationMs > 0) infoBuilder.setStreamDuration(track.durationMs)
        if (track.isHls) infoBuilder.setHlsSegmentFormat(HlsSegmentFormat.MP3)

        val item = MediaQueueItem.Builder(infoBuilder.build())
            .setAutoplay(true)
            .build()
        val queue = MediaQueueData.Builder()
            .setItems(listOf(item))
            .setRepeatMode(MediaStatus.REPEAT_MODE_REPEAT_SINGLE)
            .setStartIndex(0)
            .build()
        val request = MediaLoadRequestData.Builder()
            .setQueueData(queue)
            .setAutoplay(true)
            .build()
        client.load(request)
    }

    private fun stopPlayback() {
        playJob?.cancel()
        PlaybackState.clear()
        castSession?.remoteMediaClient?.stop()
        ProxyService.stop(this)
        showNowPlaying(null)
        setStatus(getString(R.string.status_stopped))
    }

    // --- Saved tracks -------------------------------------------------------------------------

    private fun saveOnly(rawUrl: String) {
        val url = rawUrl.trim()
        if (url.isEmpty()) {
            snack(getString(R.string.error_empty_url))
            return
        }
        if (!looksLikeSoundCloud(url)) {
            snack(getString(R.string.error_not_soundcloud))
            return
        }
        lifecycleScope.launch {
            // Try to fetch a proper title; fall back to just storing the link.
            val saved = try {
                val track = withContext(Dispatchers.IO) { resolver.resolve(resolver.canonicalTrackUrl(url)) }
                SavedTrack(track.permalinkUrl, track.title, track.artist, track.artworkUrl, System.currentTimeMillis())
            } catch (e: Exception) {
                Log.w(TAG, "Could not resolve while saving; storing raw url", e)
                SavedTrack(url, null, null, null, System.currentTimeMillis())
            }
            store.upsert(saved)
            binding.urlInput.setText(saved.url)
            refreshList()
            snack(getString(R.string.saved_ok))
        }
    }

    private fun confirmDelete(track: SavedTrack) {
        AlertDialog.Builder(this)
            .setTitle(R.string.delete_confirm_title)
            .setMessage(getString(R.string.delete_confirm_message, track.title ?: track.url))
            .setPositiveButton(R.string.delete) { _, _ ->
                store.remove(track.url)
                refreshList()
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun refreshList() {
        val tracks = store.all()
        adapter.submit(tracks)
        binding.emptyText.isVisible = tracks.isEmpty()
    }

    // --- Misc UI ------------------------------------------------------------------------------

    private fun currentInput(): String = binding.urlInput.text?.toString().orEmpty()

    private fun setStatus(text: String) {
        binding.statusText.text = text
    }

    private fun showNowPlaying(track: ResolvedTrack?) {
        binding.nowPlayingTitle.isVisible = track != null
        binding.nowPlayingArtist.isVisible = track != null && track.artist.isNotEmpty()
        binding.nowPlayingTitle.text = track?.title ?: ""
        binding.nowPlayingArtist.text = track?.artist ?: ""
    }

    private fun snack(message: String) {
        Snackbar.make(binding.root, message, Snackbar.LENGTH_LONG).show()
    }

    private fun handleIntent(intent: Intent?) {
        intent ?: return
        val text = when (intent.action) {
            Intent.ACTION_SEND -> intent.getStringExtra(Intent.EXTRA_TEXT)
            Intent.ACTION_VIEW -> intent.dataString
            else -> null
        } ?: return
        extractUrl(text)?.let { binding.urlInput.setText(it) }
    }

    private fun pasteFromClipboard() {
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
        val text = clipboard?.primaryClip?.takeIf { it.itemCount > 0 }
            ?.getItemAt(0)?.coerceToText(this)?.toString()
        val url = text?.let { extractUrl(it) }
        if (url == null) {
            snack(getString(R.string.error_clipboard_empty))
        } else {
            binding.urlInput.setText(url)
        }
    }

    private fun extractUrl(text: String): String? = URL_REGEX.find(text)?.value

    private fun looksLikeSoundCloud(url: String): Boolean =
        url.contains("soundcloud.com", ignoreCase = true) || url.contains("soundcloud.app.goo.gl", ignoreCase = true)

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    private fun requestIgnoreBatteryOptimizations() {
        val power = getSystemService(Context.POWER_SERVICE) as? PowerManager
        if (power?.isIgnoringBatteryOptimizations(packageName) == true) {
            snack(getString(R.string.battery_already))
            return
        }
        try {
            startActivity(
                Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))
            )
        } catch (e: Exception) {
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
    }

    private companion object {
        const val TAG = "MainActivity"
        val URL_REGEX = Regex("https?://\\S+")
    }
}
