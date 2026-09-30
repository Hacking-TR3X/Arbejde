package dk.spoegelsesjaeger

import android.os.Looper
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.button.MaterialButton
import com.google.android.material.tabs.TabLayout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.fakes.RoboMenuItem
import org.robolectric.shadows.ShadowDialog
import java.time.Duration

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MainActivityTest {

    private fun launch() = Robolectric.buildActivity(MainActivity::class.java).setup().get()

    private fun ViewGroup.descendants(): Sequence<View> = sequence {
        for (i in 0 until childCount) {
            val child = getChildAt(i)
            yield(child)
            if (child is ViewGroup) yieldAll(child.descendants())
        }
    }

    private fun MainActivity.evidenceButton(label: String): MaterialButton =
        findViewById<ViewGroup>(R.id.evidenceGrid).descendants()
            .filterIsInstance<MaterialButton>()
            .first { it.text.toString().endsWith(label) }

    private fun MainActivity.result() = findViewById<TextView>(R.id.resultText).text.toString()

    private fun MainActivity.openTools() = findViewById<TabLayout>(R.id.tabs).getTabAt(1)!!.select()

    @Test
    fun marksEvidence() {
        val activity = launch()
        assertEquals("30 mulige spøgelser", activity.result())
        assertEquals(30, activity.findViewById<RecyclerView>(R.id.ghostList).adapter!!.itemCount)

        activity.evidenceButton("Ultraviolet").performClick()
        activity.evidenceButton("Ghost Orb").performClick()
        activity.evidenceButton("D.O.T.S.").performClick()
        assertEquals("Det er en Banshee!", activity.result())

        // A second tap rules the evidence out.
        activity.evidenceButton("D.O.T.S.").performClick()
        assertTrue(activity.evidenceButton("D.O.T.S.").text.startsWith("✗"))
        assertEquals("4 mulige spøgelser", activity.result())

        // Nightmare hides one evidence: the Banshee is back in play, the Hantu (always Freezing) is not.
        activity.findViewById<View>(R.id.count2).performClick()
        assertEquals("4 mulige spøgelser", activity.result())

        activity.onOptionsItemSelected(RoboMenuItem(R.id.action_reset))
        assertEquals("30 mulige spøgelser", activity.result())
    }

    @Test
    fun everyGhostHasDetails() {
        val activity = launch()
        for (ghost in Ghosts.all) {
            activity.showDetails(ghost)
            shadowOf(Looper.getMainLooper()).idle()
            val dialog = ShadowDialog.getLatestDialog()
            assertTrue(ghost.name, dialog.isShowing)
            dialog.dismiss()
        }
    }

    @Test
    fun smudgeTimerMarksDemon() {
        val activity = launch()
        activity.openTools()
        activity.findViewById<View>(R.id.smudgeStart).performClick()
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(65))
        assertEquals("1:05", activity.findViewById<TextView>(R.id.smudgeTime).text.toString())
        assertTrue(activity.findViewById<View>(R.id.smudgeHunted).isShown)

        activity.findViewById<View>(R.id.smudgeHunted).performClick()
        assertEquals("2 mulige spøgelser", activity.result())

        // The cooldown timer stops by itself once every ghost may hunt again.
        activity.findViewById<View>(R.id.cooldownStart).performClick()
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(30))
        assertEquals("0:25", activity.findViewById<TextView>(R.id.cooldownTime).text.toString())
    }

    @Test
    fun footstepsGiveSpeed() {
        val activity = launch()
        activity.openTools()
        val button = activity.findViewById<View>(R.id.tapButton)
        var time = SystemClock.uptimeMillis()
        repeat(6) {
            button.dispatchTouchEvent(MotionEvent.obtain(time, time, MotionEvent.ACTION_DOWN, 10f, 10f, 0))
            button.dispatchTouchEvent(MotionEvent.obtain(time, time + 50, MotionEvent.ACTION_UP, 10f, 10f, 0))
            time += 513
        }
        assertEquals("1,70 m/s", activity.findViewById<TextView>(R.id.tapSpeed).text.toString())
        assertTrue(activity.findViewById<TextView>(R.id.tapMatches).text.contains("Spirit"))
    }
}
