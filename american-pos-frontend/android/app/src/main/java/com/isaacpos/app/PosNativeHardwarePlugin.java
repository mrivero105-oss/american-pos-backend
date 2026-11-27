package com.isaacpos.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import androidx.core.content.pm.PackageInfoCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Facade delgado del plugin nativo PosNativeHardware (Java 21 puro).
 * Conserva el 100% de los contratos JS históricos y delega en 6 managers especializados:
 *  - NativePrinterManager (BT Classic SPP, Discovery Classic/BLE, BLE GATT, TCP 9100 anti-SSRF)
 *  - NativeVisionManager + NativeVisionScannerActivity (CameraX + Play Services ML Kit en tiempo real)
 *  - NativeBiometricKeystoreManager (ECDSA P-256 v2 + Bóveda AES-256-GCM + Root check)
 *  - NativeSqliteManager (SQLite WAL + transacciones ACID)
 *  - NativeNetworkManager (ConnectivityManager + RFC1918)
 *  - NativeShareAndVoiceManager (FileProvider WhatsApp/Share, Voz, Portapapeles, Háptico, FLAG_SECURE)
 */
@CapacitorPlugin(
    name = "PosNativeHardware",
    permissions = {
        @Permission(
            alias = "camera",
            strings = { Manifest.permission.CAMERA }
        ),
        @Permission(
            alias = "microphone",
            strings = { Manifest.permission.RECORD_AUDIO }
        ),
        @Permission(
            alias = "bluetooth",
            strings = { Manifest.permission.BLUETOOTH_CONNECT }
        ),
        @Permission(
            alias = "bluetoothScan",
            strings = {
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_CONNECT
            }
        ),
        @Permission(
            alias = "bluetoothLegacyLocation",
            strings = {
                Manifest.permission.ACCESS_FINE_LOCATION
            }
        )
    }
)
public class PosNativeHardwarePlugin extends Plugin {

    // Pools separados para evitar que una impresora TCP/BT lenta bloquee Keystore, red o WhatsApp
    private final ExecutorService ioExecutor = Executors.newFixedThreadPool(2);
    private final ExecutorService printerNetworkExecutor = Executors.newFixedThreadPool(2);
    private final ExecutorService visionExecutor = Executors.newSingleThreadExecutor();

    private NativePrinterManager printerManager;
    private NativeVisionManager visionManager;
    private NativeBiometricKeystoreManager biometricKeystoreManager;
    private NativeSqliteManager sqliteManager;
    private NativeNetworkManager networkManager;
    private NativeShareAndVoiceManager shareAndVoiceManager;
    // Referencia fuerte al listener mientras CameraX está abierto (evita recolección GC de WeakReference en ráfaga)
    private NativeVisionScannerActivity.LiveScanListener activeLiveScanListener;

    @Override
    public void load() {
        super.load();
        printerManager = new NativePrinterManager(getContext(), printerNetworkExecutor);
        visionManager = new NativeVisionManager(visionExecutor);
        biometricKeystoreManager = new NativeBiometricKeystoreManager(getContext(), ioExecutor);
        sqliteManager = new NativeSqliteManager(getContext());
        networkManager = new NativeNetworkManager(getContext(), printerNetworkExecutor);
        shareAndVoiceManager = new NativeShareAndVoiceManager(getContext(), ioExecutor);
    }

    // ==================== PERMISOS NATIVOS ====================

