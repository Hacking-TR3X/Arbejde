package dk.spoegelsesjaeger

/** The seven kinds of evidence, in the same order as the in-game journal. */
enum class Evidence(val label: String, val short: String, val howTo: String) {
    EMF(
        "EMF 5", "EMF",
        "EMF-måleren når niveau 5, når spøgelset interagerer med noget.",
    ),
    DOTS(
        "D.O.T.S.", "DOTS",
        "Spøgelsets silhuet bevæger sig gennem D.O.T.S.-projektorens grønne prikker – ofte kun synligt på kamera.",
    ),
    UV(
        "Ultraviolet", "UV",
        "Fingeraftryk eller fodspor lyser op i UV-lys. Tjek døre, kontakter, vinduer og tastaturer.",
    ),
    ORB(
        "Ghost Orb", "Orb",
        "Små lysende kugler svæver rundt i spøgelsesrummet på et videokamera med night vision.",
    ),
    WRITING(
        "Ghost Writing", "Skrift",
        "Spøgelset skriver eller tegner i spøgelsesbogen, når den ligger i spøgelsesrummet.",
    ),
    SPIRIT_BOX(
        "Spirit Box", "Spirit",
        "Spøgelset svarer i spirit boxen. Sluk lyset og stil spørgsmål i spøgelsesrummet.",
    ),
    FREEZING(
        "Freezing", "Frost",
        "Termometeret viser under 0 °C i spøgelsesrummet.",
    ),
}

/** What the player has concluded about one piece of evidence. */
enum class Mark { UNKNOWN, FOUND, RULED_OUT }

/** Rough hunt-speed buckets a player can tell apart by ear, before line-of-sight acceleration. */
enum class SpeedClass(val label: String) {
    SLOW("Langsom"),
    NORMAL("Normal"),
    FAST("Hurtig");

    companion object {
        fun of(speed: Double): SpeedClass = when {
            speed < 1.6 -> SLOW
            speed <= 1.8 -> NORMAL
            else -> FAST
        }
    }
}
