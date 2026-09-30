package dk.spoegelsesjaeger

import android.content.res.ColorStateList
import android.graphics.Color
import android.os.Bundle
import android.view.Menu
import android.view.MenuItem
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.Space
import android.widget.TextView
import androidx.activity.viewModels
import androidx.annotation.ColorRes
import androidx.annotation.StringRes
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.isVisible
import androidx.core.view.updatePadding
import androidx.recyclerview.widget.LinearLayoutManager
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.button.MaterialButton
import com.google.android.material.checkbox.MaterialCheckBox
import com.google.android.material.chip.Chip
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.snackbar.Snackbar
import com.google.android.material.tabs.TabLayout
import dk.spoegelsesjaeger.databinding.ActivityMainBinding
import dk.spoegelsesjaeger.databinding.DialogGhostBinding

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private val model: HuntViewModel by viewModels()
    private lateinit var adapter: GhostAdapter
    private lateinit var tools: ToolsPage
    private lateinit var speedChips: Map<SpeedClass, Chip>
    private val evidenceButtons = linkedMapOf<Evidence, MaterialButton>()
    private val observationBoxes = linkedMapOf<Observation, MaterialCheckBox>()
    private val countButtons = mapOf(3 to R.id.count3, 2 to R.id.count2, 1 to R.id.count1, 0 to R.id.count0)
    private val difficultyHints = mapOf(
        3 to R.string.difficulty_3,
        2 to R.string.difficulty_2,
        1 to R.string.difficulty_1,
        0 to R.string.difficulty_0,
    )

    /** True while views are updated from the state, so their listeners don't write it back. */
    private var rendering = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            view.updatePadding(left = bars.left, top = bars.top, right = bars.right, bottom = bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
        setSupportActionBar(binding.toolbar)

        setUpEvidence()
        setUpBehaviour()
        adapter = GhostAdapter(
            onClick = ::showDetails,
            onLongClick = { update(model.state.toggledStrike(it)) },
        )
        binding.tracker.ghostList.layoutManager = LinearLayoutManager(this)
        binding.tracker.ghostList.adapter = adapter
        tools = ToolsPage(this, binding.tools, model, ::update)
        setUpTabs()

        applyKeepScreenOn()
        render()
    }

    override fun onDestroy() {
        tools.release()
        super.onDestroy()
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.main_menu, menu)
        menu.findItem(R.id.action_keep_screen_on).isChecked = model.keepScreenOn
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean = when (item.itemId) {
        R.id.action_reset -> {
            val before = model.state
            update(before.reset())
            Snackbar.make(binding.root, R.string.reset_done, Snackbar.LENGTH_LONG)
                .setAction(R.string.undo) { update(before) }
                .show()
            true
        }
        R.id.action_keep_screen_on -> {
            model.keepScreenOn = !model.keepScreenOn
            item.isChecked = model.keepScreenOn
            applyKeepScreenOn()
            true
        }
        R.id.action_about -> {
            MaterialAlertDialogBuilder(this)
                .setTitle(R.string.app_name)
                .setMessage(R.string.about_text)
                .setPositiveButton(R.string.close, null)
                .show()
            true
        }
        else -> super.onOptionsItemSelected(item)
    }

    /** Stores a new tracker state and redraws everything that depends on it. */
    fun update(state: TrackerState) {
        if (state == model.state) return
        model.state = state
        render()
    }

    private fun setUpTabs() {
        binding.tabs.addOnTabSelectedListener(object : TabLayout.OnTabSelectedListener {
            override fun onTabSelected(tab: TabLayout.Tab) = showPage(tab.position)
            override fun onTabUnselected(tab: TabLayout.Tab) = Unit
            override fun onTabReselected(tab: TabLayout.Tab) = Unit
        })
        binding.tabs.getTabAt(model.page)?.select()
        showPage(model.page)
    }

    private fun showPage(page: Int) {
        model.page = page
        binding.tracker.root.isVisible = page == 0
        binding.tools.root.isVisible = page == 1
        if (page == 1) tools.render()
    }

    private fun setUpEvidence() {
        Evidence.entries.chunked(2).forEach { pair ->
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            pair.forEach { evidence ->
                val button = MaterialButton(this, null, com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
                    isAllCaps = false
                    setOnClickListener { update(model.state.cycled(evidence)) }
                    setOnLongClickListener {
                        showEvidenceHelp(evidence)
                        true
                    }
                }
                row.addView(button, halfWidth())
                evidenceButtons[evidence] = button
            }
            if (pair.size == 1) row.addView(Space(this), halfWidth())
            binding.tracker.evidenceGrid.addView(row, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        }
        binding.tracker.evidenceCountGroup.addOnButtonCheckedListener { _, checkedId, isChecked ->
            if (rendering || !isChecked) return@addOnButtonCheckedListener
            val count = countButtons.entries.first { it.value == checkedId }.key
            update(model.state.copy(evidenceCount = count))
        }
    }

    private fun halfWidth() = LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f).apply {
        marginStart = dp(4)
        marginEnd = dp(4)
    }

    private fun setUpBehaviour() {
        val t = binding.tracker
        t.behaviourHeader.setOnClickListener {
            model.behaviourExpanded = !model.behaviourExpanded
            renderBehaviourHeader()
        }
        speedChips = mapOf(
            SpeedClass.SLOW to t.speedSlow,
            SpeedClass.NORMAL to t.speedNormal,
            SpeedClass.FAST to t.speedFast,
        )
        speedChips.forEach { (speed, chip) ->
            chip.setOnCheckedChangeListener { _, checked ->
                if (rendering) return@setOnCheckedChangeListener
                val speeds = model.state.speeds
                update(model.state.copy(speeds = if (checked) speeds + speed else speeds - speed))
            }
        }
        Observation.entries.forEach { observation ->
            val box = MaterialCheckBox(this).apply {
                text = observation.label
                setOnCheckedChangeListener { _, checked ->
                    if (rendering) return@setOnCheckedChangeListener
                    val seen = model.state.observations
                    update(model.state.copy(observations = if (checked) seen + observation else seen - observation))
                }
            }
            val detail = TextView(this).apply {
                text = observation.detail
                setTextAppearance(com.google.android.material.R.style.TextAppearance_Material3_BodySmall)
                setTextColor(color(R.color.text_secondary))
                setPadding(dp(32), 0, 0, dp(8))
                setOnClickListener { box.toggle() }
            }
            t.observationList.addView(box)
            t.observationList.addView(detail)
            observationBoxes[observation] = box
        }
    }

    private fun render() {
        val state = model.state
        val candidates = Identifier.possible(state)
        val t = binding.tracker

        rendering = true
        t.evidenceCountGroup.check(countButtons.getValue(state.evidenceCount))
        t.difficultyHint.setText(difficultyHints.getValue(state.evidenceCount))
        evidenceButtons.forEach { (evidence, button) ->
            val mark = state.mark(evidence)
            val useful = mark != Mark.UNKNOWN || Identifier.stillUseful(evidence, state, candidates)
            styleEvidence(button, evidence, mark, useful)
        }
        speedChips.forEach { (speed, chip) -> chip.isChecked = speed in state.speeds }
        observationBoxes.forEach { (observation, box) -> box.isChecked = observation in state.observations }
        rendering = false
        renderBehaviourHeader()

        t.resultText.text = when (candidates.size) {
            0 -> getString(R.string.result_none)
            1 -> getString(R.string.result_one, candidates.single().let { if (it.name.startsWith("The ")) it.name else "en ${it.name}" })
            else -> getString(R.string.result_many, candidates.size)
        }
        adapter.submit(
            Ghosts.all.map { GhostAdapter.Row(it, Identifier.verdict(it, state)) }
                .sortedBy { it.verdict != Verdict.POSSIBLE },
            state,
        )
        tools.render()
    }

    private fun renderBehaviourHeader() {
        val t = binding.tracker
        val count = model.state.speeds.size + model.state.observations.size
        t.behaviourTitle.text =
            if (count == 0) getString(R.string.behaviour_title) else getString(R.string.behaviour_title_count, count)
        t.behaviourBody.isVisible = model.behaviourExpanded
        t.behaviourArrow.text = if (model.behaviourExpanded) "▴" else "▾"
    }

    private fun styleEvidence(button: MaterialButton, evidence: Evidence, mark: Mark, useful: Boolean) {
        val (fill, stroke, text) = when (mark) {
            Mark.FOUND -> Triple(color(R.color.found), color(R.color.found), color(R.color.on_found))
            Mark.RULED_OUT -> Triple(Color.TRANSPARENT, color(R.color.ruled_out), color(R.color.ruled_out))
            Mark.UNKNOWN -> Triple(Color.TRANSPARENT, color(R.color.outline), color(R.color.text_primary))
        }
        button.text = when (mark) {
            Mark.FOUND -> "✓  ${evidence.label}"
            Mark.RULED_OUT -> "✗  ${evidence.label}"
            Mark.UNKNOWN -> evidence.label
        }
        button.backgroundTintList = ColorStateList.valueOf(fill)
        button.strokeColor = ColorStateList.valueOf(stroke)
        button.setTextColor(text)
        button.strike(mark == Mark.RULED_OUT)
        // Evidence that none of the remaining ghosts can show isn't worth looking for.
        button.alpha = if (useful) 1f else 0.35f
    }

    private fun showEvidenceHelp(evidence: Evidence) {
        MaterialAlertDialogBuilder(this)
            .setTitle(evidence.label)
            .setMessage(evidence.howTo)
            .setPositiveButton(R.string.close, null)
            .show()
    }

    internal fun showDetails(ghost: Ghost) {
        val dialog = BottomSheetDialog(this)
        val d = DialogGhostBinding.inflate(layoutInflater)
        d.detailName.text = ghost.name
        d.detailSummary.text = ghost.summary
        Badges.fill(d.detailEvidence, ghost, model.state, large = true)
        ghost.forced?.let {
            d.detailForced.text = getString(R.string.detail_forced, it.label)
            d.detailForced.isVisible = true
        }
        d.detailHunt.text = ghost.huntText
        d.detailSpeed.text = ghost.speedText
        d.detailTells.text = ghost.tells.joinToString("\n") { "•  $it" }
        d.detailTimes.text = getString(R.string.detail_times, ghost.smudgeSeconds, ghost.cooldownSeconds)
        d.detailTimes.isVisible = !ghost.copiesOthers
        d.detailStrike.setText(
            if (ghost.name in model.state.struckOut) R.string.detail_unstrike else R.string.detail_strike,
        )
        d.detailStrike.setOnClickListener {
            update(model.state.toggledStrike(ghost))
            dialog.dismiss()
        }
        dialog.setContentView(d.root)
        dialog.show()
    }

    fun showMessage(@StringRes text: Int) {
        Snackbar.make(binding.root, text, Snackbar.LENGTH_LONG).show()
    }

    /** Running timers keep the screen awake so their beeps aren't delayed by the phone going to sleep. */
    fun timersRunning(running: Boolean) = applyKeepScreenOn(running)

    private fun applyKeepScreenOn(timerRunning: Boolean = tools.anyTimerRunning()) {
        if (model.keepScreenOn || timerRunning) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    private fun color(@ColorRes id: Int) = ContextCompat.getColor(this, id)
}
