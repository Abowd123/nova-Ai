import type { HttpClient } from "@/lib/ai/types";
import { DEFAULT_TOOL_SETTINGS, type Assistant, type ToolSettings } from "@/lib/models";
import { formatJsResult, type JsSandbox } from "@/lib/sandbox/js-sandbox";
import { formatPythonResult, type PythonFile, type PythonProvider } from "@/lib/sandbox/python-types";
import type { Tool, ToolOutputFile, ToolResult } from "@/lib/tools/types";
import { fetchUrlViaServer, formatPage } from "@/lib/web/fetch-client";
import {
  BraveSearch,
  ExaSearch,
  SearchError,
  SearxngSearch,
  TavilySearch,
  formatSearchResults,
  rankResults,
  type SearchProvider,
} from "@/lib/web/search";
import type { ServiceKeys } from "./service-keys";
import type { SubagentService } from "./subagent-service";

export const BUILTIN_TOOL_NAMES = ["search_memory", "web_search", "fetch_url", "run_javascript", "run_python", "delegate_task"] as const;
export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number];

export interface BuiltinToolDeps {
  settings: () => Promise<ToolSettings>;
  getAssistant: (id: string) => Promise<Assistant | undefined>;
  memory: {
    retrieve(input: { query: string; assistant: Assistant | null; conversationId: string; excludeMessageIds: readonly string[]; signal?: AbortSignal }): Promise<{
      hits: { chunk: { id: string; text: string; createdAt?: number }; score: number }[];
      retrieval: "semantic" | "text" | "none";
    }>;
  };
  js: JsSandbox;
  python: PythonProvider;
  keys: ServiceKeys;
  /** HTTP for search APIs (proxy: most have no CORS). */
  searchHttp: HttpClient;
  subagent: SubagentService;
  /** Stores a file produced by a tool as an attachment of the conversation. */
  saveFile: (conversationId: string, file: PythonFile) => Promise<string | undefined>;
  fetch?: typeof fetch;
}

const stringProp = (description: string, extra: Record<string, unknown> = {}) => ({ type: "string" as const, description, ...extra });

export function searchProviderFor(settings: ToolSettings, deps: Pick<BuiltinToolDeps, "keys" | "searchHttp">): SearchProvider | null {
  switch (settings.search.provider) {
    case "tavily":
      return new TavilySearch(deps.searchHttp, () => deps.keys.get("tavily"));
    case "brave":
      return new BraveSearch(deps.searchHttp, () => deps.keys.get("brave"));
    case "exa":
      return new ExaSearch(deps.searchHttp, () => deps.keys.get("exa"));
    case "searxng":
      return new SearxngSearch(deps.searchHttp, () => settings.search.searxngUrl);
    default:
      return null;
  }
}

