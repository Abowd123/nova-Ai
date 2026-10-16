import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Android shell for the static export in ./out (npm run build:mobile).
 * The web app is unchanged: everything native goes through src/lib/native.
 */
const config: CapacitorConfig = {
  appId: "app.nova.assistant",
  appName: "Nova",
  webDir: "out",
  android: {
    // Debug builds only: lets Chrome DevTools inspect the WebView.
    webContentsDebuggingEnabled: process.env.NOVA_ANDROID_DEBUG === "1",
    allowMixedContent: false,
    captureInput: true,
  },
  server: {
    androidScheme: "https",
    // LAN providers (Ollama/ComfyUI over http) are reached through native HTTP, not the WebView.
    cleartext: false,
  },
  plugins: {
    // window.fetch → native HTTP (no CORS) for WebDAV/MCP/search; streaming uses window.CapacitorWebFetch.
    CapacitorHttp: { enabled: true },
    SplashScreen: { launchAutoHide: false, backgroundColor: "#FEF7FF", androidScaleType: "CENTER_CROP", showSpinner: false },
    StatusBar: { overlaysWebView: false, style: "DEFAULT" },
    Keyboard: { resize: "body", resizeOnFullScreen: true },
    LocalNotifications: { smallIcon: "ic_stat_nova", iconColor: "#6750A4" },
  },
};

export default config;
