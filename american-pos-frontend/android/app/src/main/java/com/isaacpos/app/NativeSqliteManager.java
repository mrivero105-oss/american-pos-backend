package com.isaacpos.app;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.database.sqlite.SQLiteStatement;
import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/**
 * Motor SQLite nativo Android en modo WAL con transacciones ACID precompiladas
 * y cola serial dedicada para persistencia offline sin bloqueo del WebView.
 */
final class NativeSqliteManager {

    private static final String SQLITE_DB_NAME = "IsaacPosNativeStorage.db";
    private static final int SQLITE_DB_VERSION = 1;
    private static PosNativeSqliteHelper sqliteHelperInstance = null;

    private final Context appContext;
    private final ExecutorService sqliteExecutor = Executors.newSingleThreadExecutor();

    NativeSqliteManager(Context context) {
        this.appContext = context.getApplicationContext();
    }

    private static synchronized PosNativeSqliteHelper getSqliteHelper(Context context) {
        if (sqliteHelperInstance == null) {
            sqliteHelperInstance = new PosNativeSqliteHelper(context.getApplicationContext());
        }
        return sqliteHelperInstance;
    }

    private static final class PosNativeSqliteHelper extends SQLiteOpenHelper {
        PosNativeSqliteHelper(Context context) {
            super(context, SQLITE_DB_NAME, null, SQLITE_DB_VERSION);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
                setWriteAheadLoggingEnabled(true);
            }
        }

        @Override
        public void onConfigure(SQLiteDatabase db) {
            super.onConfigure(db);
            try {
                db.enableWriteAheadLogging();
            } catch (Exception ignored) {}
            try {
                db.execSQL("PRAGMA synchronous = NORMAL;");
                db.execSQL("PRAGMA temp_store = MEMORY;");
            } catch (Exception ignored) {}
        }

        @Override
        public void onCreate(SQLiteDatabase db) {
            db.execSQL(
                "CREATE TABLE IF NOT EXISTS kv_records (" +
                "store_name TEXT NOT NULL, " +
                "record_id TEXT NOT NULL, " +
                "json_payload TEXT NOT NULL, " +
                "status TEXT, " +
                "search_text TEXT, " +
                "updated_at INTEGER NOT NULL, " +
                "PRIMARY KEY (store_name, record_id)" +
                ");"
            );
            db.execSQL("CREATE INDEX IF NOT EXISTS idx_kv_store_status ON kv_records(store_name, status);");
            db.execSQL("CREATE INDEX IF NOT EXISTS idx_kv_store_search ON kv_records(store_name, search_text);");
        }

