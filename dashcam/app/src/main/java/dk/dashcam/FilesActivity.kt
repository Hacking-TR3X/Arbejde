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

/** Recordings, emergency clips and photos on the camera's SD card. */
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

    private val thumbs = LruCache<String, Bitmap>(80)
    private val noThumb = HashSet<String>()
    private val loadingThumbs = HashSet<String>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityFilesBinding.inflate(layoutInflater)
        setContentView(b.root)
        setSupportActionBar(b.toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        b.toolbar.setNavigationOnClickListener { finish() }

        adapter = FileAdapter(
            onOpen = ::open,
            onDownload = { CameraSession.download(it) },
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

    override fun onDestroy() {
        super.onDestroy()
        // Browsing files stops the camera's recording; start it again when we leave.
        if (isFinishing) CameraSession.leaveFilesAsync()
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.files_menu, menu)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        if (item.itemId == R.id.action_refresh) {
            load()
            return true
        }
        return super.onOptionsItemSelected(item)
    }

    private fun load() {
        loadJob?.cancel()
        loadJob = lifecycleScope.launch {
            b.progress.isVisible = true
            b.emptyText.isVisible = false
            try {
                all = CameraSession.listFiles().sortedByDescending { it.time }
                showTab()
            } catch (e: CameraException) {
                all = emptyList()
                adapter.submit(emptyList())
                b.emptyText.text = e.message
                b.emptyText.isVisible = true
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

    private fun open(file: CamFile) {
        if (file.isPhoto) {
            showPhoto(file)
            return
        }
        // Stream the camera's small preview copy if it has one – much smoother over its Wi-Fi.
        val preview = all.firstOrNull { it.path != file.path && it.path == file.previewPath }
        val url = CameraSession.fileUrl(preview ?: file) ?: return
        PlayerActivity.startFile(this, url, FileAdapter.prettyTime(file))
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
        view.tag = file.path
        val cached = thumbs.get(file.path)
        if (cached != null) {
            view.setImageBitmap(cached)
            return
        }
        view.setImageDrawable(null)
        if (file.path in noThumb || !loadingThumbs.add(file.path)) return
        lifecycleScope.launch {
            val bytes = try {
                CameraSession.thumbnail(file)
            } catch (e: CameraException) {
                null
            }
            val bitmap = bytes?.let {
                withContext(Dispatchers.Default) { BitmapFactory.decodeByteArray(it, 0, it.size) }
            }
            loadingThumbs.remove(file.path)
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
