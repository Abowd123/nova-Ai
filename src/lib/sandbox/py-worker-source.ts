/**
 * Pyodide worker (classic worker, plain JS). Loaded from /sandbox/py?index=<pyodide url>
 * with a CSP that only allows the Pyodide CDN origin. The interpreter is kept between runs
 * (loading takes seconds); the host terminates the worker on timeout/cancel.
 *
 * host → worker: { type: "init", indexUrl } | { type: "run", id, code, files: [{name, data}], maxOutputChars }
 * worker → host: { type: "progress", stage, detail } | { type: "ready" } | { type: "stream", id, stream, text }
 *               | { type: "done", id, value?, error?, files: [{name, data}], truncated } | { type: "fatal", message }
 */
export const PY_WORKER_SOURCE = String.raw`"use strict";
var pyodide = null;
var loading = null;
var INPUT = "/home/pyodide/input";
var OUTPUT = "/home/pyodide/output";

function load(indexUrl) {
  if (loading) return loading;
  postMessage({ type: "progress", stage: "loading" });
  loading = (async function () {
    importScripts(indexUrl + "pyodide.js");
    pyodide = await loadPyodide({ indexURL: indexUrl });
    postMessage({ type: "ready" });
    return pyodide;
  })();
  loading.catch(function (e) { postMessage({ type: "fatal", message: String(e && e.message || e) }); loading = null; });
  return loading;
}

function ensureDir(path) {
  try { pyodide.FS.mkdirTree(path); } catch (e) {}
}

function clearDir(path) {
  try {
    pyodide.FS.readdir(path).forEach(function (name) {
      if (name === "." || name === "..") return;
      var full = path + "/" + name;
      var stat = pyodide.FS.stat(full);
      if (pyodide.FS.isDir(stat.mode)) { clearDir(full); pyodide.FS.rmdir(full); } else pyodide.FS.unlink(full);
    });
  } catch (e) {}
}

function collect(path, prefix, out) {
  var names = [];
  try { names = pyodide.FS.readdir(path); } catch (e) { return out; }
  names.forEach(function (name) {
    if (name === "." || name === "..") return;
    var full = path + "/" + name;
    var stat = pyodide.FS.stat(full);
    if (pyodide.FS.isDir(stat.mode)) collect(full, prefix + name + "/", out);
    else if (out.length < 20 && stat.size <= 25 * 1024 * 1024) out.push({ name: prefix + name, data: pyodide.FS.readFile(full) });
  });
  return out;
}

self.onmessage = async function (event) {
  var msg = event.data || {};
  if (msg.type === "init") { load(msg.indexUrl); return; }
  if (msg.type !== "run") return;
  var id = msg.id;
  var budget = Math.max(1000, msg.maxOutputChars | 0);
  var used = 0;
  var truncated = false;
  function push(stream, text) {
    if (truncated) return;
    if (used + text.length > budget) { text = text.slice(0, Math.max(0, budget - used)); truncated = true; }
    used += text.length;
    postMessage({ type: "stream", id: id, stream: stream, text: text });
  }
  try {
    var py = await load(msg.indexUrl);
    py.setStdout({ batched: function (s) { push("stdout", s + "\n"); } });
    py.setStderr({ batched: function (s) { push("stderr", s + "\n"); } });
    ensureDir(INPUT); ensureDir(OUTPUT); clearDir(INPUT); clearDir(OUTPUT);
    (msg.files || []).forEach(function (f) { py.FS.writeFile(INPUT + "/" + f.name.replace(/[\/\\]/g, "_"), f.data); });
    postMessage({ type: "progress", stage: "packages" });
    await py.loadPackagesFromImports(msg.code, { messageCallback: function (m) { postMessage({ type: "progress", stage: "packages", detail: String(m) }); }, errorCallback: function (m) { push("stderr", String(m) + "\n"); } });
    postMessage({ type: "progress", stage: "running" });
    py.runPython("import os\nos.chdir('/home/pyodide')");
    var result = await py.runPythonAsync(msg.code, { filename: "<nova>" });
    var value;
    if (result !== undefined && result !== null) {
      try { value = py.globals.get("repr")(result); } catch (e) { value = String(result); }
      if (result && typeof result.destroy === "function") result.destroy();
    }
    var files = collect(OUTPUT, "", []);
    postMessage({ type: "done", id: id, value: value === undefined ? undefined : String(value).slice(0, budget), files: files, truncated: truncated }, files.map(function (f) { return f.data.buffer; }));
  } catch (error) {
    var text = String(error && error.message || error);
    var match = /(\w+(?:Error|Exception|Interrupt|Exit))\s*:\s*([\s\S]*?)\s*$/.exec(text.trim().split("\n").slice(-3).join("\n"));
    var files = [];
    try { files = collect(OUTPUT, "", []); } catch (e) {}
    postMessage({ type: "done", id: id, error: { type: match ? match[1] : (error && error.type) || "Error", message: (match ? match[2] : text).slice(0, 4000), traceback: text.slice(-8000) }, files: files, truncated: truncated });
  }
};
`;

/** CSP for the Python worker: scripts and wasm only from the Pyodide origin. */
export function pythonCsp(indexUrl: string): string {
  const origin = new URL(indexUrl).origin;
  return [
    "default-src 'none'",
    `script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' ${origin}`,
    `connect-src ${origin}`,
    "worker-src 'none'",
  ].join("; ");
}

/** Only https Pyodide distributions (or same-origin paths) are accepted. */
export function validPyodideUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1"))) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url.toString().endsWith("/") ? url.toString() : `${url.toString()}/`;
  } catch {
    return null;
  }
}
