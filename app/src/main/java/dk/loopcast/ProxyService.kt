package dk.loopcast

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.mediarouter.media.MediaRouter
import com.google.android.gms.cast.MediaStatus
import com.google.android.gms.cast.framework.CastContext
import com.google.android.gms.cast.framework.CastSession
import com.google.android.gms.cast.framework.media.RemoteMediaClient

/**
 * Foreground service that keeps the loop alive overnight:
 *
 *  - keeps the process and the relay server running, holding a Wi‑Fi lock,
 *  - watches the receiver and reloads the track whenever it goes idle
 *    (finished, error, restarted receiver, …),
 *  - reconnects to the cast device if the phone's cast session drops,
 *  - survives being restarted by Android by restoring the persisted state.
 *
 * It only stops when the user presses Stop (in the app or in the notification).
 */
class ProxyService : Service() {

    private val handler = Handler(Looper.getMainLooper())
    private var wifiLock: WifiManager.WifiLock? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var castContext: CastContext? = null
    private var mediaRouter: MediaRouter? = null
    private var attachedClient: RemoteMediaClient? = null

    private var sessionAvailableAt = 0L
    private var sessionLostAt = 0L
    private var lastReconnectAt = 0L
    private var consecutiveReloads = 0
    private var nextReloadAllowedAt = 0L

    private val sessionListener = object : SimpleSessionListener() {
        override fun onSessionStarted(session: CastSession, sessionId: String) = onSessionAvailable(session)
        override fun onSessionResumed(session: CastSession, wasSuspended: Boolean) = onSessionAvailable(session)
        override fun onSessionEnded(session: CastSession, error: Int) = onSessionGone("ended ($error)")
        override fun onSessionResumeFailed(session: CastSession, error: Int) = onSessionGone("resume failed ($error)")
        override fun onSessionStartFailed(session: CastSession, error: Int) = onSessionGone("start failed ($error)")
        override fun onSessionSuspended(session: CastSession, reason: Int) {
            Log.i(TAG, "Cast session suspended ($reason); waiting for resume")
        }
    }

    private val mediaCallback = object : RemoteMediaClient.Callback() {
        override fun onStatusUpdated() {
            handler.post { checkPlayback() }
        }
    }

    /** Registered only so MediaRouter keeps discovering cast devices for reconnects. */
    private val routerCallback = object : MediaRouter.Callback() {}

    private val watchdog = object : Runnable {
        override fun run() {
            checkPlayback()
            handler.postDelayed(this, WATCHDOG_INTERVAL_MS)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        acquireLocks()
        StreamProxyServer.get(this)
        PlaybackState.restoreIfEmpty(this)

        castContext = try {
            CastContext.getSharedInstance(this).also { ctx ->
                ctx.sessionManager.addSessionManagerListener(sessionListener, CastSession::class.java)
                val router = MediaRouter.getInstance(this)
                mediaRouter = router
                ctx.mergedSelector?.let { selector ->
                    router.addCallback(selector, routerCallback, MediaRouter.CALLBACK_FLAG_REQUEST_DISCOVERY)
                }
                val session = ctx.sessionManager.currentCastSession
                if (session != null && session.isConnected) onSessionAvailable(session) else sessionLostAt = now()
            }
        } catch (e: Exception) {
            Log.w(TAG, "Cast not available", e)
            null
        }
        handler.postDelayed(watchdog, WATCHDOG_INTERVAL_MS)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            Log.i(TAG, "Stop requested from notification")
            CastPlayback.stopEverything(this)
            return START_NOT_STICKY
        }
        return START_STICKY
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        attachedClient?.unregisterCallback(mediaCallback)
        attachedClient = null
        mediaRouter?.removeCallback(routerCallback)
        castContext?.sessionManager?.removeSessionManagerListener(sessionListener, CastSession::class.java)
        releaseLocks()
        StreamProxyServer.shutdown()
        super.onDestroy()
    }

    // --- Watchdog -----------------------------------------------------------------------------

    private fun onSessionAvailable(session: CastSession) {
        attachedClient?.unregisterCallback(mediaCallback)
        attachedClient = session.remoteMediaClient?.also { it.registerCallback(mediaCallback) }
        sessionAvailableAt = now()
        sessionLostAt = 0L
        consecutiveReloads = 0
        nextReloadAllowedAt = 0L
        mediaRouter?.selectedRoute?.id?.let { routeId ->
            if (routeId != MediaRouter.getInstance(this).defaultRoute.id) {
                PlaybackState.routeId = routeId
                PlaybackState.persist(this)
            }
        }
        Log.i(TAG, "Cast session available (${session.castDevice?.friendlyName})")
        handler.postDelayed({ checkPlayback() }, 3_000L)
    }

