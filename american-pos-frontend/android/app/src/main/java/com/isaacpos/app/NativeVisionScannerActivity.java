package com.isaacpos.app;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.graphics.Color;
import android.media.AudioManager;
import android.media.Image;
import android.media.ToneGenerator;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.HapticFeedbackConstants;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.TextView;
import androidx.annotation.OptIn;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ExperimentalGetImage;
import androidx.camera.core.FocusMeteringAction;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.MeteringPoint;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.vision.barcode.BarcodeScanner;
import com.google.mlkit.vision.barcode.BarcodeScanning;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.common.InputImage;
import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Escáner nativo CameraX + Play Services ML Kit en tiempo real:
 * - Zero-copy YUV -> InputImage a 60 FPS sin cruzar base64 por el puente WebView.
 * - Linterna nativa, tap-to-focus, vibración háptica y beep instantáneo.
 * - Modo ráfaga (+1): emite cada lectura en vivo a JS sin cerrar la cámara.
 * - Fallback transparente al modal WebView si Play Services ML Kit no está disponible o el usuario elige Manual/OCR.
 */
public class NativeVisionScannerActivity extends AppCompatActivity {

    public static final String EXTRA_BURST_MODE = "burstMode";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_SUBTITLE = "subtitle";
    public static final String EXTRA_TARGET_MODE = "targetMode";

    public static final String RESULT_BARCODES = "barcodes";
    public static final String RESULT_LAST_BARCODE = "lastBarcode";
    public static final String RESULT_COUNT = "count";
    public static final String RESULT_FALLBACK_TO_WEB = "fallbackToWeb";
    public static final String RESULT_FALLBACK_REASON = "fallbackReason";
    public static final String RESULT_BURST_MODE = "burstMode";

    public interface LiveScanListener {
        void onBarcodeScanned(String barcode, int format, int count, boolean burstMode);
    }

    private static volatile WeakReference<LiveScanListener> liveScanListenerRef = new WeakReference<>(null);

    static void setLiveScanListener(LiveScanListener listener) {
        liveScanListenerRef = new WeakReference<>(listener);
    }

    private PreviewView previewView;
    private TextView titleView;
    private TextView subtitleView;
    private TextView burstBadgeView;
    private TextView lastCodeView;
    private Button torchBtn;
    private Button burstBtn;
    private Button doneBtn;

    private Camera camera;
    private BarcodeScanner barcodeScanner;
    private ExecutorService cameraExecutor;
    private ToneGenerator toneGenerator;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final NativeHardwareUtils.BurstScanGate burstGate =
            new NativeHardwareUtils.BurstScanGate(NativeHardwareUtils.DEFAULT_BURST_COOLDOWN_MS);
    private final AtomicBoolean closing = new AtomicBoolean(false);
    private final ArrayList<String> scannedCodes = new ArrayList<>();

    private boolean burstMode = false;
    private boolean torchOn = false;
    private String targetMode = "CART";
    private int consecutiveMlKitErrors = 0;

