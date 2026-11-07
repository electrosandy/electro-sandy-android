package com.electrosandy.app;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.JavascriptInterface;
import android.webkit.WebViewClient;
import android.webkit.ValueCallback;
import android.content.Intent;
import android.net.Uri;
import android.print.PrintManager;
import android.print.PrintAttributes;
import android.content.Context;
import androidx.fragment.app.FragmentActivity;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import android.speech.RecognizerIntent;
import java.util.ArrayList;
import com.google.zxing.integration.android.IntentIntegrator;
import com.google.zxing.integration.android.IntentResult;
import org.json.JSONObject;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.QueryDocumentSnapshot;
import java.util.HashMap;
import java.util.Map;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicBoolean;

public class MainActivity extends FragmentActivity {
    private WebView webView;

    private static class WebAppInterface {
        private final Activity activity;
        WebAppInterface(Activity activity) { this.activity = activity; }
        @JavascriptInterface public void authenticateBiometric() {
            activity.runOnUiThread(() -> {
                if (!(activity instanceof MainActivity)) return;
                MainActivity main = (MainActivity) activity;
                try {
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
                    } else {
                        String message = task.getException() == null ? "تعذر تسجيل الدخول" : task.getException().getMessage();
                        sendCloudJs("window.onCloudAuthResult(false,"+JSONObject.quote(message)+",'')");
                    }
                });
        }
        @JavascriptInterface public void cloudCheckAuth() {
            if (FirebaseAuth.getInstance().getCurrentUser() != null) {
                String uid = FirebaseAuth.getInstance().getCurrentUser().getUid();
                sendCloudJs("window.onCloudAuthResult(true,'جلسة المزامنة محفوظة',"+JSONObject.quote(uid)+")");
            }
        }
        @JavascriptInterface public void cloudSignOut() {
            FirebaseAuth.getInstance().signOut();
            sendCloudJs("window.onCloudSignedOut && window.onCloudSignedOut()");
        }
        @JavascriptInterface public void cloudWriteChunk(String snapshotId, String category, int index, String data) {
            if (!isSafeSnapshotId(snapshotId) || !isAllowedCloudCategory(category) || index < 0 || index >= 10000 || data == null || data.length() > 100000) {
                sendCloudJs("window.onCloudChunkSaved("+JSONObject.quote(category == null ? "" : category)+","+index+",false,'بيانات جزء غير صالحة')");
                return;
            }
            String uid = FirebaseAuth.getInstance().getCurrentUser() == null ? null : FirebaseAuth.getInstance().getCurrentUser().getUid();
            if (uid == null) {
                sendCloudJs("window.onCloudChunkSaved("+JSONObject.quote(category)+","+index+",false,'سجل الدخول أولاً')");
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
                .addOnSuccessListener(v -> sendCloudJs("window.onCloudChunkSaved("+JSONObject.quote(category)+","+index+",true,'')"))
                .addOnFailureListener(e -> sendCloudJs("window.onCloudChunkSaved("+JSONObject.quote(category)+","+index+",false,"+JSONObject.quote(e.getMessage())+")"));
        }
        @JavascriptInterface public void cloudFinishCategory(String snapshotId, String category, int count) {
            if (!isSafeSnapshotId(snapshotId) || !isAllowedCloudCategory(category) || count < 1 || count > 10000) {
                sendCloudJs("window.onCloudCategorySaved("+JSONObject.quote(category == null ? "" : category)+",false,'بيانات القسم غير صالحة')");
                return;
            }
            String uid = FirebaseAuth.getInstance().getCurrentUser() == null ? null : FirebaseAuth.getInstance().getCurrentUser().getUid();
            if (uid == null) {
                sendCloudJs("window.onCloudCategorySaved("+JSONObject.quote(category)+",false,'سجل الدخول أولاً')");
                return;
            }
            Map<String,Object> meta = new HashMap<>();
            meta.put("chunkCount", count);
            meta.put("updatedAt", System.currentTimeMillis());
            FirebaseFirestore.getInstance().collection("shops").document(uid)
                .collection("snapshots").document(snapshotId).collection("meta")
                .document(category).set(meta)
                .addOnSuccessListener(v -> sendCloudJs("window.onCloudCategorySaved("+JSONObject.quote(category)+",true,'')"))
                .addOnFailureListener(e -> sendCloudJs("window.onCloudCategorySaved("+JSONObject.quote(category)+",false,"+JSONObject.quote(e.getMessage())+")"));
        }
        @JavascriptInterface public void cloudCommitSnapshot(String snapshotId, String categoriesJson) {
            if (!isSafeSnapshotId(snapshotId)) {
                sendCloudJs("window.onCloudSnapshotCommitted(false,'معرّف النسخة غير صالح')");
                return;
            }
            String uid = FirebaseAuth.getInstance().getCurrentUser() == null ? null : FirebaseAuth.getInstance().getCurrentUser().getUid();
            if (uid == null) {
                sendCloudJs("window.onCloudSnapshotCommitted(false,'سجل الدخول أولاً')");
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
                Map<String,Object> pointer = new HashMap<>();
                pointer.put("snapshotId", snapshotId);
                pointer.put("categories", categories);
                pointer.put("updatedAt", System.currentTimeMillis());
                FirebaseFirestore.getInstance().collection("shops").document(uid)
                    .collection("snapshotMeta").document("current").set(pointer)
                    .addOnSuccessListener(v -> sendCloudJs("window.onCloudSnapshotCommitted(true,'')"))
                    .addOnFailureListener(e -> sendCloudJs("window.onCloudSnapshotCommitted(false,"+JSONObject.quote(e.getMessage())+")"));
            } catch (Exception e) {
                sendCloudJs("window.onCloudSnapshotCommitted(false,"+JSONObject.quote(e.getMessage())+")");
            }
        }
        @JavascriptInterface public void cloudDownloadSnapshot() {
            String uid = FirebaseAuth.getInstance().getCurrentUser() == null ? null : FirebaseAuth.getInstance().getCurrentUser().getUid();
            if (uid == null) {
                sendCloudJs("window.onCloudDownloadError('سجل الدخول أولاً')");
                return;
            }
            FirebaseFirestore db = FirebaseFirestore.getInstance();
            db.collection("shops").document(uid).collection("snapshotMeta").document("current").get()
                .addOnSuccessListener(pointerDoc -> {
                    if (!pointerDoc.exists()) {
                        sendCloudJs("window.onCloudDownloadComplete(false)");
                        return;
                    }
                    String snapshotId = pointerDoc.getString("snapshotId");
                    Object rawCategories = pointerDoc.get("categories");
                    if (snapshotId == null || !(rawCategories instanceof java.util.List)) {
                        sendCloudJs("window.onCloudDownloadError('مؤشر النسخة السحابية غير صالح')");
                        return;
                    }
                    java.util.List<?> categories = (java.util.List<?>) rawCategories;
                    if (categories.isEmpty() || categories.size() > 30) {
                        sendCloudJs("window.onCloudDownloadError('قائمة أقسام النسخة غير صالحة')");
                        return;
                    }
                    AtomicInteger completed = new AtomicInteger(0);
                    AtomicBoolean failed = new AtomicBoolean(false);
                    for (Object rawCategory : categories) {
                        if (!(rawCategory instanceof String) || !isAllowedCloudCategory((String) rawCategory)) {
                            if (failed.compareAndSet(false, true)) sendCloudJs("window.onCloudDownloadError('اسم قسم غير صالح')");
                            continue;
                        }
                        String category = (String) rawCategory;
                        db.collection("shops").document(uid).collection("snapshots").document(snapshotId)
                            .collection("meta").document(category).get()
                            .addOnSuccessListener(metaDoc -> {
                                if (!metaDoc.exists()) {
                                    if (failed.compareAndSet(false, true)) sendCloudJs("window.onCloudDownloadError("+JSONObject.quote("بيانات قسم مفقودة: "+category)+")");
                                    return;
                                }
                                Long countValue = metaDoc.getLong("chunkCount");
                                int count = countValue == null ? 0 : countValue.intValue();
                                if (count < 1 || count > 10000) {
                                    if (failed.compareAndSet(false, true)) sendCloudJs("window.onCloudDownloadError("+JSONObject.quote("عدد أجزاء غير صالح: "+category)+")");
                                    return;
                                }
                                db.collection("shops").document(uid).collection("snapshots").document(snapshotId)
                                    .collection("data").document(category).collection("chunks").get()
                                    .addOnSuccessListener(chunks -> {
                                        for (QueryDocumentSnapshot chunk : chunks) {
                                            String data = chunk.getString("data");
                                            Long index = chunk.getLong("index");
                                            if (data != null && index != null && index >= 0 && index < count) {
                                                sendCloudJs("window.onCloudChunkReceived("+JSONObject.quote(category)+","+index+","+count+","+JSONObject.quote(data)+")");
                                            }
                                        }
                                        if (completed.incrementAndGet() == categories.size() && !failed.get()) sendCloudJs("window.onCloudDownloadComplete(true)");
                                    })
                                    .addOnFailureListener(e -> {
                                        if (failed.compareAndSet(false, true)) sendCloudJs("window.onCloudDownloadError("+JSONObject.quote(e.getMessage())+")");
                                    });
                            })
                            .addOnFailureListener(e -> {
                                if (failed.compareAndSet(false, true)) sendCloudJs("window.onCloudDownloadError("+JSONObject.quote(e.getMessage())+")");
                            });
                    }
                })
                .addOnFailureListener(e -> sendCloudJs("window.onCloudDownloadError("+JSONObject.quote(e.getMessage())+")"));
        }
    }
    private ValueCallback<Uri[]> fileCallback;
    private static final int FILE_CHOOSER = 1001;
    private static final int VOICE_SEARCH = 1002;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(android.graphics.Color.rgb(19,36,58));
        getWindow().setNavigationBarColor(android.graphics.Color.rgb(19,36,58));
        webView = new WebView(this);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(true);
        webView.getSettings().setAllowContentAccess(true);
        WebAppInterface bridge = new WebAppInterface(this);
        webView.addJavascriptInterface(bridge, "AndroidShare");
        webView.addJavascriptInterface(bridge, "AndroidScanner");
        webView.addJavascriptInterface(bridge, "AndroidVoice");
        webView.addJavascriptInterface(bridge, "AndroidBiometric");
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent = params.createIntent();
                try { startActivityForResult(intent, FILE_CHOOSER); }
                catch (Exception e) { fileCallback = null; return false; }
                return true;
            }
        });
        setContentView(webView);
        webView.loadUrl("file:///android_asset/www/index.html");
    }

    private void notifyVoiceUnavailable() {
        if (webView != null) webView.evaluateJavascript("window.toast && window.toast('خدمة البحث الصوتي غير متاحة على هذا الجهاز')", null);
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
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
            Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            fileCallback.onReceiveValue(result);
            fileCallback = null;
        }
    }

    @Override public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack(); else super.onBackPressed();
    }
}
