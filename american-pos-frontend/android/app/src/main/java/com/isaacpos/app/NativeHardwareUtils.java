package com.isaacpos.app;

import java.net.URI;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Utilidades puras de validación, seguridad y algoritmos de hardware para la capa nativa Android de Isaac POS.
 * Sin dependencias de android.* para permitir pruebas unitarias JUnit 4 directas en JVM.
 */
public final class NativeHardwareUtils {

    public static final int DEFAULT_BLE_MTU = 23;
    public static final int MIN_BLE_CHUNK_BYTES = 20;
    public static final int MAX_BLE_CHUNK_BYTES = 244;
    public static final int MIN_PRINTER_TCP_PORT = 515;
    public static final int MAX_PRINTER_TCP_PORT = 9102;
    public static final int MAX_SHARED_PNG_BYTES = 10 * 1024 * 1024;
    public static final long DEFAULT_BURST_COOLDOWN_MS = 1400L;

    public static final Set<Integer> ALLOWED_PRINTER_TCP_PORTS = Collections.unmodifiableSet(
        new HashSet<>(Arrays.asList(9100, 9101, 9102, 515, 631))
    );

    public static final Set<String> EXCLUDED_STANDARD_GATT_SERVICE_UUIDS = Collections.unmodifiableSet(
        new HashSet<>(Arrays.asList(
            "00001800-0000-1000-8000-00805f9b34fb", // Generic Access
            "00001801-0000-1000-8000-00805f9b34fb", // Generic Attribute
            "0000180a-0000-1000-8000-00805f9b34fb", // Device Information
            "0000180f-0000-1000-8000-00805f9b34fb"  // Battery Service
        ))
    );

    public static final Set<String> KNOWN_THERMAL_BLE_SERVICE_UUIDS = Collections.unmodifiableSet(
        new HashSet<>(Arrays.asList(
            "000018f0-0000-1000-8000-00805f9b34fb", // Standard POS Printer Service
            "e7810a71-73ae-499d-8c15-faa9aef0c3f2", // POS-58 / POS-80 BLE Service
            "49535343-fe7d-4ae5-8fa9-9fafd205e455", // ISSC / Microchip Transparent UART
            "0000ff00-0000-1000-8000-00805f9b34fb", // Thermal Generic FF00
            "0000fee7-0000-1000-8000-00805f9b34fb", // Generic Printer FEE7
            "0000fff0-0000-1000-8000-00805f9b34fb", // Generic BLE Serial FFF0
            "0000ae30-0000-1000-8000-00805f9b34fb"  // Cat / Mini Thermal Printer AE30
        ))
    );

    private static final String[] PRINTER_NAME_KEYWORDS = {
        "pos", "mtp", "rpp", "xp-", "xprinter", "bixolon", "epson", "star", "zebra",
        "thermal", "printer", "impresora", "pt-", "zj-", "gp-", "hprt", "sunmi",
        "innerprinter", "bluetoothprinter", "blue tooth printer", "mpt-", "rp58", "rp80", "58mm", "80mm"
    };

    private NativeHardwareUtils() {}

    /**
     * Evalúa el resultado JSON serializado de WebView.evaluateJavascript().
     * Corrige el fallo de usar result.contains("handled"), que daba positivo en "\"unhandled\"".
     */
    public static boolean isJsBackHandled(String rawJsResult) {
        if (rawJsResult == null) return false;
        String trimmed = rawJsResult.trim();
        return "\"handled\"".equals(trimmed) || "true".equals(trimmed);
    }

    /**
     * Valida si un hostname pertenece a red privada local (RFC1918), loopback, link-local o mDNS .local.
     */
    public static boolean isPrivateLanOrLocalHost(String rawHost) {
        if (rawHost == null) return false;
        String host = rawHost.trim().toLowerCase(Locale.ROOT);
        if (host.startsWith("[") && host.endsWith("]")) {
            host = host.substring(1, host.length() - 1);
        }
        if (host.isEmpty()) return false;
        if ("localhost".equals(host) || "127.0.0.1".equals(host) || "::1".equals(host) || host.endsWith(".local")) {
            return true;
        }
        String[] parts = host.split("\\.");
        if (parts.length != 4) return false;
        int[] octets = new int[4];
        try {
            for (int i = 0; i < 4; i++) {
                if (parts[i].isEmpty() || parts[i].length() > 3) return false;
                octets[i] = Integer.parseInt(parts[i]);
                if (octets[i] < 0 || octets[i] > 255) return false;
            }
        } catch (NumberFormatException e) {
            return false;
        }
        int a = octets[0];
        int b = octets[1];
        if (a == 10 || a == 127) return true;
        if (a == 192 && b == 168) return true;
        if (a == 172 && b >= 16 && b <= 31) return true;
        if (a == 169 && b == 254) return true;
        return false;
    }

