package com.isaacpos.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.speech.RecognizerIntent;
import android.util.Base64;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.view.WindowManager;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;

/**
 * Manager de utilidades de sistema Android:
 * - Compartir comprobantes PNG vía FileProvider hacia WhatsApp / Share Sheet.
 * - Dictado por voz nativo (RecognizerIntent).
 * - Portapapeles nativo, háptico, FLAG_SECURE y ajustes de aplicación.
 */
final class NativeShareAndVoiceManager {

    private final Context appContext;
    private final ExecutorService ioExecutor;

    NativeShareAndVoiceManager(Context context, ExecutorService ioExecutor) {
        this.appContext = context.getApplicationContext();
        this.ioExecutor = ioExecutor;
    }

    static boolean isActivityAlive(Activity act) {
        return act != null && !act.isFinishing() && !act.isDestroyed();
    }

    void openAppSettings(PluginCall call) {
        try {
            Intent intent = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            Uri uri = Uri.fromParts("package", appContext.getPackageName(), null);
            intent.setData(uri);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            appContext.startActivity(intent);
            JSObject res = new JSObject();
            res.put("success", true);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("No se pudo abrir la configuración de la aplicación: " + e.getMessage());
        }
    }

    void shareImageToWhatsApp(Activity act, PluginCall call) {
        final String rawBase64 = call.getString("imageBase64");
        final String text = call.getString("text", "");
        final String phone = call.getString("phone", "");
        final String title = call.getString("title", "Factura Digital");
        final String preferredApp = call.getString("preferredApp", "auto");

        if (rawBase64 == null || rawBase64.isEmpty()) {
            call.reject("No se proporcionó la imagen en base64");
            return;
        }

        final String base64Image = NativeHardwareUtils.stripDataUrlPrefix(rawBase64);

        ioExecutor.execute(() -> {
            try {
                byte[] imageBytes = Base64.decode(base64Image, Base64.DEFAULT);
                if (!NativeHardwareUtils.isValidPngPayload(imageBytes)) {
                    call.reject("La imagen del comprobante no es un PNG válido o supera el límite de 10 MB.");
                    return;
                }

                File cacheDir = new File(appContext.getCacheDir(), "shared_receipts");
                if (!cacheDir.exists()) {
                    cacheDir.mkdirs();
                } else {
                    try {
                        File[] oldFiles = cacheDir.listFiles();
                        if (oldFiles != null) {
                            long oneHourAgo = System.currentTimeMillis() - (60L * 60L * 1000L);
                            for (File f : oldFiles) {
                                if (f.lastModified() < oneHourAgo) {
                                    f.delete();
                                }
                            }
                        }
                    } catch (Exception ignored) {}
                }

                File imageFile = new File(cacheDir, "factura_" + System.currentTimeMillis() + ".png");
                try (FileOutputStream fos = new FileOutputStream(imageFile)) {
                    fos.write(imageBytes);
                    fos.flush();
                }

                String authority = appContext.getPackageName() + ".fileprovider";
                Uri contentUri = FileProvider.getUriForFile(appContext, authority, imageFile);

                Intent intent = new Intent(Intent.ACTION_SEND);
                intent.setType("image/png");
                intent.putExtra(Intent.EXTRA_STREAM, contentUri);
                intent.setClipData(ClipData.newRawUri("", contentUri));
                if (text != null && !text.isEmpty()) {
                    intent.putExtra(Intent.EXTRA_TEXT, text);
                }
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                PackageManager pm = appContext.getPackageManager();
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

                String pref = preferredApp != null ? preferredApp.trim().toLowerCase(java.util.Locale.ROOT) : "auto";
                String targetPackage = null;
                boolean forceChooser = "chooser".equals(pref);
                if (!forceChooser) {
                    if (("whatsapp_business".equals(pref) || "w4b".equals(pref) || "com.whatsapp.w4b".equals(pref)) && hasWhatsAppBusiness) {
                        targetPackage = "com.whatsapp.w4b";
                    } else if (("whatsapp".equals(pref) || "com.whatsapp".equals(pref)) && hasWhatsApp) {
                        targetPackage = "com.whatsapp";
                    } else if (hasWhatsAppBusiness && !hasWhatsApp) {
                        targetPackage = "com.whatsapp.w4b";
                    } else if (hasWhatsApp && !hasWhatsAppBusiness) {
                        targetPackage = "com.whatsapp";
                    } else if (hasWhatsApp && hasWhatsAppBusiness) {
                        // Si el comercio tiene WhatsApp y WhatsApp Business instalados y no fijó preferencia, mostrar selector
                        forceChooser = true;
                    }
                }

                if (targetPackage != null) {
                    intent.setPackage(targetPackage);
                    if (phone != null && !phone.trim().isEmpty()) {
                        String cleanPhone = phone.replaceAll("[^0-9]", "");
                        intent.putExtra("jid", cleanPhone + "@s.whatsapp.net");
                    }
                }

                if (!isActivityAlive(act)) {
                    call.reject("Actividad cerrada antes de compartir la imagen");
                    return;
                }
                final boolean openWithChooser = forceChooser || targetPackage == null;
                act.runOnUiThread(() -> {
                    if (!isActivityAlive(act)) {
                        call.reject("Actividad no disponible al compartir imagen");
                        return;
                    }
                    try {
                        if (openWithChooser) {
                            Intent chooser = Intent.createChooser(intent, title);
                            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                            act.startActivity(chooser);
                        } else {
                            act.startActivity(intent);
                        }
                        JSObject res = new JSObject();
                        res.put("success", true);
                        call.resolve(res);
                    } catch (Exception launchErr) {
                        try {
                            intent.setPackage(null);
                            Intent chooser = Intent.createChooser(intent, title);
                            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                            act.startActivity(chooser);
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
        });
    }

    void writeClipboard(Activity act, PluginCall call, String textValue) {
        final String safeText = textValue != null ? textValue : "";
        if (!isActivityAlive(act)) {
            call.reject("Actividad no disponible para portapapeles");
            return;
        }
        act.runOnUiThread(() -> {
            if (!isActivityAlive(act)) {
                call.reject("Actividad cerrada antes de escribir portapapeles");
                return;
            }
            try {
                ClipboardManager clipboard = (ClipboardManager) appContext.getSystemService(Context.CLIPBOARD_SERVICE);
                if (clipboard != null) {
                    ClipData clip = ClipData.newPlainText("Isaac POS", safeText);
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

    void readClipboard(Activity act, PluginCall call) {
        if (!isActivityAlive(act)) {
            call.reject("Actividad no disponible para leer portapapeles");
            return;
        }
        act.runOnUiThread(() -> {
            if (!isActivityAlive(act)) {
                call.reject("Actividad cerrada antes de leer portapapeles");
                return;
            }
            try {
                ClipboardManager clipboard = (ClipboardManager) appContext.getSystemService(Context.CLIPBOARD_SERVICE);
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

    void triggerHaptic(Activity act, PluginCall call) {
        String type = call.getString("type", "medium");
        if (!isActivityAlive(act)) {
            call.resolve();
            return;
        }
        act.runOnUiThread(() -> {
            if (!isActivityAlive(act)) {
                call.resolve();
                return;
            }
            try {
                View rootView = act.getWindow().getDecorView();
                if (rootView != null) {
                    if ("heavy".equalsIgnoreCase(type)) {
                        rootView.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS);
                    } else if ("light".equalsIgnoreCase(type)) {
                        rootView.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK);
                    } else {
                        rootView.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP);
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

    void setScreenSecure(Activity act, PluginCall call) {
        boolean secure = Boolean.TRUE.equals(call.getBoolean("secure", true));
        if (!isActivityAlive(act)) {
            call.reject("Actividad no disponible para FLAG_SECURE");
            return;
        }
        act.runOnUiThread(() -> {
            if (!isActivityAlive(act)) {
                call.reject("Actividad cerrada antes de aplicar FLAG_SECURE");
                return;
            }
            try {
                if (secure) {
                    act.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
                } else {
                    act.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
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

    Intent buildVoiceRecognitionIntent(PluginCall call) {
        String prompt = call.getString("prompt", "Habla ahora para buscar...");
        String language = call.getString("language", "es-VE");
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, language);
        intent.putExtra(RecognizerIntent.EXTRA_PROMPT, prompt);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
        return intent;
    }

    void resolveVoiceRecognitionResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject ret = new JSObject();
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            ArrayList<String> matches = result.getData().getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
            if (matches != null && !matches.isEmpty()) {
                String bestMatch = matches.get(0) != null ? matches.get(0).trim() : "";
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
}
