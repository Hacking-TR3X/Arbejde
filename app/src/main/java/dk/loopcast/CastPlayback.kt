package dk.loopcast

import android.content.Context
import android.net.Uri
import android.util.Log
import com.google.android.gms.cast.HlsSegmentFormat
import com.google.android.gms.cast.MediaInfo
import com.google.android.gms.cast.MediaLoadRequestData
import com.google.android.gms.cast.MediaMetadata
import com.google.android.gms.cast.MediaQueueData
import com.google.android.gms.cast.MediaQueueItem
import com.google.android.gms.cast.MediaStatus
import com.google.android.gms.cast.framework.CastContext
import com.google.android.gms.cast.framework.media.RemoteMediaClient
import com.google.android.gms.common.images.WebImage

/** Shared helpers for (re)loading the current track on the receiver. */
object CastPlayback {

    private const val TAG = "CastPlayback"

    /**
     * The URL the receiver should play right now. In relay mode this is recomputed each
     * time so a changed phone IP is picked up automatically.
     */
    fun contentUrl(context: Context, track: ResolvedTrack): String? {
        val store = SavedTracksStore(context)
        val relay = StreamProxyServer.get(context)
        val cached = TrackCache(context).has(StreamProxyServer.keyFor(track.permalinkUrl))
        return if (store.directMode && !cached) {
            track.streamUrl.takeIf { it.isNotEmpty() }
        } else {
            relay.register(track)
        }
    }

    /** Loads the current track as a one-item queue set to repeat forever. Returns false if nothing to load. */
    fun load(context: Context, client: RemoteMediaClient): Boolean {
        val track = PlaybackState.track ?: return false
        val url = contentUrl(context, track) ?: run {
            Log.w(TAG, "No content url available for ${track.title}")
            return false
        }
        PlaybackState.contentUrl = url
        Log.i(TAG, "Loading $url on receiver")
        client.load(buildRequest(context, track, url))
        return true
    }

    fun buildRequest(context: Context, track: ResolvedTrack, contentUrl: String): MediaLoadRequestData {
        val metadata = MediaMetadata(MediaMetadata.MEDIA_TYPE_MUSIC_TRACK).apply {
            putString(MediaMetadata.KEY_TITLE, track.title)
            putString(MediaMetadata.KEY_ARTIST, track.artist)
            track.artworkUrl?.let { addImage(WebImage(Uri.parse(it))) }
        }
        // Only the direct-mode HLS case is really HLS; the relay always serves plain MP3.
        val isHlsUrl = track.isHls && contentUrl == track.streamUrl
        val infoBuilder = MediaInfo.Builder(contentUrl)
            .setStreamType(MediaInfo.STREAM_TYPE_BUFFERED)
            .setContentType(if (isHlsUrl) "application/x-mpegURL" else "audio/mpeg")
            .setMetadata(metadata)
        if (track.durationMs > 0) infoBuilder.setStreamDuration(track.durationMs)
        if (isHlsUrl) infoBuilder.setHlsSegmentFormat(HlsSegmentFormat.MP3)

        val item = MediaQueueItem.Builder(infoBuilder.build())
            .setAutoplay(true)
            .build()
        val queue = MediaQueueData.Builder()
            .setItems(listOf(item))
            .setRepeatMode(MediaStatus.REPEAT_MODE_REPEAT_SINGLE)
            .setStartIndex(0)
            .build()
        return MediaLoadRequestData.Builder()
            .setQueueData(queue)
            .setAutoplay(true)
            .build()
    }

    /** User pressed Stop: forget the track, stop the receiver and shut the relay down. */
    fun stopEverything(context: Context) {
        PlaybackState.clear()
        PlaybackState.persist(context)
        try {
            CastContext.getSharedInstance(context).sessionManager.currentCastSession?.remoteMediaClient?.stop()
        } catch (e: Exception) {
            Log.w(TAG, "Could not stop receiver", e)
        }
        ProxyService.stop(context)
    }
}
