package dk.dashcam

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Bundle
import android.util.LruCache
import android.view.Menu
import android.view.MenuItem
import android.widget.ImageView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.isVisible
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.recyclerview.widget.LinearLayoutManager
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.snackbar.Snackbar
import com.google.android.material.tabs.TabLayout
import dk.dashcam.cam.CamFile
import dk.dashcam.cam.CameraException
import dk.dashcam.databinding.ActivityFilesBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Recordings, emergency clips and photos on the camera's SD card.
 *
 * The camera's web server answers one request at a time, so this screen is careful with it:
 * thumbnails are fetched one by one only for rows on screen, cancelled when a row scrolls away
 * or the screen is left, and paused while a download runs.
 */
class FilesActivity : AppCompatActivity() {

    private lateinit var b: ActivityFilesBinding
    private lateinit var adapter: FileAdapter
    private var all: List<CamFile> = emptyList()
    private var loadJob: Job? = null

    private val tabs = listOf(
        CamFile.Kind.VIDEO to R.string.tab_videos,
        CamFile.Kind.EMERGENCY to R.string.tab_emergency,
        CamFile.Kind.PHOTO to R.string.tab_photos,
    )

    private val thumbs = LruCache<String, Bitmap>(120)
    private val noThumb = HashSet<String>()
    private val thumbJobs = HashMap<ImageView, Job>()

