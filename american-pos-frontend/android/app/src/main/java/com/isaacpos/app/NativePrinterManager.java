package com.isaacpos.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.BluetoothSocket;
import android.bluetooth.BluetoothStatusCodes;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Base64;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Manager completo de impresión térmica nativa Android:
 * 1. Bluetooth Classic RFCOMM SPP (socket persistente cacheado + timeout 5s + chunking 512 B).
 * 2. Descubrimiento activo Classic + BLE (BLUETOOTH_SCAN sin GPS en Android 12+).
 * 3. Cliente BLE GATT nativo (negociación MTU + auto-detección característica ESC/POS writable).
 * 4. Impresión directa Wi-Fi / LAN TCP 9100 con guardia anti-SSRF estricta.
 */
final class NativePrinterManager {

    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final int BT_CONNECT_TIMEOUT_MS = 5000;
    private static final int BT_CHUNK_BYTES = 512;
    private static final long BT_CHUNK_DELAY_MS = 10L;
    private static final int TCP_CONNECT_TIMEOUT_MS = 4000;
    private static final int TCP_SO_TIMEOUT_MS = 5000;
    private static final int TCP_CHUNK_BYTES = 1024;
    private static final int BLE_REQUESTED_MTU = 247;
    private static final int BLE_CONNECT_TIMEOUT_MS = 6500;
    private static final int BLE_SERVICES_TIMEOUT_MS = 5000;
    private static final int BLE_WRITE_TIMEOUT_MS = 3500;
    private static final long BLE_CHUNK_PACING_MS = 12L;

    private final Context appContext;
    private final ExecutorService ioExecutor;
    private final ExecutorService bluetoothExecutor = Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService discoveryScheduler = Executors.newSingleThreadScheduledExecutor();
    private final Object btLock = new Object();

    private BluetoothSocket cachedBtSocket = null;
    private String cachedBtAddress = null;
    private volatile Runnable activeDiscoveryStopper = null;

    NativePrinterManager(Context context, ExecutorService ioExecutor) {
        this.appContext = context.getApplicationContext();
        this.ioExecutor = ioExecutor;
    }

