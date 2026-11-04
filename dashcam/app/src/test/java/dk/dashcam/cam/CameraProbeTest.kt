package dk.dashcam.cam

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CameraProbeTest {

    @Test
    fun reportCoversEveryStepAndLeavesCameraRecording() = runBlocking {
        FakeCamera().use { cam ->
            val client = CameraClient("127.0.0.1", cam.httpPort, cam.heartbeatPort, cam.rtspPort)
            try {
                client.connect()
                val report = CameraProbe(client, settleMs = 10).run()
                val text = report.joinToString("\n")
                println(text)

                assertTrue(text, report.any { it.startsWith("Kamera: YCS.1015.INT") })
                assertTrue(text, report.any { it.startsWith("Fil-liste: 5 filer") })
                assertTrue(text, report.any { it == "Testvideo: 2019_1104_120300_002.MP4 (0.2 MB)" })
                assertTrue(text, report.any { it == "Lille preview-kopi: nej" })
                assertTrue(text, report.any { it.startsWith("Miniature: 7 bytes") })
                assertTrue(text, report.any { it.startsWith("Range-forespørgsel: HTTP 206, 1000 bytes") })
                assertTrue(text, report.any { it.startsWith("Hastighed: ") })
                assertTrue(text, report.any { it.startsWith("MP4: moov ligger efter videodata") })
                assertTrue(text, report.any { it == "Tilbage i videotilstand · optager: ja" })
                assertTrue(text, report.any { it == "Live-kommando 2015: OK" })
                assertTrue(text, report.any { it.contains("RTSP/1.0 200 OK") && it.contains("H264/90000") })
                assertEquals(1, cam.recording)
            } finally {
                client.close()
            }
        }
    }

    @Test
    fun mp4LayoutIsRecognised() {
        fun box(length: Int, type: String) = byteArrayOf(
            (length ushr 24).toByte(), (length ushr 16).toByte(), (length ushr 8).toByte(), length.toByte()
        ) + type.toByteArray()

        val fastStart = box(24, "ftyp") + ByteArray(16) + box(100, "moov")
        assertTrue(Mp4.describe(fastStart, 1000).startsWith("moov ligger i starten"))

        val moovLast = box(24, "ftyp") + ByteArray(16) + box(900, "mdat")
        assertTrue(Mp4.describe(moovLast, 1000).startsWith("moov ligger efter videodata"))

        assertTrue(Mp4.describe(ByteArray(64) { 0x55 }, 64).startsWith("kunne ikke læse"))
    }
}