    private fun onSessionGone(reason: String) {
        Log.w(TAG, "Cast session $reason; relay keeps running, will try to reconnect")
        attachedClient?.unregisterCallback(mediaCallback)
        attachedClient = null
        if (sessionLostAt == 0L) sessionLostAt = now()
    }

    private fun checkPlayback() {
        if (PlaybackState.track == null) return
        val ctx = castContext ?: return
        val session = ctx.sessionManager.currentCastSession
        if (session == null || !session.isConnected) {
            tryReconnect()
            return
        }
        val client = session.remoteMediaClient ?: return
        val status = client.mediaStatus
        val finished = status != null && status.playerState == MediaStatus.PLAYER_STATE_IDLE &&
            status.idleReason == MediaStatus.IDLE_REASON_FINISHED
        val needsReload = when {
            status == null -> now() - sessionAvailableAt > 20_000L
            status.playerState == MediaStatus.PLAYER_STATE_IDLE -> when (status.idleReason) {
                MediaStatus.IDLE_REASON_FINISHED,
                MediaStatus.IDLE_REASON_ERROR,
                MediaStatus.IDLE_REASON_NONE -> true
                else -> false // CANCELLED = someone stopped it on purpose; INTERRUPTED = a load is under way
            }
            else -> false
        }
        if (!needsReload) {
            if (status != null && status.playerState != MediaStatus.PLAYER_STATE_IDLE) consecutiveReloads = 0
            return
        }
        val now = now()
        if (now < nextReloadAllowedAt) return
        val backoff = minOf(RELOAD_BASE_DELAY_MS shl minOf(consecutiveReloads, 5), RELOAD_MAX_DELAY_MS)
        nextReloadAllowedAt = now + backoff
        consecutiveReloads++
        if (finished) PlaybackState.loopCount++
        Log.i(TAG, "Receiver idle (${status?.idleReason}); reloading (attempt $consecutiveReloads, next in ${backoff / 1000}s)")
        if (!CastPlayback.load(this, client)) Log.w(TAG, "Nothing to load")
    }

    private fun tryReconnect() {
        val routeId = PlaybackState.routeId ?: return
        val ctx = castContext ?: return
        val router = mediaRouter ?: return
        val now = now()
        if (sessionLostAt == 0L) sessionLostAt = now
        if (now - sessionLostAt < RECONNECT_GRACE_MS || now - lastReconnectAt < RECONNECT_INTERVAL_MS) return
        if (ctx.sessionManager.currentSession != null) return // a session is starting or resuming
        val route = router.routes.firstOrNull { it.id == routeId && it.isEnabled }
        if (route == null) {
            Log.i(TAG, "Cast device not visible yet; will retry")
            return
        }
        lastReconnectAt = now
        Log.i(TAG, "Reconnecting to ${route.name}")
        router.selectRoute(route)
    }

    private fun now() = System.currentTimeMillis()

    // --- Locks & notification -----------------------------------------------------------------

    @Suppress("DEPRECATION")
    private fun acquireLocks() {
        val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        wifiLock = wifi?.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "LoopCast:wifi")?.also {
            it.setReferenceCounted(false)
            it.acquire()
        }
        val power = getSystemService(Context.POWER_SERVICE) as? PowerManager
        wakeLock = power?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "LoopCast:relay")?.also {
            it.setReferenceCounted(false)
            it.acquire()
        }
    }

    private fun releaseLocks() {
        runCatching { wifiLock?.takeIf { it.isHeld }?.release() }
        runCatching { wakeLock?.takeIf { it.isHeld }?.release() }
        wifiLock = null
        wakeLock = null
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.notification_channel),
            NotificationManager.IMPORTANCE_LOW,
        )
        getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification {
        val openIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val openPending = PendingIntent.getActivity(
            this, 0, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val stopIntent = Intent(this, ProxyService::class.java).setAction(ACTION_STOP)
        val stopPending = PendingIntent.getService(
            this, 1, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_repeat_white)
            .setContentTitle(getString(R.string.notification_title))
            .setContentText(getString(R.string.notification_text))
            .setContentIntent(openPending)
            .addAction(R.drawable.ic_stop, getString(R.string.stop), stopPending)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    companion object {
        private const val TAG = "ProxyService"
        private const val CHANNEL_ID = "playback"
        private const val NOTIFICATION_ID = 1001
        private const val ACTION_STOP = "dk.loopcast.STOP"
        private const val WATCHDOG_INTERVAL_MS = 15_000L
        private const val RELOAD_BASE_DELAY_MS = 8_000L
        private const val RELOAD_MAX_DELAY_MS = 5L * 60_000L
        private const val RECONNECT_GRACE_MS = 10_000L
        private const val RECONNECT_INTERVAL_MS = 45_000L

        fun start(context: Context) {
            ContextCompat.startForegroundService(context, Intent(context, ProxyService::class.java))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, ProxyService::class.java))
        }
    }
}
