package dk.dashcam

import android.graphics.Bitmap
import android.media.MediaCodec
import android.media.MediaDataSource
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.media.MediaMuxer
import android.os.Build
import dk.dashcam.cam.CamFile
import dk.dashcam.cam.CameraClient
import dk.dashcam.cam.CameraException
import dk.dashcam.cam.RangeReader
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import java.io.File
import java.io.IOException
import java.nio.ByteBuffer

/** Lets Android's video tools read a file on the camera through [RangeReader]. */
class CameraMediaDataSource(private val reader: RangeReader) : MediaDataSource() {
    override fun readAt(position: Long, buffer: ByteArray, offset: Int, size: Int): Int =
        reader.readAt(position, buffer, offset, size)

    override fun getSize(): Long = reader.fileSize

    override fun close() = reader.close()
}

/** Makes a thumbnail from the video itself when the camera can't deliver one. */
object ThumbnailMaker {
    private const val WIDTH = 320
    private const val HEIGHT = 180

    /** Blocking. Reads only the MP4 index and the first key frame (a few hundred KB). */
    fun fromVideo(client: CameraClient, file: CamFile): Bitmap? {
        val reader = RangeReader(client, client.fileUrl(file), file.size, blockSize = 256 * 1024, maxBlocks = 8)
        val retriever = MediaMetadataRetriever()
        return try {
            retriever.setDataSource(CameraMediaDataSource(reader))
            val frame = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                retriever.getScaledFrameAtTime(1_000_000, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, WIDTH, HEIGHT)
            } else {
                retriever.getFrameAtTime(1_000_000, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
            }
            frame?.let { scale(it) }
        } catch (e: Exception) {
            null
        } finally {
            runCatching { retriever.release() }
            reader.close()
        }
    }

    fun scale(bitmap: Bitmap): Bitmap {
        if (bitmap.width <= WIDTH) return bitmap
        val h = (bitmap.height * WIDTH.toFloat() / bitmap.width).toInt().coerceAtLeast(1)
        return Bitmap.createScaledBitmap(bitmap, WIDTH, h, true)
    }
}

/**
 * Cuts a piece out of a recording without re-encoding: copies the video and audio samples
 * between two times into a new MP4. With a [RangeReader] source only that piece (plus the
 * file's index) is transferred from the camera.
 */
object ClipExporter {
    private const val MAX_SAMPLE = 4 * 1024 * 1024

    /** Copies [startUs]..[endUs] of [source] into [out]. [progress] gets 0..1. */
    suspend fun export(
        source: MediaDataSource?,
        sourcePath: String?,
        startUs: Long,
        endUs: Long,
        out: File,
        progress: (Float) -> Unit,
    ) {
        val extractor = MediaExtractor()
        var muxer: MediaMuxer? = null
        try {
            if (source != null) extractor.setDataSource(source) else extractor.setDataSource(sourcePath!!)
            val m = MediaMuxer(out.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            muxer = m
            val trackMap = HashMap<Int, Int>()
            var videoTrack = -1
            var bufferSize = 1024 * 1024
            for (i in 0 until extractor.trackCount) {
                val format = extractor.getTrackFormat(i)
                val mime = format.getString(MediaFormat.KEY_MIME) ?: continue
                if (!mime.startsWith("video/") && !mime.startsWith("audio/")) continue
                val outTrack = try {
                    m.addTrack(format)
                } catch (e: Exception) {
                    continue // a codec MP4 can't hold (e.g. raw PCM sound) – leave it out
                }
                trackMap[i] = outTrack
                extractor.selectTrack(i)
                if (mime.startsWith("video/") && videoTrack < 0) {
                    videoTrack = i
                    if (format.containsKey(MediaFormat.KEY_ROTATION)) {
                        m.setOrientationHint(format.getInteger(MediaFormat.KEY_ROTATION))
                    }
                }
                if (format.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) {
                    bufferSize = maxOf(bufferSize, format.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE))
                }
            }
            if (videoTrack < 0) throw CameraException("Fandt ingen video i filen")
            m.start()

            extractor.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
            val buffer = ByteBuffer.allocate(minOf(maxOf(bufferSize, 2 * 1024 * 1024), MAX_SAMPLE))
            val info = MediaCodec.BufferInfo()
            var firstUs = -1L
            val ended = HashSet<Int>()
            var written = 0
            while (true) {
                currentCoroutineContext().ensureActive()
                val track = extractor.sampleTrackIndex
                if (track < 0) break
                val time = extractor.sampleTime
                if (time > endUs) {
                    ended += track
                    if (ended.size >= trackMap.size) break
                    extractor.advance()
                    continue
                }
                if (track == videoTrack && firstUs < 0) firstUs = time
                if (firstUs < 0 || time < firstUs) {
                    extractor.advance() // sound from before the first video key frame
                    continue
                }
                info.offset = 0
                info.size = extractor.readSampleData(buffer, 0)
                if (info.size < 0) break
                info.presentationTimeUs = time - firstUs
                info.flags = if (extractor.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0) {
                    MediaCodec.BUFFER_FLAG_KEY_FRAME
                } else {
                    0
                }
                m.writeSampleData(trackMap.getValue(track), buffer, info)
                written++
                if (track == videoTrack) {
                    progress(((time - startUs).toFloat() / (endUs - startUs).coerceAtLeast(1)).coerceIn(0f, 1f))
                }
                extractor.advance()
            }
            if (written == 0) throw CameraException("Klippet blev tomt")
            m.stop()
            progress(1f)
        } catch (e: IOException) {
            throw CameraException("Kunne ikke læse videoen: ${e.message}", e)
        } finally {
            runCatching { muxer?.release() }
            extractor.release()
        }
    }
}
