package dk.spoegelsesjaeger

import dk.spoegelsesjaeger.Evidence.DOTS
import dk.spoegelsesjaeger.Evidence.EMF
import dk.spoegelsesjaeger.Evidence.FREEZING
import dk.spoegelsesjaeger.Evidence.ORB
import dk.spoegelsesjaeger.Evidence.SPIRIT_BOX
import dk.spoegelsesjaeger.Evidence.UV
import dk.spoegelsesjaeger.Evidence.WRITING
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class IdentifierTest {

    private fun names(state: TrackerState) = Identifier.possible(state).map { it.name }.toSet()

    private fun state(count: Int = 3, found: Set<Evidence> = emptySet(), ruledOut: Set<Evidence> = emptySet()) =
        TrackerState(
            evidenceCount = count,
            marks = found.associateWith { Mark.FOUND } + ruledOut.associateWith { Mark.RULED_OUT },
        )

    @Test
    fun dataIsConsistent() {
        assertEquals(30, Ghosts.all.size)
        assertEquals(Ghosts.all.size, Ghosts.all.map { it.name }.toSet().size)
        for (ghost in Ghosts.all) {
            assertEquals(ghost.name, 3, ghost.evidence.size)
            ghost.forced?.let { assertTrue(ghost.name, it in ghost.evidence) }
            ghost.fakeEvidence?.let { assertFalse(ghost.name, it in ghost.evidence) }
            assertTrue(ghost.name, ghost.copiesOthers || (ghost.speeds + ghost.fixedSpeeds).isNotEmpty())
            assertTrue(ghost.name, ghost.tells.isNotEmpty())
        }
        // Every ghost has its own evidence combination.
        assertEquals(Ghosts.all.size, Ghosts.all.map { it.evidence }.toSet().size)
    }

    @Test
    fun nothingMarkedMeansEveryGhostIsPossible() {
        for (count in 0..3) assertEquals(30, names(state(count)).size)
    }

    @Test
    fun threeEvidencesIdentifyOneGhost() {
        assertEquals(setOf("Banshee"), names(state(found = setOf(UV, ORB, DOTS))))
        assertEquals(setOf("Deildegast"), names(state(found = setOf(EMF, WRITING, DOTS))))
        assertEquals(setOf("Gallu"), names(state(found = setOf(EMF, UV, SPIRIT_BOX))))
    }

    @Test
    fun mimicShowsFakeOrbs() {
        // Kormos' three evidences are also a Mimic's three real ones plus its fake orbs.
        assertEquals(setOf("Kormos", "The Mimic"), names(state(found = setOf(ORB, SPIRIT_BOX, UV))))
        assertEquals(setOf("Kormos"), names(state(found = setOf(ORB, SPIRIT_BOX, UV), ruledOut = setOf(FREEZING))))
        assertEquals(setOf("The Mimic"), names(state(found = setOf(ORB, SPIRIT_BOX, UV, FREEZING))))
        assertEquals(setOf("The Mimic"), names(state(found = setOf(SPIRIT_BOX, UV, FREEZING))))
        // Orbs on a zero-evidence contract can only be the Mimic.
        assertEquals(setOf("The Mimic"), names(state(count = 0, found = setOf(ORB))))
        assertFalse("The Mimic" in names(state(count = 0, ruledOut = setOf(ORB))))
    }

    @Test
    fun hiddenEvidenceOnNightmare() {
        // On Nightmare a ruled-out evidence may just be the hidden one.
        assertTrue("Banshee" in names(state(count = 2, found = setOf(UV, ORB), ruledOut = setOf(DOTS))))
        assertFalse("Banshee" in names(state(count = 2, found = setOf(UV), ruledOut = setOf(ORB, DOTS))))
        assertEquals(
            setOf("Banshee", "Obake", "The Mimic", "Kormos"),
            names(state(count = 2, found = setOf(UV, ORB), ruledOut = setOf(DOTS))),
        )
        // Three found evidences can't happen on Nightmare (except with the Mimic's orbs).
        assertEquals(setOf("The Mimic"), names(state(count = 2, found = setOf(SPIRIT_BOX, UV, ORB))))
    }

    @Test
    fun forcedEvidence() {
        // Goryo always shows D.O.T.S. when evidence is reduced.
        assertFalse("Goryo" in names(state(count = 2, ruledOut = setOf(DOTS))))
        assertFalse("Goryo" in names(state(count = 1, found = setOf(EMF))))
        assertTrue("Goryo" in names(state(count = 1, found = setOf(DOTS))))
        // …but not on a zero-evidence contract, where nothing is shown.
        assertTrue("Goryo" in names(state(count = 0, ruledOut = setOf(DOTS))))
        assertFalse("Hantu" in names(state(count = 2, found = setOf(UV, ORB))))
        assertFalse("Deogen" in names(state(count = 1, found = setOf(WRITING))))
    }

    @Test
    fun stillUsefulGreysOutImpossibleEvidence() {
        val s = state(found = setOf(UV, ORB, DOTS))
        val candidates = Identifier.possible(s)
        assertFalse(Identifier.stillUseful(EMF, s, candidates))
        val open = state(found = setOf(SPIRIT_BOX, UV, ORB))
        assertTrue(Identifier.stillUseful(FREEZING, open, Identifier.possible(open)))
    }

    @Test
    fun speedAndBehaviourFilters() {
        val slow = TrackerState(speeds = setOf(SpeedClass.SLOW))
        val slowNames = names(slow)
        assertTrue("Revenant" in slowNames && "Aswang" in slowNames && "The Mimic" in slowNames)
        assertFalse("Spirit" in slowNames)

        val slowAndFast = TrackerState(speeds = setOf(SpeedClass.SLOW, SpeedClass.FAST))
        assertTrue("The Twins" in names(slowAndFast))
        assertFalse("Aswang" in names(slowAndFast))

        assertFalse("Mare" in names(TrackerState(observations = setOf(Observation.LIGHT_ON))))
        assertEquals(
            setOf("Demon", "The Mimic"),
            names(TrackerState(observations = setOf(Observation.SMUDGE_90))),
        )
        val veryEarly = names(TrackerState(observations = setOf(Observation.VERY_EARLY_HUNT)))
        assertEquals(setOf("Banshee", "Demon", "Yokai", "Onryo", "The Mimic", "Thaye", "Kormos"), veryEarly)
        assertFalse("Shade" in names(TrackerState(observations = setOf(Observation.EARLY_HUNT))))

        val struck = TrackerState().toggledStrike(Ghosts.byName("Oni")!!)
        assertEquals(Verdict.STRUCK_OUT, Identifier.verdict(Ghosts.byName("Oni")!!, struck))
    }

    @Test
    fun cyclingAndReset() {
        var s = TrackerState(evidenceCount = 2)
        s = s.cycled(EMF)
        assertEquals(Mark.FOUND, s.mark(EMF))
        s = s.cycled(EMF)
        assertEquals(Mark.RULED_OUT, s.mark(EMF))
        s = s.cycled(EMF)
        assertEquals(Mark.UNKNOWN, s.mark(EMF))
        s = s.cycled(UV).toggled(Observation.SALT)
        assertEquals(TrackerState(evidenceCount = 2), s.reset())
    }

    @Test
    fun footstepSpeed() {
        // 1.7 m/s ≈ 117 footsteps per minute.
        val interval = 60.0 / 116.9
        assertEquals(1.7, Footsteps.speed(interval), 0.01)
        assertEquals(3.4, Footsteps.speed(interval, ghostSpeedSetting = 0.5), 0.02)

        assertNull(Footsteps.averageInterval(listOf(0L, 500L)))
        assertEquals(0.5, Footsteps.averageInterval(listOf(0L, 500L, 1000L))!!, 1e-9)
        // Only the last five intervals count.
        assertEquals(0.5, Footsteps.averageInterval(listOf(0L, 5000L, 5500L, 6000L, 6500L, 7000L, 7500L))!!, 1e-9)

        val revenant = Ghosts.byName("Revenant")!!
        assertTrue(Footsteps.matches(revenant, 1.0, sawPlayer = false))
        assertFalse(Footsteps.matches(revenant, 1.7, sawPlayer = true))
        val spirit = Ghosts.byName("Spirit")!!
        assertFalse(Footsteps.matches(spirit, 2.5, sawPlayer = false))
        assertTrue(Footsteps.matches(spirit, 2.5, sawPlayer = true))
    }
}
