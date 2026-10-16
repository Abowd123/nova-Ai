/** A file placed in / returned from the Python sandbox (virtual filesystem). */
export interface PythonFile {
  name: string;
  mimeType: string;
  data: Uint8Array;
}

export interface PythonRunOptions {
  timeoutMs: number;
  maxOutputChars: number;
  /** Written to /home/pyodide/input before running. */
  files?: PythonFile[];
  signal?: AbortSignal;
  onOutput?: (stream: "stdout" | "stderr", text: string) => void;
  onProgress?: (stage: "loading" | "packages" | "running", detail?: string) => void;
}

export interface PythonRunResult {
  stdout: string;
  stderr: string;
  /** repr() of the last expression, if any. */
  value?: string;
  error?: { type: string; message: string };
  /** Files the code wrote to /home/pyodide/output. */
  files: PythonFile[];
  truncated: boolean;
  timedOut: boolean;
  cancelled: boolean;
  durationMs: number;
}

/**
 * Pluggable Python runtime. 1.4 ships Pyodide (WebAssembly in a Worker); a native
 * Linux/PRoot runtime on Android can implement the same interface later.
 */
export interface PythonProvider {
  readonly id: string;
  isAvailable(): boolean;
  run(code: string, options: PythonRunOptions): Promise<PythonRunResult>;
  /** Drops the interpreter (frees memory; next run starts fresh). */
  reset(): void;
}

export const PY_INPUT_DIR = "/home/pyodide/input";
export const PY_OUTPUT_DIR = "/home/pyodide/output";

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  html: "text/html",
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export function mimeForFile(name: string): string {
  return MIME[name.toLowerCase().split(".").pop() ?? ""] ?? "application/octet-stream";
}

export function formatPythonResult(result: PythonRunResult): string {
  const lines: string[] = [];
  if (result.stdout.trim()) lines.push("stdout:", result.stdout.trimEnd());
  if (result.stderr.trim()) lines.push("stderr:", result.stderr.trimEnd());
  if (result.truncated) lines.push("[output truncated]");
  if (result.error) lines.push(`${result.error.type}: ${result.error.message}`);
  else if (result.value !== undefined) lines.push(`Result: ${result.value}`);
  if (result.files.length) lines.push(`Output files: ${result.files.map((f) => `${f.name} (${f.data.byteLength} bytes)`).join(", ")}`);
  if (!lines.length) lines.push("(no output)");
  return lines.join("\n");
}
