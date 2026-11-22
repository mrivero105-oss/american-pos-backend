# ProGuard / R8 Rules — Generador de Licencias Isaac POS (com.isaacpos.licgen)

# Preservar atributos de anotaciones y firmas genéricas para interoperabilidad WebView
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod

# Preservar la actividad principal y su puente JavaScript AndroidBridge (copyText / readClipboard)
-keep class com.isaacpos.licgen.MainActivity { *; }
-keep class com.isaacpos.licgen.MainActivity$AndroidBridge { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
