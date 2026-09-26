package dk.saloona.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.KeyguardManager;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import androidx.activity.result.ActivityResult;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Saloona's own native bridge. The JS side is src/platform/native.ts; keep the
 * two in sync (method names, option names and result shapes).
 *
 * Conventions:
 * - Failures the UI must handle are resolved as values. Only programming errors
 *   (missing/invalid options) and "no app can handle this" for dial/sms reject.
 * - Nothing here logs file contents, phone numbers, file names or other user
 *   data. Log lines only name the operation and the exception class.
 * - Plugin methods run on Capacitor's plugin thread. Anything touching views,
 *   the window or BiometricPrompt is posted to the UI thread; file I/O never
 *   runs on the UI thread.
 */
@CapacitorPlugin(name = "SaloonaNative")
public class SaloonaNativePlugin extends Plugin {

    /** Private SharedPreferences file for this plugin (read by MainActivity too). */
    static final String PREFS_NAME = "saloona_native";
    /** Whether FLAG_SECURE should be set; persisted so MainActivity applies it in onCreate. */
    static final String KEY_SECURE_SCREEN = "secure_screen";

    private static final String LOG_TAG = Logger.tags("SaloonaNative");

    /** Fingerprint/face (class 2 or better) or the phone's own PIN/pattern/password. */
    private static final int AUTHENTICATORS =
        BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL;

    /** Sub-directory of getCacheDir() that the FileProvider exposes (res/xml/file_paths.xml). */
    private static final String EXPORT_DIR = "exports";
    private static final int MAX_EXPORT_NAME_LENGTH = 80;

    /** Upper bound for openFile's maxBytes, so a bad argument cannot exhaust memory. */
    private static final long OPEN_FILE_HARD_LIMIT = 64L * 1024L * 1024L;
    private static final int MAX_DISPLAY_NAME_LENGTH = 255;

    /** Same rule as the JS side: optional +, then 3-15 ASCII digits. */
    private static final Pattern PHONE_NUMBER = Pattern.compile("^\\+?[0-9]{3,15}$");

    /** Created in load() (UI thread, during Activity.onCreate). UI thread only. */
    @Nullable
    private BiometricPrompt biometricPrompt;

    /**
     * Calls waiting for the prompt that is currently showing. A second
     * authenticate() while the prompt is up joins it instead of opening another.
     * UI thread only.
     */
    private final List<PluginCall> pendingAuthCalls = new ArrayList<>();

    // ------------------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------------------

    /**
     * Called by Capacitor on the UI thread while BridgeActivity.onCreate builds
     * the bridge. BiometricPrompt should be constructed there so it survives
     * configuration changes.
     */
    @Override
    public void load() {
        try {
            biometricPrompt = createBiometricPrompt();
        } catch (RuntimeException e) {
            // Never let this stop the plugin from loading; authenticate() retries lazily.
            Logger.error(LOG_TAG, "load: BiometricPrompt kunne ikke oprettes (" + e.getClass().getSimpleName() + ")", null);
            biometricPrompt = null;
        }
    }

