package dk.dashcam.cam

import java.util.Locale

/**
 * "Test forbindelsen": measures what the camera actually does (speed, file list, thumbnails,
 * range requests, MP4 layout, live-stream endpoints) and returns a plain-text report, so
 * problems can be pinned down without having the camera at hand.
 *
 * Every step is independent – one failing step never stops the rest.
 */
class CameraProbe(
    private val client: CameraClient,
    private val settleMs: Long = CameraClient.MODE_SETTLE_MS,
) {
    private val lines = ArrayList<String>()

    private fun line(text: String) {
        lines += text
    }

    private suspend fun step(name: String, block: suspend () -> Unit) {
        try {
            block()
        } catch (e: ConnectionLostException) {
            throw e
        } catch (e: Exception) {
            line("$name: FEJL – ${e.javaClass.simpleName}: ${e.message}")
        }
    }

    suspend fun run(): List<String> {
        lines.clear()
        var wasRecording = false

        step("Kamera") {
            val s = client.readSettings()
            wasRecording = client.isRecording()
            line("Kamera: ${s[Cmd.MODEL]} · firmware ${s[Cmd.FIRMWARE]} · optager: ${yes(wasRecording)}")
            line("Indstillinger: " + s.entries.joinToString(" ") { "${it.key}=${it.value}" })
        }

        var files: List<CamFile> = emptyList()
        step("Fil-liste") {
            val t = System.nanoTime()
            files = client.listFiles()
            val ms = (System.nanoTime() - t) / 1_000_000
            val byKind = files.groupingBy { it.kind }.eachCount()
            line(
                "Fil-liste: ${files.size} filer på ${secs(ms)} (inkl. skift til filtilstand) – " +
                    CamFile.Kind.values().joinToString(", ") { "${it.name.lowercase()} ${byKind[it] ?: 0}" }
            )
            files.firstOrNull()?.let { line("Eksempel på sti: ${it.path}") }
        }

        val video = files.filter { it.kind == CamFile.Kind.VIDEO }.maxByOrNull { it.time }
        if (video == null) {
            line("Ingen videoer at teste med.")
        } else {
            line("Testvideo: ${video.name} (${mb(video.size)})")
            val preview = files.firstOrNull { it.path != video.path && it.path == video.previewPath }
            line("Lille preview-kopi: ${preview?.let { "${it.name} (${mb(it.size)})" } ?: "nej"}")

            step("Miniature") {
                val t = System.nanoTime()
                val thumb = client.thumbnail(video)
                val ms = (System.nanoTime() - t) / 1_000_000
                line("Miniature: ${thumb?.let { "${it.size} bytes" } ?: "ingen"} på ${secs(ms)}")
            }

            step("Range") {
                val p = client.probeHttp(client.fileUrl(video), 2_048, range = "bytes=1000-1999")
                line(
                    "Range-forespørgsel: HTTP ${p.code}, ${p.body.size} bytes, " +
                        "Accept-Ranges=${p.headers["Accept-Ranges"] ?: "-"}, " +
                        "Content-Range=${p.headers["Content-Range"] ?: "-"}"
                )
            }

            step("Hastighed") {
                val want = minOf(video.size, SPEED_BYTES.toLong()).toInt()
                val p = client.probeHttp(client.fileUrl(video), want, timeoutMs = 15_000)
                val perSec = if (p.millis > 0) p.body.size * 1000.0 / p.millis else 0.0
                line(
                    "Hastighed: ${mb(p.body.size.toLong())} på ${secs(p.millis)} = " +
                        String.format(Locale.US, "%.2f MB/s", perSec / 1_000_000) +
                        " (hele filen ville tage ca. ${secs(if (perSec > 0) (video.size / perSec * 1000).toLong() else 0)})"
                )
                line("Content-Type: ${p.headers["Content-Type"] ?: "-"} · Content-Length: ${p.headers["Content-Length"] ?: "-"}")
                line("MP4: ${Mp4.describe(p.body, video.size)}")
            }
        }

        step("Tilbage til video") {
            client.ensureMode(CamMode.VIDEO, settleMs)
            if (wasRecording && !client.isRecording()) client.startRecording()
            line("Tilbage i videotilstand · optager: ${yes(client.isRecording())}")
        }

        step("Live-kommando") {
            line("Live-kommando 2015: ${if (client.startLiveStream()) "OK" else "afvist"}")
        }

        step("RTSP") {
            val answer = client.rtspDescribe()
            val interesting = answer.lines().filter {
                it.startsWith("RTSP/") || it.startsWith("m=") || it.startsWith("a=rtpmap") ||
                    it.startsWith("a=control") || it.startsWith("a=fmtp") || it.startsWith("Server", true)
            }
            line("RTSP ${client.liveUrl}: " + (if (interesting.isEmpty()) answer.take(200) else interesting.joinToString(" | ")))
        }

        for (url in client.mjpegUrls) {
            step("HTTP $url") {
                val p = client.probeHttp(url, 4_096, timeoutMs = 3_000)
                val jpeg = p.body.indices.any { i ->
                    i + 1 < p.body.size && p.body[i] == 0xFF.toByte() && p.body[i + 1] == 0xD8.toByte()
                }
                line(
                    "HTTP $url: ${p.code}, Content-Type=${p.headers["Content-Type"] ?: "-"}, " +
                        "${p.body.size} bytes, JPEG-billede fundet: ${yes(jpeg)}"
                )
            }
        }
        return lines.toList()
    }

    private fun yes(b: Boolean) = if (b) "ja" else "nej"

    companion object {
        const val SPEED_BYTES = 4 * 1024 * 1024

        fun secs(ms: Long): String = String.format(Locale.US, "%.1f s", ms / 1000.0)

        fun mb(bytes: Long): String = String.format(Locale.US, "%.1f MB", bytes / 1_000_000.0)
    }
}

/** Just enough MP4 parsing to tell whether a video can start playing before it is all loaded. */
object Mp4 {
    fun describe(head: ByteArray, fileSize: Long): String {
        val types = ArrayList<String>()
        var pos = 0L
        while (pos + 8 <= head.size) {
            val p = pos.toInt()
            var size = u32(head, p)
            val type = String(head, p + 4, 4, Charsets.ISO_8859_1)
            var header = 8
            if (size == 1L) {
                if (p + 16 > head.size) break
                size = u64(head, p + 8)
                header = 16
            } else if (size == 0L) {
                size = fileSize - pos
            }
            if (!type.all { it.isLetterOrDigit() || it == ' ' }) break
            types += type
            when (type) {
                "moov" -> return "moov ligger i starten (${types.joinToString()}) – kan afspilles mens den hentes"
                "mdat" -> return "moov ligger efter videodata (${types.joinToString()}) – afspilleren skal " +
                    "først hente slutningen af filen (fra byte ${pos + size})"
            }
            if (size < header) break
            pos += size
        }
        return "kunne ikke læse MP4-opbygningen (${types.joinToString().ifEmpty { "ingen bokse" }})"
    }

    private fun u32(b: ByteArray, p: Int): Long =
        ((b[p].toLong() and 0xFF) shl 24) or ((b[p + 1].toLong() and 0xFF) shl 16) or
            ((b[p + 2].toLong() and 0xFF) shl 8) or (b[p + 3].toLong() and 0xFF)

    private fun u64(b: ByteArray, p: Int): Long = (u32(b, p) shl 32) or u32(b, p + 4)
}
