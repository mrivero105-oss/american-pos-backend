package com.isaacpos.app;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.util.Base64;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import android.content.Intent;
import android.content.ClipData;
import android.content.pm.PackageManager;
import android.net.Uri;
import androidx.core.content.FileProvider;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.barcode.BarcodeScanner;
import com.google.mlkit.vision.barcode.BarcodeScannerOptions;
import com.google.mlkit.vision.barcode.BarcodeScanning;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Executor;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.database.sqlite.SQLiteStatement;
import android.os.Build;
import android.speech.RecognizerIntent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import java.util.ArrayList;
import org.json.JSONArray;
import org.json.JSONObject;

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
            strings = {
                Manifest.permission.BLUETOOTH_CONNECT,
                Manifest.permission.BLUETOOTH_SCAN
            }
        )
    }
)
public class PosNativeHardwarePlugin extends Plugin {

    // UUID estándar para perfil serie Bluetooth SPP (Serial Port Profile)
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private final java.util.concurrent.ExecutorService bluetoothExecutor = java.util.concurrent.Executors.newSingleThreadExecutor();
    private BluetoothSocket cachedBtSocket = null;
    private String cachedBtAddress = null;

    private boolean hasBluetoothConnectPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
        }
        return true;
    }

    @SuppressLint("MissingPermission")
    private BluetoothSocket openRfcommSocket(BluetoothDevice device) throws Exception {
        BluetoothSocket sock = null;
        try {
            sock = device.createRfcommSocketToServiceRecord(SPP_UUID);
            sock.connect();
            return sock;
        } catch (Exception sppErr) {
            try {
                if (sock != null) sock.close();
            } catch (Exception ignored) {}
            try {
                java.lang.reflect.Method m = device.getClass().getMethod("createRfcommSocket", new Class[] { int.class });
                sock = (BluetoothSocket) m.invoke(device, 1);
                sock.connect();
                return sock;
            } catch (Exception reflectionErr) {
                throw sppErr;
            }
        }
    }

    private void closeCachedBtSocket() {
        if (cachedBtSocket != null) {
            try {
                cachedBtSocket.close();
            } catch (Exception ignored) {}
            cachedBtSocket = null;
            cachedBtAddress = null;
        }
    }

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
    public void openAppSettings(PluginCall call) {
        try {
            Intent intent = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            Uri uri = Uri.fromParts("package", getContext().getPackageName(), null);
            intent.setData(uri);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            JSObject res = new JSObject();
            res.put("success", true);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("No se pudo abrir la configuración de la aplicación: " + e.getMessage());
        }
    }

    @PluginMethod
    public void ensureBluetoothPermission(PluginCall call) {
        if (hasBluetoothConnectPermission()) {
            JSObject res = new JSObject();
            res.put("granted", true);
            call.resolve(res);
        } else {
            requestPermissionForAlias("bluetooth", call, "bluetoothPermsCallback");
        }
    }

    @PermissionCallback
    private void bluetoothPermsCallback(PluginCall call) {
        boolean granted = hasBluetoothConnectPermission();
        JSObject res = new JSObject();
        res.put("granted", granted);
        call.resolve(res);
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void getPairedPrinters(PluginCall call) {
        if (!hasBluetoothConnectPermission()) {
            requestPermissionForAlias("bluetooth", call, "pairedPrintersPermsCallback");
            return;
        }
        executeGetPairedPrinters(call);
    }

    @PermissionCallback
    private void pairedPrintersPermsCallback(PluginCall call) {
        if (!hasBluetoothConnectPermission()) {
            call.reject("Permiso de Bluetooth (Dispositivos cercanos) denegado por el usuario");
            return;
        }
        executeGetPairedPrinters(call);
    }

    @SuppressLint("MissingPermission")
    private void executeGetPairedPrinters(PluginCall call) {
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null || !adapter.isEnabled()) {
                JSObject res = new JSObject();
                res.put("printers", new JSArray());
                call.resolve(res);
                return;
            }

            Set<BluetoothDevice> bondedDevices = adapter.getBondedDevices();
            JSArray array = new JSArray();
            if (bondedDevices != null) {
                for (BluetoothDevice device : bondedDevices) {
                    JSObject item = new JSObject();
                    item.put("name", device.getName() != null ? device.getName() : "Impresora BT");
                    item.put("address", device.getAddress());
                    array.put(item);
                }
            }
            JSObject res = new JSObject();
            res.put("printers", array);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("Error al obtener impresoras Bluetooth: " + e.getMessage());
        }
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void printBluetooth(PluginCall call) {
        if (!hasBluetoothConnectPermission()) {
            requestPermissionForAlias("bluetooth", call, "printBluetoothPermsCallback");
            return;
        }
        executePrintBluetooth(call);
    }

    @PermissionCallback
    private void printBluetoothPermsCallback(PluginCall call) {
        if (!hasBluetoothConnectPermission()) {
            call.reject("Permiso de Bluetooth (Dispositivos cercanos) denegado por el usuario");
            return;
        }
        executePrintBluetooth(call);
    }

    @SuppressLint("MissingPermission")
    private void executePrintBluetooth(PluginCall call) {
        String address = call.getString("address");
        String base64Data = call.getString("data");

        if (base64Data == null || base64Data.isEmpty()) {
            call.reject("No se proporcionaron datos para imprimir");
            return;
        }

        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null || !adapter.isEnabled()) {
            call.reject("Bluetooth no disponible o apagado");
            return;
        }

        // Si no se proporcionó dirección, buscar la primera impresora vinculada
        if (address == null || address.isEmpty()) {
            Set<BluetoothDevice> bonded = adapter.getBondedDevices();
            if (bonded != null && !bonded.isEmpty()) {
                for (BluetoothDevice d : bonded) {
                    address = d.getAddress();
                    break;
                }
            }
        }

        if (address == null || address.isEmpty()) {
            call.reject("No hay ninguna impresora Bluetooth vinculada en el teléfono");
            return;
        }

        final String targetAddress = address;
        bluetoothExecutor.execute(() -> {
            try {
                byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                BluetoothDevice device = adapter.getRemoteDevice(targetAddress);

                boolean written = false;

                // 1. Intentar reutilizar el socket RFCOMM persistente para impresión en < 30 ms
                if (cachedBtSocket != null && cachedBtSocket.isConnected() && targetAddress.equalsIgnoreCase(cachedBtAddress)) {
                    try {
                        OutputStream out = cachedBtSocket.getOutputStream();
                        out.write(bytes);
                        out.flush();
                        written = true;
                    } catch (Exception staleErr) {
                        closeCachedBtSocket();
                    }
                } else if (cachedBtSocket != null) {
                    closeCachedBtSocket();
                }

                // 2. Si no había socket activo o se desconectó, abrir y almacenar en el pool persistente
                if (!written) {
                    cachedBtSocket = openRfcommSocket(device);
                    cachedBtAddress = targetAddress;
                    OutputStream out = cachedBtSocket.getOutputStream();
                    out.write(bytes);
                    out.flush();
                }

                JSObject res = new JSObject();
                res.put("success", true);
                res.put("printedBytes", bytes.length);
                call.resolve(res);
            } catch (Exception e) {
                closeCachedBtSocket();
                call.reject("Fallo al imprimir por Bluetooth: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void getNetworkInfo(PluginCall call) {
        try {
            String ipAddress = "";
            String gateway = "";
            String subnet = "";

            java.util.Enumeration<java.net.NetworkInterface> interfaces = java.net.NetworkInterface.getNetworkInterfaces();
            while (interfaces.hasMoreElements()) {
                java.net.NetworkInterface iface = interfaces.nextElement();
                if (iface.isLoopback() || !iface.isUp()) continue;
                java.util.Enumeration<java.net.InetAddress> addresses = iface.getInetAddresses();
                while (addresses.hasMoreElements()) {
                    java.net.InetAddress addr = addresses.nextElement();
                    if (!addr.isLoopbackAddress() && addr instanceof java.net.Inet4Address) {
                        String candidate = addr.getHostAddress();
                        if (candidate != null && !candidate.startsWith("127.")) {
                            ipAddress = candidate;
                            int lastDot = ipAddress.lastIndexOf('.');
                            if (lastDot > 0) {
                                subnet = ipAddress.substring(0, lastDot + 1);
                                gateway = subnet + "1";
                            }
                            break;
                        }
                    }
                }
                if (!ipAddress.isEmpty()) break;
            }

            JSObject res = new JSObject();
            res.put("ip", ipAddress);
            res.put("gateway", gateway);
            res.put("subnet", subnet);
            call.resolve(res);
        } catch (Exception e) {
            JSObject res = new JSObject();
            res.put("ip", "");
            res.put("gateway", "");
            res.put("subnet", "");
            call.resolve(res);
        }
    }

    @PluginMethod
    public void isBiometricAvailable(PluginCall call) {
        try {
            BiometricManager biometricManager = BiometricManager.from(getContext());
            int canAuth = biometricManager.canAuthenticate(
                BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.BIOMETRIC_WEAK
            );
            boolean available = (canAuth == BiometricManager.BIOMETRIC_SUCCESS);
            JSObject res = new JSObject();
            res.put("available", available);
            res.put("statusCode", canAuth);
            call.resolve(res);
        } catch (Exception e) {
            JSObject res = new JSObject();
            res.put("available", false);
            res.put("error", e.getMessage());
            call.resolve(res);
        }
    }

    @PluginMethod
    public void authenticateBiometric(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                String title = call.getString("title", "Autorización de Supervisor");
                String subtitle = call.getString("subtitle", "Usa tu huella o rostro para autorizar");
                String cancelText = call.getString("cancelText", "Cancelar");

                Executor executor = ContextCompat.getMainExecutor(getContext());
                FragmentActivity activity = (FragmentActivity) getActivity();

                BiometricPrompt biometricPrompt = new BiometricPrompt(activity, executor, new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationError(int errorCode, CharSequence errString) {
                        super.onAuthenticationError(errorCode, errString);
                        call.reject(errString.toString(), String.valueOf(errorCode));
                    }

                    @Override
                    public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                        super.onAuthenticationSucceeded(result);
                        JSObject res = new JSObject();
                        res.put("success", true);
                        res.put("method", "BIOMETRIC_HARDWARE");
                        call.resolve(res);
                    }

                    @Override
                    public void onAuthenticationFailed() {
                        super.onAuthenticationFailed();
                    }
                });

                BiometricPrompt.PromptInfo promptInfo = new BiometricPrompt.PromptInfo.Builder()
                        .setTitle(title)
                        .setSubtitle(subtitle)
                        .setNegativeButtonText(cancelText)
                        .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.BIOMETRIC_WEAK)
                        .build();

                biometricPrompt.authenticate(promptInfo);
            } catch (Exception e) {
                call.reject("Error iniciando autenticación biométrica nativa: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void shareImageToWhatsApp(PluginCall call) {
        String base64Image = call.getString("imageBase64");
        String text = call.getString("text", "");
        String phone = call.getString("phone", "");
        String title = call.getString("title", "Factura Digital");

        if (base64Image == null || base64Image.isEmpty()) {
            call.reject("No se proporcionó la imagen en base64");
            return;
        }

        // Limpiar prefijo data:image/...;base64, si existe
        if (base64Image.contains(",")) {
            base64Image = base64Image.substring(base64Image.indexOf(",") + 1);
        }

        try {
            byte[] imageBytes = Base64.decode(base64Image, Base64.DEFAULT);

            // Guardar imagen en el directorio de caché de la app
            File cacheDir = new File(getContext().getCacheDir(), "shared_receipts");
            if (!cacheDir.exists()) {
                cacheDir.mkdirs();
            } else {
                // Limpieza preventiva de recibos en caché (> 1 hora) para no saturar almacenamiento
                try {
                    File[] oldFiles = cacheDir.listFiles();
                    if (oldFiles != null) {
                        long oneHourAgo = System.currentTimeMillis() - (60 * 60 * 1000);
                        for (File f : oldFiles) {
                            if (f.lastModified() < oneHourAgo) {
                                f.delete();
                            }
                        }
                    }
                } catch (Exception ignored) {}
            }

            File imageFile = new File(cacheDir, "factura_" + System.currentTimeMillis() + ".png");
            FileOutputStream fos = new FileOutputStream(imageFile);
            fos.write(imageBytes);
            fos.flush();
            fos.close();

            // Obtener URI segura mediante FileProvider
            String authority = getContext().getPackageName() + ".fileprovider";
            Uri contentUri = FileProvider.getUriForFile(getContext(), authority, imageFile);

            Intent intent = new Intent(Intent.ACTION_SEND);
            intent.setType("image/png");
            intent.putExtra(Intent.EXTRA_STREAM, contentUri);
            intent.setClipData(ClipData.newRawUri("", contentUri));
            if (text != null && !text.isEmpty()) {
                intent.putExtra(Intent.EXTRA_TEXT, text);
            }
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            // Comprobar si WhatsApp o WhatsApp Business están instalados
            PackageManager pm = getContext().getPackageManager();
            boolean hasWhatsApp = false;
            boolean hasWhatsAppBusiness = false;
            try {
                pm.getPackageInfo("com.whatsapp", PackageManager.GET_ACTIVITIES);
                hasWhatsApp = true;
            } catch (Exception ignored) {}
            try {
                pm.getPackageInfo("com.whatsapp.w4b", PackageManager.GET_ACTIVITIES);
                hasWhatsAppBusiness = true;
            } catch (Exception ignored) {}

            String targetPackage = null;
            if (hasWhatsApp) {
                targetPackage = "com.whatsapp";
            } else if (hasWhatsAppBusiness) {
                targetPackage = "com.whatsapp.w4b";
            }

            if (targetPackage != null) {
                intent.setPackage(targetPackage);
                if (phone != null && !phone.trim().isEmpty()) {
                    String cleanPhone = phone.replaceAll("[^0-9]", "");
                    intent.putExtra("jid", cleanPhone + "@s.whatsapp.net");
                }
            }

            getActivity().runOnUiThread(() -> {
                try {
                    getActivity().startActivity(intent);
                    JSObject res = new JSObject();
                    res.put("success", true);
                    call.resolve(res);
                } catch (Exception launchErr) {
                    try {
                        // Fallback: abrir selector nativo de compartir de Android si el intent directo falla
                        intent.setPackage(null);
                        Intent chooser = Intent.createChooser(intent, title);
                        chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        getActivity().startActivity(chooser);
                        JSObject res = new JSObject();
                        res.put("success", true);
                        call.resolve(res);
                    } catch (Exception chooserErr) {
                        call.reject("Error al compartir la imagen: " + chooserErr.getMessage());
                    }
                }
            });
        } catch (Exception e) {
            call.reject("Error procesando imagen para compartir: " + e.getMessage());
        }
    }

    private TextRecognizer textRecognizer = null;
    private BarcodeScanner barcodeScanner = null;

    private synchronized TextRecognizer getTextRecognizer() {
        if (textRecognizer == null) {
            textRecognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        }
        return textRecognizer;
    }

    private synchronized BarcodeScanner getBarcodeScanner() {
        if (barcodeScanner == null) {
            BarcodeScannerOptions options = new BarcodeScannerOptions.Builder()
                .setBarcodeFormats(
                    Barcode.FORMAT_EAN_13,
                    Barcode.FORMAT_EAN_8,
                    Barcode.FORMAT_UPC_A,
                    Barcode.FORMAT_UPC_E,
                    Barcode.FORMAT_CODE_128,
                    Barcode.FORMAT_CODE_39,
                    Barcode.FORMAT_CODE_93,
                    Barcode.FORMAT_ITF,
                    Barcode.FORMAT_CODABAR,
                    Barcode.FORMAT_QR_CODE
                )
                .build();
            barcodeScanner = BarcodeScanning.getClient(options);
        }
        return barcodeScanner;
    }

    @PluginMethod
    public void scanBarcode(PluginCall call) {
        String base64Image = call.getString("imageBase64");
        if (base64Image == null || base64Image.isEmpty()) {
            call.reject("No se proporcionó imagen");
            return;
        }

        if (base64Image.contains(",")) {
            base64Image = base64Image.substring(base64Image.indexOf(",") + 1);
        }

        try {
            byte[] bytes = Base64.decode(base64Image, Base64.DEFAULT);
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inPreferredConfig = Bitmap.Config.RGB_565;
            Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
            if (bitmap == null) {
                call.reject("No se pudo decodificar el bitmap");
                return;
            }

            InputImage image = InputImage.fromBitmap(bitmap, 0);
            getBarcodeScanner().process(image)
                .addOnSuccessListener(barcodes -> {
                    try { bitmap.recycle(); } catch (Exception ignored) {}
                    JSObject result = new JSObject();
                    result.put("success", true);
                    if (barcodes != null && !barcodes.isEmpty()) {
                        for (Barcode barcode : barcodes) {
                            String rawVal = barcode.getRawValue();
                            if (rawVal != null && !rawVal.trim().isEmpty()) {
                                result.put("found", true);
                                result.put("rawValue", rawVal.trim());
                                result.put("format", barcode.getFormat());
                                call.resolve(result);
                                return;
                            }
                        }
                    }
                    result.put("found", false);
                    call.resolve(result);
                })
                .addOnFailureListener(e -> {
                    try { bitmap.recycle(); } catch (Exception ignored) {}
                    call.reject("Error en ML Kit Barcode: " + e.getMessage());
                });
        } catch (Exception e) {
            call.reject("Error procesando imagen para código de barras: " + e.getMessage());
        }
    }

    @PluginMethod
    public void recognizeText(PluginCall call) {
        String base64Image = call.getString("imageBase64");
        if (base64Image == null || base64Image.isEmpty()) {
            call.reject("No se proporcionó imagen");
            return;
        }

        if (base64Image.contains(",")) {
            base64Image = base64Image.substring(base64Image.indexOf(",") + 1);
        }

        try {
            byte[] bytes = Base64.decode(base64Image, Base64.DEFAULT);
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inPreferredConfig = Bitmap.Config.RGB_565;
            Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
            if (bitmap == null) {
                call.reject("No se pudo decodificar el bitmap");
                return;
            }

            InputImage image = InputImage.fromBitmap(bitmap, 0);
            getTextRecognizer().process(image)
                .addOnSuccessListener(visionText -> {
                    try { bitmap.recycle(); } catch (Exception ignored) {}
                    String fullText = visionText.getText();
                    JSArray blocksArray = new JSArray();
                    for (Text.TextBlock block : visionText.getTextBlocks()) {
                        JSObject blockObj = new JSObject();
                        blockObj.put("text", block.getText());
                        blocksArray.put(blockObj);
                    }

                    JSObject result = new JSObject();
                    result.put("success", true);
                    result.put("text", fullText);
                    result.put("blocks", blocksArray);
                    call.resolve(result);
                })
                .addOnFailureListener(e -> {
                    try { bitmap.recycle(); } catch (Exception ignored) {}
                    call.reject("Error en OCR ML Kit: " + e.getMessage());
                });
        } catch (Exception e) {
            call.reject("Error procesando imagen para OCR: " + e.getMessage());
        }
    }

    @PluginMethod
    public void copyToClipboard(PluginCall call) {
        String text = call.getString("text");
        if (text == null) text = "";
        final String textToCopy = text;
        getActivity().runOnUiThread(() -> {
            try {
                android.content.ClipboardManager clipboard = (android.content.ClipboardManager) getContext().getSystemService(android.content.Context.CLIPBOARD_SERVICE);
                if (clipboard != null) {
                    android.content.ClipData clip = android.content.ClipData.newPlainText("Isaac POS", textToCopy);
                    clipboard.setPrimaryClip(clip);
                }
                JSObject ret = new JSObject();
                ret.put("success", true);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Error al copiar al portapapeles: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void triggerHaptic(PluginCall call) {
        String type = call.getString("type", "medium");
        getActivity().runOnUiThread(() -> {
            try {
                android.view.View rootView = getActivity().getWindow().getDecorView();
                if (rootView != null) {
                    if ("heavy".equalsIgnoreCase(type)) {
                        rootView.performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS);
                    } else if ("light".equalsIgnoreCase(type)) {
                        rootView.performHapticFeedback(android.view.HapticFeedbackConstants.CLOCK_TICK);
                    } else {
                        rootView.performHapticFeedback(android.view.HapticFeedbackConstants.KEYBOARD_TAP);
                    }
                }
                JSObject ret = new JSObject();
                ret.put("success", true);
                call.resolve(ret);
            } catch (Exception e) {
                call.resolve();
            }
        });
    }

    @PluginMethod
    public void setScreenSecure(PluginCall call) {
        boolean secure = call.getBoolean("secure", true);
        getActivity().runOnUiThread(() -> {
            try {
                if (secure) {
                    getActivity().getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE);
                } else {
                    getActivity().getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE);
                }
                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("isSecure", secure);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Error configurando FLAG_SECURE: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void checkDeviceSecurity(PluginCall call) {
        try {
            boolean isRooted = false;
            String[] paths = {
                "/system/app/Superuser.apk",
                "/sbin/su",
                "/system/bin/su",
                "/system/xbin/su",
                "/data/local/xbin/su",
                "/data/local/bin/su",
                "/system/sd/xbin/su",
                "/system/bin/failsafe/su",
                "/data/local/su",
                "/su/bin/su"
            };
            for (String path : paths) {
                if (new java.io.File(path).exists()) {
                    isRooted = true;
                    break;
                }
            }
            if (!isRooted) {
                String buildTags = android.os.Build.TAGS;
                if (buildTags != null && buildTags.contains("test-keys")) {
                    isRooted = true;
                }
            }

            JSObject res = new JSObject();
            res.put("isRooted", isRooted);
            res.put("isSecureEnvironment", !isRooted);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("Error verificando seguridad del dispositivo: " + e.getMessage());
        }
    }

    @PluginMethod
    public void readClipboard(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                android.content.ClipboardManager clipboard = (android.content.ClipboardManager) getContext().getSystemService(android.content.Context.CLIPBOARD_SERVICE);
                if (clipboard != null && clipboard.hasPrimaryClip() && clipboard.getPrimaryClip().getItemCount() > 0) {
                    CharSequence text = clipboard.getPrimaryClip().getItemAt(0).getText();
                    JSObject ret = new JSObject();
                    ret.put("value", text != null ? text.toString() : "");
                    call.resolve(ret);
                    return;
                }
                JSObject ret = new JSObject();
                ret.put("value", "");
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Error leyendo portapapeles nativo: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void writeClipboard(PluginCall call) {
        String text = call.getString("text", "");
        getActivity().runOnUiThread(() -> {
            try {
                android.content.ClipboardManager clipboard = (android.content.ClipboardManager) getContext().getSystemService(android.content.Context.CLIPBOARD_SERVICE);
                if (clipboard != null) {
                    android.content.ClipData clip = android.content.ClipData.newPlainText("Isaac POS", text);
                    clipboard.setPrimaryClip(clip);
                }
                JSObject ret = new JSObject();
                ret.put("success", true);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Error escribiendo en portapapeles nativo: " + e.getMessage());
            }
        });
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
        String prompt = call.getString("prompt", "Habla ahora para buscar...");
        String language = call.getString("language", "es-VE");

        try {
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, language);
            intent.putExtra(RecognizerIntent.EXTRA_PROMPT, prompt);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
            startActivityForResult(call, intent, "handleVoiceRecognitionResult");
        } catch (Exception e) {
            call.reject("El motor de dictado por voz no está disponible en este dispositivo: " + e.getMessage());
        }
    }

    @ActivityCallback
    private void handleVoiceRecognitionResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject ret = new JSObject();
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            ArrayList<String> matches = result.getData().getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
            if (matches != null && !matches.isEmpty()) {
                String bestMatch = matches.get(0) != null ? matches.get(0).trim() : "";
                // Eliminar punto final automático del motor de voz
                if (bestMatch.endsWith(".")) {
                    bestMatch = bestMatch.substring(0, bestMatch.length() - 1).trim();
                }
                JSArray matchesArray = new JSArray();
                for (String m : matches) {
                    if (m != null) matchesArray.put(m.trim());
                }
                ret.put("success", true);
                ret.put("text", bestMatch);
                ret.put("matches", matchesArray);
                call.resolve(ret);
                return;
            }
        }
        ret.put("success", false);
        ret.put("cancelled", true);
        call.resolve(ret);
    }

    @Override
    protected void handleOnDestroy() {
        closeCachedBtSocket();
        try {
            if (barcodeScanner != null) {
                barcodeScanner.close();
                barcodeScanner = null;
            }
        } catch (Exception ignored) {}
        try {
            if (textRecognizer != null) {
                textRecognizer.close();
                textRecognizer = null;
            }
        } catch (Exception ignored) {}
        try {
            bluetoothExecutor.shutdownNow();
        } catch (Exception ignored) {}
        try {
            sqliteExecutor.shutdownNow();
        } catch (Exception ignored) {}
        super.handleOnDestroy();
    }

    // =========================================================================
    // MOTOR SQLITE NATIVO ANDROID (MODO WAL + TRANSACCIONES ACID PRECOMPILADAS)
    // =========================================================================
    private static final String SQLITE_DB_NAME = "IsaacPosNativeStorage.db";
    private static final int SQLITE_DB_VERSION = 1;
    private static PosNativeSqliteHelper sqliteHelperInstance = null;
    private final java.util.concurrent.ExecutorService sqliteExecutor = java.util.concurrent.Executors.newSingleThreadExecutor();

    private static synchronized PosNativeSqliteHelper getSqliteHelper(Context context) {
        if (sqliteHelperInstance == null) {
            sqliteHelperInstance = new PosNativeSqliteHelper(context.getApplicationContext());
        }
        return sqliteHelperInstance;
    }

    private static class PosNativeSqliteHelper extends SQLiteOpenHelper {
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

    @PluginMethod
    public void sqlitePut(PluginCall call) {
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
            try {
                SQLiteDatabase db = getSqliteHelper(getContext()).getWritableDatabase();
                SQLiteStatement stmt = db.compileStatement(
                    "INSERT OR REPLACE INTO kv_records (store_name, record_id, json_payload, status, search_text, updated_at) VALUES (?, ?, ?, ?, ?, ?);"
                );
                stmt.bindString(1, storeName);
                stmt.bindString(2, recordId);
                stmt.bindString(3, jsonPayload);
                stmt.bindString(4, status != null ? status : "");
                stmt.bindString(5, searchText != null ? searchText.toLowerCase() : "");
                stmt.bindLong(6, System.currentTimeMillis());
                stmt.executeInsert();
                stmt.close();

                JSObject res = new JSObject();
                res.put("success", true);
                res.put("recordId", recordId);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Error en sqlitePut: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void sqlitePutBatch(PluginCall call) {
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
                db = getSqliteHelper(getContext()).getWritableDatabase();
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
                    stmt.bindString(5, search.toLowerCase());
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

    @PluginMethod
    public void sqliteReplaceAllAtomic(PluginCall call) {
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
                db = getSqliteHelper(getContext()).getWritableDatabase();
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
                    insStmt.bindString(5, search.toLowerCase());
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

    @PluginMethod
    public void sqliteGetAll(PluginCall call) {
        final String storeName = call.getString("storeName");
        if (storeName == null) {
            call.reject("storeName requerido en sqliteGetAll");
            return;
        }

        sqliteExecutor.execute(() -> {
            Cursor cursor = null;
            try {
                SQLiteDatabase db = getSqliteHelper(getContext()).getReadableDatabase();
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

    @PluginMethod
    public void sqliteGetById(PluginCall call) {
        final String storeName = call.getString("storeName");
        final String recordId = call.getString("recordId");
        if (storeName == null || recordId == null) {
            call.reject("Parámetros incompletos en sqliteGetById");
            return;
        }

        sqliteExecutor.execute(() -> {
            Cursor cursor = null;
            try {
                SQLiteDatabase db = getSqliteHelper(getContext()).getReadableDatabase();
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

    @PluginMethod
    public void sqliteGetByStatus(PluginCall call) {
        final String storeName = call.getString("storeName");
        final String status = call.getString("status");
        if (storeName == null || status == null) {
            call.reject("Parámetros incompletos en sqliteGetByStatus");
            return;
        }

        sqliteExecutor.execute(() -> {
            Cursor cursor = null;
            try {
                SQLiteDatabase db = getSqliteHelper(getContext()).getReadableDatabase();
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

    @PluginMethod
    public void sqliteDelete(PluginCall call) {
        final String storeName = call.getString("storeName");
        final String recordId = call.getString("recordId");
        if (storeName == null || recordId == null) {
            call.reject("Parámetros incompletos en sqliteDelete");
            return;
        }

        sqliteExecutor.execute(() -> {
            try {
                SQLiteDatabase db = getSqliteHelper(getContext()).getWritableDatabase();
                SQLiteStatement stmt = db.compileStatement(
                    "DELETE FROM kv_records WHERE store_name = ? AND record_id = ?;"
                );
                stmt.bindString(1, storeName);
                stmt.bindString(2, recordId);
                int deleted = stmt.executeUpdateDelete();
                stmt.close();

                JSObject res = new JSObject();
                res.put("success", true);
                res.put("deleted", deleted);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Error en sqliteDelete: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void sqliteClear(PluginCall call) {
        final String storeName = call.getString("storeName");
        if (storeName == null) {
            call.reject("storeName requerido en sqliteClear");
            return;
        }

        sqliteExecutor.execute(() -> {
            try {
                SQLiteDatabase db = getSqliteHelper(getContext()).getWritableDatabase();
                SQLiteStatement stmt = db.compileStatement("DELETE FROM kv_records WHERE store_name = ?;");
                stmt.bindString(1, storeName);
                int deleted = stmt.executeUpdateDelete();
                stmt.close();

                JSObject res = new JSObject();
                res.put("success", true);
                res.put("deleted", deleted);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Error en sqliteClear: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void sqliteGetStats(PluginCall call) {
        sqliteExecutor.execute(() -> {
            Cursor cursor = null;
            try {
                SQLiteDatabase db = getSqliteHelper(getContext()).getReadableDatabase();
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

    // ==================== ANDROID KEYSTORE SECURE VAULT (AES-256-GCM) ====================

    private static final String KEYSTORE_PROVIDER = "AndroidKeyStore";
    private static final String KEYSTORE_ALIAS = "isaac_pos_secure_vault_v1";
    private static final String SECURE_PREFS_NAME = "isaac_pos_secure_vault_prefs";
    private static final String AES_GCM_TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int GCM_TAG_BITS = 128;

    private synchronized SecretKey getOrCreateVaultSecretKey() throws Exception {
        KeyStore ks = KeyStore.getInstance(KEYSTORE_PROVIDER);
        ks.load(null);
        if (ks.containsAlias(KEYSTORE_ALIAS)) {
            KeyStore.Entry entry = ks.getEntry(KEYSTORE_ALIAS, null);
            if (entry instanceof KeyStore.SecretKeyEntry) {
                return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
            }
        }
        KeyGenerator keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER);
        KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
            KEYSTORE_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setRandomizedEncryptionRequired(true)
            .build();
        keyGenerator.init(spec);
        return keyGenerator.generateKey();
    }

    @PluginMethod
    public void saveSecureSecret(PluginCall call) {
        final String key = call.getString("key");
        final String value = call.getString("value");
        if (key == null || key.trim().isEmpty() || value == null) {
            call.reject("Parámetros key y value son obligatorios en saveSecureSecret");
            return;
        }
        try {
            SecretKey secretKey = getOrCreateVaultSecretKey();
            Cipher cipher = Cipher.getInstance(AES_GCM_TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, secretKey);
            byte[] iv = cipher.getIV();
            byte[] cipherBytes = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            String payload = Base64.encodeToString(iv, Base64.NO_WRAP)
                + ":"
                + Base64.encodeToString(cipherBytes, Base64.NO_WRAP);

            SharedPreferences prefs = getContext().getSharedPreferences(SECURE_PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit().putString(key.trim(), payload).apply();

            JSObject res = new JSObject();
            res.put("success", true);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("Error guardando secreto cifrado en Android Keystore: " + e.getMessage());
        }
    }

    @PluginMethod
    public void getSecureSecret(PluginCall call) {
        final String key = call.getString("key");
        if (key == null || key.trim().isEmpty()) {
            call.reject("Parámetro key requerido en getSecureSecret");
            return;
        }
        try {
            SharedPreferences prefs = getContext().getSharedPreferences(SECURE_PREFS_NAME, Context.MODE_PRIVATE);
            String payload = prefs.getString(key.trim(), null);
            JSObject res = new JSObject();
            if (payload == null || !payload.contains(":")) {
                res.put("value", JSObject.NULL);
                call.resolve(res);
                return;
            }
            String[] parts = payload.split(":", 2);
            byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP);
            byte[] cipherBytes = Base64.decode(parts[1], Base64.NO_WRAP);

            SecretKey secretKey = getOrCreateVaultSecretKey();
            Cipher cipher = Cipher.getInstance(AES_GCM_TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, secretKey, new GCMParameterSpec(GCM_TAG_BITS, iv));
            byte[] plainBytes = cipher.doFinal(cipherBytes);

            res.put("value", new String(plainBytes, StandardCharsets.UTF_8));
            call.resolve(res);
        } catch (Exception e) {
            call.reject("Error descifrando secreto desde Android Keystore: " + e.getMessage());
        }
    }

    @PluginMethod
    public void removeSecureSecret(PluginCall call) {
        final String key = call.getString("key");
        if (key == null || key.trim().isEmpty()) {
            call.reject("Parámetro key requerido en removeSecureSecret");
            return;
        }
        try {
            SharedPreferences prefs = getContext().getSharedPreferences(SECURE_PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit().remove(key.trim()).apply();
            JSObject res = new JSObject();
            res.put("success", true);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("Error eliminando secreto en Android Keystore: " + e.getMessage());
        }
    }
}