    /** Thumbnails wait until the camera is in file mode and the fresh list is in. */
    private var thumbsReady = false
    private val thumbJobPaths = HashMap<ImageView, String>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityFilesBinding.inflate(layoutInflater)
        setContentView(b.root)
        setSupportActionBar(b.toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        b.toolbar.setNavigationOnClickListener { finish() }

        adapter = FileAdapter(
            onOpen = ::open,
            onDownload = { file ->
                DownloadOptions.show(this, CameraSession.PlayItem(file, previewOf(file))) {
                    openPlayer(file, trim = true)
                }
            },
            onDelete = ::confirmDelete,
            loadThumb = ::loadThumb,
        )
        b.fileList.layoutManager = LinearLayoutManager(this)
        b.fileList.adapter = adapter

        for ((_, label) in tabs) b.tabs.addTab(b.tabs.newTab().setText(label))
        b.tabs.addOnTabSelectedListener(object : TabLayout.OnTabSelectedListener {
            override fun onTabSelected(tab: TabLayout.Tab) = showTab()
            override fun onTabUnselected(tab: TabLayout.Tab) {}
            override fun onTabReselected(tab: TabLayout.Tab) {}
        })

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                CameraSession.downloads.collect { adapter.setDownloads(it) }
            }
        }
        load()
    }

    override fun onStart() {
        super.onStart()
        if (thumbsReady) adapter.notifyDataSetChanged() // re-request thumbnails for rows on screen
    }

    override fun onStop() {
        super.onStop()
        // Free the camera for whatever comes next (playback, live view, downloads).
        thumbJobs.values.forEach { it.cancel() }
        thumbJobs.clear()
        thumbJobPaths.clear()
    }

    override fun onDestroy() {
        super.onDestroy()
        // Browsing files stops the camera's recording; start it again when we leave.
        if (isFinishing) CameraSession.leaveFilesAsync()
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.files_menu, menu)
        return true
    }

    override fun onPrepareOptionsMenu(menu: Menu): Boolean {
        menu.findItem(R.id.action_thumbnails)?.isChecked = CameraSession.prefs.thumbnails
        return super.onPrepareOptionsMenu(menu)
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        when (item.itemId) {
            R.id.action_refresh -> load()
            R.id.action_thumbnails -> {
                val on = !CameraSession.prefs.thumbnails
                CameraSession.prefs.thumbnails = on
                item.isChecked = on
                noThumb.clear()
                adapter.notifyDataSetChanged()
            }
            else -> return super.onOptionsItemSelected(item)
        }
        return true
    }

    private fun load() {
        loadJob?.cancel()
        thumbsReady = false
        // Show the last list at once; the fresh one replaces it when the camera has answered.
        val cached = CameraSession.cachedFiles
        if (all.isEmpty() && cached != null) {
            all = cached.sortedByDescending { it.time }
            showTab()
        }
        loadJob = lifecycleScope.launch {
            b.progress.isVisible = true
            b.emptyText.isVisible = false
            try {
                all = CameraSession.listFiles().sortedByDescending { it.time }
                thumbsReady = true
                showTab()
            } catch (e: CameraException) {
                if (all.isEmpty()) {
                    adapter.submit(emptyList())
                    b.emptyText.text = e.message
                    b.emptyText.isVisible = true
                } else {
                    snack(e.message ?: getString(R.string.error))
                }
            } finally {
                b.progress.isVisible = false
            }
        }
    }

    private fun showTab() {
        val kind = tabs[b.tabs.selectedTabPosition.coerceIn(0, tabs.size - 1)].first
        val list = all.filter { it.kind == kind }
        adapter.submit(list)
        b.emptyText.setText(R.string.files_empty)
        b.emptyText.isVisible = list.isEmpty()
    }

    private fun previewOf(file: CamFile): CamFile? =
        all.firstOrNull { it.path != file.path && it.path == file.previewPath }

    private fun open(file: CamFile) {
        if (file.isPhoto) showPhoto(file) else openPlayer(file, trim = false)
    }

    /** Plays [file] with every video of the same kind queued, oldest first, so you can step through. */
    private fun openPlayer(file: CamFile, trim: Boolean) {
        val videos = all.filter { it.kind == file.kind }.sortedBy { it.time }
        CameraSession.playlist = videos.map { CameraSession.PlayItem(it, previewOf(it)) }
        val index = videos.indexOfFirst { it.path == file.path }.coerceAtLeast(0)
        PlayerActivity.startFiles(this, index, trim)
    }

    private fun showPhoto(file: CamFile) {
        lifecycleScope.launch {
            b.progress.isVisible = true
            try {
                val bytes = CameraSession.fetch(file)
                val bitmap = withContext(Dispatchers.Default) {
                    val opts = BitmapFactory.Options().apply { inSampleSize = 2 }
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)
                }
                val view = ImageView(this@FilesActivity).apply {
                    adjustViewBounds = true
                    setImageBitmap(bitmap)
                }
                MaterialAlertDialogBuilder(this@FilesActivity)
                    .setView(view)
                    .setPositiveButton(R.string.download) { _, _ -> CameraSession.download(file) }
                    .setNegativeButton(R.string.close, null)
                    .show()
            } catch (e: CameraException) {
                snack(e.message ?: getString(R.string.error))
            } finally {
                b.progress.isVisible = false
            }
        }
    }

    private fun confirmDelete(file: CamFile) {
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.delete_title)
            .setMessage(getString(R.string.delete_message, FileAdapter.prettyTime(file)))
            .setPositiveButton(R.string.delete) { _, _ ->
                lifecycleScope.launch {
                    try {
                        CameraSession.delete(file)
                        all = all.filterNot { it.path == file.path || it.path == file.previewPath }
                        showTab()
                    } catch (e: CameraException) {
                        snack(e.message ?: getString(R.string.error))
                    }
                }
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun loadThumb(file: CamFile, view: ImageView) {
        // Rebinding the same row for the same file (e.g. on download progress): keep going.
        if (thumbJobPaths[view] == file.path && thumbJobs[view]?.isActive == true) return
        // The row now shows another file: drop the request for the old one.
        thumbJobs.remove(view)?.cancel()
        thumbJobPaths.remove(view)
        view.tag = file.path
        val cached = thumbs.get(file.path)
        if (cached != null) {
            view.setImageBitmap(cached)
            return
        }
        view.setImageDrawable(null)
        if (file.path in noThumb) return
        thumbJobPaths[view] = file.path
        thumbJobs[view] = lifecycleScope.launch {
            // Thumbnails made earlier are kept on the phone and show up without the camera.
            var bitmap = CameraSession.diskThumbnail(file)
            if (bitmap == null) {
                val allowed = thumbsReady && CameraSession.prefs.thumbnails && !CameraSession.downloading
                if (!allowed) return@launch // try again when the row is shown next time
                bitmap = try {
                    CameraSession.thumbnailBitmap(file, previewOf(file))
                } catch (e: CameraException) {
                    null
                }
            }
            if (bitmap == null) {
                noThumb += file.path
                return@launch
            }
            thumbs.put(file.path, bitmap)
            if (view.tag == file.path) view.setImageBitmap(bitmap)
        }
    }

    private fun snack(text: String) {
        Snackbar.make(b.root, text, Snackbar.LENGTH_LONG).show()
    }
}
