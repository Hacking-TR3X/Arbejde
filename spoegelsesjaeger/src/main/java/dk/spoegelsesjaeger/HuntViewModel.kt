package dk.spoegelsesjaeger

import android.app.Application
import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import androidx.lifecycle.AndroidViewModel

/** Holds the contract being investigated and the running tools, so they survive rotation. */
class HuntViewModel(app: Application) : AndroidViewModel(app) {

    private val store = TrackerStore(app)

    var state: TrackerState = store.loadState()
        set(value) {
            field = value
            store.saveState(value)
        }

    var keepScreenOn: Boolean
        get() = store.keepScreenOn
        set(value) {
            store.keepScreenOn = value
        }

    /** Lobby ghost-speed setting as a factor (0.5–1.5). */
    var ghostSpeedSetting: Double
        get() = store.ghostSpeedSetting
        set(value) {
            store.ghostSpeedSetting = value
        }

    var page = 0
    var behaviourExpanded = false

    val smudge = Stopwatch(total = 180, milestones = listOf(60, 90, 180))
    val cooldown = Stopwatch(total = 25, milestones = listOf(20, 25))

    /** Footstep tap times (uptime ms), oldest first. */
    val taps = mutableListOf<Long>()
    var sawPlayer = false
}

/** Counts up from the moment it is started until [total] seconds have passed. */
class Stopwatch(val total: Int, val milestones: List<Int>) {
    var startedAt: Long? = null
        private set
    /** Milestones already announced with a beep, so rotation doesn't beep again. */
    val announced = mutableSetOf<Int>()

    fun start(now: Long) {
        startedAt = now
        announced.clear()
    }

    fun stop() {
        startedAt = null
        announced.clear()
    }

    /** Seconds since start, capped at [total]; null when stopped. */
    fun elapsed(now: Long): Double? = startedAt?.let { ((now - it) / 1000.0).coerceIn(0.0, total.toDouble()) }

    fun isRunning(now: Long): Boolean = elapsed(now).let { it != null && it < total }
}

class TrackerStore(context: Context) {

    private val prefs = context.getSharedPreferences("spoegelsesjaeger", Context.MODE_PRIVATE)

    fun loadState(): TrackerState {
        val found = prefs.enums<Evidence>(KEY_FOUND)
        val ruledOut = prefs.enums<Evidence>(KEY_RULED_OUT) - found
        return TrackerState(
            evidenceCount = prefs.getInt(KEY_COUNT, 3).coerceIn(0, 3),
            marks = found.associateWith { Mark.FOUND } + ruledOut.associateWith { Mark.RULED_OUT },
            speeds = prefs.enums(KEY_SPEEDS),
            observations = prefs.enums(KEY_OBSERVATIONS),
            struckOut = prefs.getStringSet(KEY_STRUCK_OUT, null).orEmpty().toSet(),
        )
    }

    fun saveState(state: TrackerState) = prefs.edit {
        putInt(KEY_COUNT, state.evidenceCount)
        putStringSet(KEY_FOUND, state.found.names())
        putStringSet(KEY_RULED_OUT, state.ruledOut.names())
        putStringSet(KEY_SPEEDS, state.speeds.names())
        putStringSet(KEY_OBSERVATIONS, state.observations.names())
        putStringSet(KEY_STRUCK_OUT, state.struckOut)
    }

    var keepScreenOn: Boolean
        get() = prefs.getBoolean(KEY_KEEP_SCREEN_ON, false)
        set(value) = prefs.edit { putBoolean(KEY_KEEP_SCREEN_ON, value) }

    var ghostSpeedSetting: Double
        get() = prefs.getFloat(KEY_GHOST_SPEED, 1f).toDouble()
        set(value) = prefs.edit { putFloat(KEY_GHOST_SPEED, value.toFloat()) }

    private fun Set<Enum<*>>.names(): Set<String> = mapTo(mutableSetOf()) { it.name }

    /** Reads a set of enum names, skipping any that no longer exist in a newer app version. */
    private inline fun <reified T : Enum<T>> SharedPreferences.enums(key: String): Set<T> =
        getStringSet(key, null).orEmpty().mapNotNullTo(mutableSetOf()) { name ->
            enumValues<T>().firstOrNull { it.name == name }
        }

    private companion object {
        const val KEY_COUNT = "evidence_count"
        const val KEY_FOUND = "found"
        const val KEY_RULED_OUT = "ruled_out"
        const val KEY_SPEEDS = "speeds"
        const val KEY_OBSERVATIONS = "observations"
        const val KEY_STRUCK_OUT = "struck_out"
        const val KEY_KEEP_SCREEN_ON = "keep_screen_on"
        const val KEY_GHOST_SPEED = "ghost_speed"
    }
}
