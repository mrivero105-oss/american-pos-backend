package com.isaacpos.app;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private long lastBackPressTime = 0;
    private Toast exitToast = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PosNativeHardwarePlugin.class);
        super.onCreate(savedInstanceState);
        // Mantener pantalla encendida durante la operación del terminal POS
        try {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        } catch (Exception ignored) {}
    }

    @Override
    public void onStart() {
        super.onStart();
        try {
            if (getBridge() != null && getBridge().getWebView() != null) {
                WebView webView = getBridge().getWebView();
                
                // Desactivar overscroll que ralentiza la GPU en Android
                webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
                
                // Capa de aceleración por hardware dedicada
                webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
                
                WebSettings settings = webView.getSettings();
                
                // Pre-rasterizado fuera de pantalla (elimina cuadros blancos durante el scroll rápido)
                settings.setOffscreenPreRaster(true);
                
                // Prioridad alta de procesamiento gráfico para el hilo de Chromium
                settings.setRenderPriority(WebSettings.RenderPriority.HIGH);
                
                // Almacenamiento local ultrarrápido y caché
                settings.setDomStorageEnabled(true);
                settings.setDatabaseEnabled(true);
                settings.setCacheMode(WebSettings.LOAD_DEFAULT);
                
                // Habilitar reproducción de cámara/video sin requerir toque manual
                settings.setMediaPlaybackRequiresUserGesture(false);

                // Permitir contenido mixto y peticiones a servidores LAN
                settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
                
                // Desactivar comprobación de safe browsing para evitar latencias de red en LAN
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    settings.setSafeBrowsingEnabled(false);
                }

                // Permitir descarga directa de actualizaciones APK desde el WebView abriendo el navegador del sistema
                webView.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> {
                    try {
                        android.content.Intent i = new android.content.Intent(android.content.Intent.ACTION_VIEW);
                        i.setData(android.net.Uri.parse(url));
                        i.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(i);
                    } catch (Exception ignored) {}
                });
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @Override
    public void onBackPressed() {
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().evaluateJavascript(
                "(function() { " +
                "  if (typeof window.__handleMobileBackButton === 'function') { " +
                "    var res = window.__handleMobileBackButton(); " +
                "    if (res === 'handled' || res === true) return 'handled'; " +
                "  } " +
                "  var escEvt = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true }); " +
                "  var defaultPrevented = !document.dispatchEvent(escEvt); " +
                "  if (defaultPrevented) return 'handled'; " +
                "  var modal = document.querySelector('.modal-solid, [role=\"dialog\"], .ticket-preview, #barcode-modal'); " +
                "  var closeBtn = document.querySelector('[title*=\"Cerrar\"], [aria-label*=\"Cerrar\"], [title*=\"Esc\"]'); " +
                "  if (closeBtn && modal) { closeBtn.click(); return 'handled'; } " +
                "  return 'unhandled'; " +
                "})()",
                result -> {
                    if (result != null && result.contains("handled")) {
                        return;
                    }
                    runOnUiThread(() -> {
                        long currentTime = System.currentTimeMillis();
                        if (currentTime - lastBackPressTime < 2000) {
                            if (exitToast != null) exitToast.cancel();
                            MainActivity.super.onBackPressed();
                        } else {
                            lastBackPressTime = currentTime;
                            exitToast = Toast.makeText(
                                MainActivity.this,
                                "Presiona Atrás otra vez para salir",
                                Toast.LENGTH_SHORT
                            );
                            exitToast.show();
                        }
                    });
                }
            );
            return;
        }
        super.onBackPressed();
    }
}
