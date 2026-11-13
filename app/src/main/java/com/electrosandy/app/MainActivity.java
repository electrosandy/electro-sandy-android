package com.electrosandy.app;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebChromeClient;
import android.webkit.ConsoleMessage;
import android.util.Log;
import android.webkit.WebView;
import android.webkit.JavascriptInterface;
import android.webkit.WebViewClient;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.ValueCallback;
import android.content.Intent;
import android.net.Uri;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.ImageDecoder;
import android.graphics.Matrix;
import android.os.Build;
import androidx.core.content.FileProvider;
import androidx.exifinterface.media.ExifInterface;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.IOException;
import android.print.PrintManager;
import android.print.PrintAttributes;
import android.content.Context;
import androidx.fragment.app.FragmentActivity;
import androidx.biometric.BiometricPrompt;
import androidx.biometric.BiometricManager;
import androidx.core.content.ContextCompat;
import android.speech.RecognizerIntent;
import java.util.ArrayList;
import com.google.zxing.integration.android.IntentIntegrator;
import com.google.zxing.integration.android.IntentResult;
import org.json.JSONObject;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseAuthException;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.QueryDocumentSnapshot;
import com.google.firebase.firestore.ListenerRegistration;
import java.util.HashMap;
import java.util.Map;
import java.util.Locale;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicBoolean;

public class MainActivity extends FragmentActivity {
    private static boolean rendererRecoveryAttempted = false;
    private WebView webView;
    private WebAppInterface bridge;

    private static class WebAppInterface {
        private final Activity activity;
        private ListenerRegistration cloudSnapshotListener;
        WebAppInterface(Activity activity) { this.activity = activity; }
        @JavascriptInterface public void reportPageReady(String title, String readyState, int bodyLength) {
            Log.i("ELECTRO_SMOKE", "BRIDGE_READY title=" + title + " state=" + readyState + " bodyLength=" + bodyLength);
        }
        void cleanup() {
            if (cloudSnapshotListener != null) {
                cloudSnapshotListener.remove();
                cloudSnapshotListener = null;
            }
        }
        private void watchCloudSnapshot(String uid) {
            if (cloudSnapshotListener != null) cloudSnapshotListener.remove();
            cloudSnapshotListener = FirebaseFirestore.getInstance().collection("shops").document(uid)
                .collection("snapshotMeta").document("current")
                .addSnapshotListener((snapshot, error) -> {
                    if (error != null) return;
                    String snapshotId = snapshot != null && snapshot.exists() ? snapshot.getString("snapshotId") : "";
                    sendCloudJs("window.onCloudRemoteSnapshotChanged("+JSONObject.quote(snapshotId == null ? "" : snapshotId)+")");
                });
        }
        @JavascriptInterface public void saveTextFile(String fileName, String content, String mimeType) {
            if (!(activity instanceof MainActivity)) return;
            MainActivity main = (MainActivity) activity;
            main.runOnUiThread(() -> main.beginSaveTextFile(fileName, content, mimeType));
        }

