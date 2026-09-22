package dk.loopcast

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import java.util.Calendar

/**
 * Sleep timer: playback stops at [PlaybackState.stopAtMs]. The foreground service checks
 * it every few seconds; an (inexact) alarm is scheduled as a fallback in case the service
 * is not running.
 */
object SleepTimer {

    private const val TAG = "SleepTimer"
    private const val REQUEST_CODE = 42

    fun set(context: Context, stopAtMs: Long) {
        PlaybackState.stopAtMs = stopAtMs
        PlaybackState.persist(context)
        val alarm = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
        val pending = pendingIntent(context)
        alarm.cancel(pending)
        if (stopAtMs > 0) {
            alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, stopAtMs, pending)
            Log.i(TAG, "Sleep timer set for $stopAtMs")
        }
    }

    fun clear(context: Context) = set(context, 0L)

    /** Next occurrence of the given wall-clock time (today if still ahead, otherwise tomorrow). */
    fun nextOccurrence(hour: Int, minute: Int): Long {
        val cal = Calendar.getInstance()
        cal.set(Calendar.HOUR_OF_DAY, hour)
        cal.set(Calendar.MINUTE, minute)
        cal.set(Calendar.SECOND, 0)
        cal.set(Calendar.MILLISECOND, 0)
        if (cal.timeInMillis <= System.currentTimeMillis() + 60_000L) cal.add(Calendar.DAY_OF_YEAR, 1)
        return cal.timeInMillis
    }

    /** True if the timer is set and its time has come. */
    fun isDue(): Boolean {
        val at = PlaybackState.stopAtMs
        return at > 0 && System.currentTimeMillis() >= at
    }

    private fun pendingIntent(context: Context): PendingIntent = PendingIntent.getBroadcast(
        context,
        REQUEST_CODE,
        Intent(context, StopAlarmReceiver::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
}

class StopAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        PlaybackState.restoreIfEmpty(context)
        if (!SleepTimer.isDue()) return
        Log.i("SleepTimer", "Alarm fired; stopping playback")
        CastPlayback.stopEverything(context, endSession = true)
    }
}
