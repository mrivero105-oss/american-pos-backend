# ProGuard / R8 rules for Isaac POS Android (Capacitor + PosNativeHardwarePlugin + ML Kit + Biometric)
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
-keep class com.isaacpos.app.** { *; }

# ML Kit Barcode & Text Recognition
-keep class com.google.mlkit.** { *; }
-dontwarn com.google.mlkit.**

# AndroidX Biometric
-keep class androidx.biometric.** { *; }
