package dk.dashcam

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.isVisible
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.snackbar.Snackbar
import dk.dashcam.cam.CamSettings
import dk.dashcam.cam.CameraException
import dk.dashcam.cam.SettingDef
import dk.dashcam.databinding.ActivitySettingsBinding
import dk.dashcam.databinding.ItemSettingBinding
import kotlinx.coroutines.launch

/**
 * The camera's settings. Whatever you pick here is also *remembered*, and the app puts it back
 * every time it connects – so it no longer matters that the camera forgets.
 */
class SettingsActivity : AppCompatActivity() {

    private lateinit var b: ActivitySettingsBinding
    private val session = CameraSession
    private var working = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivitySettingsBinding.inflate(layoutInflater)
        setContentView(b.root)
        setSupportActionBar(b.toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        b.toolbar.setNavigationOnClickListener { finish() }

        b.autoFixSwitch.isChecked = session.prefs.autoFix
        b.autoFixSwitch.setOnCheckedChangeListener { _, checked -> session.prefs.autoFix = checked }
        b.clockSwitch.isChecked = session.prefs.setClock
        b.clockSwitch.setOnCheckedChangeListener { _, checked -> session.prefs.setClock = checked }

        b.rememberAllButton.setOnClickListener {
            if (!session.isConnected) {
                snack(getString(R.string.connect_first))
                return@setOnClickListener
            }
            val n = session.rememberCurrent()
            snack(getString(R.string.remembered_n, n))
            render(session.state.value)
        }
        b.applyNowButton.setOnClickListener {
            if (!session.isConnected) {
                snack(getString(R.string.connect_first))
                return@setOnClickListener
            }
            lifecycleScope.launch {
                setWorking(true)
                val summary = session.syncNow(automatic = false)
                setWorking(false)
                snack(summary)
                render(session.state.value)
            }
        }

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                session.state.collect(::render)
            }
        }
    }

    private fun setWorking(on: Boolean) {
        working = on
        b.progress.isVisible = on || session.state.value.busy
    }

    private fun render(s: CameraSession.State) {
        val connected = s.status == CameraSession.Status.CONNECTED
        b.progress.isVisible = working || s.busy
        b.notConnectedHint.isVisible = !connected
        val wanted = session.prefs.wanted
        val defs = if (connected && s.settings.isNotEmpty()) {
            CamSettings.ALL.filter { s.settings.containsKey(it.cmd) }
        } else {
            CamSettings.ALL
        }
        b.settingsContainer.removeAllViews()
        for (def in defs) {
            val row = ItemSettingBinding.inflate(layoutInflater, b.settingsContainer, false)
            val current = if (connected) s.settings[def.cmd]?.trim()?.toIntOrNull() else null
            val remembered = wanted[def.cmd]
            row.settingTitle.text = def.label
            row.settingValue.text = describe(connected, def, current, remembered)
            row.root.setOnClickListener { pick(def, current, remembered) }
            b.settingsContainer.addView(row.root)
        }
    }

    private fun describe(connected: Boolean, def: SettingDef, current: Int?, remembered: Int?): String =
        when {
            !connected && remembered == null -> getString(R.string.value_not_remembered)
            !connected -> getString(R.string.value_remembered_only, def.labelFor(remembered))
            remembered == null -> def.labelFor(current)
            remembered == current -> getString(R.string.value_locked, def.labelFor(current))
            else -> getString(R.string.value_differs, def.labelFor(current), def.labelFor(remembered))
        }

    private fun pick(def: SettingDef, current: Int?, remembered: Int?) {
        if (working) return
        val labels = def.choices.map { it.label }.toTypedArray()
        var selected = def.choices.indexOfFirst { it.value == (remembered ?: current) }
        val dialog = MaterialAlertDialogBuilder(this)
            .setTitle(def.label)
            .setSingleChoiceItems(labels, selected) { _, which -> selected = which }
            .setPositiveButton(R.string.use) { _, _ ->
                if (selected >= 0) apply(def, def.choices[selected].value)
            }
            .setNegativeButton(R.string.cancel, null)
        if (remembered != null) {
            dialog.setNeutralButton(R.string.forget) { _, _ ->
                session.prefs.want(def.cmd, null)
                render(session.state.value)
            }
        }
        dialog.show()
    }

    private fun apply(def: SettingDef, value: Int) {
        lifecycleScope.launch {
            setWorking(true)
            try {
                val ok = session.changeSetting(def.cmd, value)
                snack(
                    when {
                        !session.isConnected -> getString(R.string.saved_for_next_time)
                        ok -> "${def.label}: ${def.labelFor(value)}"
                        else -> getString(R.string.camera_refused, def.label)
                    }
                )
            } catch (e: CameraException) {
                snack(e.message ?: getString(R.string.error))
            } finally {
                setWorking(false)
                render(session.state.value)
            }
        }
    }

    private fun snack(text: String) {
        Snackbar.make(b.root, text, Snackbar.LENGTH_LONG).show()
    }
}