    /**
     * Guardia anti-SSRF estricta para impresión térmica TCP LAN (puerto 9100):
     * permite únicamente IPs RFC1918 privadas o nombres mDNS .local (bloquea cloud metadata 169.254.169.254 e Internet).
     */
    public static boolean isAllowedLanPrinterHost(String rawHost) {
        if (rawHost == null) return false;
        String host = rawHost.trim().toLowerCase(Locale.ROOT);
        if (host.isEmpty()) return false;
        // Bloquear metadata cloud (AWS/GCP/Azure link-local) y loopback del propio teléfono
        if (host.startsWith("169.254.") || host.startsWith("127.") || "localhost".equals(host) || "::1".equals(host)) {
            return false;
        }
        return isPrivateLanOrLocalHost(host);
    }

    /**
     * Valida una IP literal YA resuelta post-DNS para impresoras térmicas LAN (anti DNS-rebinding y SSRF):
     * permite exclusivamente direcciones IPv4 RFC1918 (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16).
     */
    public static boolean isAllowedResolvedPrinterIp(String resolvedIp) {
        if (resolvedIp == null) return false;
        String ip = resolvedIp.trim().toLowerCase(Locale.ROOT);
        if (ip.isEmpty() || ip.contains(":")) return false;
        if (ip.startsWith("127.") || ip.startsWith("169.254.") || ip.startsWith("0.")) {
            return false;
        }
        String[] parts = ip.split("\\.");
        if (parts.length != 4) return false;
        int[] octets = new int[4];
        try {
            for (int i = 0; i < 4; i++) {
                if (parts[i].isEmpty() || parts[i].length() > 3) return false;
                octets[i] = Integer.parseInt(parts[i]);
                if (octets[i] < 0 || octets[i] > 255) return false;
            }
        } catch (NumberFormatException e) {
            return false;
        }
        int a = octets[0];
        int b = octets[1];
        if (a == 10) return true;
        if (a == 192 && b == 168) return true;
        return a == 172 && b >= 16 && b <= 31;
    }

    /**
     * Valida que el puerto TCP pertenezca estrictamente a la allowlist de impresión térmica/red (9100, 9101, 9102, 515, 631).
     */
    public static boolean isValidPrinterPort(int port) {
        return ALLOWED_PRINTER_TCP_PORTS.contains(port);
    }

    /**
     * Verifica si un UUID de servicio GATT corresponde a servicios estándar del sistema que jamás deben escribirse en impresión BLE.
     */
    public static boolean isExcludedStandardGattServiceUuid(String rawUuid) {
        if (rawUuid == null) return false;
        return EXCLUDED_STANDARD_GATT_SERVICE_UUIDS.contains(rawUuid.trim().toLowerCase(Locale.ROOT));
    }

    /**
     * Valida magic bytes PNG (89 50 4E 47 0D 0A 1A 0A) y límite máximo de tamaño (10 MB).
     */
    public static boolean isValidPngPayload(byte[] data) {
        if (data == null || data.length < 8 || data.length > MAX_SHARED_PNG_BYTES) {
            return false;
        }
        return (data[0] & 0xFF) == 0x89
            && (data[1] & 0xFF) == 0x50
            && (data[2] & 0xFF) == 0x4E
            && (data[3] & 0xFF) == 0x47
            && (data[4] & 0xFF) == 0x0D
            && (data[5] & 0xFF) == 0x0A
            && (data[6] & 0xFF) == 0x1A
            && (data[7] & 0xFF) == 0x0A;
    }

    /**
     * Calcula el tamaño seguro de payload BLE ATT a partir del MTU negociado (MTU - 3 bytes de cabecera ATT).
     */
    public static int computeBleChunkSize(int negotiatedMtu) {
        if (negotiatedMtu <= DEFAULT_BLE_MTU) {
            return MIN_BLE_CHUNK_BYTES;
        }
        int usable = negotiatedMtu - 3;
        return Math.max(MIN_BLE_CHUNK_BYTES, Math.min(MAX_BLE_CHUNK_BYTES, usable));
    }

    /**
     * Verifica si un UUID de servicio GATT corresponde a perfiles conocidos de impresoras térmicas BLE.
     */
    public static boolean isKnownThermalPrinterServiceUuid(String rawUuid) {
        if (rawUuid == null) return false;
        String normalized = rawUuid.trim().toLowerCase(Locale.ROOT);
        return KNOWN_THERMAL_BLE_SERVICE_UUIDS.contains(normalized);
    }

    /**
     * Puntúa un dispositivo Bluetooth descubierto para ordenar primero impresoras térmicas y emparejadas.
     */
    public static int scoreBluetoothPrinterCandidate(String rawName, boolean bonded, int rssi) {
        int score = bonded ? 500 : 0;
        String name = rawName != null ? rawName.trim().toLowerCase(Locale.ROOT) : "";
        if (!name.isEmpty()) {
            score += 40;
            for (String kw : PRINTER_NAME_KEYWORDS) {
                if (name.contains(kw)) {
                    score += 300;
                    break;
                }
            }
        }
        if (rssi < 0 && rssi >= -120) {
            score += Math.max(0, 120 + rssi);
        }
        return score;
    }

