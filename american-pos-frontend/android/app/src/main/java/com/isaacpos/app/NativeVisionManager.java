package com.isaacpos.app;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.google.mlkit.vision.barcode.BarcodeScanner;
import com.google.mlkit.vision.barcode.BarcodeScannerOptions;
import com.google.mlkit.vision.barcode.BarcodeScanning;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Manager de visión por computador ML Kit (vía Google Play Services) para
 * procesamiento de fotogramas base64 (scanBarcode / recognizeText) y factory
 * compartida con NativeVisionScannerActivity.
 */
final class NativeVisionManager {

    private final ExecutorService ioExecutor;
    private TextRecognizer textRecognizer = null;
    private BarcodeScanner barcodeScanner = null;

    NativeVisionManager(ExecutorService ioExecutor) {
        this.ioExecutor = ioExecutor;
    }

    static BarcodeScannerOptions createBarcodeScannerOptions() {
        return new BarcodeScannerOptions.Builder()
            .setBarcodeFormats(
                Barcode.FORMAT_EAN_13,
                Barcode.FORMAT_EAN_8,
                Barcode.FORMAT_UPC_A,
                Barcode.FORMAT_UPC_E,
                Barcode.FORMAT_CODE_128,
                Barcode.FORMAT_CODE_39,
                Barcode.FORMAT_CODE_93,
                Barcode.FORMAT_ITF,
                Barcode.FORMAT_CODABAR,
                Barcode.FORMAT_QR_CODE,
                Barcode.FORMAT_DATA_MATRIX
            )
            .build();
    }

    private synchronized TextRecognizer getTextRecognizer() {
        if (textRecognizer == null) {
            textRecognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        }
        return textRecognizer;
    }

    private synchronized BarcodeScanner getBarcodeScanner() {
        if (barcodeScanner == null) {
            barcodeScanner = BarcodeScanning.getClient(createBarcodeScannerOptions());
        }
        return barcodeScanner;
    }

    void scanBarcode(PluginCall call) {
        final String rawBase64 = call.getString("imageBase64");
        if (rawBase64 == null || rawBase64.isEmpty()) {
            call.reject("No se proporcionó imagen");
            return;
        }
        final String base64Image = NativeHardwareUtils.stripDataUrlPrefix(rawBase64);

        ioExecutor.execute(() -> {
            Bitmap bitmap = null;
            final AtomicBoolean recycled = new AtomicBoolean(false);
            try {
                byte[] bytes = Base64.decode(base64Image, Base64.DEFAULT);
                BitmapFactory.Options opts = new BitmapFactory.Options();
                opts.inPreferredConfig = Bitmap.Config.RGB_565;
                bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
                if (bitmap == null) {
                    call.reject("No se pudo decodificar el bitmap");
                    return;
                }

                final Bitmap finalBitmap = bitmap;
                Runnable safeRecycle = () -> {
                    if (recycled.compareAndSet(false, true)) {
                        try {
                            if (!finalBitmap.isRecycled()) finalBitmap.recycle();
                        } catch (Exception ignored) {}
                    }
                };

                InputImage image = InputImage.fromBitmap(finalBitmap, 0);
                getBarcodeScanner().process(image)
                    .addOnSuccessListener(barcodes -> {
                        safeRecycle.run();
                        JSObject result = new JSObject();
                        result.put("success", true);
                        if (barcodes != null && !barcodes.isEmpty()) {
                            for (Barcode barcode : barcodes) {
                                String rawVal = barcode.getRawValue();
                                if (rawVal != null && !rawVal.trim().isEmpty()) {
                                    result.put("found", true);
                                    result.put("rawValue", rawVal.trim());
                                    result.put("format", barcode.getFormat());
                                    call.resolve(result);
                                    return;
                                }
                            }
                        }
                        result.put("found", false);
                        call.resolve(result);
                    })
                    .addOnFailureListener(e -> {
                        safeRecycle.run();
                        call.reject("Error en ML Kit Barcode: " + e.getMessage());
                    })
                    .addOnCanceledListener(() -> {
                        safeRecycle.run();
                        call.reject("Escaneo de código de barras cancelado");
                    });
            } catch (Exception e) {
                if (bitmap != null && recycled.compareAndSet(false, true)) {
                    try { if (!bitmap.isRecycled()) bitmap.recycle(); } catch (Exception ignored) {}
                }
                call.reject("Error procesando imagen para código de barras: " + e.getMessage());
            }
        });
    }

    void recognizeText(PluginCall call) {
        final String rawBase64 = call.getString("imageBase64");
        if (rawBase64 == null || rawBase64.isEmpty()) {
            call.reject("No se proporcionó imagen");
            return;
        }
        final String base64Image = NativeHardwareUtils.stripDataUrlPrefix(rawBase64);

        ioExecutor.execute(() -> {
            Bitmap bitmap = null;
            final AtomicBoolean recycled = new AtomicBoolean(false);
            try {
                byte[] bytes = Base64.decode(base64Image, Base64.DEFAULT);
                BitmapFactory.Options opts = new BitmapFactory.Options();
                opts.inPreferredConfig = Bitmap.Config.RGB_565;
                bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
                if (bitmap == null) {
                    call.reject("No se pudo decodificar el bitmap");
                    return;
                }

                final Bitmap finalBitmap = bitmap;
                Runnable safeRecycle = () -> {
                    if (recycled.compareAndSet(false, true)) {
                        try {
                            if (!finalBitmap.isRecycled()) finalBitmap.recycle();
                        } catch (Exception ignored) {}
                    }
                };

                InputImage image = InputImage.fromBitmap(finalBitmap, 0);
                getTextRecognizer().process(image)
                    .addOnSuccessListener(visionText -> {
                        safeRecycle.run();
                        String fullText = visionText.getText();
                        JSArray blocksArray = new JSArray();
                        for (Text.TextBlock block : visionText.getTextBlocks()) {
                            JSObject blockObj = new JSObject();
                            blockObj.put("text", block.getText());
                            blocksArray.put(blockObj);
                        }

                        JSObject result = new JSObject();
                        result.put("success", true);
                        result.put("text", fullText);
                        result.put("blocks", blocksArray);
                        call.resolve(result);
                    })
                    .addOnFailureListener(e -> {
                        safeRecycle.run();
                        call.reject("Error en OCR ML Kit: " + e.getMessage());
                    })
                    .addOnCanceledListener(() -> {
                        safeRecycle.run();
                        call.reject("Reconocimiento de texto OCR cancelado");
                    });
            } catch (Exception e) {
                if (bitmap != null && recycled.compareAndSet(false, true)) {
                    try { if (!bitmap.isRecycled()) bitmap.recycle(); } catch (Exception ignored) {}
                }
                call.reject("Error procesando imagen para OCR: " + e.getMessage());
            }
        });
    }

    synchronized void shutdown() {
        try {
            if (barcodeScanner != null) {
                barcodeScanner.close();
                barcodeScanner = null;
            }
        } catch (Exception ignored) {}
        try {
            if (textRecognizer != null) {
                textRecognizer.close();
                textRecognizer = null;
            }
        } catch (Exception ignored) {}
    }
}
