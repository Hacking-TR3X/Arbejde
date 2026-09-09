package dk.loopcast

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/** Persists the user's saved SoundCloud links (and a few settings) in SharedPreferences. */
class SavedTracksStore(context: Context) {

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences("loopcast", Context.MODE_PRIVATE)

    fun all(): List<SavedTrack> {
        val raw = prefs.getString(KEY_TRACKS, null) ?: return emptyList()
        return try {
            val array = JSONArray(raw)
            (0 until array.length()).map { i ->
                val o = array.getJSONObject(i)
                SavedTrack(
                    url = o.getString("url"),
                    title = o.optString("title").takeIf { it.isNotEmpty() },
                    artist = o.optString("artist").takeIf { it.isNotEmpty() },
                    artworkUrl = o.optString("artwork").takeIf { it.isNotEmpty() },
                    addedAt = o.optLong("addedAt", 0L),
                )
            }
        } catch (e: Exception) {
            emptyList()
        }
    }

    /** Inserts or replaces the entry with the same URL and moves it to the top. */
    fun upsert(track: SavedTrack) {
        val existing = all().filterNot { it.url.equals(track.url, ignoreCase = true) }
        save(listOf(track) + existing)
    }

    fun remove(url: String) {
        save(all().filterNot { it.url.equals(url, ignoreCase = true) })
    }

    private fun save(tracks: List<SavedTrack>) {
        val array = JSONArray()
        tracks.forEach { t ->
            array.put(
                JSONObject()
                    .put("url", t.url)
                    .put("title", t.title ?: "")
                    .put("artist", t.artist ?: "")
                    .put("artwork", t.artworkUrl ?: "")
                    .put("addedAt", t.addedAt)
            )
        }
        prefs.edit().putString(KEY_TRACKS, array.toString()).apply()
    }

    var lastUrl: String?
        get() = prefs.getString(KEY_LAST_URL, null)
        set(value) = prefs.edit().putString(KEY_LAST_URL, value).apply()

    /** When true the Nest gets SoundCloud's own stream URL instead of the local relay. */
    var directMode: Boolean
        get() = prefs.getBoolean(KEY_DIRECT_MODE, false)
        set(value) = prefs.edit().putBoolean(KEY_DIRECT_MODE, value).apply()

    private companion object {
        const val KEY_TRACKS = "tracks"
        const val KEY_LAST_URL = "last_url"
        const val KEY_DIRECT_MODE = "direct_mode"
    }
}
