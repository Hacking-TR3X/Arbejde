package dk.saloona.app;

import android.graphics.Color;
import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AlertDialog;
import androidx.core.splashscreen.SplashScreen;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Logger;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // androidx core-splashscreen (launch theme AppTheme.NoActionBarLaunch ->
        // postSplashScreenTheme). Must run before super.onCreate. Capacitor 8.5.2's
        // BridgeActivity does not install it itself, so this is the only call.
        SplashScreen.installSplashScreen(this);

        // Must be registered before super.onCreate, which builds the bridge.
        registerPlugin(SaloonaNativePlugin.class);

        // App lock is on: hide the window from screenshots and Recents before the
        // WebView draws anything. The window exists already (Activity.attach).
        if (SaloonaNativePlugin.isSecureScreenEnabled(this)) {
            SaloonaNativePlugin.applySecureFlag(getWindow(), true);
        }

        super.onCreate(savedInstanceState);

        // Let the theme's DayNight window background show until the web app's first
        // paint (html/body set their own background), so dark mode gets no white flash.
        Bridge currentBridge = getBridge();
        if (currentBridge != null && currentBridge.getWebView() != null) {
            currentBridge.getWebView().setBackgroundColor(Color.TRANSPARENT);
        }

        registerBackHandler();
        warnIfWebViewTooOld();
    }

    /**
     * Capacitor has no back handling without @capacitor/app, which we do not use.
     * The web app uses history.pushState for sub-pages and bottom sheets, so the
     * back gesture/button goes back in the WebView history (fires popstate) while
     * there is any. On the root screen the callback steps aside so Android does its
     * normal thing (the app goes to the background).
     */
    private void registerBackHandler() {
        getOnBackPressedDispatcher().addCallback(
            this,
            new OnBackPressedCallback(true) {
                @Override
                public void handleOnBackPressed() {
                    Bridge currentBridge = getBridge();
                    WebView webView = currentBridge != null ? currentBridge.getWebView() : null;
                    if (webView != null && webView.canGoBack()) {
                        webView.goBack();
                        return;
                    }
                    setEnabled(false);
                    try {
                        getOnBackPressedDispatcher().onBackPressed();
                    } finally {
                        setEnabled(true);
                    }
                }
            }
        );
    }

    /**
     * Capacitor injects its JS bridge with WebViewCompat.addDocumentStartJavaScript.
     * Without DOCUMENT_START_SCRIPT it falls back to rewriting index.html, and a
     * WebView that old also cannot run our ES2022 bundle. Tell the user what to do
     * instead of showing a blank screen.
     */
    private void warnIfWebViewTooOld() {
        boolean supported;
        try {
            supported = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT);
        } catch (RuntimeException e) {
            // No usable WebView provider at all.
            Logger.error(Logger.tags("SaloonaNative"), "WebView-tjek fejlede (" + e.getClass().getSimpleName() + ")", null);
            supported = false;
        }
        if (supported) {
            return;
        }
        new AlertDialog.Builder(this)
            .setTitle("WebView skal opdateres")
            .setMessage("Opdatér Android System WebView fra Google Play for at bruge Saloona.")
            .setCancelable(false)
            .setPositiveButton("Luk", (dialog, which) -> finish())
            .setNegativeButton("Fortsæt alligevel", (dialog, which) -> dialog.dismiss())
            .show();
    }
}
