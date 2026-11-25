package com.isaacpos.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
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

        applyImeAndSystemBarInsets();
        configurePosWebView();
        registerPredictiveBackHandler();
    }

    private void applyImeAndSystemBarInsets() {
        // En Android 15+ (API 35+), Edge-to-Edge es obligatorio y adjustResize no encoge el WebView por sí solo;
        // en API <= 34 adjustResize ya redimensiona la ventana nativamente (evita doble padding).
        if (Build.VERSION.SDK_INT < 35) {
            return;
        }
        View contentView = findViewById(android.R.id.content);
        if (contentView == null) {
            return;
        }
        ViewCompat.setOnApplyWindowInsetsListener(contentView, (view, windowInsets) -> {
            boolean imeVisible = windowInsets.isVisible(WindowInsetsCompat.Type.ime());
            Insets sysBars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars());
            Insets imeInsets = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
            int extraImeBottom = imeVisible ? Math.max(0, imeInsets.bottom - sysBars.bottom) : 0;
            view.setPadding(0, 0, 0, extraImeBottom);
            return windowInsets;
        });
    }

    private void configurePosWebView() {
        try {
            if (getBridge() == null || getBridge().getWebView() == null) {
                return;
            }
            WebView webView = getBridge().getWebView();

            // Desactivar overscroll innecesario para fluidez en catálogo largo
            webView.setOverScrollMode(View.OVER_SCROLL_NEVER);

            WebSettings settings = webView.getSettings();

            // Pre-rasterizado fuera de pantalla (elimina cuadros blancos durante scroll rápido)
            settings.setOffscreenPreRaster(true);

            // Almacenamiento local DOM y caché estándar
            settings.setDomStorageEnabled(true);
            settings.setCacheMode(WebSettings.LOAD_DEFAULT);

            // Reproducción de cámara/escáner sin toque adicional
            settings.setMediaPlaybackRequiresUserGesture(false);

            // Permitir peticiones a servidores LAN RFC1918 desde origen HTTPS local de Capacitor
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);

            // SafeBrowsing activo (protección contra phishing/malware en navegación externa)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                settings.setSafeBrowsingEnabled(true);
            }

            // Descargas permitidas solo por HTTPS público o HTTP hacia LAN privada RFC1918
            webView.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> {
                if (!NativeHardwareUtils.isAllowedDownloadOrExternalUrl(url)) {
                    Toast.makeText(
                        MainActivity.this,
                        "Descarga bloqueada: solo se permite HTTPS o servidor POS en red local.",
                        Toast.LENGTH_SHORT
                    ).show();
                    return;
                }
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                } catch (Exception ignored) {}
            });
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void registerPredictiveBackHandler() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (getBridge() == null || getBridge().getWebView() == null) {
                    finish();
                    return;
                }

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
                        if (NativeHardwareUtils.isJsBackHandled(result)) {
                            return;
                        }
                        runOnUiThread(() -> {
                            if (isFinishing() || isDestroyed()) {
                                return;
                            }
                            long currentTime = System.currentTimeMillis();
                            if (currentTime - lastBackPressTime < 2000) {
                                if (exitToast != null) exitToast.cancel();
                                finish();
                            } else {
                                lastBackPressTime = currentTime;
                                if (exitToast != null) exitToast.cancel();
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
            }
        });
    }
}