    /**
     * Sanitiza un alias para AndroidKeyStore evitando caracteres inválidos o vacíos.
     */
    public static String sanitizeBiometricAlias(String rawAlias, String defaultAlias) {
        String fallback = (defaultAlias == null || defaultAlias.trim().isEmpty())
            ? "isaac_pos_bio_ecdsa_v2"
            : defaultAlias.trim();
        if (rawAlias == null) return fallback;
        String clean = rawAlias.trim().replaceAll("[^a-zA-Z0-9_.-]", "");
        return clean.isEmpty() ? fallback : clean;
    }

    /**
     * Extrae la carga Base64 pura removiendo encabezados data:image/...;base64, si están presentes.
     */
    public static String stripDataUrlPrefix(String rawBase64) {
        if (rawBase64 == null) return "";
        int commaIdx = rawBase64.indexOf(',');
        return commaIdx >= 0 ? rawBase64.substring(commaIdx + 1) : rawBase64;
    }

    /**
     * Valida que una URL de descarga externa o navegación sea segura:
     * - Rechaza esquemas peligrosos (file://, content://, javascript:, intent:).
     * - Permite https:// hacia cualquier host válido.
     * - Permite http:// únicamente hacia hosts privados RFC1918 / localhost / .local.
     */
    public static boolean isAllowedDownloadOrExternalUrl(String rawUrl) {
        if (rawUrl == null || rawUrl.trim().isEmpty()) return false;
        try {
            URI uri = URI.create(rawUrl.trim());
            String scheme = uri.getScheme();
            String host = uri.getHost();
            if (scheme == null || host == null || host.trim().isEmpty()) {
                return false;
            }
            String lowerScheme = scheme.toLowerCase(Locale.ROOT);
            if ("https".equals(lowerScheme)) {
                return true;
            }
            if ("http".equals(lowerScheme)) {
                return isPrivateLanOrLocalHost(host);
            }
            return false;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Calcula la altura útil del teclado virtual (IME) en píxeles CSS (dp) a partir de la geometría
     * de la ventana Android y/o los insets IME (compatible con API 24-36 y capas OEM como EMUI/MIUI).
     * Retorna 0 cuando el teclado está oculto o la diferencia corresponde solo a la barra de navegación.
     */
    public static int computeKeyboardHeightCssPx(
            int decorHeightPx,
            int visibleBottomPx,
            int navBarBottomPx,
            int imeInsetBottomPx,
            boolean hasExplicitImeInset,
            boolean imeInsetVisible,
            float density
    ) {
        float safeDensity = density > 0f ? density : 1f;
        int safeNavBottom = Math.max(0, navBarBottomPx);
        int rawKeyboardPx = 0;

        if (hasExplicitImeInset && imeInsetVisible && imeInsetBottomPx > 0) {
            rawKeyboardPx = Math.max(0, imeInsetBottomPx - safeNavBottom);
        }

        if (rawKeyboardPx == 0 && decorHeightPx > 0 && visibleBottomPx > 0) {
            int diffPx = decorHeightPx - visibleBottomPx - safeNavBottom;
            int minKeyboardThresholdPx = Math.round(100f * safeDensity);
            if (diffPx >= minKeyboardThresholdPx) {
                rawKeyboardPx = diffPx;
            }
        }

        if (hasExplicitImeInset && !imeInsetVisible && rawKeyboardPx > 0) {
            int strictOemThresholdPx = Math.round(120f * safeDensity);
            if (rawKeyboardPx < strictOemThresholdPx) {
                rawKeyboardPx = 0;
            }
        }

        if (rawKeyboardPx <= 0) {
            return 0;
        }
        return Math.max(0, Math.round(rawKeyboardPx / safeDensity));
    }

    /**
     * Compuerta anti-duplicado thread-safe para modo ráfaga (+1) del escáner CameraX + ML Kit:
     * - Productos distintos pasan de inmediato (0 ms).
     * - El mismo código se ignora durante cooldownMs para evitar lecturas múltiples por frame.
     */
    public static final class BurstScanGate {
        private final long cooldownMs;
        private String lastCode = "";
        private long lastAcceptedAtMs = 0L;

        public BurstScanGate(long cooldownMs) {
            this.cooldownMs = Math.max(200L, cooldownMs);
        }

        public synchronized String acceptOrNull(String rawCode, long nowMs) {
            if (rawCode == null) return null;
            String clean = rawCode.replaceAll("[\\r\\n\\t]+", "").trim();
            if (clean.isEmpty()) return null;
            if (clean.equals(lastCode) && (nowMs - lastAcceptedAtMs) < cooldownMs) {
                return null;
            }
            lastCode = clean;
            lastAcceptedAtMs = nowMs;
            return clean;
        }

        public synchronized void reset() {
            lastCode = "";
            lastAcceptedAtMs = 0L;
        }
    }
}
