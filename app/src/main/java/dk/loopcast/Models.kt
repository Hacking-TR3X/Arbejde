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

    fun clear() {
        track = null
        contentUrl = null
    }
}
