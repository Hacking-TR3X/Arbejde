# Saloona – R8 rules for the release build.
#
# Principle: keep rather too much than too little. A crash in the release
# build (for example when the encrypted database is opened) is far worse than
# a slightly larger APK. Every rule says why it is here; "consumer rules" means
# the library ships its own rules, which R8 applies automatically.

# Readable stack traces in logcat. There is no crash reporting; class and line
# numbers contain no personal data.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Capacitor finds plugins, @PluginMethod, @ActivityCallback and
# @PermissionCallback by reflection and reads the annotations at runtime.
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod

# --- Capacitor core -----------------------------------------------------------
# Ships consumer rules (node_modules/@capacitor/android/capacitor/proguard-rules.pro)
# that keep @CapacitorPlugin classes and their annotated methods. The core is
# kept whole anyway: plugin classes are loaded by name from
# assets/capacitor.plugins.json, and R8 full mode (AGP 8 default) is stricter
# about constructors and annotations than those rules were written for.
-keep class com.getcapacitor.** { *; }
# Cordova framework bundled with Capacitor (reflection-based plugin loading).
-keep class org.apache.cordova.** { *; }

# --- Our own code ---------------------------------------------------------------
# SaloonaNativePlugin: method names are the JS API, @ActivityCallback methods
# are looked up by name.
-keep class dk.saloona.app.** { *; }

# --- @capacitor-community/sqlite ------------------------------------------------
# No consumer rules shipped (checked: android/ has no proguard file).
-keep class com.getcapacitor.community.database.sqlite.** { *; }

# SQLCipher (net.zetetic:sqlcipher-android 4.17.0) ships consumer rules that keep
# net.zetetic.database.** and its JNI methods (checked in the AAR's proguard.txt).
# Repeated here so an upstream change cannot break opening the database.
-keep,includedescriptorclasses class net.zetetic.database.** { *; }
-keep,includedescriptorclasses interface net.zetetic.database.** { *; }
-dontwarn net.zetetic.database.**

# androidx.sqlite interfaces that SQLCipher implements and the plugin calls.
-keep class androidx.sqlite.** { *; }

# androidx.security.crypto + Tink: EncryptedSharedPreferences holds the key for
# the database. Tink 1.8.0 ships only a protobuf rule (META-INF/proguard/protobuf.pro),
# and its shaded protobuf uses reflection, so Tink is kept whole.
-keep class androidx.security.crypto.** { *; }
-keep class com.google.crypto.tink.** { *; }
# Tink 1.8.0 references optional classes that are not on the classpath
# (checked with javap: KeysDownloader -> google-http-client, joda-time;
# errorprone/javax annotations). R8 in AGP 8 fails on missing classes otherwise.
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.**
-dontwarn com.google.api.client.http.**
-dontwarn org.joda.time.**

# --- @capacitor/local-notifications (Kotlin) ------------------------------------
# No consumer rules shipped (checked). Receivers and the provider are kept by the
# manifest anyway; the rest is small, so keep it whole.
-keep class com.capacitorjs.plugins.localnotifications.** { *; }

# --- AndroidX used by our plugin -------------------------------------------------
# BiometricPrompt recreates its fragments and ViewModel by reflection.
-keep class androidx.biometric.** { *; }
# Capacitor uses WebViewCompat (document-start script, WebMessageListener);
# androidx.webkit talks to the WebView APK through boundary interfaces.
-keep class androidx.webkit.** { *; }
-keep class org.chromium.support_lib_boundary.** { *; }
