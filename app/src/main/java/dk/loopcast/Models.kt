package dk.loopcast

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
    val streamUrl: String,
    val isHls: Boolean,
    val resolvedAtMs: Long = System.currentTimeMillis(),
)

/** What is currently being looped on the Nest. Survives activity recreation. */
object PlaybackState {
    @Volatile var track: ResolvedTrack? = null
    @Volatile var contentUrl: String? = null

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
}