/** The six built-in tools. Descriptions are written for the model (English works best). */
export function createBuiltinTools(deps: BuiltinToolDeps): Tool[] {
  const settings = async () => (await deps.settings()) ?? DEFAULT_TOOL_SETTINGS;

  const searchMemory: Tool = {
    name: "search_memory",
    description:
      "Search the user's long-term memory (facts and notes from earlier conversations stored on this device). Use it when the user refers to something said before, their preferences, or personal details.",
    inputSchema: {
      type: "object",
      properties: { query: stringProp("What to look for, in natural language.", { minLength: 1, maxLength: 1000 }), limit: { type: "integer", minimum: 1, maximum: 20, description: "Max results (default 5)." } },
      required: ["query"],
    },
    permission: "auto",
    dangerous: false,
    source: "builtin",
    async execute(args, context): Promise<ToolResult> {
      const assistant = context.assistantId ? ((await deps.getAssistant(context.assistantId)) ?? null) : null;
      const found = await deps.memory.retrieve({ query: String(args.query), assistant, conversationId: context.conversationId, excludeMessageIds: [], signal: context.signal });
      const limit = typeof args.limit === "number" ? args.limit : 5;
      const hits = found.hits.slice(0, limit);
      if (!hits.length) return { content: `No memories found for "${String(args.query)}".`, display: { kind: "text" } };
      return {
        content: hits.map((h, i) => `${i + 1}. (relevance ${h.score.toFixed(2)}) ${h.chunk.text.replace(/\s+/g, " ").slice(0, 1200)}`).join("\n"),
        display: { kind: "text", value: `${hits.length} (${found.retrieval})` },
      };
    },
  };

  const webSearch: Tool = {
    name: "web_search",
    description:
      "Search the web for current information. Returns numbered results (title, URL, snippet). Cite them inline as [n]. Use fetch_url to read a result in full when snippets are not enough.",
    inputSchema: {
      type: "object",
      properties: {
        query: stringProp("Search query (keywords, any language).", { minLength: 1, maxLength: 400 }),
        count: { type: "integer", minimum: 1, maximum: 20, description: "Number of results." },
        language: stringProp("Result language code, e.g. ar or en (optional)."),
        region: stringProp("Country code, e.g. sa, ye, us (optional)."),
      },
      required: ["query"],
    },
    permission: "auto",
    dangerous: false,
    source: "builtin",
    async execute(args, context): Promise<ToolResult> {
      const config = await settings();
      const provider = searchProviderFor(config, deps);
      if (!provider) return { content: "Error: web search is not configured. Ask the user to choose a search provider in Settings → Tools.", isError: true };
      const count = typeof args.count === "number" ? args.count : config.search.count;
      const query = String(args.query);
      try {
        const raw = await provider.search({
          query,
          count: Math.min(20, count + 3),
          language: typeof args.language === "string" && args.language ? args.language : config.search.language || undefined,
          region: typeof args.region === "string" && args.region ? args.region : config.search.region || undefined,
          excludeSites: config.search.excludeSites,
          signal: context.signal,
        });
        const results = rankResults(raw, query, { count, excludeSites: config.search.excludeSites, blockedSites: config.search.blockedSites });
        return {
          content: formatSearchResults(query, results),
          display: { kind: "search", citations: results.map((r, i) => ({ index: i + 1, title: r.title, url: r.url, snippet: r.snippet.slice(0, 300) })) },
        };
      } catch (error) {
        if (error instanceof SearchError && error.code !== "aborted") return { content: `Error: ${error.message}`, isError: true };
        throw error;
      }
    },
  };

  const fetchUrl: Tool = {
    name: "fetch_url",
    description: "Download a public web page and return its readable text (navigation, ads and scripts removed). Use it to read search results or links the user shared.",
    inputSchema: {
      type: "object",
      properties: { url: stringProp("Absolute http(s) URL.", { minLength: 8, maxLength: 4000 }), focus: stringProp("What you need from the page (used to summarize very long pages; optional).") },
      required: ["url"],
    },
    permission: "auto",
    dangerous: false,
    source: "builtin",
    async execute(args, context): Promise<ToolResult> {
      const config = await settings();
      const page = await fetchUrlViaServer(String(args.url), { maxChars: config.search.maxContentChars, blockedSites: config.search.blockedSites, signal: context.signal, fetch: deps.fetch });
      let content = formatPage(page);
      if (config.search.summarizeResults && page.text.length > 4000) {
        context.onProgress?.("summarizing");
        const summary = await deps.subagent
          .summarize({ text: page.text, focus: typeof args.focus === "string" && args.focus ? args.focus : "General overview", conversationId: context.conversationId, signal: context.signal })
          .catch(() => "");
        if (summary) content = `Title: ${page.title}\nURL: ${page.url}\n\nSummary (by a helper model):\n${summary}`;
      }
      return { content, display: { kind: "page", citations: [{ index: 1, title: page.title, url: page.url, snippet: (page.excerpt ?? page.text).slice(0, 300) }] } };
    },
  };

  const runJavascript: Tool = {
    name: "run_javascript",
    description:
      "Run JavaScript in an isolated sandbox (Web Worker, no DOM, no network, no files). console.log output and the value of the last expression are returned. Top-level await works. Use it for calculations, data processing and checking code.",
    inputSchema: { type: "object", properties: { code: stringProp("JavaScript source.", { minLength: 1, maxLength: 100_000 }) }, required: ["code"] },
    permission: "ask",
    dangerous: false,
    source: "builtin",
    async execute(args, context): Promise<ToolResult> {
      const config = await settings();
      const result = await deps.js.run(String(args.code), {
        timeoutMs: config.js.timeoutMs,
        allowNetwork: config.js.allowNetwork,
        maxOutputChars: config.js.maxOutputChars,
        memoryLimitMb: config.js.memoryLimitMb,
        signal: context.signal,
      });
      if (result.cancelled) throw Object.assign(new Error("cancelled"), { name: "AbortError" });
      return {
        content: formatJsResult(result),
        isError: Boolean(result.error),
        display: {
          kind: "code",
          stdout: result.logs.filter((l) => l.level !== "error" && l.level !== "warn").map((l) => l.text).join("\n"),
          stderr: [...result.logs.filter((l) => l.level === "error" || l.level === "warn").map((l) => l.text), ...(result.error ? [`${result.error.name}: ${result.error.message}`] : [])].join("\n"),
          value: result.value,
        },
      };
    },
  };

  const runPython: Tool = {
    name: "run_python",
    description:
      "Run Python 3 (Pyodide, WebAssembly) in an isolated sandbox. Standard library plus numpy, pandas, matplotlib, scipy, sympy etc. load automatically from imports. print() output and the last expression are returned. Save files to /home/pyodide/output to give them to the user (e.g. plt.savefig('/home/pyodide/output/chart.png')). No network.",
    inputSchema: { type: "object", properties: { code: stringProp("Python source.", { minLength: 1, maxLength: 100_000 }) }, required: ["code"] },
    permission: "ask",
    dangerous: false,
    source: "builtin",
    async execute(args, context): Promise<ToolResult> {
      const config = await settings();
      if (!config.python.enabled) return { content: "Error: Python is disabled in Settings → Tools.", isError: true };
      const result = await deps.python.run(String(args.code), {
        timeoutMs: config.python.timeoutMs,
        maxOutputChars: config.python.maxOutputChars,
        signal: context.signal,
        onProgress: (stage) => context.onProgress?.(stage),
      });
      if (result.cancelled) throw Object.assign(new Error("cancelled"), { name: "AbortError" });
      const files: ToolOutputFile[] = [];
      for (const file of result.files) {
        const attachmentId = await deps.saveFile(context.conversationId, file).catch(() => undefined);
        files.push({ name: file.name, mimeType: file.mimeType, size: file.data.byteLength, attachmentId });
      }
      return {
        content: formatPythonResult(result),
        isError: Boolean(result.error),
        display: {
          kind: "code",
          stdout: result.stdout,
          stderr: [result.stderr, result.error ? `${result.error.type}: ${result.error.message}` : ""].filter(Boolean).join("\n"),
          value: result.value,
          ...(files.length ? { files } : {}),
        },
      };
    },
  };

  const delegateTask: Tool = {
    name: "delegate_task",
    description:
      "Delegate a self-contained sub-task (research, reading several pages, long extraction or summarization) to a cheaper helper model with its own context. It can use search_memory, web_search and fetch_url. Give the task and all context it needs; you receive its final report.",
    inputSchema: {
      type: "object",
      properties: { task: stringProp("Precise instructions and the expected output.", { minLength: 1, maxLength: 8000 }), context: stringProp("Facts or text the helper needs (optional).", { maxLength: 60_000 }) },
      required: ["task"],
    },
    permission: "auto",
    dangerous: false,
    source: "builtin",
    async execute(args, context): Promise<ToolResult> {
      const result = await deps.subagent.run({
        task: String(args.task),
        context: typeof args.context === "string" ? args.context : undefined,
        conversationId: context.conversationId,
        signal: context.signal,
        onProgress: context.onProgress,
      });
      return {
        content: result.text,
        display: { kind: "subagent", value: `${result.modelId} · ${result.steps}`, usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens } },
      };
    },
  };

  return [searchMemory, webSearch, fetchUrl, runJavascript, runPython, delegateTask];
}
