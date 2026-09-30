package dk.spoegelsesjaeger

import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.MotionEvent
import android.widget.TextView
import androidx.annotation.StringRes
import androidx.core.content.ContextCompat
import androidx.core.view.isVisible
import com.google.android.material.button.MaterialButton
import com.google.android.material.progressindicator.LinearProgressIndicator
import dk.spoegelsesjaeger.databinding.PageToolsBinding
import java.util.Locale

/** The "Værktøjer" tab: smudge timer, hunt cooldown timer and footstep speed meter. */
class ToolsPage(
    private val activity: MainActivity,
    private val b: PageToolsBinding,
    private val model: HuntViewModel,
    private val update: (TrackerState) -> Unit,
) {
    private val danish = Locale("da", "DK")
    private val handler = Handler(Looper.getMainLooper())
    private val ticker = object : Runnable {
        override fun run() {
            renderTimers()
            if (anyTimerRunning()) handler.postDelayed(this, 200L) else activity.timersRunning(false)
        }
    }
    private val tone: ToneGenerator? by lazy {
        runCatching { ToneGenerator(AudioManager.STREAM_ALARM, 80) }.getOrNull()
    }

    private val smudge = TimerViews(
        model.smudge, b.smudgeTime, b.smudgeProgress, b.smudgeMilestones, b.smudgeStatus,
        b.smudgeStart, b.smudgeHunted,
        milestoneTexts = mapOf(60 to R.string.smudge_m60, 90 to R.string.smudge_m90, 180 to R.string.smudge_m180),
        statusTexts = listOf(
            0 to R.string.smudge_status_0,
            60 to R.string.smudge_status_60,
            90 to R.string.smudge_status_90,
            180 to R.string.smudge_status_180,
        ),
    )
    private val cooldown = TimerViews(
        model.cooldown, b.cooldownTime, b.cooldownProgress, b.cooldownMilestones, b.cooldownStatus,
        b.cooldownStart, b.cooldownHunted,
        milestoneTexts = mapOf(20 to R.string.cooldown_m20, 25 to R.string.cooldown_m25),
        statusTexts = listOf(
            0 to R.string.cooldown_status_0,
            20 to R.string.cooldown_status_20,
            25 to R.string.cooldown_status_25,
        ),
    )
    private val speedButtons = mapOf(
        0.5 to R.id.ghostSpeed50,
        0.75 to R.id.ghostSpeed75,
        1.0 to R.id.ghostSpeed100,
        1.25 to R.id.ghostSpeed125,
        1.5 to R.id.ghostSpeed150,
    )

    init {
        for (timer in listOf(smudge, cooldown)) {
            timer.start.setOnClickListener {
                timer.watch.start(SystemClock.elapsedRealtime())
                startTicking()
            }
        }
        b.smudgeStop.setOnClickListener { stop(smudge) }
        b.cooldownStop.setOnClickListener { stop(cooldown) }
        b.smudgeHunted.setOnClickListener { smudgeHunted() }
        b.cooldownHunted.setOnClickListener { cooldownHunted() }

        // React on touch-down rather than on release so the taps line up with the footsteps.
        b.tapButton.setOnTouchListener { _, event ->
            if (event.actionMasked == MotionEvent.ACTION_DOWN) tap(event.eventTime)
            false
        }
        b.tapButton.setOnClickListener { }
        b.tapReset.setOnClickListener {
            model.taps.clear()
            renderFootsteps()
        }
        b.tapLos.isChecked = model.sawPlayer
        b.tapLos.setOnCheckedChangeListener { _, checked ->
            model.sawPlayer = checked
            renderFootsteps()
        }
        val setting = speedButtons.keys.minByOrNull { kotlin.math.abs(it - model.ghostSpeedSetting) } ?: 1.0
        b.ghostSpeedGroup.check(speedButtons.getValue(setting))
        b.ghostSpeedGroup.addOnButtonCheckedListener { _, checkedId, isChecked ->
            if (!isChecked) return@addOnButtonCheckedListener
            model.ghostSpeedSetting = speedButtons.entries.first { it.value == checkedId }.key
            renderFootsteps()
        }

        if (anyTimerRunning()) startTicking()
    }

    fun render() {
        renderTimers()
        renderFootsteps()
    }

    fun anyTimerRunning(): Boolean {
        val now = SystemClock.elapsedRealtime()
        return model.smudge.isRunning(now) || model.cooldown.isRunning(now)
    }

    fun release() {
        handler.removeCallbacks(ticker)
        tone?.release()
    }

    private fun startTicking() {
        handler.removeCallbacks(ticker)
        activity.timersRunning(true)
        handler.post(ticker)
    }

    private fun stop(timer: TimerViews) {
        timer.watch.stop()
        renderTimers()
    }

    private fun renderTimers() {
        val now = SystemClock.elapsedRealtime()
        for (timer in listOf(smudge, cooldown)) {
            val elapsed = timer.watch.elapsed(now)
            // Announce milestones that passed since the last tick.
            if (elapsed != null) {
                val passed = timer.watch.milestones.filter { it <= elapsed && it !in timer.watch.announced }
                if (passed.isNotEmpty()) {
                    timer.watch.announced += passed
                    alert()
                }
            }
            timer.render(elapsed, now)
        }
    }

    private fun smudgeHunted() {
        val elapsed = model.smudge.elapsed(SystemClock.elapsedRealtime()) ?: return
        val seen = model.state.observations
        when {
            elapsed < 60 -> activity.showMessage(R.string.smudge_too_early)
            elapsed < 90 -> {
                update(model.state.copy(observations = seen + Observation.SMUDGE_90 + Observation.SMUDGE_180))
                activity.showMessage(R.string.smudge_applied_demon)
            }
            elapsed < 180 -> {
                update(model.state.copy(observations = seen + Observation.SMUDGE_180))
                activity.showMessage(R.string.smudge_applied_spirit)
            }
            else -> activity.showMessage(R.string.smudge_too_late)
        }
        stop(smudge)
    }

    private fun cooldownHunted() {
        val elapsed = model.cooldown.elapsed(SystemClock.elapsedRealtime()) ?: return
        when {
            elapsed < 20 -> activity.showMessage(R.string.cooldown_too_early)
            elapsed < 25 -> {
                update(model.state.copy(observations = model.state.observations + Observation.FAST_COOLDOWN))
                activity.showMessage(R.string.cooldown_applied)
            }
            else -> activity.showMessage(R.string.cooldown_too_late)
        }
        stop(cooldown)
    }

    private fun tap(time: Long) {
        val taps = model.taps
        // A pause of more than five seconds starts a new measurement.
        if (taps.isNotEmpty() && time - taps.last() > 5_000) taps.clear()
        taps += time
        while (taps.size > 24) taps.removeAt(0)
        renderFootsteps()
    }

    private fun renderFootsteps() {
        val interval = Footsteps.averageInterval(model.taps)
        if (interval == null) {
            b.tapSpeed.setText(R.string.tap_empty)
            b.tapBpm.text = if (model.taps.isEmpty()) "" else activity.getString(R.string.tap_more)
            b.tapMatches.text = ""
            return
        }
        val speed = Footsteps.speed(interval, model.ghostSpeedSetting)
        b.tapSpeed.text = String.format(danish, "%.2f m/s", speed)
        b.tapBpm.text = activity.getString(
            R.string.tap_bpm,
            String.format(danish, "%.0f", Footsteps.bpm(interval)),
            SpeedClass.of(speed).label.lowercase(),
        )
        val candidates = Identifier.possible(model.state)
        val matches = candidates.filter { Footsteps.matches(it, speed, model.sawPlayer) }
        b.tapMatches.text = if (matches.isEmpty()) {
            activity.getString(R.string.tap_no_matches, candidates.size)
        } else {
            activity.getString(R.string.tap_matches, candidates.size, matches.joinToString(", ") { it.name })
        }
    }

    private fun alert() {
        runCatching { tone?.startTone(ToneGenerator.TONE_PROP_BEEP2, 300) }
        val vibrator = ContextCompat.getSystemService(activity, Vibrator::class.java) ?: return
        if (!vibrator.hasVibrator()) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createOneShot(400, VibrationEffect.DEFAULT_AMPLITUDE))
        } else {
            @Suppress("DEPRECATION")
            vibrator.vibrate(400)
        }
    }

    private inner class TimerViews(
        val watch: Stopwatch,
        val time: TextView,
        val progress: LinearProgressIndicator,
        val milestones: TextView,
        val status: TextView,
        val start: MaterialButton,
        val hunted: MaterialButton,
        val milestoneTexts: Map<Int, Int>,
        /** Status line from each second onwards, ascending. */
        val statusTexts: List<Pair<Int, Int>>,
    ) {
        fun render(elapsed: Double?, now: Long) {
            val seconds = elapsed?.toInt() ?: 0
            time.text = String.format(danish, "%d:%02d", seconds / 60, seconds % 60)
            progress.progress = seconds
            milestones.text = watch.milestones.joinToString("\n") { m ->
                val mark = if (elapsed != null && elapsed >= m) "✓" else "○"
                "$mark  $m s – ${activity.getString(milestoneTexts.getValue(m))}"
            }
            val running = watch.isRunning(now)
            status.isVisible = elapsed != null
            if (elapsed != null) status.setText(statusFor(elapsed))
            start.setText(if (running) R.string.timer_restart else R.string.timer_start)
            hunted.isVisible = running
        }

        @StringRes
        private fun statusFor(elapsed: Double): Int = statusTexts.last { elapsed >= it.first }.second
    }
}