    boolean hasBluetoothConnectPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return ContextCompat.checkSelfPermission(appContext, Manifest.permission.BLUETOOTH_CONNECT)
                    == PackageManager.PERMISSION_GRANTED;
        }
        return true;
    }

    boolean hasBluetoothScanPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return ContextCompat.checkSelfPermission(appContext, Manifest.permission.BLUETOOTH_SCAN)
                    == PackageManager.PERMISSION_GRANTED
                    && hasBluetoothConnectPermission();
        }
        // En Android 7–11 (API 24–30), Bluetooth/BLE discovery requiere ACCESS_FINE_LOCATION en runtime
        return ContextCompat.checkSelfPermission(appContext, Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    private BluetoothAdapter getBluetoothAdapter() {
        try {
            BluetoothManager bm = (BluetoothManager) appContext.getSystemService(Context.BLUETOOTH_SERVICE);
            return bm != null ? bm.getAdapter() : null;
        } catch (Exception e) {
            return null;
        }
    }

    private static String transportLabelForDeviceType(int deviceType) {
        if (deviceType == BluetoothDevice.DEVICE_TYPE_LE) return "BLE";
        if (deviceType == BluetoothDevice.DEVICE_TYPE_DUAL) return "DUAL";
        return "CLASSIC";
    }

    private void connectSocketWithTimeout(BluetoothSocket sock) throws Exception {
        Future<?> connectFuture = ioExecutor.submit(() -> {
            try {
                sock.connect();
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        });
        try {
            connectFuture.get(BT_CONNECT_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        } catch (TimeoutException te) {
            connectFuture.cancel(true);
            try { sock.close(); } catch (Exception ignored) {}
            throw new Exception("Tiempo de espera agotado al conectar impresora Bluetooth (5s)");
        } catch (Exception ex) {
            try { sock.close(); } catch (Exception ignored) {}
            throw ex;
        }
    }

    @SuppressLint("MissingPermission")
    private BluetoothSocket openRfcommSocket(BluetoothAdapter adapter, BluetoothDevice device) throws Exception {
        try {
            if (adapter != null && adapter.isDiscovering()) {
                adapter.cancelDiscovery();
            }
        } catch (Exception ignored) {}

        BluetoothSocket sock = null;
        try {
            sock = device.createRfcommSocketToServiceRecord(SPP_UUID);
            connectSocketWithTimeout(sock);
            return sock;
        } catch (Exception sppErr) {
            try {
                if (sock != null) sock.close();
            } catch (Exception ignored) {}
            BluetoothSocket fallbackSock = null;
            try {
                java.lang.reflect.Method m = device.getClass().getMethod("createRfcommSocket", int.class);
                fallbackSock = (BluetoothSocket) m.invoke(device, 1);
                if (fallbackSock == null) throw sppErr;
                connectSocketWithTimeout(fallbackSock);
                return fallbackSock;
            } catch (Exception reflectionErr) {
                try {
                    if (fallbackSock != null) fallbackSock.close();
                } catch (Exception ignored) {}
                throw sppErr;
            }
        }
    }

    private void writeChunkedToPrinter(OutputStream out, byte[] bytes) throws Exception {
        int offset = 0;
        while (offset < bytes.length) {
            int len = Math.min(BT_CHUNK_BYTES, bytes.length - offset);
            out.write(bytes, offset, len);
            out.flush();
            offset += len;
            if (offset < bytes.length) {
                Thread.sleep(BT_CHUNK_DELAY_MS);
            }
        }
    }

    void closeCachedBtSocket() {
        synchronized (btLock) {
            if (cachedBtSocket != null) {
                try {
                    cachedBtSocket.close();
                } catch (Exception ignored) {}
                cachedBtSocket = null;
                cachedBtAddress = null;
            }
        }
    }

    @SuppressLint("MissingPermission")
    void getPairedPrinters(PluginCall call) {
        try {
            BluetoothAdapter adapter = getBluetoothAdapter();
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
                    item.put("bonded", true);
                    item.put("transport", transportLabelForDeviceType(device.getType()));
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

    private static final class DiscoveredPrinter {
        final String address;
        String name;
        boolean bonded;
        String transport;
        int rssi;

        DiscoveredPrinter(String address, String name, boolean bonded, String transport, int rssi) {
            this.address = address;
            this.name = name;
            this.bonded = bonded;
            this.transport = transport;
            this.rssi = rssi;
        }
    }

    @SuppressLint("MissingPermission")
    void discoverBluetoothPrinters(PluginCall call) {
        BluetoothAdapter adapter = getBluetoothAdapter();
        if (adapter == null || !adapter.isEnabled()) {
            call.reject("Bluetooth no disponible o apagado. Activa el Bluetooth en tu teléfono.");
            return;
        }

        int rawDuration = call.getInt("durationMs", 4500);
        final long durationMs = Math.max(1500L, Math.min(8000L, rawDuration));

        // Detener cualquier escaneo previo pendiente antes de iniciar uno nuevo
        Runnable prevStop = activeDiscoveryStopper;
        if (prevStop != null) {
            try { prevStop.run(); } catch (Exception ignored) {}
        }

        final ConcurrentHashMap<String, DiscoveredPrinter> found = new ConcurrentHashMap<>();
        final JSArray warnings = new JSArray();

        // 1. Sembrar dispositivos ya emparejados
        try {
            Set<BluetoothDevice> bonded = adapter.getBondedDevices();
            if (bonded != null) {
                for (BluetoothDevice d : bonded) {
                    if (d == null || d.getAddress() == null) continue;
                    String key = d.getAddress().toUpperCase(Locale.ROOT);
                    String name = d.getName() != null && !d.getName().trim().isEmpty()
                            ? d.getName().trim() : "Impresora BT";
                    found.put(key, new DiscoveredPrinter(
                            d.getAddress(),
                            name,
                            true,
                            transportLabelForDeviceType(d.getType()),
                            -45
                    ));
                }
            }
        } catch (Exception ignored) {}

        final AtomicBoolean finished = new AtomicBoolean(false);
        final AtomicBoolean receiverRegistered = new AtomicBoolean(false);
        final BluetoothLeScanner leScanner = adapter.getBluetoothLeScanner();

        // 2. Callback BLE Scanner
        final ScanCallback bleCallback = new ScanCallback() {
            @Override
            public void onScanResult(int callbackType, ScanResult result) {
                if (result == null || result.getDevice() == null) return;
                BluetoothDevice dev = result.getDevice();
                String addr = dev.getAddress();
                if (addr == null) return;
                String devName = dev.getName();
                if ((devName == null || devName.trim().isEmpty()) && result.getScanRecord() != null) {
                    devName = result.getScanRecord().getDeviceName();
                }
                // Ignorar beacons BLE completamente anónimos sin nombre para no contaminar la lista de caja
                if (devName == null || devName.trim().isEmpty()) return;

                String key = addr.toUpperCase(Locale.ROOT);
                String cleanName = devName.trim();
                int rssi = result.getRssi();
                boolean isBonded = dev.getBondState() == BluetoothDevice.BOND_BONDED;
                String transport = dev.getType() == BluetoothDevice.DEVICE_TYPE_DUAL ? "DUAL" : "BLE";

                found.compute(key, (k, existing) -> {
                    if (existing == null) {
                        return new DiscoveredPrinter(addr, cleanName, isBonded, transport, rssi);
                    }
                    existing.rssi = rssi;
                    if (existing.name == null || existing.name.startsWith("Impresora BT")) {
                        existing.name = cleanName;
                    }
                    if ("CLASSIC".equals(existing.transport)) {
                        existing.transport = "DUAL";
                    }
                    return existing;
                });
            }
        };

        // 3. BroadcastReceiver para Bluetooth Classic Discovery
        final BroadcastReceiver classicReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent == null || !BluetoothDevice.ACTION_FOUND.equals(intent.getAction())) return;
                BluetoothDevice dev = extractBluetoothDevice(intent);
                if (dev == null || dev.getAddress() == null) return;
                String devName = dev.getName();
                if (devName == null || devName.trim().isEmpty()) return;

                String addr = dev.getAddress();
                String key = addr.toUpperCase(Locale.ROOT);
                int rssi = intent.getShortExtra(BluetoothDevice.EXTRA_RSSI, (short) -70);
                boolean isBonded = dev.getBondState() == BluetoothDevice.BOND_BONDED;
                String transport = transportLabelForDeviceType(dev.getType());

                found.compute(key, (k, existing) -> {
                    if (existing == null) {
                        return new DiscoveredPrinter(addr, devName.trim(), isBonded, transport, rssi);
                    }
                    existing.rssi = rssi;
                    if (existing.name == null || existing.name.startsWith("Impresora BT")) {
                        existing.name = devName.trim();
                    }
                    return existing;
                });
            }
        };

        Runnable finishDiscovery = () -> {
            if (!finished.compareAndSet(false, true)) return;
            activeDiscoveryStopper = null;
            try {
                if (leScanner != null) {
                    leScanner.stopScan(bleCallback);
                }
            } catch (Exception ignored) {}
            try {
                if (adapter.isDiscovering()) {
                    adapter.cancelDiscovery();
                }
            } catch (Exception ignored) {}
            if (receiverRegistered.compareAndSet(true, false)) {
                try {
                    appContext.unregisterReceiver(classicReceiver);
                } catch (Exception ignored) {}
            }

            List<DiscoveredPrinter> sorted = new ArrayList<>(found.values());
            sorted.sort(Comparator.comparingInt((DiscoveredPrinter p) ->
                    NativeHardwareUtils.scoreBluetoothPrinterCandidate(p.name, p.bonded, p.rssi)).reversed());

            JSArray arr = new JSArray();
            for (DiscoveredPrinter p : sorted) {
                JSObject obj = new JSObject();
                obj.put("name", p.name);
                obj.put("address", p.address);
                obj.put("bonded", p.bonded);
                obj.put("transport", p.transport);
                obj.put("rssi", p.rssi);
                arr.put(obj);
            }
            JSObject res = new JSObject();
            res.put("printers", arr);
            res.put("count", sorted.size());
            if (warnings.length() > 0) {
                res.put("warnings", warnings);
            }
            call.resolve(res);
        };

        activeDiscoveryStopper = finishDiscovery;

        // Registrar receiver Classic con flag explícito para Android 13-16
        try {
            IntentFilter filter = new IntentFilter(BluetoothDevice.ACTION_FOUND);
            ContextCompat.registerReceiver(appContext, classicReceiver, filter, ContextCompat.RECEIVER_EXPORTED);
            receiverRegistered.set(true);
        } catch (Exception recErr) {
            warnings.put("No se pudo registrar descubrimiento Bluetooth Classic: " + recErr.getMessage());
        }

        // Iniciar BLE scan + Classic discovery (reportando errores reales sin silenciarlos)
        try {
            if (leScanner != null) {
                ScanSettings settings = new ScanSettings.Builder()
                        .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                        .build();
                leScanner.startScan(null, settings, bleCallback);
            }
        } catch (Exception bleErr) {
            warnings.put("Escaneo BLE no disponible: " + bleErr.getMessage());
        }

        try {
            if (adapter.isDiscovering()) {
                adapter.cancelDiscovery();
            }
            if (!adapter.startDiscovery()) {
                warnings.put("El adaptador Bluetooth no inició el descubrimiento Classic (verifica permisos/ubicación).");
            }
        } catch (Exception discErr) {
            warnings.put("Error iniciando descubrimiento Classic: " + discErr.getMessage());
        }

        discoveryScheduler.schedule(finishDiscovery, durationMs, TimeUnit.MILLISECONDS);
    }

    @SuppressWarnings("deprecation")
    private static BluetoothDevice extractBluetoothDevice(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice.class);
        }
        return intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
    }

    @SuppressLint("MissingPermission")
    void printBluetooth(PluginCall call) {
        String address = call.getString("address");
        String base64Data = call.getString("data");
        String requestedTransport = call.getString("transport", "auto");

        if (base64Data == null || base64Data.isEmpty()) {
            call.reject("No se proporcionaron datos para imprimir");
            return;
        }
        if (address == null || address.trim().isEmpty()) {
            call.reject("Debes seleccionar una impresora Bluetooth específica antes de imprimir.");
            return;
        }

        BluetoothAdapter adapter = getBluetoothAdapter();
        if (adapter == null || !adapter.isEnabled()) {
            call.reject("Bluetooth no disponible o apagado");
            return;
        }

        final String targetAddress = address.trim();
        final String mode = requestedTransport != null ? requestedTransport.trim().toLowerCase(Locale.ROOT) : "auto";

        bluetoothExecutor.execute(() -> {
            synchronized (btLock) {
                try {
                    byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                    BluetoothDevice device = adapter.getRemoteDevice(targetAddress);
                    int devType = device.getType();

                    boolean forceBle = "ble".equals(mode) || ("auto".equals(mode) && devType == BluetoothDevice.DEVICE_TYPE_LE);
                    if (forceBle) {
                        closeCachedBtSocket();
                        int chunkUsed = printViaBleGatt(device, bytes);
                        JSObject res = new JSObject();
                        res.put("success", true);
                        res.put("printedBytes", bytes.length);
                        res.put("transport", "BLE_GATT");
                        res.put("chunkBytes", chunkUsed);
                        call.resolve(res);
                        return;
                    }

                    boolean written = false;
                    // 1. Reutilizar socket RFCOMM persistente si corresponde a la misma MAC
                    if (cachedBtSocket != null && cachedBtSocket.isConnected()
                            && targetAddress.equalsIgnoreCase(cachedBtAddress)) {
                        try {
                            OutputStream out = cachedBtSocket.getOutputStream();
                            writeChunkedToPrinter(out, bytes);
                            written = true;
                        } catch (Exception staleErr) {
                            closeCachedBtSocket();
                        }
                    } else if (cachedBtSocket != null) {
                        closeCachedBtSocket();
                    }

                    // 2. Si no había socket activo, abrir RFCOMM SPP con timeout + fallback reflexión
                    if (!written) {
                        try {
                            cachedBtSocket = openRfcommSocket(adapter, device);
                            cachedBtAddress = targetAddress;
                            OutputStream out = cachedBtSocket.getOutputStream();
                            writeChunkedToPrinter(out, bytes);
                        } catch (Exception sppErr) {
                            closeCachedBtSocket();
                            // Si el equipo es DUAL o UNKNOWN y estamos en modo auto, intentar BLE GATT nativo
                            if ("auto".equals(mode) && devType != BluetoothDevice.DEVICE_TYPE_CLASSIC) {
                                int chunkUsed = printViaBleGatt(device, bytes);
                                JSObject res = new JSObject();
                                res.put("success", true);
                                res.put("printedBytes", bytes.length);
                                res.put("transport", "BLE_GATT");
                                res.put("chunkBytes", chunkUsed);
                                call.resolve(res);
                                return;
                            }
                            throw sppErr;
                        }
                    }

                    JSObject res = new JSObject();
                    res.put("success", true);
                    res.put("printedBytes", bytes.length);
                    res.put("transport", "RFCOMM_SPP");
                    call.resolve(res);
                } catch (Exception e) {
                    closeCachedBtSocket();
                    call.reject("Fallo al imprimir por Bluetooth: " + e.getMessage());
                }
            }
        });
    }

    @SuppressLint("MissingPermission")
    void printBluetoothBle(PluginCall call) {
        String address = call.getString("address");
        String base64Data = call.getString("data");
        if (base64Data == null || base64Data.isEmpty()) {
            call.reject("No se proporcionaron datos para imprimir por BLE");
            return;
        }
        if (address == null || address.trim().isEmpty()) {
            call.reject("Debes seleccionar una impresora Bluetooth BLE específica.");
            return;
        }
        BluetoothAdapter adapter = getBluetoothAdapter();
        if (adapter == null || !adapter.isEnabled()) {
            call.reject("Bluetooth no disponible o apagado");
            return;
        }

        final String targetAddress = address.trim();
        bluetoothExecutor.execute(() -> {
            synchronized (btLock) {
                try {
                    closeCachedBtSocket();
                    byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                    BluetoothDevice device = adapter.getRemoteDevice(targetAddress);
                    int chunkUsed = printViaBleGatt(device, bytes);
                    JSObject res = new JSObject();
                    res.put("success", true);
                    res.put("printedBytes", bytes.length);
                    res.put("transport", "BLE_GATT");
                    res.put("chunkBytes", chunkUsed);
                    call.resolve(res);
                } catch (Exception e) {
                    call.reject("Fallo al imprimir por BLE GATT: " + e.getMessage());
                }
            }
        });
    }

    @SuppressLint("MissingPermission")
    private int printViaBleGatt(BluetoothDevice device, byte[] payload) throws Exception {
        final CountDownLatch connectedLatch = new CountDownLatch(1);
        final CountDownLatch mtuLatch = new CountDownLatch(1);
        final CountDownLatch servicesLatch = new CountDownLatch(1);
        final AtomicReference<CountDownLatch> writeLatchRef = new AtomicReference<>();
        final AtomicInteger negotiatedMtu = new AtomicInteger(NativeHardwareUtils.DEFAULT_BLE_MTU);
        final AtomicInteger lastStatus = new AtomicInteger(BluetoothGatt.GATT_SUCCESS);
        final AtomicBoolean isConnected = new AtomicBoolean(false);
        final AtomicBoolean servicesReady = new AtomicBoolean(false);

        BluetoothGattCallback callback = new BluetoothGattCallback() {
            @Override
            public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
                if (status == BluetoothGatt.GATT_SUCCESS && newState == BluetoothProfile.STATE_CONNECTED) {
                    isConnected.set(true);
                    connectedLatch.countDown();
                } else {
                    lastStatus.set(status);
                    isConnected.set(false);
                    connectedLatch.countDown();
                    mtuLatch.countDown();
                    servicesLatch.countDown();
                    CountDownLatch wl = writeLatchRef.get();
                    if (wl != null) wl.countDown();
                }
            }

            @Override
            public void onMtuChanged(BluetoothGatt gatt, int mtu, int status) {
                if (status == BluetoothGatt.GATT_SUCCESS && mtu > NativeHardwareUtils.DEFAULT_BLE_MTU) {
                    negotiatedMtu.set(mtu);
                }
                mtuLatch.countDown();
            }

            @Override
            public void onServicesDiscovered(BluetoothGatt gatt, int status) {
                if (status == BluetoothGatt.GATT_SUCCESS) {
                    servicesReady.set(true);
                } else {
                    lastStatus.set(status);
                }
                servicesLatch.countDown();
            }

            @Override
            public void onCharacteristicWrite(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, int status) {
                lastStatus.set(status);
                CountDownLatch wl = writeLatchRef.get();
                if (wl != null) wl.countDown();
            }
        };

        BluetoothGatt gatt = null;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                gatt = device.connectGatt(appContext, false, callback, BluetoothDevice.TRANSPORT_LE);
            } else {
                gatt = device.connectGatt(appContext, false, callback);
            }
            if (gatt == null) {
                throw new Exception("No se pudo iniciar la sesión BLE GATT");
            }

            if (!connectedLatch.await(BLE_CONNECT_TIMEOUT_MS, TimeUnit.MILLISECONDS) || !isConnected.get()) {
                throw new Exception("Tiempo agotado o fallo conectando impresora BLE (status=" + lastStatus.get() + ")");
            }

            // Negociar MTU mayor para transmisión térmica rápida (fallback seguro a 20 bytes)
            try {
                if (gatt.requestMtu(BLE_REQUESTED_MTU)) {
                    mtuLatch.await(1500L, TimeUnit.MILLISECONDS);
                }
            } catch (Exception ignored) {}

            if (!gatt.discoverServices()) {
                throw new Exception("No se pudo iniciar el descubrimiento de servicios BLE GATT");
            }
            if (!servicesLatch.await(BLE_SERVICES_TIMEOUT_MS, TimeUnit.MILLISECONDS) || !servicesReady.get()) {
                throw new Exception("No se descubrieron servicios GATT de la impresora BLE");
            }

            BluetoothGattCharacteristic writableChar = findWritableThermalCharacteristic(gatt.getServices());
            if (writableChar == null) {
                throw new Exception("La impresora BLE no expone ninguna característica ESC/POS escribible");
            }

            int props = writableChar.getProperties();
            boolean useNoResponse = (props & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0;
            int writeType = useNoResponse
                    ? BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                    : BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT;
            int chunkSize = NativeHardwareUtils.computeBleChunkSize(negotiatedMtu.get());

            int offset = 0;
            while (offset < payload.length) {
                int len = Math.min(chunkSize, payload.length - offset);
                byte[] chunk = new byte[len];
                System.arraycopy(payload, offset, chunk, 0, len);

                CountDownLatch chunkLatch = new CountDownLatch(1);
                writeLatchRef.set(chunkLatch);
                lastStatus.set(BluetoothGatt.GATT_SUCCESS);

                boolean initiated = writeBleChunk(gatt, writableChar, chunk, writeType);
                if (!initiated) {
                    throw new Exception("Error iniciando escritura de bloque BLE en byte " + offset);
                }
                boolean acked = chunkLatch.await(BLE_WRITE_TIMEOUT_MS, TimeUnit.MILLISECONDS);
                if (!acked) {
                    throw new Exception("Timeout esperando confirmación BLE GATT en byte " + offset);
                }
                if (lastStatus.get() != BluetoothGatt.GATT_SUCCESS) {
                    throw new Exception("Impresora BLE rechazó bloque (status=" + lastStatus.get() + ")");
                }

                offset += len;
                if (offset < payload.length) {
                    Thread.sleep(BLE_CHUNK_PACING_MS);
                }
            }

            // Dar un breve respiro para que la impresora vacíe el buffer final antes de desconectar
            Thread.sleep(150L);
            return chunkSize;
        } finally {
            if (gatt != null) {
                try { gatt.disconnect(); } catch (Exception ignored) {}
                try { gatt.close(); } catch (Exception ignored) {}
            }
        }
    }

    private static BluetoothGattCharacteristic findWritableThermalCharacteristic(List<BluetoothGattService> services) {
        if (services == null) return null;
        // 1ª pasada: priorizar servicios GATT conocidos de impresoras térmicas ESC/POS
        for (BluetoothGattService service : services) {
            if (service == null || service.getUuid() == null) continue;
            if (!NativeHardwareUtils.isKnownThermalPrinterServiceUuid(service.getUuid().toString())) continue;
            BluetoothGattCharacteristic match = findFirstWritableChar(service);
            if (match != null) return match;
        }
        // 2ª pasada: fallback a cualquier característica writable en servicios NO estándar (excluyendo 0x1800/0x1801/0x180A/0x180F)
        for (BluetoothGattService service : services) {
            if (service == null || service.getUuid() == null) continue;
            if (NativeHardwareUtils.isExcludedStandardGattServiceUuid(service.getUuid().toString())) {
                continue;
            }
            BluetoothGattCharacteristic match = findFirstWritableChar(service);
            if (match != null) return match;
        }
        return null;
    }

    private static BluetoothGattCharacteristic findFirstWritableChar(BluetoothGattService service) {
        List<BluetoothGattCharacteristic> chars = service.getCharacteristics();
        if (chars == null) return null;
        BluetoothGattCharacteristic fallbackWrite = null;
        for (BluetoothGattCharacteristic ch : chars) {
            if (ch == null) continue;
            int props = ch.getProperties();
            if ((props & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0) {
                return ch;
            }
            if ((props & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0 && fallbackWrite == null) {
                fallbackWrite = ch;
            }
        }
        return fallbackWrite;
    }

    @SuppressLint("MissingPermission")
    @SuppressWarnings("deprecation")
    private static boolean writeBleChunk(
            BluetoothGatt gatt,
            BluetoothGattCharacteristic characteristic,
            byte[] chunk,
            int writeType
    ) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            int code = gatt.writeCharacteristic(characteristic, chunk, writeType);
            return code == BluetoothStatusCodes.SUCCESS;
        }
        characteristic.setWriteType(writeType);
        characteristic.setValue(chunk);
        return gatt.writeCharacteristic(characteristic);
    }

    void printNetworkTcp(PluginCall call) {
        final String rawIp = call.getString("ip", "");
        final int port = call.getInt("port", 9100);
        final String base64Data = call.getString("data");

        if (base64Data == null || base64Data.isEmpty()) {
            call.reject("No se proporcionaron datos para imprimir por red LAN");
            return;
        }
        final String host = rawIp != null ? rawIp.trim() : "";
        if (!NativeHardwareUtils.isAllowedLanPrinterHost(host)) {
            call.reject("Host bloqueado por seguridad: solo se permiten impresoras térmicas en red local privada (RFC1918 / .local).");
            return;
        }
        if (!NativeHardwareUtils.isValidPrinterPort(port)) {
            call.reject("Puerto TCP no permitido para impresora térmica. Puertos autorizados: 9100, 9101, 9102, 515, 631.");
            return;
        }

        ioExecutor.execute(() -> {
            try {
                // Validación post-DNS anti DNS-rebinding / anti-SSRF
                InetAddress resolvedAddress = InetAddress.getByName(host);
                String resolvedIp = resolvedAddress != null ? resolvedAddress.getHostAddress() : null;
                if (!NativeHardwareUtils.isAllowedResolvedPrinterIp(resolvedIp)) {
                    call.reject("Destino de impresora bloqueado post-DNS: solo se permiten direcciones IPv4 RFC1918 privadas.");
                    return;
                }

                byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                try (Socket socket = new Socket()) {
                    socket.connect(new InetSocketAddress(resolvedAddress, port), TCP_CONNECT_TIMEOUT_MS);
                    socket.setSoTimeout(TCP_SO_TIMEOUT_MS);
                    OutputStream out = socket.getOutputStream();
                    int offset = 0;
                    while (offset < bytes.length) {
                        int len = Math.min(TCP_CHUNK_BYTES, bytes.length - offset);
                        out.write(bytes, offset, len);
                        offset += len;
                    }
                    out.flush();
                }

                JSObject res = new JSObject();
                res.put("success", true);
                res.put("printedBytes", bytes.length);
                res.put("transport", "TCP_DIRECT");
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Fallo imprimiendo directamente por red TCP " + host + ":" + port + " — " + e.getMessage());
            }
        });
    }

    void shutdown() {
        Runnable stopper = activeDiscoveryStopper;
        if (stopper != null) {
            try { stopper.run(); } catch (Exception ignored) {}
            activeDiscoveryStopper = null;
        }
        closeCachedBtSocket();
        try {
            bluetoothExecutor.shutdownNow();
        } catch (Exception ignored) {}
        try {
            discoveryScheduler.shutdownNow();
        } catch (Exception ignored) {}
    }
}
