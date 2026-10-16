#!/usr/bin/env node
/** Applies Nova's Android settings to android/ (run after `npx cap add android`). Idempotent. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { patchAppGradle, patchManifest, patchStyles, patchVariables, versionCode } from "./android-patches.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const android = join(root, "android");
if (!existsSync(android)) {
  console.error("android/ not found: run `npx cap add android` first");
  process.exit(1);
}
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

function edit(rel, fn) {
  const path = join(android, rel);
  if (!existsSync(path)) {
    console.warn(`[patch-android] skipped ${rel} (not found)`);
    return;
  }
  const before = readFileSync(path, "utf8");
  const after = fn(before);
  if (after !== before) writeFileSync(path, after);
  console.log(`[patch-android] ${after === before ? "unchanged" : "patched"} ${rel}`);
}

edit("app/src/main/AndroidManifest.xml", (xml) => patchManifest(xml, { cleartext: process.env.NOVA_ANDROID_CLEARTEXT === "1" }));
edit("variables.gradle", patchVariables);
edit("app/build.gradle", (g) => patchAppGradle(g, { name: pkg.version, code: versionCode(pkg.version) }));
edit("app/src/main/res/values/styles.xml", patchStyles);

// Monochrome status-bar icon for local notifications.
import { copyFileSync, mkdirSync } from "node:fs";
const icon = join(root, "resources/android/ic_stat_nova.png");
if (existsSync(icon)) {
  const target = join(android, "app/src/main/res/drawable");
  mkdirSync(target, { recursive: true });
  copyFileSync(icon, join(target, "ic_stat_nova.png"));
  console.log("[patch-android] copied ic_stat_nova.png");
}
