# ProGuard / R8 rules for Isaac POS Android (Capacitor + PosNativeHardwarePlugin + Capgo OTA + ML Kit + Biometric)
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod,SourceFile,LineNumberTable

# Capacitor bridge & custom native plugins invoked via reflection
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod <methods>;
    @com.getcapacitor.annotation.ActivityCallback <methods>;
    @com.getcapacitor.annotation.PermissionCallback <methods>;
    @android.webkit.JavascriptInterface <methods>;
}

# Capgo Capacitor Updater (OTA) - preservar clases cargadas por reflexión
-keep class ee.forgr.capacitor_updater.** { *; }
-dontwarn ee.forgr.capacitor_updater.**

# ML Kit Barcode & Text Recognition
-keep class com.google.mlkit.** { *; }
-dontwarn com.google.mlkit.**

# AndroidX Biometric & CameraX
-keep class androidx.biometric.** { *; }
-keep class com.isaacpos.app.NativeVisionScannerActivity { *; }
-dontwarn androidx.camera.**
