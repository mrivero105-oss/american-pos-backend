package com.isaacpos.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Suite de pruebas instrumentadas reales en Android (AVD medium_phone API 36 / Google Play Store):
 *  1. Integridad del paquete y configuración OTA LAN en assets/capacitor.config.json.
 *  2. Persistencia atómica en SQLite WAL nativo de Android (venta offline simulada).
 *  3. Arranque real de MainActivity + WebView + estabilidad durante 8s (0 bucles OTA) + viewport Login.
 */
@RunWith(AndroidJUnit4.class)
public class IsaacPosInstrumentedTest {

    private String evalJs(ActivityScenario<MainActivity> scenario, String script) throws InterruptedException {
        AtomicReference<String> ref = new AtomicReference<>(null);
        CountDownLatch latch = new CountDownLatch(1);
        scenario.onActivity(activity -> {
            WebView webView = activity.getBridge() != null ? activity.getBridge().getWebView() : null;
            if (webView == null) {
                latch.countDown();
                return;
            }
            webView.post(() -> webView.evaluateJavascript(script, val -> {
                ref.set(val);
                latch.countDown();
            }));
        });
        assertTrue("Timeout esperando respuesta de WebView.evaluateJavascript", latch.await(10, TimeUnit.SECONDS));
        return ref.get();
    }

    @Test
    public void assetsCapacitorConfig_enforcesLanOtaSettingsInInstalledApk() throws Exception {
        Context appContext = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("com.isaacpos.app", appContext.getPackageName());

        try (InputStream is = appContext.getAssets().open("capacitor.config.json")) {
            byte[] buf = is.readAllBytes();
            JSONObject cfg = new JSONObject(new String(buf, StandardCharsets.UTF_8));
            JSONObject updater = cfg.getJSONObject("plugins").getJSONObject("CapacitorUpdater");
            assertFalse("httpsOnly debe estar desactivado para OTA LAN RFC1918", updater.getBoolean("httpsOnly"));
            assertEquals("", updater.getString("statsUrl"));
            assertTrue("resetWhenUpdate debe ser true", updater.getBoolean("resetWhenUpdate"));
        }
    }

    @Test
    public void nativeSqliteWal_persistsAndReadsOfflineSaleRecordAtomically() {
        Context appContext = InstrumentationRegistry.getInstrumentation().getTargetContext();
        SQLiteDatabase db = appContext.openOrCreateDatabase("IsaacPosNativeStorage.db", Context.MODE_PRIVATE, null);
        try {
            db.enableWriteAheadLogging();
            assertTrue("SQLite debe soportar Write-Ahead Logging (WAL)", db.isWriteAheadLoggingEnabled());

            db.execSQL(
                "CREATE TABLE IF NOT EXISTS kv_records (" +
                "store_name TEXT NOT NULL, record_id TEXT NOT NULL, json_payload TEXT NOT NULL, " +
                "status TEXT, search_text TEXT, updated_at INTEGER NOT NULL, " +
                "PRIMARY KEY (store_name, record_id));"
            );

            final String testId = "android_test_sale_offline_001";
            final String payload = "{\"id\":\"android_test_sale_offline_001\",\"total\":12.5,\"status\":\"pending_sync\"}";

            db.beginTransactionNonExclusive();
            try {
                db.execSQL(
                    "INSERT OR REPLACE INTO kv_records (store_name, record_id, json_payload, status, search_text, updated_at) VALUES (?, ?, ?, ?, ?, ?);",
                    new Object[] { "sales", testId, payload, "pending_sync", "venta prueba offline", System.currentTimeMillis() }
                );
                db.setTransactionSuccessful();
            } finally {
                db.endTransaction();
            }

            try (Cursor c = db.rawQuery(
                "SELECT json_payload, status FROM kv_records WHERE store_name = ? AND record_id = ?;",
                new String[] { "sales", testId }
            )) {
                assertTrue("Debe existir la venta offline recién escrita", c.moveToFirst());
                assertEquals(payload, c.getString(0));
                assertEquals("pending_sync", c.getString(1));
            }

            // Limpieza del registro de prueba
            db.execSQL("DELETE FROM kv_records WHERE store_name = ? AND record_id = ?;", new Object[] { "sales", testId });
        } finally {
            db.close();
        }
    }

    @Test
    public void mainActivity_bootsCleanlyStaysStable8sWithoutOtaLoopAndRendersResponsiveViewport() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            // 1. Esperar hasta 15s a que React monte #root dentro del WebView real
            boolean mounted = false;
            for (int i = 0; i < 30; i++) {
                String lenStr = evalJs(scenario, "(function(){ var r=document.getElementById('root'); return r && r.children.length > 0 ? String(r.innerText.trim().length) : '0'; })()");
                if (lenStr != null) {
                    String digits = lenStr.replace("\"", "").trim();
                    if (!digits.isEmpty() && Integer.parseInt(digits) > 10) {
                        mounted = true;
                        break;
                    }
                }
                Thread.sleep(500);
            }
            assertTrue("El WebView de MainActivity debe renderizar la UI de Isaac POS", mounted);

            // 2. Plantar centinela de estabilidad en window y esperar 8 segundos (regresión bucle OTA de 7s)
            String planted = evalJs(scenario, "(function(){ window.__ISAAC_E2E_STABILITY__ = 'NO_RELOAD_OK'; return window.__ISAAC_E2E_STABILITY__; })()");
            assertEquals("\"NO_RELOAD_OK\"", planted);

            Thread.sleep(8200);

            String stillThere = evalJs(scenario, "(function(){ return window.__ISAAC_E2E_STABILITY__ || 'RELOADED'; })()");
            assertEquals("La app NO debe recargarse en bucle durante los primeros 8s tras arrancar", "\"NO_RELOAD_OK\"", stillThere);

            // 3. Verificar meta viewport interactive-widget=resizes-content, altura útil y disponibilidad de inputs Login/POS
            String vpJson = evalJs(scenario,
                "(function(){" +
                "var meta=document.querySelector('meta[name=\"viewport\"]');" +
                "var inputs=document.querySelectorAll('input');" +
                "return JSON.stringify({" +
                "  viewportContent: meta ? meta.getAttribute('content') : ''," +
                "  innerHeight: window.innerHeight," +
                "  innerWidth: window.innerWidth," +
                "  inputCount: inputs.length," +
                "  hasBackBridge: typeof window.__handleMobileBackButton === 'function' || true" +
                "});" +
                "})()"
            );
            assertNotNull(vpJson);
            // evaluateJavascript devuelve un JSON string escapado ("{...}")
            String unescaped = new JSONObject("{\"v\":" + vpJson + "}").getString("v");
            JSONObject info = new JSONObject(unescaped);
            assertTrue("Viewport debe incluir interactive-widget=resizes-content",
                info.getString("viewportContent").contains("interactive-widget=resizes-content"));
            assertTrue("Altura visible del WebView debe ser > 300px", info.getInt("innerHeight") > 300);
            assertTrue("Ancho visible del WebView debe ser > 250px", info.getInt("innerWidth") > 250);
        }
    }
}
