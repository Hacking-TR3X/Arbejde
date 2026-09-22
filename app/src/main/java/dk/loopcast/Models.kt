package dk.loopcast

import android.content.Context
import org.json.JSONObject

/** A SoundCloud link the user has saved in the app. */
data class SavedTrack(
    val url: String,
    val title: String?,
    val artist: String?,
    val artworkUrl: String?,
    val addedAt: Long,
)

/** A track resolved against SoundCloud's API, including a (temporary) stream URL. */
data class ResolvedTrack(
    val permalinkUrl: String,
    val title: String,
    val artist: String,
    val artworkUrl: String?,
    val durationMs: Long,
    /** Empty when the track is only available from the local cache. */
    val streamUrl: String,
    val isHls: Boolean,
    val resolvedAtMs: Long = System.currentTimeMillis(),
) {
    fun toJson(): JSONObject = JSONObject()
        .put("permalinkUrl", permalinkUrl)
        .put("title", title)
        .put("artist", artist)
        .put("artworkUrl", artworkUrl ?: "")
        .put("durationMs", durationMs)
        .put("streamUrl", streamUrl)
        .put("isHls", isHls)
        .put("resolvedAtMs", resolvedAtMs)

    companion object {
        fun fromJson(o: JSONObject): ResolvedTrack = ResolvedTrack(
            permalinkUrl = o.getString("permalinkUrl"),
            title = o.optString("title"),
            artist = o.optString("artist"),
            artworkUrl = o.optString("artworkUrl").takeIf { it.isNotEmpty() },
            durationMs = o.optLong("durationMs", 0L),
            streamUrl = o.optString("streamUrl"),
            isHls = o.optBoolean("isHls", false),
            resolvedAtMs = o.optLong("resolvedAtMs", 0L),
        )
    }
}

/**
 * What is currently being looped on the Nest. Lives in memory (survives activity
 * recreation) and is persisted so a restarted service can pick up where it left off.
 */
object PlaybackState {
    @Volatile var track: ResolvedTrack? = null
    @Volatile var contentUrl: String? = null
    /** MediaRouter route id of the cast device, used to reconnect automatically. */
    @Volatile var routeId: String? = null

    /** How many times the track has wrapped around since it was started. */
    @Volatile var loopCount: Int = 0
    @Volatile var lastProgressMs: Long = -1L
    /** Ignore wrap-around detection until this time (set after a manual seek). */
    @Volatile var suppressWrapUntilMs: Long = 0L

    fun startNew(newTrack: ResolvedTrack, url: String) {
        track = newTrack
        contentUrl = url
        loopCount = 0
        lastProgressMs = -1L
        suppressWrapUntilMs = 0L
    }

    fun clear() {
        track = null
        contentUrl = null
        loopCount = 0
        lastProgressMs = -1L
    }

    fun persist(context: Context) {
        val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val current = track
        if (current == null) {
            prefs.edit().clear().apply()
        } else {
            prefs.edit()
                .putString(KEY_TRACK, current.toJson().toString())
                .putString(KEY_ROUTE, routeId)
                .putInt(KEY_LOOPS, loopCount)
                .apply()
        }
    }

    /** Restores persisted state if nothing is loaded in memory. Returns true if a track is active. */
    fun restoreIfEmpty(context: Context): Boolean {
        if (track != null) return true
        val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY_TRACK, null) ?: return false
        return try {
            track = ResolvedTrack.fromJson(JSONObject(raw))
            routeId = prefs.getString(KEY_ROUTE, null)
            loopCount = prefs.getInt(KEY_LOOPS, 0)
            true
        } catch (e: Exception) {
            prefs.edit().clear().apply()
            false
        }
    }

    private const val PREFS = "playback"
    private const val KEY_TRACK = "track"
    private const val KEY_ROUTE = "route"
    private const val KEY_LOOPS = "loops"
}