    @SuppressLint("ClickableViewAccessibility")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        } catch (Exception ignored) {}

        setContentView(R.layout.activity_native_vision_scanner);

        previewView = findViewById(R.id.scanner_preview);
        titleView = findViewById(R.id.scanner_title);
        subtitleView = findViewById(R.id.scanner_subtitle);
        burstBadgeView = findViewById(R.id.scanner_burst_badge);
        lastCodeView = findViewById(R.id.scanner_last_code);
        torchBtn = findViewById(R.id.scanner_btn_torch);
        burstBtn = findViewById(R.id.scanner_btn_burst);
        Button manualBtn = findViewById(R.id.scanner_btn_manual);
        doneBtn = findViewById(R.id.scanner_btn_done);
        Button closeBtn = findViewById(R.id.scanner_btn_close);

        Intent intent = getIntent();
        targetMode = intent.getStringExtra(EXTRA_TARGET_MODE);
        if (targetMode == null || targetMode.trim().isEmpty()) {
            targetMode = "CART";
        }
        burstMode = intent.getBooleanExtra(EXTRA_BURST_MODE, false) && !"ASSIGN".equalsIgnoreCase(targetMode);

        String title = intent.getStringExtra(EXTRA_TITLE);
        String subtitle = intent.getStringExtra(EXTRA_SUBTITLE);
        if (title != null && !title.trim().isEmpty()) {
            titleView.setText(title.trim());
        }
        if (subtitle != null && !subtitle.trim().isEmpty()) {
            subtitleView.setText(subtitle.trim());
        }

        if ("ASSIGN".equalsIgnoreCase(targetMode)) {
            burstBtn.setVisibility(View.GONE);
        }

        updateBurstUi();

        closeBtn.setOnClickListener(v -> finishWithResult(false, null));
        doneBtn.setOnClickListener(v -> finishWithResult(false, null));
        manualBtn.setOnClickListener(v -> finishWithResult(true, "USER_MANUAL_OR_OCR"));

        torchBtn.setOnClickListener(v -> toggleTorch());
        burstBtn.setOnClickListener(v -> {
            if ("ASSIGN".equalsIgnoreCase(targetMode)) return;
            burstMode = !burstMode;
            updateBurstUi();
            v.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK);
        });

        // Tap-to-focus nativo sobre el PreviewView
        previewView.setOnTouchListener((v, event) -> {
            if (event.getAction() == MotionEvent.ACTION_UP && camera != null) {
                try {
                    MeteringPoint point = previewView.getMeteringPointFactory().createPoint(event.getX(), event.getY());
                    FocusMeteringAction action = new FocusMeteringAction.Builder(point, FocusMeteringAction.FLAG_AF)
                            .setAutoCancelDuration(3, TimeUnit.SECONDS)
                            .build();
                    camera.getCameraControl().startFocusAndMetering(action);
                } catch (Exception ignored) {}
            }
            return true;
        });

        cameraExecutor = Executors.newSingleThreadExecutor();
        try {
            toneGenerator = new ToneGenerator(AudioManager.STREAM_MUSIC, 85);
        } catch (Exception ignored) {
            toneGenerator = null;
        }
        barcodeScanner = BarcodeScanning.getClient(NativeVisionManager.createBarcodeScannerOptions());

        startCamera();
    }

    private void startCamera() {
        ListenableFuture<ProcessCameraProvider> cameraProviderFuture = ProcessCameraProvider.getInstance(this);
        cameraProviderFuture.addListener(() -> {
            try {
                ProcessCameraProvider cameraProvider = cameraProviderFuture.get();
                Preview preview = new Preview.Builder().build();
                preview.setSurfaceProvider(previewView.getSurfaceProvider());

                ImageAnalysis imageAnalysis = new ImageAnalysis.Builder()
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build();

                imageAnalysis.setAnalyzer(cameraExecutor, this::analyzeImageProxy);

                CameraSelector selector = CameraSelector.DEFAULT_BACK_CAMERA;
                cameraProvider.unbindAll();
                camera = cameraProvider.bindToLifecycle(this, selector, preview, imageAnalysis);

                boolean hasFlash = camera.getCameraInfo().hasFlashUnit();
                torchBtn.setEnabled(hasFlash);
                torchBtn.setAlpha(hasFlash ? 1.0f : 0.45f);
            } catch (Exception e) {
                finishWithResult(true, "CAMERAX_INIT_ERROR: " + e.getMessage());
            }
        }, ContextCompat.getMainExecutor(this));
    }

    @OptIn(markerClass = ExperimentalGetImage.class)
    private void analyzeImageProxy(ImageProxy imageProxy) {
        if (closing.get()) {
            imageProxy.close();
            return;
        }
        Image mediaImage = imageProxy.getImage();
        if (mediaImage == null) {
            imageProxy.close();
            return;
        }

        InputImage inputImage = InputImage.fromMediaImage(mediaImage, imageProxy.getImageInfo().getRotationDegrees());
        barcodeScanner.process(inputImage)
                .addOnSuccessListener(barcodes -> {
                    consecutiveMlKitErrors = 0;
                    if (closing.get() || barcodes == null || barcodes.isEmpty()) return;
                    for (Barcode barcode : barcodes) {
                        String rawValue = barcode.getRawValue();
                        String accepted = burstGate.acceptOrNull(rawValue, System.currentTimeMillis());
                        if (accepted != null) {
                            int format = barcode.getFormat();
                            mainHandler.post(() -> onCodeAccepted(accepted, format));
                            break;
                        }
                    }
                })
                .addOnFailureListener(e -> {
                    consecutiveMlKitErrors++;
                    String msg = e.getMessage() != null ? e.getMessage() : "";
                    if (consecutiveMlKitErrors >= 3
                            || msg.toLowerCase(java.util.Locale.ROOT).contains("unavailable")
                            || msg.toLowerCase(java.util.Locale.ROOT).contains("play services")
                            || msg.toLowerCase(java.util.Locale.ROOT).contains("module")) {
                        mainHandler.post(() -> finishWithResult(true, "MLKIT_UNAVAILABLE"));
                    }
                })
                .addOnCompleteListener(task -> imageProxy.close());
    }

    private void onCodeAccepted(String code, int format) {
        if (closing.get()) return;
        scannedCodes.add(code);
        int total = scannedCodes.size();

        playBeepAndHaptic();

        lastCodeView.setText("✓ " + code + (burstMode ? "  (+" + total + ")" : ""));
        lastCodeView.setVisibility(View.VISIBLE);
        updateBurstUi();

        // Notificar inmediatamente a JS (crucial para modo Ráfaga +1 sin cerrar la cámara)
        LiveScanListener listener = liveScanListenerRef.get();
        if (listener != null) {
            try {
                listener.onBarcodeScanned(code, format, total, burstMode);
            } catch (Exception ignored) {}
        }

        if (!burstMode || "ASSIGN".equalsIgnoreCase(targetMode)) {
            closing.set(true);
            mainHandler.postDelayed(() -> finishWithResult(false, null), 180L);
        }
    }

    private void playBeepAndHaptic() {
        try {
            View decor = getWindow() != null ? getWindow().getDecorView() : null;
            if (decor != null) {
                decor.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP);
            }
        } catch (Exception ignored) {}
        try {
            if (toneGenerator != null) {
                toneGenerator.startTone(ToneGenerator.TONE_PROP_BEEP, 95);
            }
        } catch (Exception ignored) {}
    }

    private void toggleTorch() {
        if (camera == null || !camera.getCameraInfo().hasFlashUnit()) return;
        torchOn = !torchOn;
        camera.getCameraControl().enableTorch(torchOn);
        torchBtn.setText(torchOn ? "Luz ON" : "Luz");
        torchBtn.setTextColor(torchOn ? Color.parseColor("#FBBF24") : Color.WHITE);
    }

    private void updateBurstUi() {
        int count = scannedCodes.size();
        if (burstMode) {
            burstBadgeView.setText("RÁFAGA (" + count + ")");
            burstBadgeView.setVisibility(View.VISIBLE);
            burstBtn.setText("Ráfaga ON");
            burstBtn.setTextColor(Color.parseColor("#34D399"));
        } else {
            burstBadgeView.setVisibility(View.GONE);
            burstBtn.setText("Ráfaga +1");
            burstBtn.setTextColor(Color.parseColor("#CBD5E1"));
        }
        doneBtn.setText(count > 0 ? "Listo (" + count + ")" : "Listo");
    }

    private void finishWithResult(boolean fallbackToWeb, String fallbackReason) {
        if (!closing.compareAndSet(false, true) && !isFinishing()) {
            // Ya en cierre pero aún no se llamó finish()
        }
        Intent data = new Intent();
        data.putStringArrayListExtra(RESULT_BARCODES, scannedCodes);
        data.putExtra(RESULT_LAST_BARCODE, scannedCodes.isEmpty() ? "" : scannedCodes.get(scannedCodes.size() - 1));
        data.putExtra(RESULT_COUNT, scannedCodes.size());
        data.putExtra(RESULT_BURST_MODE, burstMode);
        data.putExtra(RESULT_FALLBACK_TO_WEB, fallbackToWeb);
        if (fallbackReason != null) {
            data.putExtra(RESULT_FALLBACK_REASON, fallbackReason);
        }
        setResult(RESULT_OK, data);
        finish();
    }

    @Override
    protected void onDestroy() {
        closing.set(true);
        mainHandler.removeCallbacksAndMessages(null);
        try {
            if (barcodeScanner != null) {
                barcodeScanner.close();
                barcodeScanner = null;
            }
        } catch (Exception ignored) {}
        try {
            if (toneGenerator != null) {
                toneGenerator.release();
                toneGenerator = null;
            }
        } catch (Exception ignored) {}
        try {
            if (cameraExecutor != null) {
                cameraExecutor.shutdownNow();
            }
        } catch (Exception ignored) {}
        super.onDestroy();
    }
}
