package dk.dashcam.cam

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * Reads an MJPEG live stream (multipart HTTP, or just JPEGs back to back) and hands over each
 * JPEG frame. Some Novatek cameras offer this on port 8192 as an alternative to RTSP.
 */
object MjpegReader {
    private const val MAX_FRAME = 4 * 1024 * 1024

    /** Runs until the stream ends or the coroutine is cancelled. */
    suspend fun read(url: String, timeoutMs: Int = 5_000, onFrame: suspend (ByteArray) -> Unit) =
        withContext(Dispatchers.IO) {
            val conn = URL(url).openConnection() as HttpURLConnection
            conn.connectTimeout = timeoutMs
            conn.readTimeout = timeoutMs
            try {
                val input = BufferedInputStream(conn.inputStream, 64 * 1024)
                val frame = ByteArrayOutputStream(256 * 1024)
                var prev = -1
                var inFrame = false
                while (isActive) {
                    val b = input.read()
                    if (b < 0) break
                    if (!inFrame) {
                        if (prev == 0xFF && b == 0xD8) {
                            inFrame = true
                            frame.reset()
                            frame.write(0xFF)
                            frame.write(0xD8)
                        }
                    } else {
                        frame.write(b)
                        if (prev == 0xFF && b == 0xD9) {
                            inFrame = false
                            onFrame(frame.toByteArray())
                        } else if (frame.size() > MAX_FRAME) {
                            inFrame = false
                        }
                    }
                    prev = b
                }
            } finally {
                conn.disconnect()
            }
        }
}
