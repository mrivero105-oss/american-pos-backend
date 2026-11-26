package com.isaacpos.app;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Enumeration;
import java.util.concurrent.ExecutorService;

/**
 * Manager de red LAN: descubre la IP RFC1918 activa vía ConnectivityManager + LinkProperties
 * con fallback a NetworkInterface para auto-descubrimiento de servidor POS en red local.
 */
final class NativeNetworkManager {

    private final Context appContext;
    private final ExecutorService ioExecutor;

    NativeNetworkManager(Context context, ExecutorService ioExecutor) {
        this.appContext = context.getApplicationContext();
        this.ioExecutor = ioExecutor;
    }

    void getNetworkInfo(PluginCall call) {
        ioExecutor.execute(() -> {
            String ipAddress = "";
            String gateway = "";
            String subnet = "";
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
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }

                // 2. Fallback a NetworkInterface (filtrando únicamente LAN RFC1918)
                if (ipAddress.isEmpty()) {
                    Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
                    while (interfaces != null && interfaces.hasMoreElements()) {
                        NetworkInterface iface = interfaces.nextElement();
                        if (iface.isLoopback() || !iface.isUp()) continue;
                        Enumeration<InetAddress> addresses = iface.getInetAddresses();
                        while (addresses.hasMoreElements()) {
                            InetAddress addr = addresses.nextElement();
                            if (!addr.isLoopbackAddress() && addr instanceof Inet4Address) {
                                String candidate = addr.getHostAddress();
                                if (candidate != null
                                        && NativeHardwareUtils.isPrivateLanOrLocalHost(candidate)
                                        && !candidate.startsWith("127.")) {
                                    ipAddress = candidate;
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
            call.resolve(res);
        });
    }
}
