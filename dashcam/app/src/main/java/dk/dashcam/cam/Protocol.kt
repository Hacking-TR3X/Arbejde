package dk.dashcam.cam

/**
 * Command numbers understood by the YI Smart Dash Camera (YCS.1015).
 *
 * The camera runs Novatek firmware: every command is a plain HTTP GET to
 * `http://192.168.1.254/?custom=1&cmd=<nr>[&par=<int>][&str=<text>]` and the answer is a
 * tiny XML document. The numbers come from the reverse-engineered `yidashcam` Python library
 * (github.com/kwirk/yidashcam) plus the standard Novatek command table.
 */
object Cmd {
    const val TAKE_PHOTO = 1001
    const val RECORD = 2001 // par=1 start, par=0 stop
    const val RECORDING_STATE = 2016
    const val VIDEO_PHOTO = 2017
    const val EMERGENCY_CLIP = 2019
    const val MODE = 3001
    const val SET_WIFI_PASSWORD = 3004
    const val FIRMWARE = 3012
    const val ALL_SETTINGS = 3014
    const val FILE_LIST = 3015
    const val SAVE_SETTINGS = 3021
    const val SET_CLOCK = 3034
    const val MODEL = 3035
    const val SERIAL = 3037
    const val THUMBNAIL = 4001
    const val DELETE = 4003
    const val FORCE_DELETE = 4009
    const val CONNECT = 8001
    const val DISCONNECT = 8002
}

enum class CamMode(val par: Int) { PHOTO(0), VIDEO(1), FILES(2) }

class Choice(val value: Int, val label: String)

class SettingDef(val cmd: Int, val label: String, val choices: List<Choice>) {
    fun labelFor(value: Int?): String = when (value) {
        null -> "?"
        else -> choices.firstOrNull { it.value == value }?.label ?: "Ukendt ($value)"
    }
}

/** The settings the camera reports in [Cmd.ALL_SETTINGS] and accepts as `cmd=<nr>&par=<value>`. */
object CamSettings {
    private val onOff = listOf(Choice(1, "Til"), Choice(0, "Fra"))

    val ALL: List<SettingDef> = listOf(
        SettingDef(
            2002, "Videokvalitet", listOf(
                Choice(1, "1080p, 60 fps"),
                Choice(0, "1080p, 30 fps"),
                Choice(2, "2304×1296, 30 fps"),
                Choice(3, "720p, 30 fps"),
            )
        ),
        SettingDef(
            2003, "Længde på hvert klip", listOf(
                Choice(1, "3 minutter"),
                Choice(2, "5 minutter"),
                Choice(3, "10 minutter"),
            )
        ),
        SettingDef(2007, "Optag lyd", onOff),
        SettingDef(2008, "Dato og tid i videoen", onOff),
        SettingDef(
            2011, "Stødsensor (gemmer nødklip ved stød)", listOf(
                Choice(0, "Lav"),
                Choice(1, "Mellem"),
                Choice(2, "Høj"),
            )
        ),
        SettingDef(2012, "Start optagelse automatisk", onOff),
        SettingDef(
            2005, "Eksponering", listOf(
                Choice(12, "−2"), Choice(11, "−5/3"), Choice(10, "−4/3"), Choice(9, "−1"),
                Choice(8, "−2/3"), Choice(7, "−1/3"), Choice(6, "0 (automatisk)"),
                Choice(5, "+1/3"), Choice(4, "+2/3"), Choice(3, "+1"), Choice(2, "+4/3"),
                Choice(1, "+5/3"), Choice(0, "+2"),
            )
        ),
        SettingDef(2031, "Vognbane- og afstandsadvarsel (ADAS)", onOff),
        SettingDef(2040, "YI-logo i videoen", onOff),
        SettingDef(
            3033, "Sluk skærmen efter", listOf(
                Choice(0, "Aldrig"),
                Choice(1, "1 minut"),
                Choice(2, "5 minutter"),
                Choice(3, "10 minutter"),
            )
        ),
        SettingDef(2050, "Vis ur når skærmen er slukket", onOff),
        SettingDef(2051, "Lyd ved tænd/sluk", onOff),
        SettingDef(3041, "Knaplyde", onOff),
        SettingDef(3044, "Kørselsrapport", onOff),
        SettingDef(
            1002, "Billedopløsning", listOf(
                Choice(0, "4032×3024"), Choice(1, "3648×2736"), Choice(2, "3264×2448"),
                Choice(3, "2592×1944"), Choice(4, "2048×1536"), Choice(7, "1920×1080"),
                Choice(6, "1280×960"), Choice(5, "640×480"),
            )
        ),
        SettingDef(
            3008, "Sprog på kameraet", listOf(
                Choice(0, "Engelsk"), Choice(4, "Tysk"), Choice(1, "Fransk"), Choice(2, "Spansk"),
                Choice(3, "Portugisisk"), Choice(5, "Italiensk"), Choice(8, "Russisk"),
                Choice(9, "Japansk"), Choice(6, "Kinesisk (forenklet)"),
                Choice(7, "Kinesisk (traditionelt)"),
            )
        ),
    )

    fun byCmd(cmd: Int): SettingDef? = ALL.firstOrNull { it.cmd == cmd }
}
