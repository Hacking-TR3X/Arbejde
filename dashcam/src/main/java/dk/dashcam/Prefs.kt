package dk.dashcam

import android.content.Context

/** Small persistent settings for the app itself (not the camera). */
class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("dashcam", Context.MODE_PRIVATE)

    /** Start of the camera's Wi-Fi name; used to find it when Android has to join it. */
    var ssidPrefix: String
        get() = sp.getString("ssid_prefix", DEFAULT_SSID_PREFIX)?.takeIf { it.isNotBlank() }
            ?: DEFAULT_SSID_PREFIX
        set(value) = sp.edit().putString("ssid_prefix", value.trim()).apply()

    var wifiPassword: String
        get() = sp.getString("wifi_password", DEFAULT_PASSWORD) ?: DEFAULT_PASSWORD
        set(value) = sp.edit().putString("wifi_password", value).apply()

    /** Re-apply the remembered camera settings every time the app connects. */
    var autoFix: Boolean
        get() = sp.getBoolean("auto_fix", true)
        set(value) = sp.edit().putBoolean("auto_fix", value).apply()

    var setClock: Boolean
        get() = sp.getBoolean("set_clock", true)
        set(value) = sp.edit().putBoolean("set_clock", value).apply()

    /** Camera settings the user wants, as command number → value. */
    var wanted: Map<Int, Int>
        get() = sp.getString("wanted", "").orEmpty()
            .split(',')
            .mapNotNull { pair ->
                val (k, v) = pair.split('=').takeIf { it.size == 2 } ?: return@mapNotNull null
                val key = k.toIntOrNull() ?: return@mapNotNull null
                val value = v.toIntOrNull() ?: return@mapNotNull null
                key to value
            }
            .toMap()
        set(value) = sp.edit()
            .putString("wanted", value.entries.joinToString(",") { "${it.key}=${it.value}" })
            .apply()

    fun want(cmd: Int, value: Int?) {
        val map = wanted.toMutableMap()
        if (value == null) map.remove(cmd) else map[cmd] = value
        wanted = map
    }

    companion object {
        const val DEFAULT_SSID_PREFIX = "YI"
        const val DEFAULT_PASSWORD = "1234567890"
    }
}
