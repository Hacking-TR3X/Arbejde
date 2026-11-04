package dk.dashcam.cam

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test
import java.net.InetAddress
import java.net.ServerSocket
import kotlin.concurrent.thread

class MjpegReaderTest {

    @Test
    fun splitsMultipartStreamIntoJpegFrames() = runBlocking {
        val frame1 = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 1, 2, 3, 0xFF.toByte(), 0xD9.toByte())
        val frame2 = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 9, 0xFF.toByte(), 0x00, 8, 0xFF.toByte(), 0xD9.toByte())
        val server = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
        thread(isDaemon = true) {
            server.accept().use { s ->
                s.getInputStream().read(ByteArray(1024))
                val out = s.getOutputStream()
                out.write(
                    "HTTP/1.1 200 OK\r\nContent-Type: multipart/x-mixed-replace; boundary=frame\r\n\r\n".toByteArray()
                )
                for (f in listOf(frame1, frame2)) {
                    out.write("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${f.size}\r\n\r\n".toByteArray())
                    out.write(f)
                    out.write("\r\n".toByteArray())
                }
                out.flush()
            }
        }
        val frames = ArrayList<ByteArray>()
        MjpegReader.read("http://127.0.0.1:${server.localPort}/") { frames += it }
        server.close()
        assertEquals(2, frames.size)
        assertArrayEquals(frame1, frames[0])
        assertArrayEquals(frame2, frames[1])
    }
}
