package dk.dashcam.cam

import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import java.io.IOException

class RangeReaderTest {
    private lateinit var cam: FakeCamera
    private lateinit var client: CameraClient
    private val path = "A:\\Movie\\2019_1104_120300_002.MP4" // 200 000 bytes in the fake camera

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
    fun readsArbitraryPartsAndOnlyFetchesWhatIsNeeded() {
        val expected = cam.fakeMp4(200_000)
        val reader = RangeReader(client, client.fileUrl(path), 200_000, blockSize = 16_384, maxBlocks = 4)

        // The end of the file first (where the MP4 index sits), then the start.
        val tail = ByteArray(100)
        assertEquals(100, reader.readAt(199_900, tail, 0, 100))
        assertArrayEquals(expected.copyOfRange(199_900, 200_000), tail)

        val across = ByteArray(40_000) // spans three blocks
        assertEquals(40_000, reader.readAt(10_000, across, 0, 40_000))
        assertArrayEquals(expected.copyOfRange(10_000, 50_000), across)

        assertTrue("only a few blocks fetched: ${reader.bytesFetched}", reader.bytesFetched < 100_000)
        assertEquals(-1, reader.readAt(200_000, tail, 0, 10))

        val short = ByteArray(500)
        assertEquals(100, reader.readAt(199_900, short, 0, 500))
    }

    @Test
    fun detectsCamerasWithoutRangeSupport() = runBlocking {
        val url = client.fileUrl(path)
        assertTrue(client.supportsRange(url))
        cam.rangeSupported = false
        assertFalse(client.supportsRange(url))

        val reader = RangeReader(client, url, 200_000, blockSize = 16_384)
        val buf = ByteArray(10)
        assertEquals(10, reader.readAt(0, buf, 0, 10)) // the first block still works
        try {
            reader.readAt(150_000, buf, 0, 10)
            fail("expected an error")
        } catch (_: IOException) {
        }
        assertTrue(reader.lastError is RangeNotSupportedException)
    }
}
