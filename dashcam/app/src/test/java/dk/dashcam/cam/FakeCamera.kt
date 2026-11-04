package dk.dashcam.cam

import java.io.BufferedInputStream
import java.io.IOException
import java.io.InputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import kotlin.concurrent.thread

/**
 * A strict imitation of the YI Smart Dash Camera's Novatek protocol, for tests:
 * - every command except 8001 needs a live heartbeat, otherwise Status -256
 * - `custom=1` must be the first query parameter
 * - settings can't be changed while recording, the file list only works in file mode
 * - setting 2031 is accepted but silently ignored (like a buggy firmware)
 *
 * Uses a tiny hand-written HTTP server on plain sockets, because Android unit tests compile
 * against android.jar, which lacks the JDK's com.sun.net.httpserver.
 */
class FakeCamera : AutoCloseable {
    class FakeFile(val name: String, val path: String, val size: Int, val time: String, val attr: Int)

    private val loopback = InetAddress.getByName("127.0.0.1")
    private val http = ServerSocket(0, 50, loopback)
    private val heartbeat = ServerSocket(0, 5, loopback)

    val httpPort: Int get() = http.localPort
    val heartbeatPort: Int get() = heartbeat.localPort

    @Volatile var connected = false
    @Volatile private var lastHeartbeat = 0L
    var mode = 1
    var recording = 1
    var clock: String? = null
    var saved = false
    val commands = ArrayList<String>()

    val settings = linkedMapOf(
        1002 to "0", 2002 to "1", 2003 to "2", 2005 to "6", 2007 to "1", 2008 to "1",
        2011 to "1", 2012 to "1", 2031 to "0", 3033 to "0",
        3012 to "YCS1015_V3.0.4", 3035 to "YCS.1015.INT", 3037 to "CA31YBUSCR1946044418",
    )

    val files = mutableListOf(
        FakeFile("2019_1104_120000_001.MP4", "A:\\Movie\\2019_1104_120000_001.MP4", 100_000, "2019/11/04 12:00:00", 32),
        FakeFile("2019_1104_120000_001_s.MP4", "A:\\Movie_s\\2019_1104_120000_001_s.MP4", 2_000, "2019/11/04 12:00:00", 32),
        FakeFile("2019_1104_120300_002.MP4", "A:\\Movie\\2019_1104_120300_002.MP4", 200_000, "2019/11/04 12:03:00", 32),
        FakeFile("2019_1104_120100_003.MP4", "A:\\EMR\\2019_1104_120100_003.MP4", 4_096, "2019/11/04 12:01:00", 33),
        FakeFile("2019_1104_120200_004.JPG", "A:\\Photo\\2019_1104_120200_004.JPG", 512, "2019/11/04 12:02:00", 32),
    )

    init {
        acceptLoop(http) { serveHttp(it) }
        acceptLoop(heartbeat) { serveHeartbeat(it) }
    }

    private fun acceptLoop(server: ServerSocket, handler: (Socket) -> Unit) {
        thread(isDaemon = true) {
            while (!server.isClosed) {
                val socket = try {
                    server.accept()
                } catch (e: IOException) {
                    break
                }
                thread(isDaemon = true) {
                    try {
                        handler(socket)
                    } catch (_: IOException) {
                    } finally {
                        runCatching { socket.close() }
                    }
                }
            }
        }
    }

    private fun serveHeartbeat(socket: Socket) {
        val buf = ByteArray(64)
        val input = socket.getInputStream()
        while (true) {
            val n = input.read(buf)
            if (n < 0) return
            if (String(buf, 0, n).startsWith("02:001:0")) lastHeartbeat = System.currentTimeMillis()
        }
    }

    private fun serveHttp(socket: Socket) {
        val input = BufferedInputStream(socket.getInputStream())
        val requestLine = readLine(input) ?: return
        while (true) {
            val header = readLine(input) ?: break
            if (header.isEmpty()) break
        }
        val target = requestLine.split(' ').getOrNull(1) ?: "/"
        val (type, body) = handle(target)
        val out = socket.getOutputStream()
        out.write(
            ("HTTP/1.1 200 OK\r\nContent-Type: $type\r\nContent-Length: ${body.size}\r\n" +
                "Connection: close\r\n\r\n").toByteArray()
        )
        out.write(body)
        out.flush()
    }

    private fun readLine(input: InputStream): String? {
        val sb = StringBuilder()
        while (true) {
            val c = input.read()
            if (c < 0) return if (sb.isEmpty()) null else sb.toString()
            if (c == '\n'.code) return sb.toString().trimEnd('\r')
            sb.append(c.toChar())
        }
    }

