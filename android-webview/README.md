# Codex Mini Remote Android

Minimal Android WebView wrapper for the self-hosted Codex Mini remote page.

## Build

```sh
cd android-webview
./gradlew assembleDebug
```

The debug APK is generated at:

```text
app/build/outputs/apk/debug/app-debug.apk
```

## Default Target

The app opens:

```text
http://154.37.222.164/login
```

The project explicitly allows cleartext HTTP traffic to this IP. Move the relay
behind HTTPS before wider distribution.
