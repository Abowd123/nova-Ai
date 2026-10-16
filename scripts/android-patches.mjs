/**
 * Pure text transforms for the generated Android project (unit-tested).
 * `npx cap add android` creates android/; these make it Nova's: permissions, deep link,
 * orientation, min SDK 26 (Android 8), release signing from environment variables.
 */
export const DEEP_LINK_SCHEME = "app.nova.assistant";

export const PERMISSIONS = [
  "android.permission.INTERNET",
  "android.permission.ACCESS_NETWORK_STATE",
  "android.permission.RECORD_AUDIO",
  "android.permission.MODIFY_AUDIO_SETTINGS",
  "android.permission.CAMERA",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.VIBRATE",
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_MEDIA_VIDEO",
  "android.permission.READ_MEDIA_AUDIO",
];

const LEGACY_STORAGE = '<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />';

export function patchManifest(xml, options = {}) {
  let out = xml;
  // Permissions (idempotent).
  const missing = PERMISSIONS.filter((p) => !out.includes(`android:name="${p}"`));
  const lines = missing.map((p) => `    <uses-permission android:name="${p}" />`);
  if (!out.includes("READ_EXTERNAL_STORAGE")) lines.push(`    ${LEGACY_STORAGE}`);
  if (!out.includes('android.hardware.camera"')) lines.push('    <uses-feature android:name="android.hardware.camera" android:required="false" />');
  if (!out.includes('android.hardware.microphone"')) lines.push('    <uses-feature android:name="android.hardware.microphone" android:required="false" />');
  if (lines.length) out = out.replace(/(\s*)<\/manifest>\s*$/, `\n${lines.join("\n")}\n</manifest>\n`);

  // Deep link for OAuth callbacks: app.nova.assistant://oauth/callback
  if (!out.includes(`android:scheme="${DEEP_LINK_SCHEME}"`)) {
    const filter = [
      "            <intent-filter android:autoVerify=\"false\">",
      '                <action android:name="android.intent.action.VIEW" />',
      '                <category android:name="android.intent.category.DEFAULT" />',
      '                <category android:name="android.intent.category.BROWSABLE" />',
      `                <data android:scheme="${DEEP_LINK_SCHEME}" android:host="oauth" />`,
      "            </intent-filter>",
    ].join("\n");
    out = out.replace(/(<activity[\s\S]*?<\/intent-filter>)/, `$1\n${filter}`);
  }

  // Rotation allowed (phones + tablets), activity survives config changes (no reload on rotate).
  out = out.replace(/android:screenOrientation="[^"]*"/, 'android:screenOrientation="unspecified"');
  if (!/<activity[^>]*android:windowSoftInputMode=/.test(out)) out = out.replace(/<activity(\s)/, '<activity android:windowSoftInputMode="adjustResize"$1');

  // Cleartext (http) only when explicitly requested (LAN Ollama/ComfyUI over http).
  const cleartext = options.cleartext ? "true" : "false";
  if (/android:usesCleartextTraffic="[^"]*"/.test(out)) out = out.replace(/android:usesCleartextTraffic="[^"]*"/, `android:usesCleartextTraffic="${cleartext}"`);
  else out = out.replace(/<application(\s)/, `<application android:usesCleartextTraffic="${cleartext}"$1`);
  // No cloud backup of app data: keys are device-bound, backups go through WebDAV.
  if (!out.includes("android:allowBackup=")) out = out.replace(/<application(\s)/, '<application android:allowBackup="false"$1');
  else out = out.replace(/android:allowBackup="[^"]*"/, 'android:allowBackup="false"');
  return out;
}

export function patchVariables(gradle) {
  // Android 8.0 (API 26) and newer.
  return gradle.replace(/minSdkVersion\s*=\s*\d+/, "minSdkVersion = 26");
}

const SIGNING_BLOCK = `
    signingConfigs {
        release {
            // Provided by CI (GitHub secrets) or a local keystore.properties; never committed.
            def keystorePath = System.getenv("NOVA_KEYSTORE_PATH")
            if (keystorePath) {
                storeFile file(keystorePath)
                storePassword System.getenv("NOVA_KEYSTORE_PASSWORD")
                keyAlias System.getenv("NOVA_KEY_ALIAS")
                keyPassword System.getenv("NOVA_KEY_PASSWORD")
            }
        }
    }
`;

export function patchAppGradle(gradle, version) {
  let out = gradle;
  if (version) {
    out = out.replace(/versionName\s+"[^"]*"/, `versionName "${version.name}"`).replace(/versionCode\s+\d+/, `versionCode ${version.code}`);
  }
  if (!out.includes("NOVA_KEYSTORE_PATH")) out = out.replace(/(android\s*\{)/, `$1${SIGNING_BLOCK}`);
  if (!/release\s*\{[^}]*signingConfig/.test(out)) {
    out = out.replace(/(buildTypes\s*\{\s*release\s*\{)/, `$1\n            if (System.getenv("NOVA_KEYSTORE_PATH")) signingConfig signingConfigs.release`);
  }
  return out;
}

/** 1.5.0 → 10500, 1.5.12 → 10512 (monotonic for semver without huge minors). */
export function versionCode(semver) {
  const [major = 0, minor = 0, patch = 0] = semver.split("-")[0].split(".").map((n) => Number.parseInt(n, 10) || 0);
  return major * 10000 + minor * 100 + patch;
}

export function patchStyles(xml) {
  // Navigation bar matches the app surface.
  if (xml.includes("android:navigationBarColor")) return xml;
  return xml.replace(/(<style name="AppTheme\.NoActionBar"[^>]*>)/, '$1\n        <item name="android:navigationBarColor">@android:color/black</item>');
}
