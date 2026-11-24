package com.isaacpos.app;

import static org.junit.Assert.assertFalse;
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
}
