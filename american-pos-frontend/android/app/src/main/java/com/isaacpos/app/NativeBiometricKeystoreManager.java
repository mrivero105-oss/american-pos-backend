package com.isaacpos.app;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import javax.crypto.AEADBadTagException;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Manager de seguridad criptográfica Android:
 * - Biometría fuerte Hardware-Backed ECDSA P-256 v2 (TEE/StrongBox) con BiometricPrompt.
 * - Bóveda AES-256-GCM en AndroidKeyStore para tokens/secretos.
 * - Detección básica de integridad del dispositivo (root/test-keys).
 */
final class NativeBiometricKeystoreManager {

    private static final String KEYSTORE_PROVIDER = "AndroidKeyStore";
    private static final String DEFAULT_BIOMETRIC_KEY_ALIAS = "isaac_pos_bio_ecdsa_v2";
    private static final String KEYSTORE_ALIAS = "isaac_pos_secure_vault_v1";
    private static final String SECURE_PREFS_NAME = "isaac_pos_secure_vault_prefs";
    private static final String AES_GCM_TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int GCM_TAG_BITS = 128;

    private final Context appContext;
    private final ExecutorService ioExecutor;

    NativeBiometricKeystoreManager(Context context, ExecutorService ioExecutor) {
        this.appContext = context.getApplicationContext();
        this.ioExecutor = ioExecutor;
    }

    private void deleteKeystoreEntryQuietly(String alias) {
        try {
            KeyStore ks = KeyStore.getInstance(KEYSTORE_PROVIDER);
            ks.load(null);
            if (ks.containsAlias(alias)) {
                ks.deleteEntry(alias);
            }
        } catch (Exception ignored) {}
    }

    void isBiometricAvailable(PluginCall call) {
        try {
            BiometricManager biometricManager = BiometricManager.from(appContext);
            int canAuth = biometricManager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
            boolean available = (canAuth == BiometricManager.BIOMETRIC_SUCCESS);
            JSObject res = new JSObject();
            res.put("available", available);
            res.put("statusCode", canAuth);
            res.put("strength", "BIOMETRIC_STRONG");
            call.resolve(res);
        } catch (Exception e) {
            JSObject res = new JSObject();
            res.put("available", false);
            res.put("error", e.getMessage());
            call.resolve(res);
        }
    }

