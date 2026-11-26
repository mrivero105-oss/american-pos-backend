package com.isaacpos.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class NativeHardwareUtilsTest {

    @Test
    public void isJsBackHandled_distinguishesHandledFromUnhandled() {
        assertTrue(NativeHardwareUtils.isJsBackHandled("\"handled\""));
        assertTrue(NativeHardwareUtils.isJsBackHandled("  \"handled\"  "));
        assertTrue(NativeHardwareUtils.isJsBackHandled("true"));

        // Regresión crítica previa: "\"unhandled\"" contiene la subcadena "handled"
        assertFalse(NativeHardwareUtils.isJsBackHandled("\"unhandled\""));
        assertFalse(NativeHardwareUtils.isJsBackHandled("false"));
        assertFalse(NativeHardwareUtils.isJsBackHandled("null"));
        assertFalse(NativeHardwareUtils.isJsBackHandled(""));
        assertFalse(NativeHardwareUtils.isJsBackHandled(null));
    }

    @Test
    public void isPrivateLanOrLocalHost_allowsOnlyRfc1918AndLoopback() {
        assertTrue(NativeHardwareUtils.isPrivateLanOrLocalHost("192.168.1.30"));
        assertTrue(NativeHardwareUtils.isPrivateLanOrLocalHost("10.0.0.5"));
        assertTrue(NativeHardwareUtils.isPrivateLanOrLocalHost("172.16.0.1"));
        assertTrue(NativeHardwareUtils.isPrivateLanOrLocalHost("172.31.255.254"));
        assertTrue(NativeHardwareUtils.isPrivateLanOrLocalHost("127.0.0.1"));
        assertTrue(NativeHardwareUtils.isPrivateLanOrLocalHost("localhost"));
        assertTrue(NativeHardwareUtils.isPrivateLanOrLocalHost("servidor-caja.local"));

        assertFalse(NativeHardwareUtils.isPrivateLanOrLocalHost("172.32.0.1"));
        assertFalse(NativeHardwareUtils.isPrivateLanOrLocalHost("8.8.8.8"));
        assertFalse(NativeHardwareUtils.isPrivateLanOrLocalHost("api.isaacpos.com"));
        assertFalse(NativeHardwareUtils.isPrivateLanOrLocalHost("192.168.1.999"));
        assertFalse(NativeHardwareUtils.isPrivateLanOrLocalHost(""));
        assertFalse(NativeHardwareUtils.isPrivateLanOrLocalHost(null));
    }

    @Test
    public void isAllowedLanPrinterHost_enforcesStrictAntiSsrfForTcp9100() {
        assertTrue(NativeHardwareUtils.isAllowedLanPrinterHost("192.168.1.200"));
        assertTrue(NativeHardwareUtils.isAllowedLanPrinterHost("10.10.0.45"));
        assertTrue(NativeHardwareUtils.isAllowedLanPrinterHost("172.16.2.15"));
        assertTrue(NativeHardwareUtils.isAllowedLanPrinterHost("impresora-cocina.local"));

        // Bloquear cloud metadata (169.254.169.254), loopback e Internet público
        assertFalse(NativeHardwareUtils.isAllowedLanPrinterHost("169.254.169.254"));
        assertFalse(NativeHardwareUtils.isAllowedLanPrinterHost("127.0.0.1"));
        assertFalse(NativeHardwareUtils.isAllowedLanPrinterHost("localhost"));
        assertFalse(NativeHardwareUtils.isAllowedLanPrinterHost("8.8.8.8"));
        assertFalse(NativeHardwareUtils.isAllowedLanPrinterHost("evil.example.com"));
        assertFalse(NativeHardwareUtils.isAllowedLanPrinterHost(""));
        assertFalse(NativeHardwareUtils.isAllowedLanPrinterHost(null));

        assertTrue(NativeHardwareUtils.isValidPrinterPort(9100));
        assertTrue(NativeHardwareUtils.isValidPrinterPort(1024));
        assertTrue(NativeHardwareUtils.isValidPrinterPort(65535));
        assertFalse(NativeHardwareUtils.isValidPrinterPort(80));
        assertFalse(NativeHardwareUtils.isValidPrinterPort(22));
        assertFalse(NativeHardwareUtils.isValidPrinterPort(0));
        assertFalse(NativeHardwareUtils.isValidPrinterPort(70000));
    }

    @Test
    public void bleHelpers_computeSafeMtuChunkAndDetectThermalServices() {
        assertEquals(20, NativeHardwareUtils.computeBleChunkSize(0));
        assertEquals(20, NativeHardwareUtils.computeBleChunkSize(23));
        assertEquals(182, NativeHardwareUtils.computeBleChunkSize(185));
        assertEquals(244, NativeHardwareUtils.computeBleChunkSize(247));
        assertEquals(244, NativeHardwareUtils.computeBleChunkSize(517));

        assertTrue(NativeHardwareUtils.isKnownThermalPrinterServiceUuid("000018F0-0000-1000-8000-00805F9B34FB"));
        assertTrue(NativeHardwareUtils.isKnownThermalPrinterServiceUuid("e7810a71-73ae-499d-8c15-faa9aef0c3f2"));
        assertTrue(NativeHardwareUtils.isKnownThermalPrinterServiceUuid("49535343-fe7d-4ae5-8fa9-9fafd205e455"));
        assertFalse(NativeHardwareUtils.isKnownThermalPrinterServiceUuid("00001800-0000-1000-8000-00805f9b34fb"));
        assertFalse(NativeHardwareUtils.isKnownThermalPrinterServiceUuid(null));

        int bondedPrinter = NativeHardwareUtils.scoreBluetoothPrinterCandidate("POS-58-BLE", true, -55);
        int unbondedPrinter = NativeHardwareUtils.scoreBluetoothPrinterCandidate("Xprinter XP-P300", false, -50);
        int randomHeadset = NativeHardwareUtils.scoreBluetoothPrinterCandidate("JBL Tune 510", false, -40);
        assertTrue(bondedPrinter > unbondedPrinter);
        assertTrue(unbondedPrinter > randomHeadset);
    }

    @Test
    public void burstScanGate_deduplicatesSameCodeWithinCooldownAndAllowsDistinctImmediately() {
        NativeHardwareUtils.BurstScanGate gate = new NativeHardwareUtils.BurstScanGate(1400L);

        assertNull(gate.acceptOrNull(null, 1000L));
        assertNull(gate.acceptOrNull("   \n\t ", 1000L));

        // 1ª lectura pasa inmediatamente
        assertEquals("7591234567890", gate.acceptOrNull(" 7591234567890\r\n", 1000L));
        // Mismo código 500 ms después: bloqueado por anti-rebote
        assertNull(gate.acceptOrNull("7591234567890", 1500L));
        // Producto distinto a 1600 ms: pasa inmediatamente (0 ms de espera)
        assertEquals("7590000000001", gate.acceptOrNull("7590000000001", 1600L));
        // Volver al primer producto pasa inmediatamente porque cambió
        assertEquals("7591234567890", gate.acceptOrNull("7591234567890", 1700L));
        // Mismo código después de expirar cooldown (1700 + 1450 = 3150 ms): pasa (+1 ráfaga)
        assertEquals("7591234567890", gate.acceptOrNull("7591234567890", 3150L));

        gate.reset();
        assertEquals("7591234567890", gate.acceptOrNull("7591234567890", 3200L));
    }

    @Test
    public void sanitizeBiometricAliasAndStripDataUrlPrefix_handleEdgeCases() {
        assertEquals("isaac_pos_bio_ecdsa_v2", NativeHardwareUtils.sanitizeBiometricAlias(null, "isaac_pos_bio_ecdsa_v2"));
        assertEquals("isaac_pos_bio_ecdsa_v2", NativeHardwareUtils.sanitizeBiometricAlias("   $$$ ", "isaac_pos_bio_ecdsa_v2"));
        assertEquals("user_42.key-1", NativeHardwareUtils.sanitizeBiometricAlias(" user_42.key-1!! ", "isaac_pos_bio_ecdsa_v2"));

        assertEquals("QUJDRA==", NativeHardwareUtils.stripDataUrlPrefix("data:image/jpeg;base64,QUJDRA=="));
        assertEquals("QUJDRA==", NativeHardwareUtils.stripDataUrlPrefix("QUJDRA=="));
        assertEquals("", NativeHardwareUtils.stripDataUrlPrefix(null));
    }

    @Test
    public void isAllowedDownloadOrExternalUrl_enforcesHttpsOnPublicHostsAndBlocksUnsafeSchemes() {
        assertTrue(NativeHardwareUtils.isAllowedDownloadOrExternalUrl("https://api.isaacpos.com/app.apk"));
        assertTrue(NativeHardwareUtils.isAllowedDownloadOrExternalUrl("http://192.168.1.50:3005/Isaac-POS-Mobile.apk"));
        assertTrue(NativeHardwareUtils.isAllowedDownloadOrExternalUrl("http://10.0.0.2:3005/dist.zip"));
        assertTrue(NativeHardwareUtils.isAllowedDownloadOrExternalUrl("http://localhost:3005/hello"));

        assertFalse(NativeHardwareUtils.isAllowedDownloadOrExternalUrl("http://api.isaacpos.com/app.apk"));
        assertFalse(NativeHardwareUtils.isAllowedDownloadOrExternalUrl("http://8.8.8.8/malware.apk"));
        assertFalse(NativeHardwareUtils.isAllowedDownloadOrExternalUrl("file:///etc/passwd"));
        assertFalse(NativeHardwareUtils.isAllowedDownloadOrExternalUrl("javascript:alert(1)"));
        assertFalse(NativeHardwareUtils.isAllowedDownloadOrExternalUrl("content://com.isaacpos.app.fileprovider/secret"));
        assertFalse(NativeHardwareUtils.isAllowedDownloadOrExternalUrl("intent://scan/#Intent;end"));
        assertFalse(NativeHardwareUtils.isAllowedDownloadOrExternalUrl(""));
    }

    @Test
    public void computeKeyboardHeightCssPx_handlesApi30ImeInsetsAndLegacyOemFallback() {
        // API 30+ con inset IME explícito (teclado 900px, barra nav 144px, densidad 3.0 -> 252dp)
        assertEquals(
            252,
            NativeHardwareUtils.computeKeyboardHeightCssPx(2340, 1440, 144, 900, true, true, 3.0f)
        );

        // API 30+ teclado cerrado (solo barra nav visible)
        assertEquals(
            0,
            NativeHardwareUtils.computeKeyboardHeightCssPx(2340, 2196, 144, 0, true, false, 3.0f)
        );

        // API <= 29 / EMUI sin inset IME explícito: fallback por visibleDisplayFrame (teclado 780px netos @ 3x -> 260dp)
        assertEquals(
            260,
            NativeHardwareUtils.computeKeyboardHeightCssPx(2340, 1416, 144, 0, false, false, 3.0f)
        );

        // Barra de navegación sola (144px = 48dp < 100dp) jamás debe disparar falso positivo de teclado
        assertEquals(
            0,
            NativeHardwareUtils.computeKeyboardHeightCssPx(2340, 2196, 0, 0, false, false, 3.0f)
        );
    }
}
