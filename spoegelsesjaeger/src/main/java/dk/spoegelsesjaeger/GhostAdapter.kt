package dk.spoegelsesjaeger

import android.content.Context
import android.graphics.Paint
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.LayoutInflater
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.RecyclerView
import dk.spoegelsesjaeger.databinding.ItemGhostBinding

class GhostAdapter(
    private val onClick: (Ghost) -> Unit,
    private val onLongClick: (Ghost) -> Unit,
) : RecyclerView.Adapter<GhostAdapter.Holder>() {

    class Row(val ghost: Ghost, val verdict: Verdict)

    private var rows: List<Row> = emptyList()
    private var state = TrackerState()

    fun submit(rows: List<Row>, state: TrackerState) {
        this.rows = rows
        this.state = state
        notifyDataSetChanged()
    }

    override fun getItemCount() = rows.size

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) =
        Holder(ItemGhostBinding.inflate(LayoutInflater.from(parent.context), parent, false))

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val row = rows[position]
        val ghost = row.ghost
        val b = holder.binding
        val context = b.root.context
        val possible = row.verdict == Verdict.POSSIBLE

        b.ghostName.text = ghost.name
        b.ghostName.strike(!possible)
        b.ghostSummary.text = ghost.summary
        b.ghostMeta.text = if (possible) meta(context, ghost) else context.getString(row.verdict.reason())
        b.ghostMeta.setTextColor(
            ContextCompat.getColor(context, if (possible) R.color.primary else R.color.text_secondary),
        )
        b.root.alpha = if (possible) 1f else 0.4f
        Badges.fill(b.evidenceBadges, ghost, state)

        b.card.setOnClickListener { onClick(ghost) }
        b.card.setOnLongClickListener {
            onLongClick(ghost)
            true
        }
    }

    private fun meta(context: Context, ghost: Ghost): String {
        if (ghost.copiesOthers) return context.getString(R.string.meta_varies)
        val hunt = context.getString(
            if (ghost.huntsAtAnySanity) R.string.meta_hunt_any else R.string.meta_hunt,
            ghost.maxHuntSanity,
        )
        val speed = context.getString(
            R.string.meta_speed,
            ghost.speedClasses.sorted().joinToString("/") { it.label.lowercase() },
        )
        return "$hunt · $speed"
    }

    class Holder(val binding: ItemGhostBinding) : RecyclerView.ViewHolder(binding.root)
}

fun Verdict.reason(): Int = when (this) {
    Verdict.EVIDENCE -> R.string.verdict_evidence
    Verdict.SPEED -> R.string.verdict_speed
    Verdict.BEHAVIOUR -> R.string.verdict_behaviour
    Verdict.STRUCK_OUT -> R.string.verdict_struck_out
    Verdict.POSSIBLE -> R.string.result_many // never shown
}

fun TextView.strike(on: Boolean) {
    paintFlags = if (on) paintFlags or Paint.STRIKE_THRU_TEXT_FLAG else paintFlags and Paint.STRIKE_THRU_TEXT_FLAG.inv()
}

fun Context.dp(value: Int): Int =
    TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()

/** Small rounded labels showing a ghost's evidence, coloured by what the player has marked. */
object Badges {

    /** Small badges go in a row; [large] ones go in a wrapping ChipGroup that does its own spacing. */
    fun fill(container: ViewGroup, ghost: Ghost, state: TrackerState, large: Boolean = false) {
        val context = container.context
        container.removeAllViews()
        Evidence.entries.filter { it in ghost.evidence }.forEach { evidence ->
            container.addView(badge(context, if (large) evidence.label else evidence.short, state.mark(evidence), large))
        }
        ghost.fakeEvidence?.let { fake ->
            val label = if (large) context.getString(R.string.fake_evidence, fake.label) else context.getString(R.string.fake_orb)
            container.addView(badge(context, label, state.mark(fake), large, fake = true))
        }
    }

    private fun badge(context: Context, text: String, mark: Mark, large: Boolean, fake: Boolean = false): TextView {
        val color = ContextCompat.getColor(
            context,
            when {
                mark == Mark.FOUND -> R.color.found
                mark == Mark.RULED_OUT -> R.color.ruled_out
                fake -> R.color.fake
                else -> R.color.outline
            },
        )
        return TextView(context).apply {
            this.text = text
            setTextSize(TypedValue.COMPLEX_UNIT_SP, if (large) 14f else 11f)
            val h = context.dp(if (large) 10 else 6)
            val v = context.dp(if (large) 4 else 2)
            setPadding(h, v, h, v)
            setTextColor(
                when (mark) {
                    Mark.FOUND -> ContextCompat.getColor(context, R.color.on_found)
                    Mark.RULED_OUT -> color
                    Mark.UNKNOWN -> ContextCompat.getColor(context, if (fake) R.color.fake else R.color.text_primary)
                },
            )
            strike(mark == Mark.RULED_OUT)
            background = GradientDrawable().apply {
                cornerRadius = context.dp(8).toFloat()
                setStroke(context.dp(1), color)
                setColor(if (mark == Mark.FOUND) color else 0)
            }
            if (!large) {
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                ).apply { marginStart = context.dp(4) }
            }
        }
    }
}