        @Override
        public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
            onCreate(db);
        }
    }

    void put(PluginCall call) {
        final String storeName = call.getString("storeName");
        final String recordId = call.getString("recordId");
        final String jsonPayload = call.getString("jsonPayload");
        final String status = call.getString("status", "");
        final String searchText = call.getString("searchText", "");

        if (storeName == null || recordId == null || jsonPayload == null) {
            call.reject("Parámetros incompletos para sqlitePut");
            return;
        }

        sqliteExecutor.execute(() -> {
            SQLiteStatement stmt = null;
            try {
                SQLiteDatabase db = getSqliteHelper(appContext).getWritableDatabase();
                stmt = db.compileStatement(
                    "INSERT OR REPLACE INTO kv_records (store_name, record_id, json_payload, status, search_text, updated_at) VALUES (?, ?, ?, ?, ?, ?);"
                );
                stmt.bindString(1, storeName);
                stmt.bindString(2, recordId);
                stmt.bindString(3, jsonPayload);
                stmt.bindString(4, status != null ? status : "");
                stmt.bindString(5, searchText != null ? searchText.toLowerCase(Locale.ROOT) : "");
                stmt.bindLong(6, System.currentTimeMillis());
                stmt.executeInsert();

                JSObject res = new JSObject();
                res.put("success", true);
                res.put("recordId", recordId);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Error en sqlitePut: " + e.getMessage());
            } finally {
                if (stmt != null) {
                    try { stmt.close(); } catch (Exception ignored) {}
                }
            }
        });
    }

    void putBatch(PluginCall call) {
        final String storeName = call.getString("storeName");
        final JSArray records = call.getArray("records");

        if (storeName == null || records == null) {
            call.reject("Parámetros incompletos para sqlitePutBatch");
            return;
        }

        sqliteExecutor.execute(() -> {
            SQLiteDatabase db = null;
            SQLiteStatement stmt = null;
            try {
                db = getSqliteHelper(appContext).getWritableDatabase();
                db.beginTransactionNonExclusive();
                stmt = db.compileStatement(
                    "INSERT OR REPLACE INTO kv_records (store_name, record_id, json_payload, status, search_text, updated_at) VALUES (?, ?, ?, ?, ?, ?);"
                );
                long now = System.currentTimeMillis();
                int count = records.length();
                for (int i = 0; i < count; i++) {
                    JSONObject item = records.optJSONObject(i);
                    if (item == null) continue;
                    String id = item.optString("k", "");
                    String payload = item.optString("v", "");
                    if (id.isEmpty() || payload.isEmpty()) continue;
                    String status = item.optString("s", "");
                    String search = item.optString("q", "");

                    stmt.clearBindings();
                    stmt.bindString(1, storeName);
                    stmt.bindString(2, id);
                    stmt.bindString(3, payload);
                    stmt.bindString(4, status);
                    stmt.bindString(5, search.toLowerCase(Locale.ROOT));
                    stmt.bindLong(6, now);
                    stmt.executeInsert();
                }
                db.setTransactionSuccessful();
                JSObject res = new JSObject();
                res.put("success", true);
                res.put("count", count);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Error en sqlitePutBatch: " + e.getMessage());
            } finally {
                if (stmt != null) {
                    try { stmt.close(); } catch (Exception ignored) {}
                }
                if (db != null && db.inTransaction()) {
                    try { db.endTransaction(); } catch (Exception ignored) {}
                }
            }
        });
    }

    void replaceAllAtomic(PluginCall call) {
        final String storeName = call.getString("storeName");
        final JSArray records = call.getArray("records");

        if (storeName == null || records == null) {
            call.reject("Parámetros incompletos para sqliteReplaceAllAtomic");
            return;
        }

        sqliteExecutor.execute(() -> {
            SQLiteDatabase db = null;
            SQLiteStatement delStmt = null;
            SQLiteStatement insStmt = null;
            try {
                db = getSqliteHelper(appContext).getWritableDatabase();
                db.beginTransactionNonExclusive();

                delStmt = db.compileStatement("DELETE FROM kv_records WHERE store_name = ?;");
                delStmt.bindString(1, storeName);
                delStmt.executeUpdateDelete();

                insStmt = db.compileStatement(
                    "INSERT OR REPLACE INTO kv_records (store_name, record_id, json_payload, status, search_text, updated_at) VALUES (?, ?, ?, ?, ?, ?);"
                );
                long now = System.currentTimeMillis();
                int count = records.length();
                for (int i = 0; i < count; i++) {
                    JSONObject item = records.optJSONObject(i);
                    if (item == null) continue;
                    String id = item.optString("k", "");
                    String payload = item.optString("v", "");
                    if (id.isEmpty() || payload.isEmpty()) continue;
                    String status = item.optString("s", "");
                    String search = item.optString("q", "");

                    insStmt.clearBindings();
                    insStmt.bindString(1, storeName);
                    insStmt.bindString(2, id);
                    insStmt.bindString(3, payload);
                    insStmt.bindString(4, status);
                    insStmt.bindString(5, search.toLowerCase(Locale.ROOT));
                    insStmt.bindLong(6, now);
                    insStmt.executeInsert();
                }

                db.setTransactionSuccessful();
                JSObject res = new JSObject();
                res.put("success", true);
                res.put("count", count);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Error en sqliteReplaceAllAtomic: " + e.getMessage());
            } finally {
                if (delStmt != null) {
                    try { delStmt.close(); } catch (Exception ignored) {}
                }
                if (insStmt != null) {
                    try { insStmt.close(); } catch (Exception ignored) {}
                }
                if (db != null && db.inTransaction()) {
                    try { db.endTransaction(); } catch (Exception ignored) {}
                }
            }
        });
    }

    void getAll(PluginCall call) {
        final String storeName = call.getString("storeName");
        if (storeName == null) {
            call.reject("storeName requerido en sqliteGetAll");
            return;
        }

        sqliteExecutor.execute(() -> {
            Cursor cursor = null;
            try {
                SQLiteDatabase db = getSqliteHelper(appContext).getReadableDatabase();
                cursor = db.rawQuery(
                    "SELECT json_payload FROM kv_records WHERE store_name = ?;",
                    new String[] { storeName }
                );
                StringBuilder sb = new StringBuilder(Math.max(64, cursor.getCount() * 160));
                sb.append('[');
                boolean first = true;
                while (cursor.moveToNext()) {
                    String payload = cursor.getString(0);
                    if (payload == null || payload.isEmpty()) continue;
                    if (!first) sb.append(',');
                    sb.append(payload);
                    first = false;
                }
                sb.append(']');

                JSObject res = new JSObject();
                res.put("jsonArray", sb.toString());
                res.put("count", cursor.getCount());
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Error en sqliteGetAll: " + e.getMessage());
            } finally {
                if (cursor != null) {
                    try { cursor.close(); } catch (Exception ignored) {}
                }
            }
        });
    }

    void getById(PluginCall call) {
        final String storeName = call.getString("storeName");
        final String recordId = call.getString("recordId");
        if (storeName == null || recordId == null) {
            call.reject("Parámetros incompletos en sqliteGetById");
            return;
        }

        sqliteExecutor.execute(() -> {
            Cursor cursor = null;
            try {
                SQLiteDatabase db = getSqliteHelper(appContext).getReadableDatabase();
                cursor = db.rawQuery(
                    "SELECT json_payload FROM kv_records WHERE store_name = ? AND record_id = ? LIMIT 1;",
                    new String[] { storeName, recordId }
                );
                String jsonPayload = null;
                if (cursor.moveToFirst()) {
                    jsonPayload = cursor.getString(0);
                }
                JSObject res = new JSObject();
                res.put("jsonPayload", jsonPayload);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Error en sqliteGetById: " + e.getMessage());
            } finally {
                if (cursor != null) {
                    try { cursor.close(); } catch (Exception ignored) {}
                }
            }
        });
    }

    void getByStatus(PluginCall call) {
        final String storeName = call.getString("storeName");
        final String status = call.getString("status");
        if (storeName == null || status == null) {
            call.reject("Parámetros incompletos en sqliteGetByStatus");
            return;
        }

        sqliteExecutor.execute(() -> {
            Cursor cursor = null;
            try {
                SQLiteDatabase db = getSqliteHelper(appContext).getReadableDatabase();
                cursor = db.rawQuery(
                    "SELECT json_payload FROM kv_records WHERE store_name = ? AND status = ?;",
                    new String[] { storeName, status }
                );
                StringBuilder sb = new StringBuilder(Math.max(64, cursor.getCount() * 160));
                sb.append('[');
                boolean first = true;
                while (cursor.moveToNext()) {
                    String payload = cursor.getString(0);
                    if (payload == null || payload.isEmpty()) continue;
                    if (!first) sb.append(',');
                    sb.append(payload);
                    first = false;
                }
                sb.append(']');

                JSObject res = new JSObject();
                res.put("jsonArray", sb.toString());
                res.put("count", cursor.getCount());
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Error en sqliteGetByStatus: " + e.getMessage());
            } finally {
                if (cursor != null) {
                    try { cursor.close(); } catch (Exception ignored) {}
                }
            }
        });
    }

    void delete(PluginCall call) {
        final String storeName = call.getString("storeName");
        final String recordId = call.getString("recordId");
        if (storeName == null || recordId == null) {
            call.reject("Parámetros incompletos en sqliteDelete");
            return;
        }

        sqliteExecutor.execute(() -> {
            SQLiteStatement stmt = null;
            try {
                SQLiteDatabase db = getSqliteHelper(appContext).getWritableDatabase();
                stmt = db.compileStatement(
                    "DELETE FROM kv_records WHERE store_name = ? AND record_id = ?;"
                );
                stmt.bindString(1, storeName);
                stmt.bindString(2, recordId);
                int deleted = stmt.executeUpdateDelete();

                JSObject res = new JSObject();
                res.put("success", true);
                res.put("deleted", deleted);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Error en sqliteDelete: " + e.getMessage());
            } finally {
                if (stmt != null) {
                    try { stmt.close(); } catch (Exception ignored) {}
                }
            }
        });
    }

    void clear(PluginCall call) {
        final String storeName = call.getString("storeName");
        if (storeName == null) {
            call.reject("storeName requerido en sqliteClear");
            return;
        }

        sqliteExecutor.execute(() -> {
            SQLiteStatement stmt = null;
            try {
                SQLiteDatabase db = getSqliteHelper(appContext).getWritableDatabase();
                stmt = db.compileStatement("DELETE FROM kv_records WHERE store_name = ?;");
                stmt.bindString(1, storeName);
                int deleted = stmt.executeUpdateDelete();

                JSObject res = new JSObject();
                res.put("success", true);
                res.put("deleted", deleted);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Error en sqliteClear: " + e.getMessage());
            } finally {
                if (stmt != null) {
                    try { stmt.close(); } catch (Exception ignored) {}
                }
            }
        });
    }

    void getStats(PluginCall call) {
        sqliteExecutor.execute(() -> {
            Cursor cursor = null;
            try {
                SQLiteDatabase db = getSqliteHelper(appContext).getReadableDatabase();
                cursor = db.rawQuery(
                    "SELECT store_name, COUNT(*) FROM kv_records GROUP BY store_name;",
                    null
                );
                JSObject counts = new JSObject();
                int total = 0;
                while (cursor.moveToNext()) {
                    String sName = cursor.getString(0);
                    int cnt = cursor.getInt(1);
                    counts.put(sName, cnt);
                    total += cnt;
                }
                JSObject res = new JSObject();
                res.put("engine", "ANDROID_NATIVE_SQLITE_WAL");
                res.put("walEnabled", db.isWriteAheadLoggingEnabled());
                res.put("totalRecords", total);
                res.put("stores", counts);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Error en sqliteGetStats: " + e.getMessage());
            } finally {
                if (cursor != null) {
                    try { cursor.close(); } catch (Exception ignored) {}
                }
            }
        });
    }

    void shutdown() {
        try {
            sqliteExecutor.shutdownNow();
        } catch (Exception ignored) {}
    }
}