    void authenticateBiometric(Activity rawActivity, PluginCall call) {
        if (rawActivity == null || rawActivity.isFinishing() || rawActivity.isDestroyed()
                || !(rawActivity instanceof FragmentActivity)) {
            call.reject("Actividad no disponible para autenticación biométrica");
            return;
        }
        FragmentActivity activity = (FragmentActivity) rawActivity;
        activity.runOnUiThread(() -> {
            if (activity.isFinishing() || activity.isDestroyed()) {
                call.reject("Actividad cerrada antes de iniciar biometría");
                return;
            }
            try {
                String title = call.getString("title", "Autorización Biométrica");
                String subtitle = call.getString("subtitle", "Usa tu huella dactilar fuerte para continuar");
                String cancelText = call.getString("cancelText", "Cancelar");

                Executor executor = ContextCompat.getMainExecutor(appContext);
                BiometricPrompt biometricPrompt = new BiometricPrompt(activity, executor,
                        new BiometricPrompt.AuthenticationCallback() {
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
                                res.put("method", "BIOMETRIC_STRONG_HARDWARE");
                                call.resolve(res);
                            }
                        });

                BiometricPrompt.PromptInfo promptInfo = new BiometricPrompt.PromptInfo.Builder()
                        .setTitle(title)
                        .setSubtitle(subtitle)
                        .setNegativeButtonText(cancelText)
                        .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                        .build();

                biometricPrompt.authenticate(promptInfo);
            } catch (Exception e) {
                call.reject("Error iniciando autenticación biométrica nativa: " + e.getMessage());
            }
        });
    }

    void registerBiometricKey(Activity rawActivity, PluginCall call) {
        final String alias = NativeHardwareUtils.sanitizeBiometricAlias(
                call.getString("alias", DEFAULT_BIOMETRIC_KEY_ALIAS),
                DEFAULT_BIOMETRIC_KEY_ALIAS
        );
        final String title = call.getString("title", "Vincular Huella Dactilar");
        final String subtitle = call.getString("subtitle", "Coloca tu huella para proteger la llave criptográfica");
        final String cancelText = call.getString("cancelText", "Cancelar");

        if (rawActivity == null || rawActivity.isFinishing() || rawActivity.isDestroyed()
                || !(rawActivity instanceof FragmentActivity)) {
            call.reject("Actividad no disponible para enrolamiento biométrico");
            return;
        }

        BiometricManager biometricManager = BiometricManager.from(appContext);
        if (biometricManager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                != BiometricManager.BIOMETRIC_SUCCESS) {
            call.reject("Este dispositivo no cuenta con biometría fuerte (Clase 3) configurada.", "BIOMETRIC_UNAVAILABLE");
            return;
        }

        final FragmentActivity activity = (FragmentActivity) rawActivity;
        try {
            deleteKeystoreEntryQuietly(alias);

            KeyPairGenerator kpg = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, KEYSTORE_PROVIDER);
            KeyGenParameterSpec.Builder specBuilder = new KeyGenParameterSpec.Builder(
                alias,
                KeyProperties.PURPOSE_SIGN
            )
                .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256)
                .setUserAuthenticationRequired(true);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                specBuilder.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                specBuilder.setInvalidatedByBiometricEnrollment(true);
            }

            kpg.initialize(specBuilder.build());
            KeyPair keyPair = kpg.generateKeyPair();
            final String publicKeySpki = Base64.encodeToString(keyPair.getPublic().getEncoded(), Base64.NO_WRAP);

            Signature verifySignature = Signature.getInstance("SHA256withECDSA");
            verifySignature.initSign(keyPair.getPrivate());
            BiometricPrompt.CryptoObject cryptoObject = new BiometricPrompt.CryptoObject(verifySignature);

            activity.runOnUiThread(() -> {
                if (activity.isFinishing() || activity.isDestroyed()) {
                    deleteKeystoreEntryQuietly(alias);
                    call.reject("Actividad cerrada durante registro biométrico");
                    return;
                }
                try {
                    Executor executor = ContextCompat.getMainExecutor(appContext);
                    BiometricPrompt prompt = new BiometricPrompt(activity, executor,
                            new BiometricPrompt.AuthenticationCallback() {
                                @Override
                                public void onAuthenticationError(int errorCode, CharSequence errString) {
                                    super.onAuthenticationError(errorCode, errString);
                                    deleteKeystoreEntryQuietly(alias);
                                    call.reject(errString.toString(), String.valueOf(errorCode));
                                }

                                @Override
                                public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                                    super.onAuthenticationSucceeded(result);
                                    try {
                                        BiometricPrompt.CryptoObject unlocked = result.getCryptoObject();
                                        if (unlocked == null || unlocked.getSignature() == null) {
                                            deleteKeystoreEntryQuietly(alias);
                                            call.reject("No se recibió CryptoObject válido al registrar biometría");
                                            return;
                                        }
                                        unlocked.getSignature().update(
                                                "isaac-pos-biometric-enroll-check".getBytes(StandardCharsets.UTF_8));
                                        unlocked.getSignature().sign();

                                        JSObject res = new JSObject();
                                        res.put("success", true);
                                        res.put("alias", alias);
                                        res.put("publicKeySpki", publicKeySpki);
                                        res.put("algorithm", "ECDSA_P256_SHA256");
                                        call.resolve(res);
                                    } catch (Exception signErr) {
                                        deleteKeystoreEntryQuietly(alias);
                                        call.reject("Fallo verificando firma en hardware seguro: " + signErr.getMessage());
                                    }
                                }
                            });

                    BiometricPrompt.PromptInfo promptInfo = new BiometricPrompt.PromptInfo.Builder()
                        .setTitle(title)
                        .setSubtitle(subtitle)
                        .setNegativeButtonText(cancelText)
                        .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                        .build();

                    prompt.authenticate(promptInfo, cryptoObject);
                } catch (Exception promptErr) {
                    deleteKeystoreEntryQuietly(alias);
                    call.reject("Error mostrando prompt biométrico de registro: " + promptErr.getMessage());
                }
            });
        } catch (Exception e) {
            deleteKeystoreEntryQuietly(alias);
            call.reject("Error generando clave ECDSA biométrica en AndroidKeyStore: " + e.getMessage());
        }
    }

    void signBiometricChallenge(Activity rawActivity, PluginCall call) {
        final String alias = NativeHardwareUtils.sanitizeBiometricAlias(
                call.getString("alias", DEFAULT_BIOMETRIC_KEY_ALIAS),
                DEFAULT_BIOMETRIC_KEY_ALIAS
        );
        final String challenge = call.getString("challenge");
        final String title = call.getString("title", "Iniciar Sesión");
        final String subtitle = call.getString("subtitle", "Coloca tu huella para firmar el acceso");
        final String cancelText = call.getString("cancelText", "Cancelar");

        if (challenge == null || challenge.trim().isEmpty()) {
            call.reject("El reto criptográfico (challenge) es obligatorio");
            return;
        }

        if (rawActivity == null || rawActivity.isFinishing() || rawActivity.isDestroyed()
                || !(rawActivity instanceof FragmentActivity)) {
            call.reject("Actividad no disponible para firma biométrica");
            return;
        }

        final FragmentActivity activity = (FragmentActivity) rawActivity;
        try {
            KeyStore ks = KeyStore.getInstance(KEYSTORE_PROVIDER);
            ks.load(null);
            if (!ks.containsAlias(alias)) {
                call.reject("BIOMETRIC_KEY_INVALIDATED: No existe clave biométrica registrada en este equipo.",
                        "BIOMETRIC_KEY_INVALIDATED");
                return;
            }
            PrivateKey privateKey = (PrivateKey) ks.getKey(alias, null);
            if (privateKey == null) {
                deleteKeystoreEntryQuietly(alias);
                call.reject("BIOMETRIC_KEY_INVALIDATED: Clave privada biométrica no encontrada.",
                        "BIOMETRIC_KEY_INVALIDATED");
                return;
            }

            Signature signature = Signature.getInstance("SHA256withECDSA");
            try {
                signature.initSign(privateKey);
            } catch (KeyPermanentlyInvalidatedException invErr) {
                deleteKeystoreEntryQuietly(alias);
                call.reject("BIOMETRIC_KEY_INVALIDATED: Las huellas del dispositivo cambiaron.",
                        "BIOMETRIC_KEY_INVALIDATED");
                return;
            }

            BiometricPrompt.CryptoObject cryptoObject = new BiometricPrompt.CryptoObject(signature);
            activity.runOnUiThread(() -> {
                if (activity.isFinishing() || activity.isDestroyed()) {
                    call.reject("Actividad cerrada antes de firmar reto biométrico");
                    return;
                }
                try {
                    Executor executor = ContextCompat.getMainExecutor(appContext);
                    BiometricPrompt prompt = new BiometricPrompt(activity, executor,
                            new BiometricPrompt.AuthenticationCallback() {
                                @Override
                                public void onAuthenticationError(int errorCode, CharSequence errString) {
                                    super.onAuthenticationError(errorCode, errString);
                                    call.reject(errString.toString(), String.valueOf(errorCode));
                                }

                                @Override
                                public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                                    super.onAuthenticationSucceeded(result);
                                    try {
                                        BiometricPrompt.CryptoObject unlocked = result.getCryptoObject();
                                        if (unlocked == null || unlocked.getSignature() == null) {
                                            call.reject("CryptoObject ausente tras verificación biométrica");
                                            return;
                                        }
                                        Signature unlockedSig = unlocked.getSignature();
                                        unlockedSig.update(challenge.getBytes(StandardCharsets.UTF_8));
                                        byte[] derSignature = unlockedSig.sign();

                                        JSObject res = new JSObject();
                                        res.put("success", true);
                                        res.put("alias", alias);
                                        res.put("signature", Base64.encodeToString(derSignature, Base64.NO_WRAP));
                                        call.resolve(res);
                                    } catch (Exception signErr) {
                                        call.reject("Error firmando reto biométrico: " + signErr.getMessage());
                                    }
                                }
                            });

                    BiometricPrompt.PromptInfo promptInfo = new BiometricPrompt.PromptInfo.Builder()
                        .setTitle(title)
                        .setSubtitle(subtitle)
                        .setNegativeButtonText(cancelText)
                        .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                        .build();

                    prompt.authenticate(promptInfo, cryptoObject);
                } catch (Exception promptErr) {
                    call.reject("Error iniciando prompt de firma biométrica: " + promptErr.getMessage());
                }
            });
        } catch (Exception e) {
            call.reject("Error accediendo a clave biométrica en AndroidKeyStore: " + e.getMessage());
        }
    }

    void deleteBiometricKey(PluginCall call) {
        final String alias = NativeHardwareUtils.sanitizeBiometricAlias(
                call.getString("alias", DEFAULT_BIOMETRIC_KEY_ALIAS),
                DEFAULT_BIOMETRIC_KEY_ALIAS
        );
        deleteKeystoreEntryQuietly(alias);
        JSObject res = new JSObject();
        res.put("success", true);
        call.resolve(res);
    }

    void checkDeviceSecurity(PluginCall call) {
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
                if (new File(path).exists()) {
                    isRooted = true;
                    break;
                }
            }
            if (!isRooted) {
                String buildTags = Build.TAGS;
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

    void saveSecureSecret(PluginCall call) {
        final String key = call.getString("key");
        final String value = call.getString("value");
        if (key == null || key.trim().isEmpty() || value == null) {
            call.reject("Parámetros key y value son obligatorios en saveSecureSecret");
            return;
        }
        ioExecutor.execute(() -> {
            try {
                SecretKey secretKey = getOrCreateVaultSecretKey();
                Cipher cipher = Cipher.getInstance(AES_GCM_TRANSFORMATION);
                cipher.init(Cipher.ENCRYPT_MODE, secretKey);
                byte[] iv = cipher.getIV();
                byte[] cipherBytes = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
                String payload = Base64.encodeToString(iv, Base64.NO_WRAP)
                    + ":"
                    + Base64.encodeToString(cipherBytes, Base64.NO_WRAP);

                SharedPreferences prefs = appContext.getSharedPreferences(SECURE_PREFS_NAME, Context.MODE_PRIVATE);
                prefs.edit().putString(key.trim(), payload).apply();

                JSObject res = new JSObject();
                res.put("success", true);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Error guardando secreto cifrado en Android Keystore: " + e.getMessage());
            }
        });
    }

    void getSecureSecret(PluginCall call) {
        final String key = call.getString("key");
        if (key == null || key.trim().isEmpty()) {
            call.reject("Parámetro key requerido en getSecureSecret");
            return;
        }
        ioExecutor.execute(() -> {
            SharedPreferences prefs = appContext.getSharedPreferences(SECURE_PREFS_NAME, Context.MODE_PRIVATE);
            try {
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
            } catch (KeyPermanentlyInvalidatedException | AEADBadTagException invErr) {
                prefs.edit().remove(key.trim()).apply();
                JSObject res = new JSObject();
                res.put("value", JSObject.NULL);
                res.put("invalidated", true);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Error descifrando secreto desde Android Keystore: " + e.getMessage());
            }
        });
    }

    void removeSecureSecret(PluginCall call) {
        final String key = call.getString("key");
        if (key == null || key.trim().isEmpty()) {
            call.reject("Parámetro key requerido en removeSecureSecret");
            return;
        }
        ioExecutor.execute(() -> {
            try {
                SharedPreferences prefs = appContext.getSharedPreferences(SECURE_PREFS_NAME, Context.MODE_PRIVATE);
                prefs.edit().remove(key.trim()).apply();
                JSObject res = new JSObject();
                res.put("success", true);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Error eliminando secreto en Android Keystore: " + e.getMessage());
            }
        });
    }
}
