#!/usr/bin/env node
/** Prints JS bundle and APK sizes (Markdown) for the CI job summary; fails over budget. */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.cwd());
const BUDGET_JS_KB = Number(process.env.NOVA_JS_BUDGET_KB ?? 3500);
const BUDGET_APK_MB = Number(process.env.NOVA_APK_BUDGET_MB ?? 40);

function walk(dir, filter, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, filter, out);
    else if (filter(path)) out.push({ path, size: stat.size });
  }
  return out;
}

const chunks = walk(join(root, ".next/static/chunks"), (p) => p.endsWith(".js")).concat(walk(join(root, "out/_next/static/chunks"), (p) => p.endsWith(".js")));
const jsTotal = chunks.reduce((n, c) => n + c.size, 0);
const apks = walk(join(root, "android/app/build/outputs/apk"), (p) => p.endsWith(".apk"));
const kb = (b) => (b / 1024).toFixed(1);
const mb = (b) => (b / 1048576).toFixed(2);

const lines = ["## Size report", "", "| Artifact | Size |", "| --- | --- |", `| JS chunks (${chunks.length}) | ${kb(jsTotal)} KB |`];
for (const c of chunks.sort((a, b) => b.size - a.size).slice(0, 5)) lines.push(`| ↳ ${c.path.split("/chunks/")[1]} | ${kb(c.size)} KB |`);
for (const apk of apks) lines.push(`| ${apk.path.split("/apk/")[1]} | ${mb(apk.size)} MB |`);
console.log(lines.join("\n"));

let failed = false;
if (chunks.length && jsTotal / 1024 > BUDGET_JS_KB) {
  console.error(`JS budget exceeded: ${kb(jsTotal)} KB > ${BUDGET_JS_KB} KB`);
  failed = true;
}
for (const apk of apks) {
  if (apk.size / 1048576 > BUDGET_APK_MB) {
    console.error(`APK budget exceeded: ${mb(apk.size)} MB > ${BUDGET_APK_MB} MB`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
