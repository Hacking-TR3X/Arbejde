package dk.dashcam.cam

import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import java.io.ByteArrayOutputStream

class CameraClientTest {
    private lateinit var cam: FakeCamera
    private lateinit var client: CameraClient

    @Before
    fun setUp() {
        cam = FakeCamera()
        client = CameraClient("127.0.0.1", cam.httpPort, cam.heartbeatPort)
    }

    @After
    fun tearDown() {
        client.close()
        cam.close()
    }

    @Test
    fun parsesNovatekXml() {
        val files = CameraXml.parseFiles(
            "<LIST><ALLFile><File><NAME>a.MP4</NAME><FPATH>A:\\Movie\\a.MP4</FPATH>" +
                "<SIZE>10</SIZE><TIME>2019/11/04 12:00:00</TIME><ATTR>33</ATTR></File></ALLFile></LIST>"
        )
        assertEquals(1, files.size)
        assertEquals("/Movie/a.MP4", files[0].urlPath)
        assertTrue(files[0].readOnly)
        assertEquals("A:\\Movie_s\\a_s.MP4", files[0].previewPath)
        assertEquals(CamFile.Kind.PREVIEW, CamFile("x", "A:\\Movie_s\\a_s.MP4", 1, "", false).kind)
        assertEquals(CamFile.Kind.EMERGENCY, CamFile("x", "A:\\EMR\\a.MP4", 1, "", false).kind)
        assertEquals(CamFile.Kind.PHOTO, CamFile("x.JPG", "A:\\Photo\\x.JPG", 1, "", false).kind)

        val reply = CameraXml.parseReply(
            "<?xml version=\"1.0\" ?>\r\n<Function>\r\n<Cmd>2016</Cmd>\r\n<Status>0</Status>\r\n" +
                "<Value>1</Value>\r\n</Function>"
        )
        assertEquals(2016, reply.cmd)
        assertEquals("1", reply.text)
    }

    @Test
    fun customParameterComesFirstAndTextIsEncoded() {
        assertEquals(
            "http://127.0.0.1:${cam.httpPort}/?custom=1&cmd=3034&str=2026-11-04_12%3A07%3A00",
            client.url(cmd = 3034, str = "2026-11-04_12:07:00"),
        )
    }

    @Test
    fun commandsWithoutConnectionReportLostConnection() = runBlocking {
        try {
            client.readSettings()
            fail("expected ConnectionLostException")
        } catch (_: ConnectionLostException) {
        }
    }

    @Test
    fun connectReadsInfoAndSyncFixesSettingsWithoutLeavingRecordingOff() = runBlocking {
        client.connect()
        assertEquals(CamMode.VIDEO, client.mode)
        val settings = client.readSettings()
        assertEquals("YCS.1015.INT", settings[Cmd.MODEL])
        assertTrue(client.isRecording())

        // 9999 is unknown to the camera and must be skipped; 2031 is silently ignored by it.
        val wanted = mapOf(2003 to 1, 2007 to 0, 2002 to 1, 2031 to 1, 9999 to 1)
        val result = syncCamera(client, wanted, setClock = true, settleMs = 10)

        assertEquals(setOf(2003, 2007), result.changed.map { it.cmd }.toSet())
        assertEquals(listOf(2031), result.failed.map { it.cmd })
        assertTrue(result.clockSet)
        assertTrue(result.savedToFlash)
        assertEquals("1", cam.settings[2003])
        assertEquals("0", cam.settings[2007])
        assertNotNull(cam.clock)
        assertTrue("camera must record again", client.isRecording())
    }

    @Test
    fun syncWithNothingToChangeDoesNotInterruptRecording() = runBlocking {
        client.connect()
        val result = syncCamera(client, mapOf(2003 to 2), setClock = true, settleMs = 10)
        assertTrue(result.changed.isEmpty())
        assertTrue(result.clockSet)
        assertFalse(cam.commands.any { it.startsWith("2001=") })
    }

    @Test
    fun listsDownloadsAndDeletesFiles() = runBlocking {
        client.connect()
        val files = client.listFiles()
        assertEquals(CamMode.FILES, client.mode)
        assertEquals(5, files.size)

        val video = files.first { it.kind == CamFile.Kind.VIDEO && it.name.endsWith("001.MP4") }
        assertTrue(files.any { it.path == video.previewPath })
        assertNotNull(client.thumbnail(video))

        val out = ByteArrayOutputStream()
        var progress = 0L
        client.download(video, out) { done, _ -> progress = done }
        assertEquals(100_000, out.size())
        assertEquals(100_000L, progress)

        try {
            client.download(CamFile("nope.MP4", "A:\\Movie\\nope.MP4", 1, "", false), ByteArrayOutputStream()) { _, _ -> }
            fail("missing file must fail")
        } catch (_: CameraException) {
        }

        val emergency = files.first { it.kind == CamFile.Kind.EMERGENCY } // read-only → force delete
        client.delete(emergency)
        client.delete(video)
        val left = client.listFiles().map { it.name }
        assertFalse(emergency.name in left)
        assertFalse(video.name in left)
        assertFalse("preview copy deleted too", "2019_1104_120000_001_s.MP4" in left)
    }

    @Test
    fun disconnectTellsTheCamera() = runBlocking {
        client.connect()
        client.disconnect()
        assertFalse(client.connected)
        assertFalse(cam.connected)
    }
}
