package dk.loopcast

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Turns a SoundCloud track link into a playable stream URL using SoundCloud's public
 * web API (the same endpoints the soundcloud.com web player uses).
 */
class SoundCloudResolver(context: Context) {

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences("soundcloud", Context.MODE_PRIVATE)

    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    /**
     * Normalises any SoundCloud link (short on.soundcloud.com links, mobile links,
     * tracking parameters) to the canonical https://soundcloud.com/artist/track form.
     */
    @Throws(IOException::class)
    fun canonicalTrackUrl(input: String): String {
        var url = input.trim()
        if (!url.startsWith("http://") && !url.startsWith("https://")) url = "https://$url"
        val parsed = url.toHttpUrlOrNull() ?: throw IOException("Ugyldigt link")
        val host = parsed.host.lowercase()
        if (!host.endsWith("soundcloud.com") && !host.endsWith("soundcloud.app.goo.gl")) {
            throw IOException("Det er ikke et SoundCloud-link")
        }

        var finalUrl: HttpUrl = parsed
        if (host == "on.soundcloud.com" || host.endsWith("soundcloud.app.goo.gl")) {
            // Short links redirect to the real track page; follow them.
            http.newCall(request(url)).execute().use { response ->
                finalUrl = response.request.url
            }
        }

        val cleaned = finalUrl.newBuilder()
            .query(null)
            .fragment(null)
            .build()
            .toString()
            .replace("://m.soundcloud.com", "://soundcloud.com")
            .replace("://www.soundcloud.com", "://soundcloud.com")
            .trimEnd('/')
        Log.d(TAG, "Canonical url: $cleaned")
        return cleaned
    }

    /** Resolves a canonical track URL to metadata plus a temporary stream URL. */
    @Throws(IOException::class)
    fun resolve(trackUrl: String): ResolvedTrack {
        var clientId = clientId(forceRefresh = false)

        var track = apiJson(resolveEndpoint(trackUrl, clientId))
        if (track == null) {
            clientId = clientId(forceRefresh = true)
            track = apiJson(resolveEndpoint(trackUrl, clientId))
                ?: throw IOException("SoundCloud afviste opslaget (client_id)")
        }

        val kind = track.optString("kind")
        if (kind == "playlist") throw IOException("Linket er en playliste – brug et link til ét track")
        if (kind != "track") throw IOException("Linket peger ikke på et track ($kind)")

        val transcoding = pickTranscoding(track)
        val trackAuthorization = track.optString("track_authorization", "")
        val streamJsonUrl = transcoding.getString("url").toHttpUrl().newBuilder()
            .addQueryParameter("client_id", clientId)
            .apply { if (trackAuthorization.isNotEmpty()) addQueryParameter("track_authorization", trackAuthorization) }
            .build()
            .toString()

        var streamJson = apiJson(streamJsonUrl)
        if (streamJson == null) {
            clientId = clientId(forceRefresh = true)
            val retryUrl = streamJsonUrl.toHttpUrl().newBuilder()
                .setQueryParameter("client_id", clientId).build().toString()
            streamJson = apiJson(retryUrl) ?: throw IOException("Kunne ikke hente stream-URL")
        }
        val streamUrl = streamJson.optString("url").takeIf { it.isNotEmpty() }
            ?: throw IOException("SoundCloud returnerede en tom stream-URL")

        val protocol = transcoding.optJSONObject("format")?.optString("protocol") ?: ""
        val artwork = track.optString("artwork_url").takeIf { it.isNotEmpty() }
            ?.replace("-large.", "-t500x500.")
        val duration = track.optLong("full_duration", 0L).takeIf { it > 0 } ?: track.optLong("duration", 0L)

        return ResolvedTrack(
            permalinkUrl = track.optString("permalink_url").takeIf { it.isNotEmpty() } ?: trackUrl,
            title = track.optString("title").takeIf { it.isNotEmpty() } ?: trackUrl,
            artist = track.optJSONObject("user")?.optString("username") ?: "",
            artworkUrl = artwork,
            durationMs = duration,
            streamUrl = streamUrl,
            isHls = protocol == "hls",
        )
    }