    @PluginMethod
    public void ensureCameraPermission(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            JSObject res = new JSObject();
            res.put("granted", true);
            call.resolve(res);
        } else {
            requestPermissionForAlias("camera", call, "cameraPermsCallback");
        }
    }

    @PermissionCallback
    private void cameraPermsCallback(PluginCall call) {
        boolean granted = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
        JSObject res = new JSObject();
        res.put("granted", granted);
        call.resolve(res);
    }

    @PluginMethod
    public void ensureMicrophonePermission(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            JSObject res = new JSObject();
            res.put("granted", true);
            call.resolve(res);
        } else {
            requestPermissionForAlias("microphone", call, "microphonePermsCallback");
        }
    }

    @PermissionCallback
    private void microphonePermsCallback(PluginCall call) {
        boolean granted = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
        JSObject res = new JSObject();
        res.put("granted", granted);
        call.resolve(res);
    }

    @PluginMethod
    public void ensureBluetoothPermission(PluginCall call) {
        if (printerManager.hasBluetoothConnectPermission()) {
            JSObject res = new JSObject();
            res.put("granted", true);
            call.resolve(res);
        } else {
            requestPermissionForAlias("bluetooth", call, "bluetoothPermsCallback");
        }
    }

    @PermissionCallback
    private void bluetoothPermsCallback(PluginCall call) {
        JSObject res = new JSObject();
        res.put("granted", printerManager.hasBluetoothConnectPermission());
        call.resolve(res);
    }

    // ==================== IMPRESIÓN TÉRMICA (BT CLASSIC, DISCOVERY, BLE GATT, TCP 9100) ====================

    @PluginMethod
    public void getPairedPrinters(PluginCall call) {
        if (!printerManager.hasBluetoothConnectPermission()) {
            requestPermissionForAlias("bluetooth", call, "pairedPrintersPermsCallback");
            return;
        }
        printerManager.getPairedPrinters(call);
    }

    @PermissionCallback
    private void pairedPrintersPermsCallback(PluginCall call) {
        if (!printerManager.hasBluetoothConnectPermission()) {
            call.reject("Permiso de Bluetooth (Dispositivos cercanos) denegado por el usuario");
            return;
        }
        printerManager.getPairedPrinters(call);
    }

    @PluginMethod
    public void discoverBluetoothPrinters(PluginCall call) {
        if (!printerManager.hasBluetoothScanPermission()) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                requestPermissionForAlias("bluetoothScan", call, "discoverBluetoothPermsCallback");
            } else {
                requestPermissionForAlias("bluetoothLegacyLocation", call, "discoverBluetoothPermsCallback");
            }
            return;
        }
        printerManager.discoverBluetoothPrinters(call);
    }

    @PermissionCallback
    private void discoverBluetoothPermsCallback(PluginCall call) {
        if (!printerManager.hasBluetoothScanPermission()) {
            String msg = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                ? "Permiso de escaneo Bluetooth (Dispositivos cercanos) denegado por el usuario"
                : "En Android 7–11 se requiere permiso de Ubicación para descubrir impresoras Bluetooth cercanas";
            call.reject(msg);
            return;
        }
        printerManager.discoverBluetoothPrinters(call);
    }

    @PluginMethod
    public void printBluetooth(PluginCall call) {
        if (!printerManager.hasBluetoothConnectPermission()) {
            requestPermissionForAlias("bluetooth", call, "printBluetoothPermsCallback");
            return;
        }
        printerManager.printBluetooth(call);
    }

    @PermissionCallback
    private void printBluetoothPermsCallback(PluginCall call) {
        if (!printerManager.hasBluetoothConnectPermission()) {
            call.reject("Permiso de Bluetooth (Dispositivos cercanos) denegado por el usuario");
            return;
        }
        printerManager.printBluetooth(call);
    }

    @PluginMethod
    public void printBluetoothBle(PluginCall call) {
        if (!printerManager.hasBluetoothConnectPermission()) {
            requestPermissionForAlias("bluetooth", call, "printBluetoothBlePermsCallback");
            return;
        }
        printerManager.printBluetoothBle(call);
    }

    @PermissionCallback
    private void printBluetoothBlePermsCallback(PluginCall call) {
        if (!printerManager.hasBluetoothConnectPermission()) {
            call.reject("Permiso de Bluetooth (Dispositivos cercanos) denegado por el usuario");
            return;
        }
        printerManager.printBluetoothBle(call);
    }

    @PluginMethod
    public void printNetworkTcp(PluginCall call) {
        printerManager.printNetworkTcp(call);
    }

    // ==================== VISIÓN CAMERAX + ML KIT ====================

    @PluginMethod
    public void startNativeScanner(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissionForAlias("camera", call, "nativeScannerCameraPermsCallback");
            return;
        }
        launchNativeScannerActivity(call);
    }

    @PermissionCallback
    private void nativeScannerCameraPermsCallback(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            call.reject("Permiso de cámara denegado por el usuario");
            return;
        }
        launchNativeScannerActivity(call);
    }

    private void launchNativeScannerActivity(PluginCall call) {
        try {
            Intent intent = new Intent(getContext(), NativeVisionScannerActivity.class);
            intent.putExtra(NativeVisionScannerActivity.EXTRA_BURST_MODE, Boolean.TRUE.equals(call.getBoolean("burstMode", false)));
            intent.putExtra(NativeVisionScannerActivity.EXTRA_TITLE, call.getString("title", "Escáner Nativo POS"));
            intent.putExtra(NativeVisionScannerActivity.EXTRA_SUBTITLE, call.getString("subtitle", "Apunta al código • Toca pantalla para enfocar"));
            intent.putExtra(NativeVisionScannerActivity.EXTRA_TARGET_MODE, call.getString("targetMode", "CART"));

            // Stream en tiempo real hacia JS para modo ráfaga (+1) sin cerrar la cámara
            activeLiveScanListener = (barcode, format, count, burstMode) -> {
                JSObject evt = new JSObject();
                evt.put("barcode", barcode);
                evt.put("format", format);
                evt.put("count", count);
                evt.put("burstMode", burstMode);
                notifyListeners("nativeBarcodeScanned", evt);
            };
            NativeVisionScannerActivity.setLiveScanListener(activeLiveScanListener);

            startActivityForResult(call, intent, "handleNativeScannerResult");
        } catch (Exception e) {
            activeLiveScanListener = null;
            NativeVisionScannerActivity.setLiveScanListener(null);
            call.reject("No se pudo iniciar el escáner nativo CameraX: " + e.getMessage());
        }
    }

    @ActivityCallback
    private void handleNativeScannerResult(PluginCall call, ActivityResult result) {
        activeLiveScanListener = null;
        NativeVisionScannerActivity.setLiveScanListener(null);
        if (call == null) return;
        JSObject ret = new JSObject();
        Intent data = result.getData();
        if (result.getResultCode() == Activity.RESULT_OK && data != null) {
            ArrayList<String> list = data.getStringArrayListExtra(NativeVisionScannerActivity.RESULT_BARCODES);
            JSArray barcodesArr = new JSArray();
            if (list != null) {
                for (String code : list) {
                    barcodesArr.put(code);
                }
            }
            ret.put("success", true);
            ret.put("cancelled", false);
            ret.put("barcodes", barcodesArr);
            ret.put("lastBarcode", data.getStringExtra(NativeVisionScannerActivity.RESULT_LAST_BARCODE));
            ret.put("count", data.getIntExtra(NativeVisionScannerActivity.RESULT_COUNT, 0));
            ret.put("burstMode", data.getBooleanExtra(NativeVisionScannerActivity.RESULT_BURST_MODE, false));
            ret.put("fallbackToWeb", data.getBooleanExtra(NativeVisionScannerActivity.RESULT_FALLBACK_TO_WEB, false));
            String reason = data.getStringExtra(NativeVisionScannerActivity.RESULT_FALLBACK_REASON);
            if (reason != null) {
                ret.put("fallbackReason", reason);
            }
            call.resolve(ret);
            return;
        }
        ret.put("success", false);
        ret.put("cancelled", true);
        ret.put("barcodes", new JSArray());
        ret.put("count", 0);
        ret.put("fallbackToWeb", false);
        call.resolve(ret);
    }

    @PluginMethod
    public void scanBarcode(PluginCall call) {
        visionManager.scanBarcode(call);
    }

    @PluginMethod
    public void recognizeText(PluginCall call) {
        visionManager.recognizeText(call);
    }

    // ==================== RED LAN ====================

    @PluginMethod
    public void getNetworkInfo(PluginCall call) {
        networkManager.getNetworkInfo(call);
    }

    // ==================== BIOMETRÍA, KEYSTORE Y SEGURIDAD ====================

    @PluginMethod
    public void isBiometricAvailable(PluginCall call) {
        biometricKeystoreManager.isBiometricAvailable(call);
    }

    @PluginMethod
    public void authenticateBiometric(PluginCall call) {
        biometricKeystoreManager.authenticateBiometric(getActivity(), call);
    }

    @PluginMethod
    public void registerBiometricKey(PluginCall call) {
        biometricKeystoreManager.registerBiometricKey(getActivity(), call);
    }

    @PluginMethod
    public void signBiometricChallenge(PluginCall call) {
        biometricKeystoreManager.signBiometricChallenge(getActivity(), call);
    }

    @PluginMethod
    public void deleteBiometricKey(PluginCall call) {
        biometricKeystoreManager.deleteBiometricKey(call);
    }

    @PluginMethod
    public void checkDeviceSecurity(PluginCall call) {
        biometricKeystoreManager.checkDeviceSecurity(call);
    }

    @PluginMethod
    public void saveSecureSecret(PluginCall call) {
        biometricKeystoreManager.saveSecureSecret(call);
    }

    @PluginMethod
    public void getSecureSecret(PluginCall call) {
        biometricKeystoreManager.getSecureSecret(call);
    }

    @PluginMethod
    public void removeSecureSecret(PluginCall call) {
        biometricKeystoreManager.removeSecureSecret(call);
    }

    // ==================== SHARE, VOZ, PORTAPAPELES, HÁPTICO Y SISTEMA ====================

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        shareAndVoiceManager.openAppSettings(call);
    }

    @PluginMethod
    public void shareImageToWhatsApp(PluginCall call) {
        shareAndVoiceManager.shareImageToWhatsApp(getActivity(), call);
    }

    @PluginMethod
    public void copyToClipboard(PluginCall call) {
        shareAndVoiceManager.writeClipboard(getActivity(), call, call.getString("text", ""));
    }

    @PluginMethod
    public void writeClipboard(PluginCall call) {
        shareAndVoiceManager.writeClipboard(getActivity(), call, call.getString("text", ""));
    }

    @PluginMethod
    public void readClipboard(PluginCall call) {
        shareAndVoiceManager.readClipboard(getActivity(), call);
    }

    @PluginMethod
    public void triggerHaptic(PluginCall call) {
        shareAndVoiceManager.triggerHaptic(getActivity(), call);
    }

    @PluginMethod
    public void setScreenSecure(PluginCall call) {
        shareAndVoiceManager.setScreenSecure(getActivity(), call);
    }

    @PluginMethod
    public void startVoiceRecognition(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissionForAlias("microphone", call, "voiceRecognitionPermsCallback");
            return;
        }
        launchVoiceRecognitionIntent(call);
    }

    @PermissionCallback
    private void voiceRecognitionPermsCallback(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            call.reject("Permiso de micrófono denegado por el usuario");
            return;
        }
        launchVoiceRecognitionIntent(call);
    }

    private void launchVoiceRecognitionIntent(PluginCall call) {
        try {
            Intent intent = shareAndVoiceManager.buildVoiceRecognitionIntent(call);
            startActivityForResult(call, intent, "handleVoiceRecognitionResult");
        } catch (Exception e) {
            call.reject("El motor de dictado por voz no está disponible en este dispositivo: " + e.getMessage());
        }
    }

    @ActivityCallback
    private void handleVoiceRecognitionResult(PluginCall call, ActivityResult result) {
        shareAndVoiceManager.resolveVoiceRecognitionResult(call, result);
    }

    // ==================== SQLITE NATIVO WAL ====================

    @PluginMethod
    public void sqlitePut(PluginCall call) {
        sqliteManager.put(call);
    }

    @PluginMethod
    public void sqlitePutBatch(PluginCall call) {
        sqliteManager.putBatch(call);
    }

    @PluginMethod
    public void sqliteReplaceAllAtomic(PluginCall call) {
        sqliteManager.replaceAllAtomic(call);
    }

    @PluginMethod
    public void sqliteGetAll(PluginCall call) {
        sqliteManager.getAll(call);
    }

    @PluginMethod
    public void sqliteGetById(PluginCall call) {
        sqliteManager.getById(call);
    }

    @PluginMethod
    public void sqliteGetByStatus(PluginCall call) {
        sqliteManager.getByStatus(call);
    }

    @PluginMethod
    public void sqliteDelete(PluginCall call) {
        sqliteManager.delete(call);
    }

    @PluginMethod
    public void sqliteClear(PluginCall call) {
        sqliteManager.clear(call);
    }

    @PluginMethod
    public void sqliteGetStats(PluginCall call) {
        sqliteManager.getStats(call);
    }

    @PluginMethod
    public void discoverLanServersUdp(PluginCall call) {
        networkManager.discoverLanServersUdp(call);
    }

    @PluginMethod
    public void getAppBuildInfo(PluginCall call) {
        try {
            PackageManager pm = getContext().getPackageManager();
            String pkg = getContext().getPackageName();
            PackageInfo pInfo = pm.getPackageInfo(pkg, 0);
            long versionCode = PackageInfoCompat.getLongVersionCode(pInfo);
            JSObject res = new JSObject();
            res.put("versionCode", versionCode);
            res.put("versionName", pInfo.versionName != null ? pInfo.versionName : "");
            res.put("packageName", pkg);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("No se pudo leer información de compilación del APK: " + e.getMessage());
        }
    }

    // ==================== CICLO DE VIDA ====================

    @Override
    protected void handleOnDestroy() {
        activeLiveScanListener = null;
        NativeVisionScannerActivity.setLiveScanListener(null);
        if (printerManager != null) printerManager.shutdown();
        if (visionManager != null) visionManager.shutdown();
        if (sqliteManager != null) sqliteManager.shutdown();
        try {
            ioExecutor.shutdownNow();
        } catch (Exception ignored) {}
        try {
            printerNetworkExecutor.shutdownNow();
        } catch (Exception ignored) {}
        try {
            visionExecutor.shutdownNow();
        } catch (Exception ignored) {}
        super.handleOnDestroy();
    }
}
