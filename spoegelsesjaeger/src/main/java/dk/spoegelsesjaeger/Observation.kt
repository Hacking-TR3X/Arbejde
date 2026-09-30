package dk.spoegelsesjaeger

/**
 * Something the player can see or measure during a contract that rules ghosts out
 * regardless of how much evidence the difficulty gives.
 *
 * [fits] returns true when the ghost is still possible after the player saw this.
 */
enum class Observation(val label: String, val detail: String, val fits: (Ghost) -> Boolean) {
    LIGHT_ON(
        "Spøgelset tændte et lys",
        "Mare tænder aldrig lyset.",
        excluding("Mare"),
    ),
    BREAKER_ON(
        "Spøgelset tændte for strømmen",
        "Hantu tænder aldrig for strømmen i sikringsskabet.",
        excluding("Hantu"),
    ),
    BREAKER_OFF(
        "Spøgelset slukkede selv strømmen",
        "Jinn slukker aldrig selv sikringsskabet. Strømsvigt fordi for mange lys er tændt tæller ikke.",
        excluding("Jinn"),
    ),
    SALT(
        "Spøgelset trådte i salt",
        "Wraith rører aldrig salt.",
        excluding("Wraith"),
    ),
    MIST(
        "Tåge-event (spøgelset pustede en sky)",
        "Oni og Kormos laver aldrig tåge-eventet.",
        excluding("Oni", "Kormos"),
    ),
    PHOTO(
        "Spøgelset forsvandt ikke, da du fotograferede det",
        "Phantom forsvinder altid, når den bliver fotograferet.",
        excluding("Phantom"),
    ),
    DOTS_EYES(
        "D.O.T.S.-silhuet set direkte (ikke på kamera)",
        "Goryo kan kun ses i D.O.T.S. gennem et kamera, når ingen er i rummet.",
        excluding("Goryo"),
    ),
    ROOM_CHANGE(
        "Spøgelset skiftede favoritrum",
        "Goryo skifter aldrig favoritrum.",
        excluding("Goryo"),
    ),
    FOOTSTEPS_FAR(
        "Jagt-skridt hørt mere end ca. 12 m væk",
        "En Mylings skridt kan kun høres tæt på under jagter.",
        excluding("Myling"),
    ),
    HIDING_KILL(
        "Nogen blev dræbt i et skjulested",
        "Aswang kan ikke dræbe spillere, der gemmer sig i skabe, garderober og telte.",
        excluding("Aswang"),
    ),
    MALE_NAME(
        "Spøgelset har et mandenavn",
        "Banshee og Dayan har altid et kvindenavn (se kønsikonet i dagbogen).",
        excluding("Banshee", "Dayan"),
    ),
    SMUDGE_180(
        "Jagt under 180 s efter røgelse",
        "Røgelse holder en Spirit væk i 180 s. Brug smudge-timeren under Værktøjer.",
        excluding("Spirit"),
    ),
    SMUDGE_90(
        "Jagt under 90 s efter røgelse",
        "Kun en Demon kan jage så hurtigt efter røgelse (60 s). Jagter fra forbandede genstande tæller ikke.",
        only("Demon"),
    ),
    FAST_COOLDOWN(
        "Ny jagt under 25 s efter forrige jagt",
        "Kun en Demon har kortere pause mellem jagter (20 s). Jagter fra forbandede genstande tæller ikke.",
        only("Demon"),
    ),
    EARLY_HUNT(
        "Jagt over 50 % gennemsnitlig sanity",
        "Kun spøgelser der kan jage tidligt. Jagter fra forbandede genstande tæller ikke.",
        { it.huntsAtAnySanity || it.maxHuntSanity > 50 },
    ),
    VERY_EARLY_HUNT(
        "Jagt ved 70 % gennemsnitlig sanity eller mere",
        "Kun spøgelser der kan jage meget tidligt. Jagter fra forbandede genstande tæller ikke.",
        { it.huntsAtAnySanity || it.maxHuntSanity >= 70 },
    ),
    OBAKE_PRINT(
        "Seks-fingret håndaftryk eller formskifte under jagt",
        "Det kan kun en Obake.",
        only("Obake"),
    ),
}

/** Rules out the named ghosts. The Mimic is never named, so it is never ruled out by behaviour. */
private fun excluding(vararg names: String): (Ghost) -> Boolean = { it.name !in names }

/** Keeps only the named ghosts – plus the Mimic, which can copy them. */
private fun only(vararg names: String): (Ghost) -> Boolean = { it.copiesOthers || it.name in names }
