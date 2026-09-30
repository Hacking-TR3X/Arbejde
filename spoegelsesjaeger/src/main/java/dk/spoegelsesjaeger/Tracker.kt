package dk.spoegelsesjaeger

/** Everything the player has marked during the current contract. */
data class TrackerState(
    /** How many evidences the difficulty shows: 3 (Amateur–Professional), 2 (Nightmare), 1 (Insanity), 0. */
    val evidenceCount: Int = 3,
    val marks: Map<Evidence, Mark> = emptyMap(),
    /** Hunt speeds heard during this contract; the ghost must be able to move at every one of them. */
    val speeds: Set<SpeedClass> = emptySet(),
    val observations: Set<Observation> = emptySet(),
    /** Ghosts the player has struck out by hand. */
    val struckOut: Set<String> = emptySet(),
) {
    fun mark(evidence: Evidence): Mark = marks[evidence] ?: Mark.UNKNOWN

    val found: Set<Evidence> get() = marks.filterValues { it == Mark.FOUND }.keys
    val ruledOut: Set<Evidence> get() = marks.filterValues { it == Mark.RULED_OUT }.keys

    fun withMark(evidence: Evidence, mark: Mark) = copy(marks = marks + (evidence to mark))

    /** UNKNOWN → FOUND → RULED_OUT → UNKNOWN. */
    fun cycled(evidence: Evidence): TrackerState = withMark(
        evidence,
        when (mark(evidence)) {
            Mark.UNKNOWN -> Mark.FOUND
            Mark.FOUND -> Mark.RULED_OUT
            Mark.RULED_OUT -> Mark.UNKNOWN
        },
    )

    fun toggled(speed: SpeedClass) = copy(speeds = speeds.toggle(speed))
    fun toggled(observation: Observation) = copy(observations = observations.toggle(observation))
    fun toggledStrike(ghost: Ghost) = copy(struckOut = struckOut.toggle(ghost.name))

    /** A fresh contract keeps the chosen difficulty. */
    fun reset() = TrackerState(evidenceCount = evidenceCount)
}

private fun <T> Set<T>.toggle(item: T): Set<T> = if (item in this) this - item else this + item

/** Why a ghost is not (or is) still a candidate. */
enum class Verdict { POSSIBLE, EVIDENCE, SPEED, BEHAVIOUR, STRUCK_OUT }

object Identifier {

    /**
     * True if the ghost can show every found evidence and none of the ruled-out ones on a
     * difficulty that shows [count] of its three evidences.
     */
    fun evidenceFits(ghost: Ghost, count: Int, found: Set<Evidence>, ruledOut: Set<Evidence>): Boolean {
        val shownCount = count.coerceIn(0, ghost.evidence.size)
        val required = if (shownCount > 0) setOfNotNull(ghost.forced) else emptySet()
        return subsets(ghost.evidence.toList(), shownCount).any { shown ->
            val visible = shown + setOfNotNull(ghost.fakeEvidence)
            shown.containsAll(required) && visible.containsAll(found) && visible.none { it in ruledOut }
        }
    }

    fun verdict(ghost: Ghost, state: TrackerState): Verdict = when {
        !evidenceFits(ghost, state.evidenceCount, state.found, state.ruledOut) -> Verdict.EVIDENCE
        !state.speeds.all { it in ghost.speedClasses } -> Verdict.SPEED
        !state.observations.all { it.fits(ghost) } -> Verdict.BEHAVIOUR
        ghost.name in state.struckOut -> Verdict.STRUCK_OUT
        else -> Verdict.POSSIBLE
    }

    fun possible(state: TrackerState, ghosts: List<Ghost> = Ghosts.all): List<Ghost> =
        ghosts.filter { verdict(it, state) == Verdict.POSSIBLE }

    /**
     * True if finding [evidence] would still leave at least one candidate – i.e. the evidence is
     * worth testing for. Evidence that no remaining ghost can show is greyed out in the UI.
     */
    fun stillUseful(evidence: Evidence, state: TrackerState, candidates: List<Ghost>): Boolean =
        candidates.any { evidenceFits(it, state.evidenceCount, state.found + evidence, state.ruledOut) }

    private fun <T> subsets(items: List<T>, size: Int): List<Set<T>> {
        if (size == 0) return listOf(emptySet())
        if (items.size < size) return emptyList()
        val head = items.first()
        val tail = items.drop(1)
        return subsets(tail, size - 1).map { it + head } + subsets(tail, size)
    }
}

/** Converts tapped footsteps to a ghost speed, using the same model as the Zero-Network tracker. */
object Footsteps {

    /** Extra time per step the game adds on top of the distance travelled (seconds). */
    private const val STEP_OFFSET = 0.075

    /** Speed in m/s from the average time between footsteps, scaled back from the lobby's ghost-speed setting. */
    fun speed(intervalSeconds: Double, ghostSpeedSetting: Double = 1.0): Double =
        1.0 / (ghostSpeedSetting * (intervalSeconds + STEP_OFFSET))

    fun bpm(intervalSeconds: Double): Double = 60.0 / intervalSeconds

    /**
     * Average of the most recent intervals between taps (ms timestamps, oldest first).
     * Returns null until there are at least two intervals.
     */
    fun averageInterval(tapTimesMs: List<Long>, window: Int = 5): Double? {
        val intervals = tapTimesMs.zipWithNext { a, b -> (b - a) / 1000.0 }.takeLast(window)
        return if (intervals.size < 2) null else intervals.average()
    }

    /**
     * True if the ghost can move at [measured] m/s. With [sawPlayer] the ghost's line-of-sight
     * speed-up (up to +65 %) is allowed too.
     */
    fun matches(ghost: Ghost, measured: Double, sawPlayer: Boolean, tolerance: Double = 0.1): Boolean {
        if (ghost.copiesOthers) return true
        fun near(low: Double, high: Double) = measured >= low - tolerance && measured <= high + tolerance
        return ghost.speeds.any { near(it, if (sawPlayer) it * 1.65 else it) } ||
            ghost.fixedSpeeds.any { near(it, it) }
    }
}
