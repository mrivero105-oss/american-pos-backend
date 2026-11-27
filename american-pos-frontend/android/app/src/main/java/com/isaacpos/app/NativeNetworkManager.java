package com.isaacpos.app;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import org.json.JSONObject;

/**
 * Manager de red LAN:
 * 1. Descubre la IP RFC1918 activa y su máscara real (prefixLength) vía ConnectivityManager + LinkProperties.
 * 2. Escucha/sondea beacons UDP puerto 41234 para descubrir cualquier servidor PC en toda la subred LAN.
 */
final class NativeNetworkManager {

    private static final int UDP_DISCOVERY_PORT = 41234;
    private static final int DEFAULT_UDP_TIMEOUT_MS = 2500;

    private final Context appContext;
    private final ExecutorService ioExecutor;

    NativeNetworkManager(Context context, ExecutorService ioExecutor) {
        this.appContext = context.getApplicationContext();
        this.ioExecutor = ioExecutor;
    }

    private static String computeBroadcastAddress(String ipv4, int prefixLength) {
        try {
            if (ipv4 == null || ipv4.isEmpty() || prefixLength < 8 || prefixLength > 30) {
                return "255.255.255.255";
            }
            String[] parts = ipv4.split("\\.");
            if (parts.length != 4) return "255.255.255.255";
            int ipInt = 0;
            for (int i = 0; i < 4; i++) {
                ipInt = (ipInt << 8) | (Integer.parseInt(parts[i]) & 0xFF);
            }
            int mask = prefixLength == 0 ? 0 : (0xFFFFFFFF << (32 - prefixLength));
            int broadcast = ipInt | (~mask);
            return ((broadcast >>> 24) & 0xFF) + "."
                + ((broadcast >>> 16) & 0xFF) + "."
                + ((broadcast >>> 8) & 0xFF) + "."
                + (broadcast & 0xFF);
        } catch (Exception e) {
            return "255.255.255.255";
        }
    }

