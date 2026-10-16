/**
 * Source of the JavaScript sandbox worker (plain ES2020, no imports). Served by
 * /sandbox/js and /sandbox/js-net with a strict Content-Security-Policy:
 *   - connect-src 'none' (no fetch/XHR/WebSocket/EventSource) unless network is allowed,
 *   - script-src 'self' 'unsafe-eval' (no remote import(), eval only inside this worker).
 * The worker also removes network, storage and messaging globals (defence in depth), runs
 * ONE snippet and is terminated by the host on timeout / cancel (hard interrupt).
 *
 * Protocol (host → worker): { type: "run", nonce, code, allowNetwork, maxOutputChars, memoryLimitMb }
 * (worker → host): { nonce, type: "log", level, text } | { nonce, type: "done", value?, error?, truncated }
 */
export const JS_WORKER_SOURCE = String.raw`"use strict";
(function () {
  var g = self;
  var post = g.postMessage.bind(g);
  var listen = g.addEventListener.bind(g);
  var started = false;

  var NETWORK = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "WebTransport", "RTCPeerConnection", "importScripts", "Worker", "SharedWorker"];
  var LOCAL = ["indexedDB", "caches", "BroadcastChannel", "postMessage", "onmessage", "addEventListener", "removeEventListener", "MessageChannel", "Notification", "FileSystemHandle", "navigator.storage"];

  function block(name) {
    try { Object.defineProperty(g, name, { value: undefined, writable: false, configurable: false }); } catch (e) {}
    var proto = Object.getPrototypeOf(g);
    while (proto) {
      try { if (Object.prototype.hasOwnProperty.call(proto, name)) delete proto[name]; } catch (e) {}
      proto = Object.getPrototypeOf(proto);
    }
  }

  function format(value, depth, seen) {
    depth = depth || 0;
    seen = seen || [];
    var type = typeof value;
    if (value === null) return "null";
    if (type === "undefined") return "undefined";
    if (type === "string") return depth === 0 ? value : JSON.stringify(value);
    if (type === "number" || type === "boolean") return String(value);
    if (type === "bigint") return value.toString() + "n";
    if (type === "symbol") return value.toString();
    if (type === "function") return "[Function " + (value.name || "anonymous") + "]";
    if (value instanceof Error) return (value.stack && String(value.stack).indexOf(value.message) >= 0 ? String(value.stack) : value.name + ": " + value.message);
    if (seen.indexOf(value) >= 0) return "[Circular]";
    if (depth > 4) return Array.isArray(value) ? "[Array]" : "[Object]";
    seen = seen.concat([value]);
    if (value instanceof Date) return isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
    if (value instanceof RegExp) return String(value);
    if (value instanceof Map) {
      var entries = [];
      value.forEach(function (v, k) { entries.push(format(k, depth + 1, seen) + " => " + format(v, depth + 1, seen)); });
      return "Map(" + value.size + ") {" + entries.slice(0, 100).join(", ") + (value.size > 100 ? ", …" : "") + "}";
    }
    if (value instanceof Set) {
      var items = [];
      value.forEach(function (v) { items.push(format(v, depth + 1, seen)); });
      return "Set(" + value.size + ") {" + items.slice(0, 100).join(", ") + (value.size > 100 ? ", …" : "") + "}";
    }
    if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
      var arr = Array.prototype.slice.call(value, 0, 100);
      return value.constructor.name + "(" + value.length + ") [" + arr.join(", ") + (value.length > 100 ? ", …" : "") + "]";
    }
    if (Array.isArray(value)) {
      var parts = value.slice(0, 100).map(function (v) { return format(v, depth + 1, seen); });
      return "[" + parts.join(", ") + (value.length > 100 ? ", … " + (value.length - 100) + " more" : "") + "]";
    }
    if (typeof value.then === "function") return "Promise";
    var keys = Object.keys(value);
    var body = keys.slice(0, 100).map(function (k) { return (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)) + ": " + format(value[k], depth + 1, seen); });
    var name = value.constructor && value.constructor !== Object && value.constructor.name ? value.constructor.name + " " : "";
    return name + "{" + body.join(", ") + (keys.length > 100 ? ", …" : "") + "}";
  }

  function lastExpressionReturn(code) {
    var lines = code.replace(/\s+$/, "").split("\n");
    var last = lines.length - 1;
    while (last >= 0 && (/^\s*$/.test(lines[last]) || /^\s*\/\//.test(lines[last]))) last--;
    if (last < 0) return null;
    var line = lines[last].trim().replace(/;$/, "");
    if (!line || /^(const|let|var|if|for|while|do|switch|try|catch|finally|function|class|return|throw|import|export|async\s+function|break|continue)\b/.test(line)) return null;
    if (/[{}(\[,+\-*/=&|?:]$/.test(line) || /^[}\])]/.test(line)) return null;
    if (last > 0 && /[,(\[+\-*/=&|?:.]\s*$/.test(lines[last - 1])) return null;
    lines[last] = lines[last].replace(line, "return (" + line + ")");
    return lines.join("\n");
  }

  function run(code) {
    if (!/\bawait\b/.test(code)) return (0, eval)(code);
    var AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    var transformed = lastExpressionReturn(code);
    if (transformed) {
      try { return new AsyncFunction(transformed)(); } catch (e) { if (!(e instanceof SyntaxError)) throw e; }
    }
    return new AsyncFunction(code)();
  }

  listen("message", function (event) {
    var msg = event.data || {};
    if (msg.type !== "run" || started) return;
    started = true;
    var nonce = msg.nonce;
    var budget = Math.max(1000, msg.maxOutputChars | 0);
    var used = 0;
    var truncated = false;
    var limitBytes = Math.max(16, msg.memoryLimitMb | 0) * 1024 * 1024;
    function checkMemory() {
      var mem = g.performance && g.performance.memory;
      if (mem && mem.usedJSHeapSize > limitBytes) throw new RangeError("Memory limit exceeded (" + Math.round(mem.usedJSHeapSize / 1048576) + " MB)");
    }
    function emit(level, args) {
      if (truncated) return;
      var text = Array.prototype.map.call(args, function (a) { return format(a); }).join(" ");
      if (used + text.length > budget) { text = text.slice(0, Math.max(0, budget - used)); truncated = true; }
      used += text.length;
      post({ nonce: nonce, type: "log", level: level, text: text });
      checkMemory();
    }
    var fakeConsole = {};
    ["log", "info", "warn", "error", "debug", "trace"].forEach(function (level) {
      fakeConsole[level] = function () { emit(level === "trace" ? "debug" : level, arguments); };
    });
    fakeConsole.table = function (data) { emit("log", [data]); };
    fakeConsole.dir = function (data) { emit("log", [data]); };
    fakeConsole.assert = function (cond) { if (!cond) emit("error", ["Assertion failed"].concat(Array.prototype.slice.call(arguments, 1))); };
    var counts = {};
    fakeConsole.count = function (label) { label = label || "default"; counts[label] = (counts[label] || 0) + 1; emit("log", [label + ": " + counts[label]]); };
    fakeConsole.time = fakeConsole.timeEnd = fakeConsole.group = fakeConsole.groupEnd = fakeConsole.clear = function () {};
    try { Object.defineProperty(g, "console", { value: fakeConsole, writable: false, configurable: false }); } catch (e) { g.console = fakeConsole; }

    listen("unhandledrejection", function (e) { emit("error", ["Unhandled rejection:", e.reason]); });
    if (!msg.allowNetwork) NETWORK.forEach(block);
    LOCAL.forEach(block);

    function finish(payload) {
      payload.nonce = nonce;
      payload.type = "done";
      payload.truncated = truncated;
      post(payload);
    }
    Promise.resolve()
      .then(function () { return run(String(msg.code)); })
      .then(function (value) { checkMemory(); finish(value === undefined ? {} : { value: format(value) .slice(0, budget) }); })
      .catch(function (error) {
        finish({ error: { name: (error && error.name) || "Error", message: error && error.message !== undefined ? String(error.message) : format(error), stack: error && error.stack ? String(error.stack).slice(0, 4000) : undefined } });
      });
  });
})();
`;

/** CSP for the sandbox worker response. */
export function sandboxCsp(allowNetwork: boolean): string {
  return ["default-src 'none'", "script-src 'self' 'unsafe-eval'", allowNetwork ? "connect-src *" : "connect-src 'none'", "worker-src 'none'"].join("; ");
}
