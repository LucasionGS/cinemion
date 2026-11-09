plugins {
  id("com.android.application")
}

val appVersion = "1.0.0"

// Derived from the version, so a newer version always has a higher code and the two can't drift: 1.2.3 gives 10203
val appVersionCode = appVersion.split(".").map { it.toInt() }.let { (major, minor, patch) -> major * 10000 + minor * 100 + patch }

// The release key comes from the environment (CI, or the owner's machine); without it a release is signed with the
// debug key, so a plain `assembleRelease` still produces an installable APK.
val keystorePath: String? = System.getenv("CINEMION_TV_KEYSTORE")

android {
  namespace = "dev.ionnet.cinemion"
  compileSdk = 36

  defaultConfig {
    applicationId = "dev.ionnet.cinemion"
    minSdk = 24
    targetSdk = 36
    versionCode = appVersionCode
    versionName = appVersion
    buildConfigField("String", "UPDATE_URL", "\"https://api.github.com/repos/LucasionGS/cinemion/releases/latest\"")
  }

  buildFeatures {
    buildConfig = true
  }

  signingConfigs {
    if (keystorePath != null) {
      create("release") {
        storeFile = file(keystorePath)
        storePassword = System.getenv("CINEMION_TV_KEYSTORE_PASSWORD")
        keyAlias = System.getenv("CINEMION_TV_KEY_ALIAS")
        keyPassword = System.getenv("CINEMION_TV_KEY_PASSWORD")
      }
    }
  }

  buildTypes {
    debug {
      // Debug builds look for updates on the emulator's host, so the update flow can be tried without a release
      buildConfigField("String", "UPDATE_URL", "\"http://10.0.2.2:8701/releases/latest\"")
    }
    release {
      isMinifyEnabled = true
      isShrinkResources = true
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
      signingConfig = signingConfigs.getByName(if (keystorePath != null) "release" else "debug")
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
}

dependencies {
  implementation("androidx.webkit:webkit:1.15.0")
  implementation("androidx.core:core-ktx:1.17.0")
}

// The release APK under the name the GitHub release and the self-updater expect: cinemion-tv-<version>.apk
val publishReleaseApk = tasks.register<Copy>("publishReleaseApk") {
  from(layout.buildDirectory.dir("outputs/apk/release")) {
    include("*.apk")
  }
  into(layout.buildDirectory.dir("outputs/tv"))
  rename { "cinemion-tv-$appVersion.apk" }
}

tasks.matching { it.name == "assembleRelease" }.configureEach {
  finalizedBy(publishReleaseApk)
}
