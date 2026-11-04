package dk.dashcam

import android.text.format.Formatter
import android.view.LayoutInflater
import android.view.ViewGroup
import android.widget.ImageView
import androidx.recyclerview.widget.RecyclerView
import dk.dashcam.cam.CamFile
import dk.dashcam.databinding.ItemFileBinding
import java.text.ParseException
import java.text.SimpleDateFormat
import java.util.Locale

class FileAdapter(
    private val onOpen: (CamFile) -> Unit,
    private val onDownload: (CamFile) -> Unit,
    private val onDelete: (CamFile) -> Unit,
    private val loadThumb: (CamFile, ImageView) -> Unit,
) : RecyclerView.Adapter<FileAdapter.Holder>() {

    class Holder(val b: ItemFileBinding) : RecyclerView.ViewHolder(b.root)

    private var items: List<CamFile> = emptyList()
    private var downloads: Map<String, CameraSession.Download> = emptyMap()

    fun submit(list: List<CamFile>) {
        items = list
        notifyDataSetChanged()
    }

    fun setDownloads(map: Map<String, CameraSession.Download>) {
        downloads = map
        notifyDataSetChanged()
    }

    override fun getItemCount(): Int = items.size

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder =
        Holder(ItemFileBinding.inflate(LayoutInflater.from(parent.context), parent, false))

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val file = items[position]
        val ctx = holder.b.root.context
        holder.b.fileTitle.text = prettyTime(file)
        val size = Formatter.formatShortFileSize(ctx, file.size)
        val dl = downloads[file.path]
        val extra = when {
            dl == null -> if (file.readOnly) ctx.getString(R.string.locked) else null
            dl.error != null -> ctx.getString(R.string.download_failed, dl.error)
            dl.finished -> ctx.getString(R.string.download_done)
            else -> {
                val pct = if (dl.total > 0) (dl.done * 100 / dl.total).toInt() else 0
                ctx.getString(R.string.downloading_pct, pct)
            }
        }
        holder.b.fileDetail.text = listOfNotNull(size, extra).joinToString(" · ")
        holder.b.root.setOnClickListener { onOpen(file) }
        holder.b.downloadButton.setOnClickListener { onDownload(file) }
        holder.b.deleteButton.setOnClickListener { onDelete(file) }
        loadThumb(file, holder.b.thumb)
    }

    companion object {
        private val IN = SimpleDateFormat("yyyy/MM/dd HH:mm:ss", Locale.US)
        private val OUT = SimpleDateFormat("EEE d. MMM yyyy 'kl.' HH:mm", Locale.forLanguageTag("da"))

        fun prettyTime(file: CamFile): String = try {
            IN.parse(file.time)?.let { OUT.format(it) } ?: file.name
        } catch (e: ParseException) {
            file.name
        }
    }
}
