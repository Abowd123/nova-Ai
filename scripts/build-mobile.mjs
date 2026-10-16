#!/usr/bin/env node
/**
 * Static export for the Android app (Capacitor serves ./out from the APK).
 *
 * Server-only parts cannot be exported, so they are moved aside for the build and ALWAYS
 * restored afterwards (even on failure):
 *   src/app/api            → /api/proxy, /api/fetch (native HTTP replaces them in the app)
 *   src/middleware.ts      → per-request CSP nonce (no server in the APK)
 *   src/app/(app)/chat/[id]→ dynamic segment (the app uses /chat/view?id=…)
 *   src/app/sandbox/py     → dynamic CSP route (the app uses /sandbox/py.js)
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stash = join(root, ".mobile-build-stash");
const SERVER_ONLY = ["src/app/api", "src/middleware.ts", "src/app/(app)/chat/[id]", "src/app/sandbox/py"];
const REQUIRED_OUTPUT = ["index.html", "chat/view/index.html", "sandbox/js.js", "sandbox/js-net.js", "sandbox/py.js", "manifest.webmanifest"];

function moveAside() {
  rmSync(stash, { recursive: true, force: true });
  const moved = [];
  for (const rel of SERVER_ONLY) {
    const from = join(root, rel);
    if (!existsSync(from)) continue;
    const to = join(stash, rel);
    mkdirSync(dirname(to), { recursive: true });
    renameSync(from, to);
    moved.push(rel);
  }
  return moved;
}

function restore(moved) {
  for (const rel of moved) {
    const from = join(stash, rel);
    const to = join(root, rel);
    if (existsSync(to)) rmSync(to, { recursive: true, force: true });
    mkdirSync(dirname(to), { recursive: true });
    renameSync(from, to);
  }
  rmSync(stash, { recursive: true, force: true });
}

// A previous run that was killed mid-build: put things back first.
if (existsSync(stash)) {
  console.warn("[build:mobile] restoring files from an interrupted build");
  restore(SERVER_ONLY.filter((rel) => existsSync(join(stash, rel))));
}

const moved = moveAside();
let status = 1;
try {
  const env = {
    ...process.env,
    NOVA_STATIC_EXPORT: "1",
    NEXT_PUBLIC_ENABLE_SW: "never",
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || "https://localhost",
    NEXT_TELEMETRY_DISABLED: "1",
  };
  const result = spawnSync("npx", ["next", "build"], { cwd: root, env, stdio: "inherit", shell: process.platform === "win32" });
  status = result.status ?? 1;
} finally {
  restore(moved);
}
if (status !== 0) process.exit(status);

const missing = REQUIRED_OUTPUT.filter((rel) => {
  const path = join(root, "out", rel);
  return !existsSync(path) || (rel.endsWith(".js") && !statSync(path).isFile());
});
if (missing.length) {
  console.error(`[build:mobile] missing in ./out: ${missing.join(", ")}`);
  process.exit(1);
}
console.log("[build:mobile] static export ready in ./out");
