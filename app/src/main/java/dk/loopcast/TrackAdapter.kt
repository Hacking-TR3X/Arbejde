package dk.loopcast

import android.annotation.SuppressLint
import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import dk.loopcast.databinding.ItemTrackBinding

class TrackAdapter(
    private val onPlay: (SavedTrack) -> Unit,
    private val onDelete: (SavedTrack) -> Unit,
) : RecyclerView.Adapter<TrackAdapter.ViewHolder>() {

    private val items = mutableListOf<SavedTrack>()

    @SuppressLint("NotifyDataSetChanged")
    fun submit(tracks: List<SavedTrack>) {
        items.clear()
        items.addAll(tracks)
        notifyDataSetChanged()
    }

    class ViewHolder(val binding: ItemTrackBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val binding = ItemTrackBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return ViewHolder(binding)
    }

    override fun getItemCount(): Int = items.size

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val track = items[position]
        val shortUrl = track.url.removePrefix("https://").removePrefix("http://")
        holder.binding.trackTitle.text = track.title ?: shortUrl
        holder.binding.trackSubtitle.text =
            if (track.title != null) listOfNotNull(track.artist?.takeIf { it.isNotEmpty() }, shortUrl).joinToString(" · ")
            else ""
        holder.binding.root.setOnClickListener { onPlay(track) }
        holder.binding.playIcon.setOnClickListener { onPlay(track) }
        holder.binding.deleteIcon.setOnClickListener { onDelete(track) }
    }
}