    /**
     * Emits appStateChange {isActive: false}. JS uses it to re-lock the app.
     * Note: our own pickers, the share sheet and the PIN screen also pause the
     * activity.
     */
    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        notifyListeners("appStateChange", new JSObject().put("isActive", false));
    }

    /** Emits appStateChange {isActive: true}. */
    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        notifyListeners("appStateChange", new JSObject().put("isActive", true));
    }

    /**
     * Capacitor's default copies the options of a call waiting for an activity
     * result (for saveFile: the whole backup) into the activity's saved-instance
     * Bundle whenever the app goes to the background. That puts personal data in
     * the Bundle and can exceed the 1 MB Binder limit (TransactionTooLargeException
     * crash). A call cannot be resumed after process death anyway, because the JS
     * promise is gone, so nothing is saved.
     */
    @Override
    @Nullable
    protected Bundle saveInstanceState() {
        return null;
    }

    // ------------------------------------------------------------------------
    // App lock
    // ------------------------------------------------------------------------

    /**
     * lockAvailability(): {available: true} | {available: false, reason}.
     * reason: 'no_device_credential' when the phone has no screen lock,
     * 'no_hardware', 'none_enrolled', or 'unavailable' for anything else.
     */
    @PluginMethod
    public void lockAvailability(PluginCall call) {
        JSObject ret = new JSObject();
        KeyguardManager keyguard = (KeyguardManager) getContext().getSystemService(Context.KEYGUARD_SERVICE);
        if (keyguard != null && !keyguard.isDeviceSecure()) {
            call.resolve(ret.put("available", false).put("reason", "no_device_credential"));
            return;
        }
        int status = BiometricManager.from(getContext()).canAuthenticate(AUTHENTICATORS);
        switch (status) {
            case BiometricManager.BIOMETRIC_SUCCESS:
                ret.put("available", true);
                break;
            case BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE:
                ret.put("available", false).put("reason", "no_hardware");
                break;
            case BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED:
                ret.put("available", false).put("reason", "none_enrolled");
                break;
            default:
                ret.put("available", false).put("reason", "unavailable");
                break;
        }
        call.resolve(ret);
    }

    /**
     * authenticate({title, subtitle?}): shows the system BiometricPrompt with
     * BIOMETRIC_WEAK | DEVICE_CREDENTIAL, so the phone's PIN/pattern/password is
     * always offered. androidx.biometric 1.1.0 supports this combination on every
     * API level we run on (26+): on 30+ it is passed to the framework, on 26-29
     * the library shows the fingerprint dialog and falls back to the keyguard
     * credential screen. It is the non-deprecated form of
     * setDeviceCredentialAllowed(true). No negative button may be set with it.
     *
     * Resolves {success: true} or {success: false, error}. A single rejected
     * finger (onAuthenticationFailed) keeps the prompt open and resolves nothing.
     */
    @PluginMethod
    public void authenticate(final PluginCall call) {
        final String title = call.getString("title");
        if (title == null || title.trim().isEmpty()) {
            call.reject("authenticate: title mangler", "INVALID_ARGUMENT");
            return;
        }
        final String subtitle = call.getString("subtitle");
        getActivity().runOnUiThread(() -> startAuthentication(call, title, subtitle));
    }

    /** UI thread. */
    private void startAuthentication(PluginCall call, String title, @Nullable String subtitle) {
        Activity activity = getActivity();
        if (activity == null || activity.isFinishing() || activity.isDestroyed()) {
            call.resolve(authError("canceled"));
            return;
        }
        if (!pendingAuthCalls.isEmpty()) {
            // A prompt is already showing (e.g. JS asked again on resume): share its result.
            pendingAuthCalls.add(call);
            return;
        }
        if (getActivity().getSupportFragmentManager().isStateSaved()) {
            // BiometricPrompt 1.1.0 silently ignores authenticate() after onSaveInstanceState
            // (app in the background) and would never call back. JS can retry on resume.
            call.resolve(authError("canceled"));
            return;
        }
        if (BiometricManager.from(getContext()).canAuthenticate(AUTHENTICATORS) != BiometricManager.BIOMETRIC_SUCCESS) {
            call.resolve(authError("unavailable"));
            return;
        }

        BiometricPrompt.PromptInfo.Builder builder = new BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setAllowedAuthenticators(AUTHENTICATORS)
            // Face unlock should open the app without an extra tap.
            .setConfirmationRequired(false);
        if (subtitle != null && !subtitle.trim().isEmpty()) {
            builder.setSubtitle(subtitle);
        }

        BiometricPrompt.PromptInfo promptInfo;
        try {
            promptInfo = builder.build();
        } catch (IllegalArgumentException e) {
            Logger.error(LOG_TAG, "authenticate: PromptInfo afvist (" + e.getClass().getSimpleName() + ")", null);
            call.resolve(authError("unavailable"));
            return;
        }

        if (biometricPrompt == null) {
            biometricPrompt = createBiometricPrompt();
        }
        pendingAuthCalls.add(call);
        try {
            biometricPrompt.authenticate(promptInfo);
        } catch (RuntimeException e) {
            // e.g. IllegalStateException if the FragmentManager has already saved its state.
            Logger.error(LOG_TAG, "authenticate: kunne ikke vise prompten (" + e.getClass().getSimpleName() + ")", null);
            finishAuthentication(authError("failed"));
        }
    }

    /** UI thread (load() or startAuthentication). */
    private BiometricPrompt createBiometricPrompt() {
        return new BiometricPrompt(
            getActivity(),
            ContextCompat.getMainExecutor(getContext()),
            new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                    finishAuthentication(new JSObject().put("success", true));
                }

                @Override
                public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                    finishAuthentication(authError(mapAuthError(errorCode)));
                }

                @Override
                public void onAuthenticationFailed() {
                    // One unrecognised finger/face. The prompt stays open and the user
                    // can retry or switch to the PIN, so the call is not resolved here.
                }
            }
        );
    }

    /** UI thread. Resolves every call waiting for the current prompt. */
    private void finishAuthentication(JSObject result) {
        List<PluginCall> calls = new ArrayList<>(pendingAuthCalls);
        pendingAuthCalls.clear();
        for (PluginCall pending : calls) {
            pending.resolve(result);
        }
    }

    private static String mapAuthError(int errorCode) {
        switch (errorCode) {
            case BiometricPrompt.ERROR_USER_CANCELED:
            case BiometricPrompt.ERROR_NEGATIVE_BUTTON:
            case BiometricPrompt.ERROR_CANCELED:
                return "canceled";
            case BiometricPrompt.ERROR_LOCKOUT:
            case BiometricPrompt.ERROR_LOCKOUT_PERMANENT:
                return "lockout";
            case BiometricPrompt.ERROR_HW_NOT_PRESENT:
            case BiometricPrompt.ERROR_NO_BIOMETRICS:
            case BiometricPrompt.ERROR_NO_DEVICE_CREDENTIAL:
                return "unavailable";
            default:
                return "failed";
        }
    }

    private static JSObject authError(String error) {
        return new JSObject().put("success", false).put("error", error);
    }

    // ------------------------------------------------------------------------
    // Secure screen
    // ------------------------------------------------------------------------

    /**
     * setSecureScreen({enabled}): sets or clears FLAG_SECURE (no screenshots,
     * blank thumbnail in Recents) and persists the choice so MainActivity can
     * apply it in onCreate, before the WebView draws anything.
     */
    @PluginMethod
    @SuppressLint("ApplySharedPref") // commit() on purpose: we are off the UI thread and want it on disk.
    public void setSecureScreen(final PluginCall call) {
        Boolean enabled = call.getBoolean("enabled");
        if (enabled == null) {
            call.reject("setSecureScreen: enabled mangler", "INVALID_ARGUMENT");
            return;
        }
        final boolean secure = enabled;
        if (!prefs(getContext()).edit().putBoolean(KEY_SECURE_SCREEN, secure).commit()) {
            Logger.error(LOG_TAG, "setSecureScreen: kunne ikke gemme indstillingen", null);
        }
        getActivity().runOnUiThread(() -> {
            applySecureFlag(getActivity().getWindow(), secure);
            call.resolve();
        });
    }

    /** Whether FLAG_SECURE was last switched on. Safe to call before the bridge exists. */
    static boolean isSecureScreenEnabled(Context context) {
        return prefs(context).getBoolean(KEY_SECURE_SCREEN, false);
    }

    /** UI thread (or before the window is shown). */
    static void applySecureFlag(@Nullable Window window, boolean secure) {
        if (window == null) {
            return;
        }
        if (secure) {
            window.addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        }
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    // ------------------------------------------------------------------------
    // Files
    // ------------------------------------------------------------------------

    /**
     * saveFile({fileName, mimeType, data}): ACTION_CREATE_DOCUMENT, so the user
     * picks where to save (Drev, Downloads ...). Writes data as UTF-8.
     * Resolves {saved: true}, {saved: false} when the user cancels, or
     * {saved: false, error: 'write_failed'} when writing fails.
     */
    @PluginMethod
    public void saveFile(PluginCall call) {
        String fileName = call.getString("fileName");
        String mimeType = call.getString("mimeType");
        String data = call.getString("data");
        if (isBlank(fileName) || isBlank(mimeType) || data == null) {
            call.reject("saveFile: fileName, mimeType og data skal angives", "INVALID_ARGUMENT");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        intent.putExtra(Intent.EXTRA_TITLE, fileName);
        launchForResult(call, intent, "saveFileResult");
    }

    /** UI thread (ActivityResult callback). {@code call} is null after process death. */
    @ActivityCallback
    @SuppressWarnings("unused") // invoked by Capacitor by name
    private void saveFileResult(@Nullable final PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        getBridge().releaseCall(call);
        final Uri uri = resultUri(result);
        if (uri == null) {
            call.resolve(new JSObject().put("saved", false));
            return;
        }
        final String data = call.getString("data", "");
        execute(() -> {
            byte[] bytes = (data == null ? "" : data).getBytes(StandardCharsets.UTF_8);
            if (writeDocument(uri, bytes)) {
                call.resolve(new JSObject().put("saved", true));
            } else {
                call.resolve(new JSObject().put("saved", false).put("error", "write_failed"));
            }
        });
    }

    /** Plugin thread. Truncates the document ("wt") so an overwritten file never keeps old bytes. */
    private boolean writeDocument(Uri uri, byte[] bytes) {
        ContentResolver resolver = getContext().getContentResolver();
        OutputStream out = null;
        try {
            try {
                out = resolver.openOutputStream(uri, "wt");
            } catch (IllegalArgumentException | UnsupportedOperationException | FileNotFoundException e) {
                // Some providers do not support mode "wt"; fall back below.
                out = null;
            }
            if (out == null) {
                out = openTruncatedFallback(resolver, uri);
            }
            if (out == null) {
                Logger.error(LOG_TAG, "saveFile: dokumentet kunne ikke åbnes", null);
                return false;
            }
            out.write(bytes);
            out.flush();
            OutputStream toClose = out;
            out = null;
            toClose.close();
            return true;
        } catch (IOException | RuntimeException e) {
            Logger.error(LOG_TAG, "saveFile: skrivning fejlede (" + e.getClass().getSimpleName() + ")", null);
            return false;
        } finally {
            closeQuietly(out);
        }
    }

    /** Mode "w" plus an explicit truncate where the provider gives us a real file. */
    @Nullable
    private static OutputStream openTruncatedFallback(ContentResolver resolver, Uri uri) throws IOException {
        ParcelFileDescriptor pfd = resolver.openFileDescriptor(uri, "w");
        if (pfd == null) {
            return null;
        }
        FileOutputStream stream = new ParcelFileDescriptor.AutoCloseOutputStream(pfd);
        try {
            stream.getChannel().truncate(0);
        } catch (IOException ignored) {
            // A pipe (cloud provider) cannot be truncated; it receives a fresh stream anyway.
        }
        return stream;
    }

    /**
     * openFile({mimeTypes, maxBytes}): ACTION_OPEN_DOCUMENT and reads the file as
     * UTF-8 (a leading BOM is removed). Reads at most maxBytes + 1 bytes and never
     * trusts the provider's reported size.
     * Resolves {canceled: true}, {canceled: false, name, data},
     * {canceled: false, name, tooLarge: true}, or
     * {canceled: false, name, error: 'read_failed'}.
     */
    @PluginMethod
    public void openFile(PluginCall call) {
        long maxBytes = readMaxBytes(call);
        if (maxBytes < 1 || maxBytes > OPEN_FILE_HARD_LIMIT) {
            call.reject("openFile: maxBytes skal være mellem 1 og " + OPEN_FILE_HARD_LIMIT, "INVALID_ARGUMENT");
            return;
        }
        String[] mimeTypes = readMimeTypes(call);
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        boolean onlyWildcard = mimeTypes.length == 0 || (mimeTypes.length == 1 && "*/*".equals(mimeTypes[0]));
        if (!onlyWildcard) {
            intent.putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes);
        }
        launchForResult(call, intent, "openFileResult");
    }

    /** UI thread (ActivityResult callback). {@code call} is null after process death. */
    @ActivityCallback
    @SuppressWarnings("unused") // invoked by Capacitor by name
    private void openFileResult(@Nullable final PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        getBridge().releaseCall(call);
        final Uri uri = resultUri(result);
        if (uri == null) {
            call.resolve(new JSObject().put("canceled", true));
            return;
        }
        final long maxBytes = readMaxBytes(call);
        execute(() -> call.resolve(readDocument(uri, maxBytes)));
    }

    /** Plugin thread. */
    private JSObject readDocument(Uri uri, long maxBytes) {
        JSObject ret = new JSObject().put("canceled", false);
        ContentResolver resolver = getContext().getContentResolver();
        String name = queryDisplayName(resolver, uri);
        if (name != null) {
            ret.put("name", name);
        }
        try (InputStream in = resolver.openInputStream(uri)) {
            if (in == null) {
                return ret.put("error", "read_failed");
            }
            ByteArrayOutputStream buffer = new ByteArrayOutputStream((int) Math.min(maxBytes + 1, 64 * 1024));
            byte[] chunk = new byte[16 * 1024];
            long total = 0;
            while (total <= maxBytes) {
                int wanted = (int) Math.min(chunk.length, maxBytes + 1 - total);
                int n = in.read(chunk, 0, wanted);
                if (n < 0) {
                    break;
                }
                if (n == 0) {
                    // Violates the InputStream contract; bail out instead of spinning.
                    throw new IOException("zero-length read");
                }
                buffer.write(chunk, 0, n);
                total += n;
            }
            if (total > maxBytes) {
                return ret.put("tooLarge", true);
            }
            String text = new String(buffer.toByteArray(), StandardCharsets.UTF_8);
            if (!text.isEmpty() && text.charAt(0) == '﻿') {
                text = text.substring(1);
            }
            return ret.put("data", text);
        } catch (IOException | RuntimeException e) {
            Logger.error(LOG_TAG, "openFile: læsning fejlede (" + e.getClass().getSimpleName() + ")", null);
            return ret.put("error", "read_failed");
        }
    }

    @Nullable
    private static String queryDisplayName(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0 && !cursor.isNull(index)) {
                    String name = cursor.getString(index);
                    if (name != null && name.length() > MAX_DISPLAY_NAME_LENGTH) {
                        name = name.substring(0, MAX_DISPLAY_NAME_LENGTH);
                    }
                    return name;
                }
            }
        } catch (RuntimeException e) {
            Logger.error(LOG_TAG, "openFile: filnavn kunne ikke læses (" + e.getClass().getSimpleName() + ")", null);
        }
        return null;
    }

    /**
     * shareFile({fileName, mimeType, data, title}): writes data to
     * cache/exports/<sanitised name> (older exports are deleted first), and opens
     * the share sheet (ACTION_SEND through the FileProvider) with the given title.
     * Resolves {shared: true} once the chooser is launched, otherwise
     * {shared: false, error: 'write_failed' | 'no_app'}.
     */
    @PluginMethod
    public void shareFile(final PluginCall call) {
        String fileName = call.getString("fileName");
        String mimeType = call.getString("mimeType");
        String data = call.getString("data");
        String title = call.getString("title");
        if (isBlank(fileName) || isBlank(mimeType) || data == null || title == null) {
            call.reject("shareFile: fileName, mimeType, data og title skal angives", "INVALID_ARGUMENT");
            return;
        }
        Context context = getContext();
        File dir = new File(context.getCacheDir(), EXPORT_DIR);
        deleteChildren(dir);
        if (!dir.isDirectory() && !dir.mkdirs()) {
            Logger.error(LOG_TAG, "shareFile: eksportmappen kunne ikke oprettes", null);
            call.resolve(new JSObject().put("shared", false).put("error", "write_failed"));
            return;
        }
        String safeName = sanitizeFileName(fileName);
        File file = new File(dir, safeName);
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(data.getBytes(StandardCharsets.UTF_8));
        } catch (IOException e) {
            Logger.error(LOG_TAG, "shareFile: skrivning fejlede (" + e.getClass().getSimpleName() + ")", null);
            deleteQuietly(file);
            call.resolve(new JSObject().put("shared", false).put("error", "write_failed"));
            return;
        }

        final Uri uri;
        try {
            uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file);
        } catch (IllegalArgumentException e) {
            Logger.error(LOG_TAG, "shareFile: FileProvider afviste filen", null);
            deleteQuietly(file);
            call.resolve(new JSObject().put("shared", false).put("error", "write_failed"));
            return;
        }

        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType(mimeType);
        send.putExtra(Intent.EXTRA_STREAM, uri);
        // ClipData makes the read grant reach the chosen app (createChooser migrates it).
        send.setClipData(ClipData.newRawUri(safeName, uri));
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        final Intent chooser = Intent.createChooser(send, title);

        getActivity().runOnUiThread(() -> {
            try {
                getActivity().startActivity(chooser);
                call.resolve(new JSObject().put("shared", true));
            } catch (ActivityNotFoundException e) {
                call.resolve(new JSObject().put("shared", false).put("error", "no_app"));
            }
        });
    }

    /** clearExportCache(): deletes everything in cache/exports/. Called on start-up. */
    @PluginMethod
    public void clearExportCache(PluginCall call) {
        deleteChildren(new File(getContext().getCacheDir(), EXPORT_DIR));
        call.resolve();
    }

    /**
     * Keeps [A-Za-z0-9._-], replaces everything else with '_', strips leading dots
     * (no hidden files, no "." or ".."), and limits the length to 80 characters
     * while keeping a short extension.
     */
    static String sanitizeFileName(String name) {
        String safe = name.replaceAll("[^A-Za-z0-9._-]", "_");
        int start = 0;
        while (start < safe.length() && safe.charAt(start) == '.') {
            start++;
        }
        safe = safe.substring(start);
        if (safe.length() > MAX_EXPORT_NAME_LENGTH) {
            int dot = safe.lastIndexOf('.');
            String extension = (dot > 0 && safe.length() - dot <= 10) ? safe.substring(dot) : "";
            safe = safe.substring(0, MAX_EXPORT_NAME_LENGTH - extension.length()) + extension;
        }
        return safe.isEmpty() ? "saloona-eksport" : safe;
    }

    // ------------------------------------------------------------------------
    // Phone
    // ------------------------------------------------------------------------

    /** dial({number}): opens the dialer (ACTION_DIAL). Needs no CALL_PHONE permission. */
    @PluginMethod
    public void dial(PluginCall call) {
        startPhoneIntent(call, Intent.ACTION_DIAL, "tel");
    }

    /** sms({number}): opens the SMS app (ACTION_SENDTO smsto:). Needs no SMS permission. */
    @PluginMethod
    public void sms(PluginCall call) {
        startPhoneIntent(call, Intent.ACTION_SENDTO, "smsto");
    }

    /** Re-validates the number here, so JS can never send anything else to another app. */
    private void startPhoneIntent(final PluginCall call, String action, String scheme) {
        String number = call.getString("number");
        if (number == null || !PHONE_NUMBER.matcher(number).matches()) {
            call.reject("Ugyldigt telefonnummer", "INVALID_ARGUMENT");
            return;
        }
        final Intent intent = new Intent(action, Uri.fromParts(scheme, number, null));
        getActivity().runOnUiThread(() -> {
            try {
                getActivity().startActivity(intent);
                call.resolve();
            } catch (ActivityNotFoundException e) {
                call.reject("Ingen app kan håndtere det", "NO_APP");
            }
        });
    }

    // ------------------------------------------------------------------------
    // Haptics
    // ------------------------------------------------------------------------

    /**
     * haptic({kind}): View.performHapticFeedback on the WebView. Respects the
     * system's touch-feedback setting and needs no VIBRATE permission.
     * confirm: CONFIRM (API 30+) else VIRTUAL_KEY; reject: REJECT (API 30+) else
     * LONG_PRESS; tick: CLOCK_TICK.
     */
    @PluginMethod
    public void haptic(final PluginCall call) {
        String kind = call.getString("kind");
        final int feedback;
        if ("confirm".equals(kind)) {
            feedback = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                ? HapticFeedbackConstants.CONFIRM
                : HapticFeedbackConstants.VIRTUAL_KEY;
        } else if ("reject".equals(kind)) {
            feedback = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                ? HapticFeedbackConstants.REJECT
                : HapticFeedbackConstants.LONG_PRESS;
        } else if ("tick".equals(kind)) {
            feedback = HapticFeedbackConstants.CLOCK_TICK;
        } else {
            call.reject("haptic: ukendt kind", "INVALID_ARGUMENT");
            return;
        }
        getActivity().runOnUiThread(() -> {
            View webView = getBridge().getWebView();
            if (webView != null) {
                webView.performHapticFeedback(feedback);
            }
            call.resolve();
        });
    }

    // ------------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------------

    /**
     * Starts a system activity through Capacitor's ActivityResult launcher.
     * If no app can handle it the saved call is released and the call rejected.
     */
    private void launchForResult(PluginCall call, Intent intent, String callbackName) {
        try {
            startActivityForResult(call, intent, callbackName);
        } catch (ActivityNotFoundException e) {
            getBridge().releaseCall(call);
            call.reject("Ingen app kan håndtere det", "NO_APP");
        }
    }

    /** The document Uri of a successful picker result, or null when canceled. */
    @Nullable
    private static Uri resultUri(ActivityResult result) {
        if (result == null || result.getResultCode() != Activity.RESULT_OK) {
            return null;
        }
        Intent data = result.getData();
        return data != null ? data.getData() : null;
    }

    /** maxBytes arrives as Integer, Long or Double depending on its size in JSON. */
    private static long readMaxBytes(PluginCall call) {
        Object value = call.getData().opt("maxBytes");
        if (value instanceof Number) {
            double d = ((Number) value).doubleValue();
            if (!Double.isNaN(d) && !Double.isInfinite(d)) {
                return (long) Math.floor(d);
            }
        }
        return -1;
    }

    private static String[] readMimeTypes(PluginCall call) {
        List<String> types = new ArrayList<>();
        JSArray array = call.getArray("mimeTypes");
        if (array != null) {
            for (int i = 0; i < array.length(); i++) {
                Object value = array.opt(i);
                if (value instanceof String && !((String) value).trim().isEmpty()) {
                    types.add(((String) value).trim());
                }
            }
        }
        return types.toArray(new String[0]);
    }

    private static boolean isBlank(@Nullable String value) {
        return value == null || value.trim().isEmpty();
    }

    /** Deletes the contents of {@code dir} (recursively), not the directory itself. */
    private static void deleteChildren(File dir) {
        File[] children = dir.listFiles();
        if (children == null) {
            return;
        }
        for (File child : children) {
            if (child.isDirectory()) {
                deleteChildren(child);
            }
            deleteQuietly(child);
        }
    }

    private static void deleteQuietly(File file) {
        if (file.exists() && !file.delete()) {
            Logger.error(LOG_TAG, "eksportfil kunne ikke slettes", null);
        }
    }

    private static void closeQuietly(@Nullable OutputStream stream) {
        if (stream == null) {
            return;
        }
        try {
            stream.close();
        } catch (IOException ignored) {
            // Nothing useful to do; the write result has already been decided.
        }
    }
}
