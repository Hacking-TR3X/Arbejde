plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "dk.loopcast"
    compileSdk = 35

    defaultConfig {
        applicationId = "dk.loopcast"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    // One shared keystore so every build from CI can be installed on top of the
    // previous one without uninstalling first. It only protects a side-loaded
    // hobby app, so the password is intentionally not secret.
    signingConfigs {
        create("shared") {
            storeFile = file("keystore/loopcast.jks")
            storePassword = "loopcast"
            keyAlias = "loopcast"
            keyPassword = "loopcast"
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("shared")
        }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("shared")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        viewBinding = true
    }

    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.recyclerview:recyclerview:1.3.2")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.mediarouter:mediarouter:1.7.0")
    implementation("com.google.android.material:material:1.12.0")

    // Google Cast (Chromecast / Google Nest)
    implementation("com.google.android.gms:play-services-cast-framework:22.0.0")

    // Networking + tiny local HTTP server that relays the SoundCloud stream to the Nest
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.nanohttpd:nanohttpd:2.3.1")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