        @JavascriptInterface public void authenticateBiometric() {
            activity.runOnUiThread(() -> {
                if (!(activity instanceof MainActivity)) return;
                MainActivity main = (MainActivity) activity;
                try {
                    int biometricAvailability = BiometricManager.from(main).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK);
                    if (biometricAvailability != BiometricManager.BIOMETRIC_SUCCESS) {
                        if (main.webView != null) main.webView.evaluateJavascript(
                            "window.onBiometricError(" + JSONObject.quote("البصمة غير متاحة على هذا الجهاز؛ استعمل رمز PIN.") + ")", null);
                        return;
                    }
                    BiometricPrompt prompt = new BiometricPrompt(main, ContextCompat.getMainExecutor(main), new BiometricPrompt.AuthenticationCallback() {
                        @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                            if (main.webView != null) main.webView.evaluateJavascript("window.onBiometricAuthenticated()", null);
                        }
                        @Override public void onAuthenticationError(int code, CharSequence message) {
                            if (main.webView != null) main.webView.evaluateJavascript("window.onBiometricError(" + JSONObject.quote(String.valueOf(message)) + ")", null);
                        }
                    });
                    BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                        .setTitle("ELECTRO Sandy")
                        .setSubtitle("تأكيد الهوية بالبصمة")
                        .setNegativeButtonText("إلغاء")
                        .build();
                    prompt.authenticate(info);
                } catch (Exception error) {
                    if (main.webView != null) main.webView.evaluateJavascript("window.onBiometricError('تعذر تشغيل البصمة على هذا الجهاز')", null);
                }
            });
        }
        @JavascriptInterface public void startVoiceSearch() {
            activity.runOnUiThread(() -> {
                Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ar-MA");
                intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "قل اسم المنتج أو الباركود");
                try { activity.startActivityForResult(intent, VOICE_SEARCH); }
                catch (Exception e) { if (activity instanceof MainActivity) ((MainActivity) activity).notifyVoiceUnavailable(); }
            });
        }
        @JavascriptInterface public void scanBarcode() {
            activity.runOnUiThread(() -> {
                IntentIntegrator scanner = new IntentIntegrator(activity);
                scanner.setDesiredBarcodeFormats(IntentIntegrator.ALL_CODE_TYPES);
                scanner.setPrompt("وجّه الكاميرا نحو الباركود أو QR");
                scanner.setBeepEnabled(false);
                scanner.setOrientationLocked(false);
                scanner.initiateScan();
            });
        }
        @JavascriptInterface public void shareText(String text) {
            activity.runOnUiThread(() -> {
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("text/plain");
                send.putExtra(Intent.EXTRA_TEXT, text == null ? "" : text);
                activity.startActivity(Intent.createChooser(send, "مشاركة الفاتورة"));
            });
        }
        @JavascriptInterface public void printHtml(String html, String jobName) {
            activity.runOnUiThread(() -> {
                WebView printView = new WebView(activity);
                printView.setWebViewClient(new WebViewClient() {
                    @Override public void onPageFinished(WebView view, String url) {
                        PrintManager manager = (PrintManager) activity.getSystemService(Context.PRINT_SERVICE);
                        if (manager != null) {
                            manager.print(jobName == null ? "ELECTRO Sandy" : jobName,
                                printView.createPrintDocumentAdapter(jobName == null ? "ELECTRO Sandy" : jobName),
                                new PrintAttributes.Builder().build());
                        }
                    }
                });
                printView.loadDataWithBaseURL(null, html == null ? "" : html, "text/html", "UTF-8", null);
            });
        }
        private boolean isAllowedCloudCategory(String category) {
            return category != null && java.util.Arrays.asList(
                "products","orders","customers","purchases","cashEntries","cashClosings",
                "stockAudits","sellerProfile","activityLog","warranties","suppliers","returns"
            ).contains(category);
        }
        private boolean isValidCloudCategoryPayload(String category, String payload) {
            try {
                if ("sellerProfile".equals(category)) {
                    new org.json.JSONObject(payload);
                    return true;
                }
                if (!isAllowedCloudCategory(category)) return false;
                org.json.JSONArray array = new org.json.JSONArray(payload);
                if (array.length() > 100000) return false;
                for (int i = 0; i < array.length(); i++) {
                    if (!(array.opt(i) instanceof org.json.JSONObject)) return false;
                }
                return true;
            } catch (Exception invalidPayload) {
                return false;
            }
        }
        private boolean isSafeSnapshotId(String snapshotId) {
            return snapshotId != null && snapshotId.matches("[a-z0-9-]{1,64}");
        }
        private void sendCloudJs(String script) {
            if (activity instanceof MainActivity) {
                MainActivity main = (MainActivity) activity;
                activity.runOnUiThread(() -> {
                    if (main.webView != null) main.webView.evaluateJavascript(script, null);
                });
            }
        }
        @JavascriptInterface public void cloudSignIn(String email, String password) {
            FirebaseAuth.getInstance().signInWithEmailAndPassword(email == null ? "" : email.trim(), password == null ? "" : password)
                .addOnCompleteListener(task -> {
                    if (task.isSuccessful() && task.getResult() != null && task.getResult().getUser() != null) {
                        String uid = task.getResult().getUser().getUid();
                        sendCloudJs("window.onCloudAuthResult(true,'تم تسجيل الدخول إلى حساب المزامنة',"+JSONObject.quote(uid)+")");
                        watchCloudSnapshot(uid);
                    } else {
                        Exception error = task.getException();
                        String code = "AUTH_UNKNOWN";
                        StringBuilder details = new StringBuilder();
                        Throwable cause = error;
                        int depth = 0;
                        while (cause != null && depth++ < 8) {
                            if (cause instanceof FirebaseAuthException) {
                                code = ((FirebaseAuthException) cause).getErrorCode();
                                break;
                            }
                            if (details.length() > 0) details.append(" <- ");
                            details.append(cause.getClass().getSimpleName());
                            String causeMessage = cause.getMessage();
                            if (causeMessage != null && !causeMessage.trim().isEmpty()) {
                                String safeMessage = causeMessage.replace('\n', ' ').replace('\r', ' ');
                                details.append(": ").append(safeMessage.length() > 240 ? safeMessage.substring(0, 240) : safeMessage);
                            }
                            cause = cause.getCause();
                        }
                        String message = error == null ? "تعذر تسجيل الدخول" : error.getMessage();
                        if ("AUTH_UNKNOWN".equals(code) && details.length() > 0) {
                            code = "AUTH_UNKNOWN(" + details.toString() + ")";
                        }
                        Log.e("ELECTRO_AUTH", "Cloud sign-in failed code=" + code, error);
                        sendCloudJs("window.onCloudAuthResult(false,"+JSONObject.quote(code + ": " + message)+",'')");
                    }
                });
        }
        @JavascriptInterface public void cloudCheckAuth() {
            if (FirebaseAuth.getInstance().getCurrentUser() != null) {
                String uid = FirebaseAuth.getInstance().getCurrentUser().getUid();
                sendCloudJs("window.onCloudAuthResult(true,'جلسة المزامنة محفوظة',"+JSONObject.quote(uid)+")");
                watchCloudSnapshot(uid);
            }
        }
        @JavascriptInterface public void cloudSignOut() {
            if (cloudSnapshotListener != null) { cloudSnapshotListener.remove(); cloudSnapshotListener = null; }
            FirebaseAuth.getInstance().signOut();
            sendCloudJs("window.onCloudSignedOut && window.onCloudSignedOut()");
        }
        @JavascriptInterface public void cloudWriteChunk(String snapshotId, String category, int index, String data) {
            if (!isSafeSnapshotId(snapshotId) || !isAllowedCloudCategory(category) || index < 0 || index >= 10000 || data == null || data.length() > 100000) {
                sendCloudJs("window.onCloudChunkSaved("+JSONObject.quote(category == null ? "" : category)+","+index+",false,'بيانات جزء غير صالحة',"+JSONObject.quote(snapshotId)+")");
                return;
            }
            String uid = FirebaseAuth.getInstance().getCurrentUser() == null ? null : FirebaseAuth.getInstance().getCurrentUser().getUid();
            if (uid == null) {
                sendCloudJs("window.onCloudChunkSaved("+JSONObject.quote(category)+","+index+",false,'سجل الدخول أولاً',"+JSONObject.quote(snapshotId)+")");
                return;
            }
            Map<String,Object> chunk = new HashMap<>();
            chunk.put("index", index);
            chunk.put("data", data == null ? "" : data);
            chunk.put("updatedAt", System.currentTimeMillis());
            FirebaseFirestore.getInstance().collection("shops").document(uid)
                .collection("snapshots").document(snapshotId).collection("data")
                .document(category).collection("chunks")
                .document(String.format(Locale.US,"%06d",index)).set(chunk)
                .addOnSuccessListener(v -> sendCloudJs("window.onCloudChunkSaved("+JSONObject.quote(category)+","+index+",true,'',"+JSONObject.quote(snapshotId)+")"))
                .addOnFailureListener(e -> sendCloudJs("window.onCloudChunkSaved("+JSONObject.quote(category)+","+index+",false,"+JSONObject.quote(e.getMessage())+","+JSONObject.quote(snapshotId)+")"));
        }
        @JavascriptInterface public void cloudFinishCategory(String snapshotId, String category, int count) {
            if (!isSafeSnapshotId(snapshotId) || !isAllowedCloudCategory(category) || count < 1 || count > 10000) {
                sendCloudJs("window.onCloudCategorySaved("+JSONObject.quote(category == null ? "" : category)+",false,'بيانات القسم غير صالحة',"+JSONObject.quote(snapshotId)+")");
                return;
            }
            String uid = FirebaseAuth.getInstance().getCurrentUser() == null ? null : FirebaseAuth.getInstance().getCurrentUser().getUid();
            if (uid == null) {
                sendCloudJs("window.onCloudCategorySaved("+JSONObject.quote(category)+",false,'سجل الدخول أولاً',"+JSONObject.quote(snapshotId)+")");
                return;
            }
            Map<String,Object> meta = new HashMap<>();
            meta.put("chunkCount", count);
            meta.put("updatedAt", System.currentTimeMillis());
            FirebaseFirestore.getInstance().collection("shops").document(uid)
                .collection("snapshots").document(snapshotId).collection("meta")
                .document(category).set(meta)
                .addOnSuccessListener(v -> sendCloudJs("window.onCloudCategorySaved("+JSONObject.quote(category)+",true,'',"+JSONObject.quote(snapshotId)+")"))
                .addOnFailureListener(e -> sendCloudJs("window.onCloudCategorySaved("+JSONObject.quote(category)+",false,"+JSONObject.quote(e.getMessage())+","+JSONObject.quote(snapshotId)+")"));
        }
        @JavascriptInterface public void cloudCommitSnapshot(String snapshotId, String categoriesJson, String expectedBaseId, boolean requireBaseMatch) {
            if (!isSafeSnapshotId(snapshotId) || (requireBaseMatch && expectedBaseId != null && !expectedBaseId.isEmpty() && !isSafeSnapshotId(expectedBaseId))) {
                sendCloudJs("window.onCloudSnapshotCommitted(false,'معرّف النسخة غير صالح',"+JSONObject.quote(snapshotId)+")");
                return;
            }
            String uid = FirebaseAuth.getInstance().getCurrentUser() == null ? null : FirebaseAuth.getInstance().getCurrentUser().getUid();
            if (uid == null) {
                sendCloudJs("window.onCloudSnapshotCommitted(false,'سجل الدخول أولاً',"+JSONObject.quote(snapshotId)+")");
                return;
            }
            try {
                org.json.JSONArray parsed = new org.json.JSONArray(categoriesJson == null ? "[]" : categoriesJson);
                java.util.ArrayList<String> categories = new java.util.ArrayList<>();
                for (int i = 0; i < parsed.length(); i++) {
                    String category = parsed.getString(i);
                    if (!isAllowedCloudCategory(category) || categories.contains(category))
                        throw new IllegalArgumentException("اسم قسم غير صالح أو مكرر");
                    categories.add(category);
                }
                if (categories.size() != 12) throw new IllegalArgumentException("قائمة أقسام النسخة غير مكتملة");
                AtomicInteger verifiedCount = new AtomicInteger(0);
                AtomicBoolean failed = new AtomicBoolean(false);
                for (String category : categories) {
                    FirebaseFirestore.getInstance().collection("shops").document(uid)
                        .collection("snapshots").document(snapshotId).collection("meta").document(category).get()
                        .addOnSuccessListener(meta -> {
                            if (!meta.exists()) {
                                if (failed.compareAndSet(false, true)) sendCloudJs("window.onCloudSnapshotCommitted(false,'بيانات قسم غير مكتملة: '+"
                                    + JSONObject.quote(category) + ","+JSONObject.quote(snapshotId)+")");
                                return;
                            }
                            Long countValue = meta.getLong("chunkCount");
                            int count = countValue == null ? 0 : countValue.intValue();
                            if (count < 1 || count > 10000) {
                                if (failed.compareAndSet(false, true)) sendCloudJs("window.onCloudSnapshotCommitted(false,'عدد أجزاء غير صالح',"+JSONObject.quote(snapshotId)+")");
                                return;
                            }
                            FirebaseFirestore.getInstance().collection("shops").document(uid)
                                .collection("snapshots").document(snapshotId).collection("data").document(category).collection("chunks").get()
                                .addOnSuccessListener(chunks -> {
                                    if (chunks.size() != count) {
                                        if (failed.compareAndSet(false, true)) sendCloudJs("window.onCloudSnapshotCommitted(false,'أجزاء النسخة غير مكتملة',"+JSONObject.quote(snapshotId)+")");
                                        return;
                                    }
                                    java.util.TreeMap<Integer,String> verifiedChunks = new java.util.TreeMap<>();
                                    for (QueryDocumentSnapshot chunk : chunks) {
                                        Long indexValue = chunk.getLong("index");
                                        String data = chunk.getString("data");
                                        if (indexValue == null || indexValue < 0 || indexValue >= count || data == null || data.length() > 100000
                                            || !String.format(Locale.US,"%06d",indexValue.intValue()).equals(chunk.getId())
                                            || verifiedChunks.put(indexValue.intValue(),data) != null) {
                                            if (failed.compareAndSet(false, true)) sendCloudJs("window.onCloudSnapshotCommitted(false,'جزء غير صالح داخل النسخة',"+JSONObject.quote(snapshotId)+")");
                                            return;
                                        }
                                    }
                                    if (verifiedChunks.size() != count) {
                                        if (failed.compareAndSet(false, true)) sendCloudJs("window.onCloudSnapshotCommitted(false,'هناك أجزاء ناقصة داخل النسخة',"+JSONObject.quote(snapshotId)+")");
                                        return;
                                    }
                                    StringBuilder categoryPayload = new StringBuilder();
                                    for (int index = 0; index < count; index++) {
                                        String chunkData = verifiedChunks.get(index);
                                        if (chunkData == null) {
                                            if (failed.compareAndSet(false, true)) sendCloudJs("window.onCloudSnapshotCommitted(false,'هناك أجزاء ناقصة داخل النسخة',"+JSONObject.quote(snapshotId)+")");
                                            return;
                                        }
                                        categoryPayload.append(chunkData);
                                    }
                                    if (!isValidCloudCategoryPayload(category,categoryPayload.toString())) {
                                        if (failed.compareAndSet(false, true)) sendCloudJs("window.onCloudSnapshotCommitted(false,'محتوى قسم غير صالح: '+"
                                            + JSONObject.quote(category) + ","+JSONObject.quote(snapshotId)+")");
                                        return;
                                    }
                                    if (verifiedCount.incrementAndGet() == categories.size() && !failed.get()) {
                                        long committedAt = System.currentTimeMillis();
                                        Map<String,Object> snapshotInfo = new HashMap<>();
                                        snapshotInfo.put("snapshotId", snapshotId);
                                        snapshotInfo.put("categories", categories);
                                        snapshotInfo.put("categoryCount", categories.size());
                                        snapshotInfo.put("createdAt", committedAt);
                                        snapshotInfo.put("schemaVersion", 1);
                                        snapshotInfo.put("status", "READY");
                                        com.google.firebase.firestore.DocumentReference snapshotRef = FirebaseFirestore.getInstance().collection("shops").document(uid)
                                            .collection("snapshots").document(snapshotId);
                                        Map<String,Object> pointer = new HashMap<>();
                                        pointer.put("snapshotId", snapshotId);
                                        pointer.put("categories", categories);
                                        pointer.put("updatedAt", committedAt);
                                        com.google.firebase.firestore.DocumentReference pointerRef = FirebaseFirestore.getInstance().collection("shops").document(uid)
                                            .collection("snapshotMeta").document("current");
                                        String expectedBase = expectedBaseId == null ? "" : expectedBaseId;
                                        FirebaseFirestore.getInstance().runTransaction(transaction -> {
                                            com.google.firebase.firestore.DocumentSnapshot current = transaction.get(pointerRef);
                                            String currentId = current.exists() ? current.getString("snapshotId") : "";
                                            if (currentId == null) currentId = "";
                                            if (requireBaseMatch && !expectedBase.equals(currentId)) return false;
                                            // Publish the snapshot document and current pointer atomically.
                                            // A stale client must not leave an orphan READY snapshot behind.
                                            transaction.set(snapshotRef, snapshotInfo);
                                            transaction.set(pointerRef, pointer);
                                            return true;
                                        }).addOnSuccessListener(committed -> {
                                            if (Boolean.TRUE.equals(committed)) sendCloudJs("window.onCloudSnapshotCommitted(true,'',"+JSONObject.quote(snapshotId)+")");
                                            else sendCloudJs("window.onCloudSnapshotCommitted(false,'CLOUD_CONFLICT: النسخة السحابية تغيرت من جهاز آخر',"+JSONObject.quote(snapshotId)+")");
                                        }).addOnFailureListener(e -> sendCloudJs("window.onCloudSnapshotCommitted(false,"+JSONObject.quote(e.getMessage())+","+JSONObject.quote(snapshotId)+")"));
                                    }
                                })
                                .addOnFailureListener(e -> {
                                    if (failed.compareAndSet(false, true)) sendCloudJs("window.onCloudSnapshotCommitted(false,"+JSONObject.quote(e.getMessage())+","+JSONObject.quote(snapshotId)+")");
                                });
                        })
                        .addOnFailureListener(e -> {
                            if (failed.compareAndSet(false, true)) sendCloudJs("window.onCloudSnapshotCommitted(false,"+JSONObject.quote(e.getMessage())+","+JSONObject.quote(snapshotId)+")");
                        });
                }
            } catch (Exception e) {
                sendCloudJs("window.onCloudSnapshotCommitted(false,"+JSONObject.quote(e.getMessage())+","+JSONObject.quote(snapshotId)+")");
            }
        }
        @JavascriptInterface public void cloudDownloadSnapshot(String requestId) {
            if (!isSafeSnapshotId(requestId)) return;
            String uid = FirebaseAuth.getInstance().getCurrentUser() == null ? null : FirebaseAuth.getInstance().getCurrentUser().getUid();
            if (uid == null) {
                sendCloudJs("window.onCloudDownloadError('سجل الدخول أولاً',"+JSONObject.quote(requestId)+")");
                return;
            }
            FirebaseFirestore db = FirebaseFirestore.getInstance();
            db.collection("shops").document(uid).collection("snapshotMeta").document("current").get()
                .addOnSuccessListener(pointerDoc -> {
                    if (!pointerDoc.exists()) {
                        sendCloudJs("window.onCloudDownloadComplete(false,'',"+JSONObject.quote(requestId)+")");
                        return;
                    }
                    String snapshotId = pointerDoc.getString("snapshotId");
                    Object rawCategories = pointerDoc.get("categories");
                    if (!isSafeSnapshotId(snapshotId) || !(rawCategories instanceof java.util.List)) {
                        sendCloudJs("window.onCloudDownloadError('مؤشر النسخة السحابية غير صالح',"+JSONObject.quote(requestId)+")");
                        return;
                    }
                    java.util.List<?> categories = (java.util.List<?>) rawCategories;
                    java.util.HashSet<String> uniqueCategories = new java.util.HashSet<>();
                    if (categories.size() != 12) {
                        sendCloudJs("window.onCloudDownloadError('قائمة أقسام النسخة غير مكتملة',"+JSONObject.quote(requestId)+")");
                        return;
                    }
                    for (Object rawCategory : categories) {
                        if (!(rawCategory instanceof String) || !isAllowedCloudCategory((String) rawCategory) || !uniqueCategories.add((String) rawCategory)) {
                            sendCloudJs("window.onCloudDownloadError('أقسام النسخة غير صالحة أو مكررة',"+JSONObject.quote(requestId)+")");
                            return;
                        }
                    }
                    AtomicInteger completed = new AtomicInteger(0);
                    AtomicBoolean failed = new AtomicBoolean(false);
                    for (Object rawCategory : categories) {
                        String category = (String) rawCategory;
                        db.collection("shops").document(uid).collection("snapshots").document(snapshotId)
                            .collection("meta").document(category).get()
                            .addOnSuccessListener(metaDoc -> {
                                if (!metaDoc.exists()) {
                                    if (failed.compareAndSet(false, true)) sendCloudJs("window.onCloudDownloadError("+JSONObject.quote("بيانات قسم مفقودة: "+category)+","+JSONObject.quote(requestId)+")");
                                    return;
                                }
                                Long countValue = metaDoc.getLong("chunkCount");
                                int count = countValue == null ? 0 : countValue.intValue();
                                if (count < 1 || count > 10000) {
                                    if (failed.compareAndSet(false, true)) sendCloudJs("window.onCloudDownloadError("+JSONObject.quote("عدد أجزاء غير صالح: "+category)+","+JSONObject.quote(requestId)+")");
                                    return;
                                }
                                db.collection("shops").document(uid).collection("snapshots").document(snapshotId)
                                    .collection("data").document(category).collection("chunks").get()
                                    .addOnSuccessListener(chunks -> {
                                        if (chunks.size() != count) {
                                            if (failed.compareAndSet(false, true)) sendCloudJs("window.onCloudDownloadError("+JSONObject.quote("عدد أجزاء النسخة غير متطابق: "+category)+","+JSONObject.quote(requestId)+")");
                                            return;
                                        }
                                        java.util.HashMap<Integer,String> verified = new java.util.HashMap<>();
                                        for (QueryDocumentSnapshot chunk : chunks) {
                                            String data = chunk.getString("data");
                                            Long indexValue = chunk.getLong("index");
                                            if (data == null || data.length() > 100000 || indexValue == null || indexValue < 0 || indexValue >= count) {
                                                if (failed.compareAndSet(false, true)) sendCloudJs("window.onCloudDownloadError("+JSONObject.quote("جزء غير صالح داخل "+category)+","+JSONObject.quote(requestId)+")");
                                                return;
                                            }
                                            int index = indexValue.intValue();
                                            String expectedId = String.format(Locale.US,"%06d",index);
                                            if (!expectedId.equals(chunk.getId()) || verified.put(index,data) != null) {
                                                if (failed.compareAndSet(false, true)) sendCloudJs("window.onCloudDownloadError("+JSONObject.quote("جزء مكرر أو بمعرّف غير صحيح داخل "+category)+","+JSONObject.quote(requestId)+")");
                                                return;
                                            }
                                        }
                                        if (verified.size() != count) {
                                            if (failed.compareAndSet(false, true)) sendCloudJs("window.onCloudDownloadError("+JSONObject.quote("هناك أجزاء ناقصة داخل "+category)+","+JSONObject.quote(requestId)+")");
                                            return;
                                        }
                                        for (int index = 0; index < count; index++) {
                                            String data = verified.get(index);
                                            if (data == null) {
                                                if (failed.compareAndSet(false, true)) sendCloudJs("window.onCloudDownloadError("+JSONObject.quote("جزء مفقود داخل "+category)+","+JSONObject.quote(requestId)+")");
                                                return;
                                            }
                                            sendCloudJs("window.onCloudChunkReceived("+JSONObject.quote(category)+","+index+","+count+","+JSONObject.quote(data)+","+JSONObject.quote(requestId)+")");
                                        }
                                        if (completed.incrementAndGet() == categories.size() && !failed.get()) {
                                            // Re-check the current pointer after all chunks are downloaded.
                                            // If another device committed a newer snapshot mid-download,
                                            // discard these buffers instead of restoring a stale snapshot.
                                            db.collection("shops").document(uid).collection("snapshotMeta").document("current").get()
                                                .addOnSuccessListener(latestPointer -> {
                                                    String latestId = latestPointer.exists() ? latestPointer.getString("snapshotId") : "";
                                                    if (latestId == null) latestId = "";
                                                    if (!snapshotId.equals(latestId)) {
                                                        if (failed.compareAndSet(false, true)) sendCloudJs("window.onCloudDownloadError("+JSONObject.quote("تغيرت النسخة السحابية أثناء التنزيل؛ أعد المحاولة للحصول على أحدث نسخة")+","+JSONObject.quote(requestId)+")");
                                                        return;
                                                    }
                                                    if (!failed.get()) sendCloudJs("window.onCloudDownloadComplete(true,"+JSONObject.quote(snapshotId)+","+JSONObject.quote(requestId)+")");
                                                })
                                                .addOnFailureListener(e -> {
                                                    if (failed.compareAndSet(false, true)) sendCloudJs("window.onCloudDownloadError("+JSONObject.quote(e.getMessage())+","+JSONObject.quote(requestId)+")");
                                                });
                                        }
                                    })
                                    .addOnFailureListener(e -> {
                                        if (failed.compareAndSet(false, true)) sendCloudJs("window.onCloudDownloadError("+JSONObject.quote(e.getMessage())+","+JSONObject.quote(requestId)+")");
                                    });
                            })
                            .addOnFailureListener(e -> {
                                if (failed.compareAndSet(false, true)) sendCloudJs("window.onCloudDownloadError("+JSONObject.quote(e.getMessage())+","+JSONObject.quote(requestId)+")");
                            });
                    }
                })
                .addOnFailureListener(e -> sendCloudJs("window.onCloudDownloadError("+JSONObject.quote(e.getMessage())+","+JSONObject.quote(requestId)+")"));
        }
    }
    private ValueCallback<Uri[]> fileCallback;
    private static final int FILE_CHOOSER = 1001;
    private static final int VOICE_SEARCH = 1002;
    private static final int FILE_SAVE = 1003;
    private String pendingSaveContent;
    private String pendingSaveFileName;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(android.graphics.Color.rgb(19,36,58));
        getWindow().setNavigationBarColor(android.graphics.Color.rgb(19,36,58));
        webView = new WebView(this);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setJavaScriptCanOpenWindowsAutomatically(false);
        webView.getSettings().setSupportMultipleWindows(false);
        webView.getSettings().setSupportZoom(false);
        webView.getSettings().setBuiltInZoomControls(false);
        webView.getSettings().setDisplayZoomControls(false);
        webView.getSettings().setMediaPlaybackRequiresUserGesture(true);
        webView.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if (android.os.Build.VERSION.SDK_INT >= 26) webView.getSettings().setSafeBrowsingEnabled(true);
        webView.getSettings().setGeolocationEnabled(false);
        webView.getSettings().setDomStorageEnabled(true);
        // Force software composition for the app WebView. Some headless Android
        // emulator GPU stacks report a ready DOM while presenting a white surface.
        webView.setLayerType(android.view.View.LAYER_TYPE_SOFTWARE, null);
        webView.setBackgroundColor(android.graphics.Color.rgb(9, 19, 33));
        webView.getSettings().setAllowFileAccess(true);
        webView.getSettings().setAllowContentAccess(true);
        webView.getSettings().setAllowFileAccessFromFileURLs(false);
        webView.getSettings().setAllowUniversalAccessFromFileURLs(false);
        bridge = new WebAppInterface(this);
        webView.addJavascriptInterface(bridge, "AndroidShare");
        webView.addJavascriptInterface(bridge, "AndroidScanner");
        webView.addJavascriptInterface(bridge, "AndroidVoice");
        webView.addJavascriptInterface(bridge, "AndroidBiometric");
        webView.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                Log.i("ELECTRO_SMOKE", "PAGE_FINISHED url=" + url);
                view.evaluateJavascript("(function(){var b=document.body,g=document.getElementById('authGate'),c=document.getElementById('authContent'),t=document.title||'',s=document.readyState,n=b?(b.innerText||'').length:0;if(window.AndroidShare&&AndroidShare.reportPageReady)AndroidShare.reportPageReady(t,s,n);return JSON.stringify({title:t,readyState:s,bodyLength:n,bodyBackground:b?getComputedStyle(b).backgroundColor:'',authGateDisplay:g?getComputedStyle(g).display:'missing',authContentLength:c?(c.innerText||'').trim().length:0,viewportWidth:window.innerWidth,viewportHeight:window.innerHeight})})()", value ->
                    Log.i("ELECTRO_SMOKE", "DOM_STATE " + value));
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, android.webkit.WebResourceError error) {
                super.onReceivedError(view, request, error);
                Log.e("ELECTRO_SMOKE", "WEB_ERROR url=" + (request == null ? "" : request.getUrl()) + " code=" + (error == null ? -1 : error.getErrorCode()) + " description=" + (error == null ? "" : error.getDescription()));
            }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                boolean crashed = detail != null && detail.didCrash();
                int priority = detail == null ? -1 : detail.rendererPriorityAtExit();
                Log.e("ELECTRO_WEBVIEW", "Renderer process gone; crashed=" + crashed + " priority=" + priority);
                if (MainActivity.this.webView == view && !rendererRecoveryAttempted) {
                    rendererRecoveryAttempted = true;
                    if (bridge != null) bridge.cleanup();
                    try {
                        android.view.ViewParent parent = view.getParent();
                        if (parent instanceof android.view.ViewGroup) {
                            ((android.view.ViewGroup) parent).removeView(view);
                        }
                        view.stopLoading();
                        view.removeJavascriptInterface("AndroidShare");
                        view.removeJavascriptInterface("AndroidScanner");
                        view.removeJavascriptInterface("AndroidVoice");
                        view.removeJavascriptInterface("AndroidBiometric");
                        view.destroy();
                    } catch (Exception cleanupError) {
                        Log.w("ELECTRO_WEBVIEW", "Unable to fully clean up crashed WebView", cleanupError);
                    } finally {
                        MainActivity.this.webView = null;
                    }
                    Intent restart = MainActivity.this.getIntent();
                    MainActivity.this.finish();
                    MainActivity.this.startActivity(restart);
                } else if (MainActivity.this.webView == view) {
                    Log.e("ELECTRO_WEBVIEW", "Renderer recovery already attempted; closing affected activity");
                    MainActivity.this.finish();
                }
                return true;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return shouldOverrideUrlLoading(view, request == null || request.getUrl() == null ? null : request.getUrl().toString());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url == null) return true;
                if (url.startsWith("file:///android_asset/")) return false;
                if (url.startsWith("https://") || url.startsWith("http://")) {
                    try {
                        MainActivity.this.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                    } catch (Exception ignored) { }
                }
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(ConsoleMessage message) {
                if (message != null && message.messageLevel() == ConsoleMessage.MessageLevel.ERROR) {
                    Log.e("ELECTRO_JS", "console(" + message.lineNumber() + ") " + message.message() + " @ " + message.sourceId());
                }
                return true;
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("image/*");
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivityForResult(Intent.createChooser(intent, "اختيار صور المنتج"), FILE_CHOOSER);
                } catch (Exception e) {
                    Log.e("ELECTRO_FILES", "Unable to open image picker", e);
                    if (fileCallback != null) fileCallback.onReceiveValue(null);
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });
        setContentView(webView);
        webView.loadUrl("file:///android_asset/www/index.html");
    }

    private void notifyVoiceUnavailable() {
        if (webView != null) webView.evaluateJavascript("window.toast && window.toast('خدمة البحث الصوتي غير متاحة على هذا الجهاز')", null);
    }

    private void beginSaveTextFile(String fileName, String content, String mimeType) {
        if (pendingSaveContent != null || content == null) {
            notifyFileSaveResult(false, "error");
            return;
        }
        String safeName = fileName == null ? "ELECTRO-Sandy-export.txt" : fileName.replaceAll("[\\\\/:*?\\\"<>|]", "_").trim();
        if (safeName.isEmpty()) safeName = "ELECTRO-Sandy-export.txt";
        String safeMime = "application/json".equals(mimeType) || "text/csv".equals(mimeType) || "application/vnd.ms-excel".equals(mimeType) ? mimeType : "text/plain";
        pendingSaveContent = content;
        pendingSaveFileName = safeName;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(safeMime);
        intent.putExtra(Intent.EXTRA_TITLE, safeName);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        try {
            startActivityForResult(intent, FILE_SAVE);
        } catch (Exception e) {
            pendingSaveContent = null;
            pendingSaveFileName = null;
            notifyFileSaveResult(false, "error");
        }
    }

    private void notifyFileSaveResult(boolean success, String result) {
        if (webView == null) return;
        String script = "window.onNativeFileSaved && window.onNativeFileSaved(" + success + "," + JSONObject.quote(result == null ? "" : result) + ")";
        runOnUiThread(() -> {
            if (webView != null) webView.evaluateJavascript(script, null);
        });
    }

    private void writePendingTextFile(Uri uri) {
        final String content = pendingSaveContent;
        final String fileName = pendingSaveFileName;
        pendingSaveContent = null;
        pendingSaveFileName = null;
        if (uri == null || content == null) {
            notifyFileSaveResult(false, "cancelled");
            return;
        }
        new Thread(() -> {
            try (OutputStream output = getContentResolver().openOutputStream(uri, "w")) {
                if (output == null) throw new IllegalStateException("تعذر فتح الملف");
                output.write(content.getBytes(StandardCharsets.UTF_8));
                output.flush();
                notifyFileSaveResult(true, fileName);
            } catch (Exception e) {
                notifyFileSaveResult(false, "error");
            }
        }, "ELECTRO-Sandy-FileSave").start();
    }


    // Normalize selected formats natively before WebView reads them.
    private Uri normalizeProductImage(Uri source, int index) throws Exception {
        Bitmap bitmap = null;
        if (Build.VERSION.SDK_INT >= 28) {
            ImageDecoder.Source imageSource = ImageDecoder.createSource(getContentResolver(), source);
            bitmap = ImageDecoder.decodeBitmap(imageSource, (decoder, info, src) -> {
                decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
                int width = info.getSize().getWidth(), height = info.getSize().getHeight();
                int max = Math.max(width, height);
                if (max > 2048) {
                    float scale = 2048f / max;
                    decoder.setTargetSize(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
                }
            });
        } else {
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            try (InputStream in = getContentResolver().openInputStream(source)) {
                if (in == null) throw new IOException("تعذر فتح الصورة");
                BitmapFactory.decodeStream(in, null, bounds);
            }
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw new IOException("صيغة الصورة غير مدعومة");
            BitmapFactory.Options options = new BitmapFactory.Options();
            int largest = Math.max(bounds.outWidth, bounds.outHeight);
            while (largest / options.inSampleSize > 2048) options.inSampleSize *= 2;
            try (InputStream in = getContentResolver().openInputStream(source)) {
                if (in == null) throw new IOException("تعذر فتح الصورة");
                bitmap = BitmapFactory.decodeStream(in, null, options);
            }
            if (bitmap == null) throw new IOException("تعذر فك ترميز الصورة");
            try (InputStream in = getContentResolver().openInputStream(source)) {
                if (in != null) {
                    int orientation = new ExifInterface(in).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
                    Matrix matrix = new Matrix();
                    if (orientation == ExifInterface.ORIENTATION_ROTATE_90) matrix.postRotate(90);
                    else if (orientation == ExifInterface.ORIENTATION_ROTATE_180) matrix.postRotate(180);
                    else if (orientation == ExifInterface.ORIENTATION_ROTATE_270) matrix.postRotate(270);
                    else if (orientation == ExifInterface.ORIENTATION_FLIP_HORIZONTAL) matrix.preScale(-1, 1);
                    else if (orientation == ExifInterface.ORIENTATION_FLIP_VERTICAL) matrix.preScale(1, -1);
                    if (!matrix.isIdentity()) {
                        Bitmap rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
                        if (rotated != bitmap) bitmap.recycle();
                        bitmap = rotated;
                    }
                }
            }
        }
        if (bitmap == null || bitmap.getWidth() < 1 || bitmap.getHeight() < 1) throw new IOException("ملف الصورة غير صالح");
        File directory = new File(getCacheDir(), "product-images");
        if (!directory.exists() && !directory.mkdirs()) throw new IOException("تعذر إنشاء مساحة مؤقتة للصور");
        File[] old = directory.listFiles();
        if (old != null) for (File item : old) if (System.currentTimeMillis() - item.lastModified() > 86400000L) item.delete();
        File output = new File(directory, "product-" + System.currentTimeMillis() + "-" + index + ".jpg");
        try (FileOutputStream stream = new FileOutputStream(output)) {
            if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 88, stream)) throw new IOException("تعذر تحويل الصورة إلى JPEG");
            stream.flush();
        } finally {
            bitmap.recycle();
        }
        return FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", output);
    }

    private Uri[] normalizeSelectedImages(Uri[] selected) {
        if (selected == null || selected.length == 0) return null;
        ArrayList<Uri> normalized = new ArrayList<>();
        for (int i = 0; i < selected.length; i++) {
            try {
                normalized.add(normalizeProductImage(selected[i], i));
            } catch (Exception error) {
                Log.e("ELECTRO_IMAGES", "Image conversion failed index=" + i + " uri=" + selected[i], error);
                if (webView != null) {
                    String message = "تعذر قراءة إحدى الصور المختارة. جرّب حفظها من جديد ثم أعد الاختيار.";
                    webView.post(() -> webView.evaluateJavascript("window.toast && window.toast(" + JSONObject.quote(message) + ")", null));
                }
                return null;
            }
        }
        return normalized.toArray(new Uri[0]);
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_SAVE) {
            Uri uri = resultCode == RESULT_OK && data != null ? data.getData() : null;
            writePendingTextFile(uri);
            return;
        }
        if (requestCode == VOICE_SEARCH) {
            if (resultCode == RESULT_OK && data != null && webView != null) {
                ArrayList<String> matches = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
                if (matches != null && !matches.isEmpty()) webView.evaluateJavascript("window.onVoiceSearchResult(" + JSONObject.quote(matches.get(0)) + ")", null);
            }
            return;
        }
        IntentResult scanResult = IntentIntegrator.parseActivityResult(requestCode, resultCode, data);
        if (scanResult != null) {
            if (scanResult.getContents() != null && webView != null) {
                webView.evaluateJavascript("window.onCameraBarcodeScanned(" + JSONObject.quote(scanResult.getContents()) + ")", null);
            }
            return;
        }
        if (requestCode == FILE_CHOOSER && fileCallback != null) {
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null) {
                try { result = WebChromeClient.FileChooserParams.parseResult(resultCode, data); }
                catch (Exception e) { Log.w("ELECTRO_FILES", "Unable to parse selected image URIs", e); }
                if ((result == null || result.length == 0) && data.getClipData() != null) {
                    android.content.ClipData clip = data.getClipData();
                    ArrayList<Uri> selected = new ArrayList<>();
                    for (int i = 0; i < clip.getItemCount(); i++) {
                        Uri uri = clip.getItemAt(i).getUri();
                        if (uri != null) selected.add(uri);
                    }
                    if (!selected.isEmpty()) result = selected.toArray(new Uri[0]);
                }
                if ((result == null || result.length == 0) && data.getData() != null) result = new Uri[]{data.getData()};
            }
            Log.i("ELECTRO_FILES", "Image picker resultCode=" + resultCode + " selected=" + (result == null ? 0 : result.length));
            if (result != null && result.length > 0) result = normalizeSelectedImages(result);
            ValueCallback<Uri[]> callback = fileCallback;
            fileCallback = null;
            callback.onReceiveValue(result);
        }
    }

    @Override protected void onDestroy() {
        pendingSaveContent = null;
        pendingSaveFileName = null;
        if (bridge != null) bridge.cleanup();
        if (webView != null) {
            webView.stopLoading();
            webView.removeJavascriptInterface("AndroidShare");
            webView.removeJavascriptInterface("AndroidScanner");
            webView.removeJavascriptInterface("AndroidVoice");
            webView.removeJavascriptInterface("AndroidBiometric");
            webView.destroy();
            webView = null;
        }
        if (fileCallback != null) {
            fileCallback.onReceiveValue(null);
            fileCallback = null;
        }
        super.onDestroy();
    }

    private void fallbackBackNavigation() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript("(function(){return window.handleAndroidBack ? window.handleAndroidBack() : false;})()", value -> {
            if (!"true".equals(value)) fallbackBackNavigation();
        });
    }
}
