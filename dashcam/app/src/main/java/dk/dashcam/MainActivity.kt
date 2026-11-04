package dk.dashcam

import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.provider.Settings
import android.view.Menu
import android.view.MenuItem
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.isVisible
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.snackbar.Snackbar
import dk.dashcam.CameraSession.Status
import dk.dashcam.cam.CameraException
import dk.dashcam.databinding.ActivityMainBinding
import dk.dashcam.databinding.DialogTextInputBinding
import dk.dashcam.databinding.DialogWifiBinding
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {

    private lateinit var b: ActivityMainBinding
    private val session = CameraSession

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityMainBinding.inflate(layoutInflater)
        setContentView(b.root)
        setSupportActionBar(b.toolbar)

        b.connectButton.setOnClickListener {
            when (session.state.value.status) {
                Status.CONNECTED -> session.disconnect()
                Status.CONNECTING -> session.cancelConnect()
                Status.DISCONNECTED -> session.connect(interactive = true)
            }
        }
        b.liveButton.setOnClickListener { PlayerActivity.startLive(this) }
        b.filesButton.setOnClickListener { startActivity(Intent(this, FilesActivity::class.java)) }
        b.settingsButton.setOnClickListener {
            startActivity(Intent(this, SettingsActivity::class.java))
        }

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch { session.state.collect(::render) }
                launch {
                    session.log.collect { lines ->
                        b.logText.text =
                            if (lines.isEmpty()) getString(R.string.log_empty) else lines.joinToString("\n")
                    }
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        // Already on the camera's Wi-Fi? Then connect straight away, without any dialog.
        if (session.state.value.status == Status.DISCONNECTED && !session.userDisconnected) {
            session.connect(interactive = false)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        if (isFinishing && session.isConnected) session.disconnect()
    }

    private fun render(s: CameraSession.State) {
        val connected = s.status == Status.CONNECTED
        b.statusTitle.setText(
            when (s.status) {
                Status.CONNECTED -> R.string.status_connected
                Status.CONNECTING -> R.string.status_connecting
                Status.DISCONNECTED -> R.string.status_disconnected
            }
        )
        b.statusDetail.text = if (connected) {
            val info = listOfNotNull(
                s.model,
                s.firmware?.let { getString(R.string.firmware_x, it) },
                s.recording?.let { getString(if (it) R.string.recording else R.string.not_recording) },
            ).joinToString(" · ")
            if (s.message.isNotEmpty() && s.message != "Forbundet") "$info\n${s.message}" else info
        } else {
            s.message
        }
        b.progress.isVisible = s.status == Status.CONNECTING || s.busy
        b.connectButton.setText(
            when (s.status) {
                Status.CONNECTED -> R.string.disconnect
                Status.CONNECTING -> R.string.cancel
                Status.DISCONNECTED -> R.string.connect
            }
        )
        b.liveButton.isEnabled = connected
        b.filesButton.isEnabled = connected
        b.helpCard.isVisible = !connected
        b.helpText.text = getString(R.string.help_text, session.prefs.ssidPrefix, session.prefs.wifiPassword)
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.main_menu, menu)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        when (item.itemId) {
            R.id.action_test -> runTest()
            R.id.action_wifi -> showWifiDialog()
            R.id.action_change_password -> showChangePasswordDialog()
            R.id.action_phone_wifi -> startActivity(Intent(Settings.ACTION_WIFI_SETTINGS))
            else -> return super.onOptionsItemSelected(item)
        }
        return true
    }

    /** Measures the camera and shows a report that can be shared (e.g. pasted to Claude). */
    private fun runTest() {
        if (!session.isConnected) {
            snack(getString(R.string.connect_first))
            return
        }
        lifecycleScope.launch {
            val report = try {
                session.runDiagnostics()
            } catch (e: CameraException) {
                snack(e.message ?: getString(R.string.error))
                return@launch
            }
            val text = TextView(this@MainActivity).apply {
                this.text = report
                setTextIsSelectable(true)
                typeface = Typeface.MONOSPACE
                textSize = 12f
                val pad = (20 * resources.displayMetrics.density).toInt()
                setPadding(pad, pad / 2, pad, 0)
            }
            MaterialAlertDialogBuilder(this@MainActivity)
                .setTitle(R.string.test_title)
                .setView(ScrollView(this@MainActivity).apply { addView(text) })
                .setPositiveButton(R.string.share) { _, _ ->
                    val send = Intent(Intent.ACTION_SEND)
                        .setType("text/plain")
                        .putExtra(Intent.EXTRA_TEXT, report)
                    startActivity(Intent.createChooser(send, getString(R.string.share)))
                }
                .setNegativeButton(R.string.close, null)
                .show()
        }
    }

    private fun showWifiDialog() {
        val v = DialogWifiBinding.inflate(layoutInflater)
        v.ssidInput.setText(session.prefs.ssidPrefix)
        v.passwordInput.setText(session.prefs.wifiPassword)
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.wifi_dialog_title)
            .setView(v.root)
            .setPositiveButton(R.string.save) { _, _ ->
                session.prefs.ssidPrefix = v.ssidInput.text?.toString().orEmpty()
                session.prefs.wifiPassword = v.passwordInput.text?.toString().orEmpty()
                render(session.state.value)
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun showChangePasswordDialog() {
        if (!session.isConnected) {
            snack(getString(R.string.connect_first))
            return
        }
        val v = DialogTextInputBinding.inflate(layoutInflater)
        v.message.setText(R.string.change_pw_message)
        v.inputLayout.hint = getString(R.string.change_pw_hint)
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.change_pw_title)
            .setView(v.root)
            .setPositiveButton(R.string.change) { _, _ ->
                val pw = v.input.text?.toString().orEmpty()
                if (!pw.matches(Regex("[A-Za-z0-9]{8,16}"))) {
                    snack(getString(R.string.change_pw_invalid))
                    return@setPositiveButton
                }
                lifecycleScope.launch {
                    try {
                        session.changeWifiPassword(pw)
                        snack(getString(R.string.change_pw_done))
                    } catch (e: CameraException) {
                        snack(e.message ?: getString(R.string.error))
                    }
                }
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun snack(text: String) {
        Snackbar.make(b.root, text, Snackbar.LENGTH_LONG).show()
    }
}
