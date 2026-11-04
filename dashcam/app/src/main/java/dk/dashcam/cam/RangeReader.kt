package dk.dashcam.cam

import java.io.Closeable
import java.io.IOException

class RangeNotSupportedException : CameraException("Kameraet kan ikke sende dele af en fil")

/**
 * Random access to a file on the camera through HTTP Range requests, with a small block
 * cache. Lets Android's video tools (MediaExtractor / MediaMetadataRetriever) read just the
 * parts of a recording they need – e.g. the index at the end plus a few seconds of video –
 * instead of the whole file.
 *
 * Blocking; meant to be called from a background thread.
 */
class RangeReader(
    private val client: CameraClient,
    private val url: String,
    val fileSize: Long,
    private val blockSize: Int = 512 * 1024,
    private val maxBlocks: Int = 16,
    private val onFetched: (Long) -> Unit = {},
) : Closeable {
    private val blocks = object : LinkedHashMap<Long, ByteArray>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Long, ByteArray>?): Boolean =
            size > maxBlocks
    }

    /** Bytes actually transferred from the camera so far. */
    @Volatile
    var bytesFetched = 0L
        private set

    /** The last error, so callers can tell *why* Android's video tools gave up. */
    @Volatile
    var lastError: Exception? = null
        private set

    @Volatile
    private var closed = false

    /** Copies up to [length] bytes at [position] into [buffer]. Returns the count, or -1 at the end. */
    @Synchronized
    fun readAt(position: Long, buffer: ByteArray, offset: Int, length: Int): Int {
        if (position >= fileSize || length <= 0) return if (length <= 0) 0 else -1
        var done = 0
        var pos = position
        try {
            while (done < length && pos < fileSize) {
                val index = pos / blockSize
                val block = blocks[index] ?: fetch(index).also { blocks[index] = it }
                val inBlock = (pos - index * blockSize).toInt()
                if (inBlock >= block.size) break
                val n = minOf(length - done, block.size - inBlock)
                System.arraycopy(block, inBlock, buffer, offset + done, n)
                done += n
                pos += n
            }
        } catch (e: Exception) {
            lastError = e
            throw if (e is IOException) e else IOException(e.message, e)
        }
        return if (done == 0) -1 else done
    }

    private fun fetch(index: Long): ByteArray {
        if (closed) throw IOException("Læseren er lukket")
        val from = index * blockSize
        val to = minOf(fileSize, from + blockSize) - 1
        val bytes = try {
            client.fetchRange(url, from, to)
        } catch (e: IOException) {
            client.fetchRange(url, from, to) // one retry – the camera's Wi-Fi drops packets
        }
        bytesFetched += bytes.size
        onFetched(bytesFetched)
        return bytes
    }

    override fun close() {
        closed = true
        synchronized(this) { blocks.clear() }
    }
}