    private fun xml(cmd: Int, status: Int, extra: String = "") =
        "<?xml version=\"1.0\" encoding=\"UTF-8\" ?>\r\n<Function>\r\n<Cmd>$cmd</Cmd>\r\n" +
            "<Status>$status</Status>\r\n$extra</Function>\r\n"

    @Synchronized
    private fun handle(target: String): Pair<String, ByteArray> {
        val path = target.substringBefore('?')
        val query = target.substringAfter('?', "")
        if (query.isEmpty()) {
            val file = files.firstOrNull { it.path.substring(2).replace('\\', '/') == path }
                ?: return "text/html" to
                    "<html><head><title>Page not found</title></head></html>".toByteArray()
            return "video/mp4" to ByteArray(file.size) { (it % 256).toByte() }
        }
        val params: List<Pair<String, String>> = query.split('&').map { part ->
            val key = part.substringBefore('=')
            val value = URLDecoder.decode(part.substringAfter('=', ""), "UTF-8")
            key to value
        }
        if (params.first() != ("custom" to "1")) return "text/xml" to xml(-1, -999).toByteArray()
        val q: Map<String, String> = params.toMap()
        val cmd = q.getValue("cmd").toInt()
        val par = q["par"]?.toInt()
        val str = q["str"]
        commands += if (par != null) "$cmd=$par" else "$cmd"

        val reply: String = when {
            cmd == 8001 -> {
                connected = true
                lastHeartbeat = System.currentTimeMillis()
                xml(cmd, 0)
            }
            !connected || System.currentTimeMillis() - lastHeartbeat > 15_000 -> {
                connected = false
                xml(cmd, -256)
            }
            cmd == 8002 -> {
                connected = false
                xml(cmd, 0)
            }
            cmd == 3001 -> {
                mode = par!!
                if (mode != 1) recording = 0
                xml(cmd, 0)
            }
            cmd == 2016 -> xml(cmd, 0, "<Value>$recording</Value>\r\n")
            cmd == 2001 -> if (mode != 1) xml(cmd, -21) else {
                recording = par!!
                xml(cmd, 0)
            }
            cmd == 3014 -> buildString {
                append("<?xml version=\"1.0\" encoding=\"UTF-8\" ?>\r\n<Function>\r\n")
                for ((k, v) in settings) append("<Cmd>$k</Cmd>\r\n<Status>$v</Status>\r\n")
                append("</Function>\r\n")
            }
            cmd == 3034 -> {
                clock = str
                xml(cmd, 0)
            }
            cmd == 3021 -> {
                saved = true
                xml(cmd, 0)
            }
            cmd == 3015 -> if (mode != 2) xml(cmd, -22) else buildString {
                append("<?xml version=\"1.0\" encoding=\"UTF-8\" ?>\r\n<LIST>\r\n")
                for (f in files) {
                    append("<ALLFile><File>\r\n<NAME>${f.name}</NAME>\r\n<FPATH>${f.path}</FPATH>\r\n")
                    append("<SIZE>${f.size}</SIZE>\r\n<TIMECODE>1</TIMECODE>\r\n<TIME>${f.time}</TIME>\r\n")
                    append("<ATTR>${f.attr}</ATTR></File>\r\n</ALLFile>\r\n")
                }
                append("</LIST>\r\n")
            }
            cmd == 4003 || cmd == 4009 -> {
                val f = files.firstOrNull { it.path == str }
                when {
                    f == null -> xml(cmd, -11)
                    (f.attr and 1) == 1 && cmd == 4003 -> xml(cmd, -12)
                    else -> {
                        files.remove(f)
                        xml(cmd, 0)
                    }
                }
            }
            cmd == 4001 -> return "image/jpeg" to byteArrayOf(-1, -40, -1, -32, 1, 2, 3)
            cmd == 2019 -> xml(cmd, 0)
            cmd == 2017 -> xml(cmd, if (recording == 1) 0 else -5)
            settings.containsKey(cmd) -> when {
                recording == 1 -> xml(cmd, -22)
                cmd == 2031 -> xml(cmd, 0) // accepted, but ignored
                else -> {
                    settings[cmd] = par.toString()
                    xml(cmd, 0)
                }
            }
            else -> xml(cmd, -3)
        }
        return "text/xml" to reply.toByteArray()
    }

    override fun close() {
        http.close()
        heartbeat.close()
    }
}
