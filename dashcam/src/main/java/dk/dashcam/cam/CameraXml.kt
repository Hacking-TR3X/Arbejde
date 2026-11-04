package dk.dashcam.cam

/** A file on the camera's SD card, as listed by [Cmd.FILE_LIST]. */
data class CamFile(
    val name: String,
    /** Path as the camera reports it, e.g. `A:\Movie\2019_1104_120000_001.MP4`. */
    val path: String,
    val size: Long,
    /** `yyyy/MM/dd HH:mm:ss` – sorts correctly as plain text. */
    val time: String,
    val readOnly: Boolean,
) {
    enum class Kind { VIDEO, EMERGENCY, PHOTO, PREVIEW }

    /** Path to use in URLs: drive letter removed and backslashes turned into slashes. */
    val urlPath: String
        get() {
            val noDrive = if (path.length >= 2 && path[1] == ':') path.substring(2) else path
            val slashed = noDrive.replace('\\', '/')
            return if (slashed.startsWith("/")) slashed else "/$slashed"
        }

    private val folder: String
        get() = path.replace('\\', '/').substringBeforeLast('/', "").substringAfterLast('/')

    val isPhoto: Boolean get() = name.endsWith(".jpg", ignoreCase = true)

    val kind: Kind
        get() = when {
            folder.endsWith("_s", ignoreCase = true) -> Kind.PREVIEW
            path.contains("emr", ignoreCase = true) || path.contains("event", ignoreCase = true) -> Kind.EMERGENCY
            isPhoto -> Kind.PHOTO
            else -> Kind.VIDEO
        }

    /** The camera keeps a small low-resolution copy of loop recordings in a `…_s` folder. */
    val previewPath: String
        get() = PREVIEW_RE.replace(path, "$1_s$2_s$3")

    private companion object {
        val PREVIEW_RE = Regex("^(.+movie)(.+)(\\..{3})$", RegexOption.IGNORE_CASE)
    }
}

/**
 * Tolerant parsing of the camera's XML answers. Regular expressions instead of a real XML
 * parser, because cheap camera firmware does not always produce well-formed XML.
 */
object CameraXml {
    class Reply(val cmd: Int?, val status: Int?, val value: String?, val string: String?) {
        /** The most useful payload: `<String>`, else `<Value>`, else `<Status>`. */
        val text: String? get() = string ?: value ?: status?.toString()
    }

    private val PAIR_RE = Regex(
        "<Cmd>\\s*(-?\\d+)\\s*</Cmd>\\s*<Status>(.*?)</Status>",
        RegexOption.DOT_MATCHES_ALL,
    )
    private val FILE_RE = Regex("<File>(.*?)</File>", RegexOption.DOT_MATCHES_ALL)

    fun tag(xml: String, name: String): String? =
        Regex("<$name>(.*?)</$name>", RegexOption.DOT_MATCHES_ALL).find(xml)
            ?.groupValues?.get(1)?.trim()?.let(::unescape)

    fun parseReply(xml: String): Reply = Reply(
        cmd = tag(xml, "Cmd")?.toIntOrNull(),
        status = tag(xml, "Status")?.toIntOrNull(),
        value = tag(xml, "Value"),
        string = tag(xml, "String"),
    )

    /** Answer to [Cmd.ALL_SETTINGS]: a flat list of `<Cmd>nr</Cmd><Status>value</Status>` pairs. */
    fun parseSettings(xml: String): Map<Int, String> {
        val out = LinkedHashMap<Int, String>()
        for (m in PAIR_RE.findAll(xml)) {
            out[m.groupValues[1].toInt()] = unescape(m.groupValues[2].trim())
        }
        return out
    }

    fun parseFiles(xml: String): List<CamFile> = FILE_RE.findAll(xml).mapNotNull { m ->
        val block = m.groupValues[1]
        val path = tag(block, "FPATH") ?: return@mapNotNull null
        CamFile(
            name = tag(block, "NAME") ?: path.substringAfterLast('\\'),
            path = path,
            size = tag(block, "SIZE")?.toLongOrNull() ?: 0L,
            time = tag(block, "TIME") ?: "",
            readOnly = ((tag(block, "ATTR")?.toIntOrNull() ?: 0) and 1) == 1,
        )
    }.toList()

    fun unescape(s: String): String = s
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}