    /** Prefer a plain progressive MP3 (easiest for the Nest to loop), fall back to HLS MP3. */
    private fun pickTranscoding(track: JSONObject): JSONObject {
        val transcodings = track.optJSONObject("media")?.optJSONArray("transcodings") ?: JSONArray()
        var best: JSONObject? = null
        var bestScore = -1
        for (i in 0 until transcodings.length()) {
            val t = transcodings.getJSONObject(i)
            val format = t.optJSONObject("format") ?: continue
            val protocol = format.optString("protocol")
            val mime = format.optString("mime_type")
            val snipped = t.optBoolean("snipped", false)
            val score = when {
                snipped -> 0
                protocol == "progressive" && mime.startsWith("audio/mpeg") -> 3
                protocol == "hls" && mime.startsWith("audio/mpeg") -> 2
                else -> -1
            }
            if (score > bestScore) {
                best = t
                bestScore = score
            }
        }
        return when {
            best == null || bestScore < 0 -> throw IOException("Fandt ingen afspilbar stream til tracket")
            bestScore == 0 -> throw IOException("Tracket kan kun forhåndsvises (kræver SoundCloud Go+)")
            else -> best
        }
    }

    private fun resolveEndpoint(trackUrl: String, clientId: String): String =
        "https://api-v2.soundcloud.com/resolve".toHttpUrl().newBuilder()
            .addQueryParameter("url", trackUrl)
            .addQueryParameter("client_id", clientId)
            .build()
            .toString()

    /** GET a JSON endpoint. Returns null on 401/403 so the caller can refresh the client id. */
    @Throws(IOException::class)
    private fun apiJson(url: String): JSONObject? {
        http.newCall(request(url)).execute().use { response ->
            when {
                response.code == 401 || response.code == 403 -> return null
                response.code == 404 -> throw IOException("Tracket blev ikke fundet på SoundCloud (404)")
                !response.isSuccessful -> throw IOException("SoundCloud svarede ${response.code}")
            }
            val body = response.body?.string() ?: throw IOException("Tomt svar fra SoundCloud")
            return JSONObject(body)
        }
    }

    @Synchronized
    @Throws(IOException::class)
    private fun clientId(forceRefresh: Boolean): String {
        if (!forceRefresh) {
            prefs.getString(KEY_CLIENT_ID, null)?.let { return it }
        }
        val id = fetchClientId()
        prefs.edit().putString(KEY_CLIENT_ID, id).apply()
        return id
    }

    /**
     * SoundCloud does not hand out API keys any more, so do what the web player does:
     * load soundcloud.com and pick the client_id out of its JavaScript bundles.
     */
    @Throws(IOException::class)
    private fun fetchClientId(): String {
        val html = http.newCall(request("https://soundcloud.com/")).execute().use { response ->
            if (!response.isSuccessful) throw IOException("soundcloud.com svarede ${response.code}")
            response.body?.string() ?: ""
        }
        val scripts = SCRIPT_REGEX.findAll(html).map { it.groupValues[1] }.toList().asReversed()
        if (scripts.isEmpty()) throw IOException("Kunne ikke læse soundcloud.com")
        for (src in scripts) {
            val js = http.newCall(request(src)).execute().use { response ->
                if (response.isSuccessful) response.body?.string() ?: "" else ""
            }
            CLIENT_ID_REGEX.find(js)?.let { return it.groupValues[1] }
        }
        throw IOException("Kunne ikke finde SoundCloud client_id")
    }

    private fun request(url: String): Request = Request.Builder()
        .url(url)
        .header("User-Agent", USER_AGENT)
        .header("Accept", "*/*")
        .header("Origin", "https://soundcloud.com")
        .header("Referer", "https://soundcloud.com/")
        .get()
        .build()

    private companion object {
        const val TAG = "SoundCloudResolver"
        const val KEY_CLIENT_ID = "client_id"
        const val USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        val SCRIPT_REGEX = Regex("<script[^>]+src=\"(https://a-v2\\.sndcdn\\.com/assets/[^\"]+\\.js)\"")
        val CLIENT_ID_REGEX = Regex("client_id\\s*:\\s*\"([0-9a-zA-Z]{32})\"")
    }
}