    void getNetworkInfo(PluginCall call) {
        ioExecutor.execute(() -> {
            String ipAddress = "";
            String gateway = "";
            String subnet = "";
            int prefixLength = 24;
            try {
                // 1. Priorizar red Wi-Fi / Ethernet activa mediante ConnectivityManager + LinkProperties
                ConnectivityManager cm = (ConnectivityManager) appContext.getSystemService(Context.CONNECTIVITY_SERVICE);
                if (cm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    Network activeNet = cm.getActiveNetwork();
                    NetworkCapabilities caps = activeNet != null ? cm.getNetworkCapabilities(activeNet) : null;
                    if (caps != null && (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                            || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))) {
                        LinkProperties lp = cm.getLinkProperties(activeNet);
                        if (lp != null) {
                            for (LinkAddress linkAddr : lp.getLinkAddresses()) {
                                InetAddress addr = linkAddr.getAddress();
                                if (addr instanceof Inet4Address && !addr.isLoopbackAddress()) {
                                    String candidate = addr.getHostAddress();
                                    if (candidate != null
                                            && NativeHardwareUtils.isPrivateLanOrLocalHost(candidate)
                                            && !candidate.startsWith("127.")) {
                                        ipAddress = candidate;
                                        int realPrefix = linkAddr.getPrefixLength();
                                        if (realPrefix >= 8 && realPrefix <= 30) {
                                            prefixLength = realPrefix;
                                        }
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }

                // 2. Fallback a NetworkInterface (filtrando únicamente LAN RFC1918 y leyendo prefixLength real)
                if (ipAddress.isEmpty()) {
                    Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
                    while (interfaces != null && interfaces.hasMoreElements()) {
                        NetworkInterface iface = interfaces.nextElement();
                        if (iface.isLoopback() || !iface.isUp()) continue;
                        for (InterfaceAddress ifAddr : iface.getInterfaceAddresses()) {
                            InetAddress addr = ifAddr.getAddress();
                            if (addr != null && !addr.isLoopbackAddress() && addr instanceof Inet4Address) {
                                String candidate = addr.getHostAddress();
                                if (candidate != null
                                        && NativeHardwareUtils.isPrivateLanOrLocalHost(candidate)
                                        && !candidate.startsWith("127.")) {
                                    ipAddress = candidate;
                                    short realPrefix = ifAddr.getNetworkPrefixLength();
                                    if (realPrefix >= 8 && realPrefix <= 30) {
                                        prefixLength = realPrefix;
                                    }
                                    break;
                                }
                            }
                        }
                        if (!ipAddress.isEmpty()) break;
                    }
                }

                if (!ipAddress.isEmpty()) {
                    int lastDot = ipAddress.lastIndexOf('.');
                    if (lastDot > 0) {
                        subnet = ipAddress.substring(0, lastDot + 1);
                        gateway = subnet + "1";
                    }
                }
            } catch (Exception ignored) {}

            JSObject res = new JSObject();
            res.put("ip", ipAddress);
            res.put("gateway", gateway);
            res.put("subnet", subnet);
            res.put("prefixLength", prefixLength);
            res.put("broadcast", computeBroadcastAddress(ipAddress, prefixLength));
            call.resolve(res);
        });
    }

    /**
     * Escucha y sondea el puerto UDP 41234 en la LAN local (timeout acotado 2.5s) para descubrir
     * instantáneamente servidores Isaac POS PC en cualquier dirección IP de la subred sin escanear 254 IPs.
     */
    void discoverLanServersUdp(PluginCall call) {
        int rawTimeout = call.getInt("timeoutMs", DEFAULT_UDP_TIMEOUT_MS);
        final int totalTimeoutMs = Math.max(800, Math.min(5000, rawTimeout));
        final int port = call.getInt("port", UDP_DISCOVERY_PORT);

        ioExecutor.execute(() -> {
            Map<String, JSObject> discovered = new LinkedHashMap<>();
            DatagramSocket socket = null;
            try {
                socket = new DatagramSocket(null);
                socket.setReuseAddress(true);
                socket.setBroadcast(true);
                try {
                    socket.bind(new InetSocketAddress(port));
                } catch (Exception bindErr) {
                    // Si el puerto 41234 ya está ocupado, usar puerto efímero para recibir respuestas al probe
                    socket.close();
                    socket = new DatagramSocket();
                    socket.setReuseAddress(true);
                    socket.setBroadcast(true);
                }

                // Enviar sonda activa de descubrimiento a broadcast local
                try {
                    byte[] probeBytes = "{\"type\":\"ISAAC_POS_DISCOVER\"}".getBytes(StandardCharsets.UTF_8);
                    DatagramPacket probe = new DatagramPacket(
                        probeBytes,
                        probeBytes.length,
                        InetAddress.getByName("255.255.255.255"),
                        port
                    );
                    socket.send(probe);
                } catch (Exception ignored) {}

                long deadline = System.currentTimeMillis() + totalTimeoutMs;
                byte[] buffer = new byte[2048];

                while (System.currentTimeMillis() < deadline) {
                    int remaining = (int) Math.max(100L, Math.min(600L, deadline - System.currentTimeMillis()));
                    socket.setSoTimeout(remaining);
                    DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                    try {
                        socket.receive(packet);
                        String senderIp = packet.getAddress() != null ? packet.getAddress().getHostAddress() : "";
                        if (!NativeHardwareUtils.isAllowedResolvedPrinterIp(senderIp)) {
                            continue;
                        }
                        String rawPayload = new String(packet.getData(), 0, packet.getLength(), StandardCharsets.UTF_8).trim();
                        if (rawPayload.isEmpty() || !rawPayload.startsWith("{")) continue;

                        JSONObject json = new JSONObject(rawPayload);
                        String type = json.optString("type", "");
                        String app = json.optString("app", "");
                        if (!"ISAAC_POS_BEACON".equalsIgnoreCase(type)
                                && !"ISAAC_POS_SERVER".equalsIgnoreCase(type)
                                && !app.toLowerCase(java.util.Locale.ROOT).contains("isaac")) {
                            continue;
                        }

                        int serverPort = json.optInt("port", 3005);
                        if (serverPort < 1 || serverPort > 65535) serverPort = 3005;
                        String protocol = "https".equalsIgnoreCase(json.optString("protocol", "http")) ? "https" : "http";
                        String reportedIp = json.optString("ip", senderIp).trim();
                        String finalIp = NativeHardwareUtils.isAllowedResolvedPrinterIp(reportedIp) ? reportedIp : senderIp;

                        String key = finalIp + ":" + serverPort;
                        JSObject item = new JSObject();
                        item.put("ip", finalIp);
                        item.put("port", serverPort);
                        item.put("protocol", protocol);
                        item.put("url", protocol + "://" + finalIp + ":" + serverPort);
                        item.put("name", json.optString("name", json.optString("hostname", "Isaac POS PC")));
                        item.put("companyId", json.optString("companyId", ""));
                        item.put("serverFingerprint", json.optString("serverFingerprint", ""));
                        item.put("hmac", json.optString("hmac", ""));
                        discovered.put(key, item);
                    } catch (SocketTimeoutException timeoutEx) {
                        // Continuar hasta agotar deadline si aún no se encontró servidor
                        if (!discovered.isEmpty()) break;
                    } catch (Exception ignored) {}
                }
            } catch (Exception err) {
                JSObject errRes = new JSObject();
                errRes.put("servers", new JSArray());
                errRes.put("error", err.getMessage());
                call.resolve(errRes);
                return;
            } finally {
                if (socket != null) {
                    try { socket.close(); } catch (Exception ignored) {}
                }
            }

            JSArray arr = new JSArray();
            for (JSObject s : discovered.values()) {
                arr.put(s);
            }
            JSObject res = new JSObject();
            res.put("servers", arr);
            res.put("count", discovered.size());
            call.resolve(res);
        });
    }
}
