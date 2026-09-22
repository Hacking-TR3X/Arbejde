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
import android.widget.SeekBar
import androidx.activity.result.contract.ActivityResultContracts
import android.app.TimePickerDialog
import android.os.Handler
import android.os.Looper
import android.text.format.DateFormat
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.MenuItemCompat
import androidx.core.view.isVisible
import androidx.lifecycle.lifecycleScope
import androidx.mediarouter.app.MediaRouteActionProvider
import androidx.mediarouter.media.MediaRouter
import androidx.recyclerview.widget.LinearLayoutManager
import com.google.android.gms.cast.MediaSeekOptions
import com.google.android.gms.cast.MediaStatus
import com.google.android.gms.cast.framework.CastButtonFactory
import com.google.android.gms.cast.framework.CastContext
import com.google.android.gms.cast.framework.CastSession
import com.google.android.gms.cast.framework.media.RemoteMediaClient
import com.google.android.material.snackbar.Snackbar
import dk.loopcast.databinding.ActivityMainBinding
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.IOException
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit
import java.util.Calendar
import java.util.Locale

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var store: SavedTracksStore
    private lateinit var resolver: SoundCloudResolver
    private lateinit var adapter: TrackAdapter
    private lateinit var trackCache: TrackCache
    private val downloadClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .followRedirects(true)
            .build()
    }

    private var castContext: CastContext? = null
    private var castSession: CastSession? = null
    private var mediaRouteMenuItem: MenuItem? = null

    /** URL to start playing as soon as the user has picked a cast device. */
    private var pendingUrl: String? = null
    private var playJob: Job? = null
    private var userSeeking = false
    private val uiHandler = Handler(Looper.getMainLooper())
    private val timerTicker = object : Runnable {
        override fun run() {
            updateTimerText()
            uiHandler.postDelayed(this, 30_000L)
        }
    }

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

    private val progressListener = RemoteMediaClient.ProgressListener { progressMs, durationMs ->
        onProgress(progressMs, durationMs)
    }

    private val mediaCallback = object : RemoteMediaClient.Callback() {
        override fun onStatusUpdated() {
            val client = castSession?.remoteMediaClient ?: return
            updatePlayPauseButton(client)
            updateLoopText()
            val status = client.mediaStatus ?: return
            if (status.playerState == MediaStatus.PLAYER_STATE_IDLE &&
                status.idleReason == MediaStatus.IDLE_REASON_ERROR
            ) {
                setStatus(getString(R.string.status_playback_error))
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
        trackCache = TrackCache(this)
        PlaybackState.restoreIfEmpty(this)
        pruneCache()

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
        binding.timerButton.setOnClickListener { showTimerDialog() }
        binding.playPauseButton.setOnClickListener { togglePlayPause() }
        binding.rewindButton.setOnClickListener { seekRelative(-15_000L) }
        binding.forwardButton.setOnClickListener { seekRelative(15_000L) }
        binding.toEndButton.setOnClickListener { seekTo(currentDurationMs() - 10_000L) }
        binding.seekBar.max = SEEK_MAX
        binding.seekBar.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seekBar: SeekBar, progress: Int, fromUser: Boolean) {
                if (fromUser) updatePositionText(progressToMs(progress), currentDurationMs())
            }

            override fun onStartTrackingTouch(seekBar: SeekBar) {
                userSeeking = true
            }

            override fun onStopTrackingTouch(seekBar: SeekBar) {
                userSeeking = false
                seekTo(progressToMs(seekBar.progress))
            }
        })
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
        uiHandler.post(timerTicker)
        if (PlaybackState.track == null && binding.nowPlayingTitle.isVisible) {
            // The sleep timer (or the notification's Stop) ended playback while we were away.
            showNowPlaying(null)
            setStatus(getString(R.string.status_stopped))
        }
        val manager = castContext?.sessionManager ?: return
        manager.addSessionManagerListener(sessionListener, CastSession::class.java)
        val session = manager.currentCastSession
        if (session != null && session.isConnected) onConnected(session) else updateCastUi()
    }

    override fun onPause() {
        uiHandler.removeCallbacks(timerTicker)
        castContext?.sessionManager?.removeSessionManagerListener(sessionListener, CastSession::class.java)
        castSession?.remoteMediaClient?.unregisterCallback(mediaCallback)
        castSession?.remoteMediaClient?.removeProgressListener(progressListener)
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
        session.remoteMediaClient?.let {
            it.registerCallback(mediaCallback)
            it.addProgressListener(progressListener, PROGRESS_INTERVAL_MS)
            updatePlayPauseButton(it)
        }
        val routeId = MediaRouter.getInstance(this).selectedRoute.id
        if (routeId != MediaRouter.getInstance(this).defaultRoute.id) {
            PlaybackState.routeId = routeId
            if (PlaybackState.track != null) PlaybackState.persist(this)
        }
        showNowPlaying(PlaybackState.track)
        updateCastUi()
        pendingUrl?.let {
            pendingUrl = null
            playUrl(it)
        }
    }

    private fun onDisconnected() {
        castSession?.remoteMediaClient?.unregisterCallback(mediaCallback)
        castSession?.remoteMediaClient?.removeProgressListener(progressListener)
        castSession = null
        binding.controls.isVisible = false
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
            setStatus(
                if (PlaybackState.track != null) getString(R.string.status_disconnected)
                else getString(R.string.status_idle)
            )
        }
        binding.stopButton.isEnabled = connected || PlaybackState.track != null
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
            var replacedCurrent = false
            try {
                setStatus(getString(R.string.status_resolving))
                val track = withContext(Dispatchers.IO) { resolveOrUseCache(url) }
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

                // Keep a local copy so the overnight loop never depends on SoundCloud.
                val key = StreamProxyServer.keyFor(track.permalinkUrl)
                if (!store.directMode && !trackCache.has(key) && track.streamUrl.isNotEmpty()) {
                    try {
                        withContext(Dispatchers.IO) {
                            trackCache.download(track, downloadClient) { percent ->
                                lifecycleScope.launch {
                                    setStatus(
                                        if (percent >= 0) getString(R.string.status_downloading, percent)
                                        else getString(R.string.status_downloading_unknown)
                                    )
                                }
                            }
                        }
                    } catch (e: IOException) {
                        Log.w(TAG, "Download failed; falling back to streaming", e)
                        snack(getString(R.string.download_failed_streaming))
                    }
                }

                replacedCurrent = true
                PlaybackState.startNew(track, "")
                PlaybackState.persist(this@MainActivity)
                ProxyService.start(this@MainActivity)
                // Work out the URL off the main thread, but hand it to the Cast SDK on the
                // main thread – RemoteMediaClient insists on that.
                val contentUrl = withContext(Dispatchers.IO) { CastPlayback.contentUrl(this@MainActivity, track) }
                    ?: throw IOException(getString(R.string.error_no_wifi_ip))
                val client = castSession?.remoteMediaClient
                    ?: throw IOException(getString(R.string.error_session_lost))
                CastPlayback.loadWithUrl(this@MainActivity, client, track, contentUrl)
                Log.i(TAG, "Casting $contentUrl")
                showNowPlaying(track)
                updateTimerText()
                setStatus(getString(R.string.status_playing_on, deviceName()))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.e(TAG, "Playback failed", e)
                if (replacedCurrent) {
                    PlaybackState.clear()
                    PlaybackState.persist(this@MainActivity)
                }
                setStatus(getString(R.string.status_error, e.message ?: e.javaClass.simpleName))
            } finally {
                binding.playButton.isEnabled = true
            }
        }
    }

    /**
     * Resolves the link on SoundCloud. If that fails but the track is already cached on the
     * phone, plays the cached copy using the saved metadata instead.
     */
    private fun resolveOrUseCache(url: String): ResolvedTrack {
        try {
            return resolver.resolve(resolver.canonicalTrackUrl(url))
        } catch (e: IOException) {
            val cleaned = url.substringBefore('?').trimEnd('/')
            val saved = store.all().firstOrNull { it.url.equals(cleaned, ignoreCase = true) }
            val key = StreamProxyServer.keyFor(cleaned)
            if (saved == null || !trackCache.has(key)) throw e
            Log.w(TAG, "Resolve failed; using cached copy", e)
            return ResolvedTrack(
                permalinkUrl = saved.url,
                title = saved.title ?: saved.url,
                artist = saved.artist ?: "",
                artworkUrl = saved.artworkUrl,
                durationMs = 0L,
                streamUrl = "",
                isHls = false,
            )
        }
    }

    private fun stopPlayback() {
        playJob?.cancel()
        CastPlayback.stopEverything(this)
        showNowPlaying(null)
        updateTimerText()
        setStatus(getString(R.string.status_stopped))
        binding.stopButton.isEnabled = castSession?.isConnected == true
    }

    // --- Sleep timer --------------------------------------------------------------------------

    private fun showTimerDialog() {
        val options = mutableListOf(
            getString(R.string.timer_none),
            getString(R.string.timer_minutes, 30),
            getString(R.string.timer_one_hour),
            getString(R.string.timer_hours, 2),
            getString(R.string.timer_hours, 4),
            getString(R.string.timer_hours, 8),
            getString(R.string.timer_pick_time),
        )
        val lastClock = store.lastTimerClock
        if (lastClock >= 0) options += getString(R.string.timer_last_clock, formatClock(lastClock / 60, lastClock % 60))

        AlertDialog.Builder(this)
            .setTitle(R.string.timer_title)
            .setItems(options.toTypedArray()) { _, which ->
                val now = System.currentTimeMillis()
                when (which) {
                    0 -> applyTimer(0L)
                    1 -> applyTimer(now + 30L * 60_000L)
                    2 -> applyTimer(now + 60L * 60_000L)
                    3 -> applyTimer(now + 2L * 60L * 60_000L)
                    4 -> applyTimer(now + 4L * 60L * 60_000L)
                    5 -> applyTimer(now + 8L * 60L * 60_000L)
                    6 -> pickStopTime()
                    7 -> applyClockTimer(lastClock / 60, lastClock % 60)
                }
            }
            .show()
    }

    private fun pickStopTime() {
        val last = store.lastTimerClock
        val cal = Calendar.getInstance()
        val hour = if (last >= 0) last / 60 else cal.get(Calendar.HOUR_OF_DAY)
        val minute = if (last >= 0) last % 60 else cal.get(Calendar.MINUTE)
        TimePickerDialog(
            this,
            { _, pickedHour, pickedMinute -> applyClockTimer(pickedHour, pickedMinute) },
            hour,
            minute,
            DateFormat.is24HourFormat(this),
        ).show()
    }

    private fun applyClockTimer(hour: Int, minute: Int) {
        store.lastTimerClock = hour * 60 + minute
        applyTimer(SleepTimer.nextOccurrence(hour, minute))
    }

    private fun applyTimer(stopAtMs: Long) {
        SleepTimer.set(this, stopAtMs)
        updateTimerText()
        if (stopAtMs > 0) {
            snack(getString(R.string.timer_set, formatClock(stopAtMs)))
        } else {
            snack(getString(R.string.timer_cleared))
        }
    }

    private fun updateTimerText() {
        val stopAt = PlaybackState.stopAtMs
        val remaining = stopAt - System.currentTimeMillis()
        binding.timerText.text = if (stopAt <= 0L || remaining <= 0L) {
            getString(R.string.timer_none_text)
        } else {
            getString(R.string.timer_active, formatClock(stopAt), formatRemaining(remaining))
        }
    }

    private fun formatRemaining(ms: Long): String {
        val totalMinutes = (ms + 59_999L) / 60_000L
        val hours = totalMinutes / 60
        val minutes = totalMinutes % 60
        return if (hours > 0) getString(R.string.remaining_hours_minutes, hours, minutes)
        else getString(R.string.remaining_minutes, minutes)
    }

    private fun formatClock(epochMs: Long): String {
        val cal = Calendar.getInstance().apply { timeInMillis = epochMs }
        return formatClock(cal.get(Calendar.HOUR_OF_DAY), cal.get(Calendar.MINUTE))
    }

    private fun formatClock(hour: Int, minute: Int): String =
        String.format(Locale.getDefault(), "%02d:%02d", hour, minute)

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
                if (PlaybackState.track?.permalinkUrl != track.url) {
                    trackCache.delete(StreamProxyServer.keyFor(track.url))
                }
                refreshList()
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun pruneCache() {
        val keep = store.all().map { StreamProxyServer.keyFor(it.url) }.toMutableSet()
        PlaybackState.track?.let { keep += StreamProxyServer.keyFor(it.permalinkUrl) }
        lifecycleScope.launch(Dispatchers.IO) { trackCache.prune(keep) }
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
        binding.controls.isVisible = track != null && castSession?.isConnected == true
        if (track != null) {
            updatePositionText(0L, track.durationMs)
            binding.seekBar.progress = 0
            updateLoopText()
        }
    }

    // --- Transport controls -------------------------------------------------------------------

    private fun onProgress(progressMs: Long, durationMs: Long) {
        if (PlaybackState.track == null) return
        val duration = if (durationMs > 0) durationMs else currentDurationMs()
        if (!userSeeking && duration > 0) {
            binding.seekBar.progress = (progressMs * SEEK_MAX / duration).toInt().coerceIn(0, SEEK_MAX)
        }
        if (!userSeeking) updatePositionText(progressMs, duration)
        updateTimerText()

        // A jump from near the end back to the start means the receiver looped.
        val last = PlaybackState.lastProgressMs
        val now = System.currentTimeMillis()
        if (last >= 0 && duration > 0 && now > PlaybackState.suppressWrapUntilMs &&
            progressMs + 5_000L < last && last > duration - 30_000L
        ) {
            PlaybackState.loopCount++
            updateLoopText()
        }
        PlaybackState.lastProgressMs = progressMs
    }

    private fun togglePlayPause() {
        val client = castSession?.remoteMediaClient ?: return
        if (client.isPlaying) client.pause() else client.play()
    }

    private fun seekRelative(deltaMs: Long) {
        val client = castSession?.remoteMediaClient ?: return
        seekTo(client.approximateStreamPosition + deltaMs)
    }

    private fun seekTo(positionMs: Long) {
        val client = castSession?.remoteMediaClient ?: return
        val duration = currentDurationMs()
        val target = if (duration > 0) positionMs.coerceIn(0L, duration - 1_000L) else positionMs.coerceAtLeast(0L)
        PlaybackState.suppressWrapUntilMs = System.currentTimeMillis() + 4_000L
        PlaybackState.lastProgressMs = target
        updatePositionText(target, duration)
        client.seek(
            MediaSeekOptions.Builder()
                .setPosition(target)
                .setResumeState(MediaSeekOptions.RESUME_STATE_UNCHANGED)
                .build()
        )
    }

    private fun currentDurationMs(): Long {
        val fromReceiver = castSession?.remoteMediaClient?.streamDuration ?: 0L
        return if (fromReceiver > 0) fromReceiver else PlaybackState.track?.durationMs ?: 0L
    }

    private fun progressToMs(progress: Int): Long {
        val duration = currentDurationMs()
        return if (duration > 0) progress.toLong() * duration / SEEK_MAX else 0L
    }

    private fun updatePlayPauseButton(client: RemoteMediaClient) {
        val playing = client.isPlaying || client.isBuffering
        binding.playPauseButton.setIconResource(if (playing) R.drawable.ic_pause else R.drawable.ic_play)
        binding.playPauseButton.contentDescription = getString(if (playing) R.string.pause else R.string.play)
    }

    private fun updatePositionText(positionMs: Long, durationMs: Long) {
        binding.positionText.text = getString(R.string.position_format, formatTime(positionMs), formatTime(durationMs))
    }

    private fun updateLoopText() {
        val count = PlaybackState.loopCount
        binding.loopText.text =
            if (count <= 0) getString(R.string.loop_count_first) else getString(R.string.loop_count, count)
    }

    private fun formatTime(ms: Long): String {
        val totalSeconds = (ms.coerceAtLeast(0L) / 1000L)
        return String.format(Locale.getDefault(), "%d:%02d", totalSeconds / 60, totalSeconds % 60)
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
        const val SEEK_MAX = 1000
        const val PROGRESS_INTERVAL_MS = 500L
        val URL_REGEX = Regex("https?://\\S+")
    }
}
