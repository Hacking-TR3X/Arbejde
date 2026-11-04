package dk.dashcam

import android.app.Application

class DashcamApp : Application() {
    override fun onCreate() {
        super.onCreate()
        CameraSession.init(this)
    }
}
