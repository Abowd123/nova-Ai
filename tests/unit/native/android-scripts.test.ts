// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEEP_LINK_SCHEME, patchAppGradle, patchManifest, patchVariables, versionCode } from "../../../scripts/android-patches.mjs";
import { changelogSection } from "../../../scripts/release-notes-lib.mjs";

const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application
        android:allowBackup="true"
        android:label="@string/app_name">
        <activity
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode"
            android:name=".MainActivity"
            android:launchMode="singleTask">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
    <uses-permission android:name="android.permission.INTERNET" />
</manifest>
`;

const GRADLE = `android {
    namespace "app.nova.assistant"
    defaultConfig {
        versionCode 1
        versionName "1.0"
    }
    buildTypes {
        release {
            minifyEnabled false
        }
    }
}`;

describe("Android project patches", () => {
  it("adds permissions, the OAuth deep link, rotation and safe defaults (idempotent)", () => {
    const once = patchManifest(MANIFEST);
    const twice = patchManifest(once);
    expect(twice).toBe(once);
    for (const p of ["RECORD_AUDIO", "CAMERA", "POST_NOTIFICATIONS", "ACCESS_NETWORK_STATE"]) expect(once).toContain(`android.permission.${p}`);
    expect(once.match(/android.permission.INTERNET/g)).toHaveLength(1);
    expect(once).toContain(`android:scheme="${DEEP_LINK_SCHEME}" android:host="oauth"`);
    expect(once).toContain('android:allowBackup="false"');
    expect(once).toContain('android:usesCleartextTraffic="false"');
    expect(once).toContain('android:windowSoftInputMode="adjustResize"');
    expect(patchManifest(MANIFEST, { cleartext: true })).toContain('android:usesCleartextTraffic="true"');
    expect(once.trim().endsWith("</manifest>")).toBe(true);
  });

  it("sets min SDK 26, version and env-based signing without secrets in files", () => {
    expect(patchVariables("ext {\n    minSdkVersion = 23\n}")).toContain("minSdkVersion = 26");
    const gradle = patchAppGradle(GRADLE, { name: "1.5.0", code: versionCode("1.5.0") });
    expect(gradle).toContain('versionName "1.5.0"');
    expect(gradle).toContain("versionCode 10500");
    expect(gradle).toContain('System.getenv("NOVA_KEYSTORE_PASSWORD")');
    expect(gradle).toContain("signingConfig signingConfigs.release");
    expect(patchAppGradle(gradle, { name: "1.5.0", code: 10500 })).toBe(gradle);
    expect(versionCode("1.5.12-beta.1")).toBe(10512);
  });

  it("extracts release notes from the changelog", () => {
    const md = "# Changelog\n\n## 1.5.0 — Android\n\n- APK\n\n## 1.4.2 — x\n\n- y\n";
    expect(changelogSection(md, "1.5.0")).toBe("- APK");
    expect(changelogSection(md, "9.9.9")).toBe("");
  });
});
