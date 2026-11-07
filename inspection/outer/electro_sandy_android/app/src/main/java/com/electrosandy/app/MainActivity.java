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
import android.speech.RecognizerIntent;
import java.util.ArrayList;
import com.google.zxing.integration.android.IntentIntegrator;
import com.google.zxing.integration.android.IntentResult;
import org.json.JSONObject;

public class MainActivity extends Activity {
    private WebView webView;

    private static class WebAppInterface {
        private final Activity activity;
        WebAppInterface(Activity activity) { this.activity = activity; }
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
