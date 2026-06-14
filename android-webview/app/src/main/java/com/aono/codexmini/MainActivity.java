package com.aono.codexmini;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.webkit.CookieManager;
import android.webkit.HttpAuthHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceResponse;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private static final String REMOTE_URL = "http://154.37.222.164/";

    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureWindow();

        webView = new WebView(this);
        setContentView(webView);
        configureWebView(webView);

        if (savedInstanceState == null) {
            webView.loadUrl(REMOTE_URL);
        } else {
            webView.restoreState(savedInstanceState);
        }
    }

    private void configureWindow() {
        Window window = getWindow();
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.BLACK);
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView(WebView view) {
        view.setBackgroundColor(Color.rgb(8, 11, 18));
        view.setOverScrollMode(View.OVER_SCROLL_NEVER);

        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(view, true);

        view.setWebChromeClient(new WebChromeClient());
        view.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) {
                    return false;
                }
                return false;
            }

            @SuppressWarnings("deprecation")
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return false;
            }

            @Override
            public void onReceivedHttpAuthRequest(WebView view, HttpAuthHandler handler, String host, String realm) {
                showHttpAuthPrompt(view, handler, host, realm);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    showErrorPage("页面加载失败", error.getDescription().toString());
                }
            }

            @SuppressWarnings("deprecation")
            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                showErrorPage("页面加载失败", description);
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
                if (request.isForMainFrame()) {
                    showErrorPage(
                            "服务器返回 " + errorResponse.getStatusCode(),
                            errorResponse.getReasonPhrase()
                    );
                }
            }
        });
    }

    private void showHttpAuthPrompt(WebView view, HttpAuthHandler handler, String host, String realm) {
        String[] savedCredentials = view.getHttpAuthUsernamePassword(host, realm);
        if (savedCredentials != null && savedCredentials.length == 2) {
            handler.proceed(savedCredentials[0], savedCredentials[1]);
            return;
        }

        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        int padding = dp(20);
        content.setPadding(padding, dp(8), padding, 0);

        TextView message = new TextView(this);
        message.setText("服务器需要 HTTP Basic 登录。请输入服务器访问账号和密码。");
        message.setTextColor(Color.rgb(34, 43, 57));
        message.setTextSize(14);
        content.addView(message);

        EditText username = new EditText(this);
        username.setHint("用户名");
        username.setSingleLine(true);
        username.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_NORMAL);
        content.addView(username);

        EditText password = new EditText(this);
        password.setHint("密码");
        password.setSingleLine(true);
        password.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        content.addView(password);

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("Codex Mini 登录")
                .setView(content)
                .setPositiveButton("登录", null)
                .setNegativeButton("取消", (d, which) -> handler.cancel())
                .setOnCancelListener(d -> handler.cancel())
                .create();

        dialog.setOnShowListener(d -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String user = username.getText().toString().trim();
            String pass = password.getText().toString();
            if (user.isEmpty() || pass.isEmpty()) {
                showErrorPage("登录信息不完整", "请输入服务器访问账号和密码。");
                return;
            }

            view.setHttpAuthUsernamePassword(host, realm, user, pass);
            handler.proceed(user, pass);
            dialog.dismiss();
        }));
        dialog.show();
    }

    private void showErrorPage(String title, String detail) {
        String html = "<!doctype html><html><head><meta charset=\"utf-8\">"
                + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">"
                + "<style>body{margin:0;background:#080b12;color:#e8edf7;font-family:sans-serif;"
                + "display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px;}"
                + "main{max-width:420px;width:100%;}h1{font-size:20px;margin:0 0 12px;}"
                + "p{font-size:14px;line-height:1.55;color:#aab4c4;margin:0 0 16px;}"
                + "button{border:0;border-radius:8px;background:#37d4a5;color:#06110d;"
                + "font-size:15px;font-weight:600;padding:12px 16px;width:100%;}</style></head>"
                + "<body><main><h1>" + escapeHtml(title) + "</h1><p>" + escapeHtml(detail)
                + "</p><button onclick=\"location.href='" + REMOTE_URL + "'\">重新加载</button></main></body></html>";
        webView.loadDataWithBaseURL(REMOTE_URL, html, "text/html", "UTF-8", null);
    }

    private String escapeHtml(String value) {
        if (value == null || value.isEmpty()) {
            return "请检查网络连接或服务器登录信息。";
        }
        return value
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;");
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }
}
