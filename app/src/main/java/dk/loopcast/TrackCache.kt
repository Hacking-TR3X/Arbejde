package dk.loopcast

import android.content.Context
import android.util.Log
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.io.IOException

/**
 * Downloads the MP3 for a track once and keeps it on the phone. The relay then serves
 * the local file, so an overnight loop never depends on SoundCloud or on expiring
 * stream URLs.
 */
class TrackCache(context: Context) {

    private val dir = File(context.applicationContext.filesDir, "tracks").apply { mkdirs() }

    fun fileFor(key: String): File = File(dir, "$key.mp3")

    fun has(key: String): Boolean = fileFor(key).let { it.isFile && it.length() > MIN_BYTES }

    fun delete(key: String) {
        fileFor(key).delete()
        File(dir, "$key.part").delete()
    }

    /** Removes cached files that belong to none of the given keys. */
    fun prune(keepKeys: Set<String>) {
        dir.listFiles()?.forEach { file ->
            val key = file.name.substringBefore('.')
            if (key !in keepKeys) file.delete()
        }
    }

    /**
     * Downloads the track unless it is already cached. [onProgress] receives 0–100, or -1
     * when the total size is unknown.
     */
    @Throws(IOException::class)
    fun download(track: ResolvedTrack, http: OkHttpClient, onProgress: (Int) -> Unit): File {
        val key = StreamProxyServer.keyFor(track.permalinkUrl)
        val target = fileFor(key)
        if (has(key)) return target
        if (track.streamUrl.isEmpty()) throw IOException("Ingen stream-URL at hente fra")

        val part = File(dir, "$key.part")
        part.delete()
        try {
            if (track.isHls) downloadHls(track.streamUrl, http, part, onProgress)
            else downloadProgressive(track.streamUrl, http, part, onProgress)
            if (part.length() < MIN_BYTES) throw IOException("Den hentede fil er for lille (${part.length()} bytes)")
            if (!part.renameTo(target)) throw IOException("Kunne ikke gemme tracket lokalt")
            Log.i(TAG, "Cached ${track.title} (${target.length()} bytes)")
            return target
        } finally {
            part.delete()
        }
    }

    private fun downloadProgressive(url: String, http: OkHttpClient, out: File, onProgress: (Int) -> Unit) {
        http.newCall(request(url)).execute().use { response ->
            if (!response.isSuccessful) throw IOException("SoundCloud svarede ${response.code} ved download")
            val body = response.body ?: throw IOException("Tomt svar ved download")
            val total = body.contentLength()
            var done = 0L
            var lastPercent = -2
            body.byteStream().use { input ->
                FileOutputStream(out).use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        output.write(buffer, 0, read)
                        done += read
                        val percent = if (total > 0) (done * 100 / total).toInt() else -1
                        if (percent != lastPercent) {
                            lastPercent = percent
                            onProgress(percent)
                        }
                    }
                }
            }
        }
    }

    /** SoundCloud's MP3 HLS segments are plain MPEG audio, so concatenating them gives a valid MP3. */
    private fun downloadHls(playlistUrl: String, http: OkHttpClient, out: File, onProgress: (Int) -> Unit) {
        val (base, playlist) = http.newCall(request(playlistUrl)).execute().use { response ->
            if (!response.isSuccessful) throw IOException("SoundCloud svarede ${response.code} ved hentning af playliste")
            response.request.url to (response.body?.string() ?: "")
        }
        val segments = playlist.lines()
            .map { it.trim() }
            .filter { it.isNotEmpty() && !it.startsWith("#") }
            .map { base.resolve(it)?.toString() ?: it }
        if (segments.isEmpty()) throw IOException("Playlisten indeholder ingen lydsegmenter")

        FileOutputStream(out).use { output ->
            segments.forEachIndexed { index, segmentUrl ->
                var attempt = 0
                while (true) {
                    try {
                        http.newCall(request(segmentUrl)).execute().use { response ->
                            if (!response.isSuccessful) throw IOException("Segment ${index + 1} svarede ${response.code}")
                            response.body?.byteStream()?.copyTo(output) ?: throw IOException("Tomt segment")
                        }
                        break
                    } catch (e: IOException) {
                        if (++attempt >= 3) throw e
                    }
                }
                onProgress((index + 1) * 100 / segments.size)
            }
        }
    }

    private fun request(url: String): Request = Request.Builder()
        .url(url.toHttpUrl())
        .header("User-Agent", "LoopCast/1.0")
        .header("Accept", "*/*")
        .get()
        .build()

    private companion object {
        const val TAG = "TrackCache"
        const val MIN_BYTES = 64L * 1024L
    }
}
