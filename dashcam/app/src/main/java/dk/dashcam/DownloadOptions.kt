package dk.dashcam

import android.content.Context
import android.text.format.Formatter
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import dk.dashcam.cam.CamFile

/** "Hent": the whole video, the camera's small preview copy, or cut a piece out. */
object DownloadOptions {
    fun show(
        context: Context,
        item: CameraSession.PlayItem,
        onDownload: (CamFile) -> Unit = { CameraSession.download(it) },
        onClip: () -> Unit,
    ) {
        val file = item.file
        if (file.isPhoto) {
            onDownload(file)
            return
        }
        val labels = ArrayList<String>()
        val actions = ArrayList<() -> Unit>()
        labels += context.getString(R.string.dl_clip)
        actions += onClip
        item.preview?.let { preview ->
            labels += context.getString(R.string.dl_small, Formatter.formatShortFileSize(context, preview.size))
            actions += { onDownload(preview) }
        }
        labels += context.getString(R.string.dl_whole, Formatter.formatShortFileSize(context, file.size))
        actions += { onDownload(file) }
        MaterialAlertDialogBuilder(context)
            .setTitle(R.string.download)
            .setItems(labels.toTypedArray()) { _, which -> actions[which]() }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }
}
