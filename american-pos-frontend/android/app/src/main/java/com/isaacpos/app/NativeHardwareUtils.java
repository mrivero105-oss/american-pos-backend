package com.isaacpos.app;

import java.net.URI;
import java.util.Locale;

/**
 * Utilidades puras de validación y seguridad para la capa nativa Android de Isaac POS.
 * Sin dependencias de android.* para permitir pruebas unitarias JUnit 4 directas en JVM.
 */
public final class NativeHardwareUtils {

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
}
