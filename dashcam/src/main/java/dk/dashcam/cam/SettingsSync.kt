package dk.dashcam.cam

import java.util.Date

class SettingChange(val cmd: Int, val from: Int?, val to: Int) {
    val def: SettingDef? get() = CamSettings.byCmd(cmd)

    fun describe(): String {
        val d = def ?: return "Indstilling $cmd: $from → $to"
        return "${d.label}: ${d.labelFor(from)} → ${d.labelFor(to)}"
    }
}

class SyncResult(
    val changed: List<SettingChange>,
    val failed: List<SettingChange>,
    val clockSet: Boolean,
    val savedToFlash: Boolean,
    val settingsAfter: Map<Int, String>,
)

/**
 * Brings the camera in line with the settings the user wants and sets its clock.
 *
 * The camera refuses most changes while it records, so recording is paused during the
 * changes and started again afterwards if it was running.
 */
suspend fun syncCamera(
    client: CameraClient,
    wanted: Map<Int, Int>,
    setClock: Boolean,
    settleMs: Long = CameraClient.MODE_SETTLE_MS,
    now: () -> Date = { Date() },
): SyncResult {
    val before = client.readSettings()
    val todo = wanted.filter { (cmd, value) ->
        // Only touch settings this camera actually reports.
        before.containsKey(cmd) && before[cmd]?.trim()?.toIntOrNull() != value
    }

    var clockSet = false
    if (todo.isEmpty()) {
        if (setClock) clockSet = runCatchingCamera { client.setClock(now()) }
        if (clockSet || !setClock) {
            return SyncResult(emptyList(), emptyList(), clockSet, false, before)
        }
    }

    // Maintenance window: video mode, recording paused.
    client.ensureMode(CamMode.VIDEO, settleMs)
    val wasRecording = client.isRecording()
    if (wasRecording) client.stopRecording()

    try {
        if (setClock && !clockSet) clockSet = runCatchingCamera { client.setClock(now()) }

        val attempted = ArrayList<SettingChange>()
        val failed = ArrayList<SettingChange>()
        for ((cmd, value) in todo) {
            val change = SettingChange(cmd, before[cmd]?.trim()?.toIntOrNull(), value)
            if (runCatchingCamera { client.setSetting(cmd, value) }) attempted += change
            else failed += change
        }
        val saved = if (todo.isNotEmpty()) client.saveSettings() else false

        val after = client.readSettings()
        val changed = ArrayList<SettingChange>()
        for (change in attempted) {
            if (after[change.cmd]?.trim()?.toIntOrNull() == change.to) changed += change
            else failed += change
        }
        return SyncResult(changed, failed, clockSet, saved, after)
    } finally {
        if (wasRecording && client.connected) {
            runCatchingCamera { client.startRecording() }
        }
    }
}

/** Runs [block]; returns false on an ordinary camera error, rethrows a lost connection. */
private suspend fun runCatchingCamera(block: suspend () -> Unit): Boolean = try {
    block()
    true
} catch (e: ConnectionLostException) {
    throw e
} catch (_: CameraException) {
    false
}
