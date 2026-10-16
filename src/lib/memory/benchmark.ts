import { MemoryIndex, type IndexEntry } from "./memory-index";

export interface BenchmarkResult {
  entries: number;
  dims: number;
  buildMs: number;
  /** Median of the search runs (hybrid: cosine + BM25). */
  searchMs: number;
  runs: number;
}

/** Deterministic PRNG (mulberry32) so results are comparable between runs. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ["memory", "project", "nova", "assistant", "ذاكرة", "مشروع", "مساعد", "travel", "budget", "سفر", "ميزانية", "recipe", "code", "كود", "meeting", "اجتماع"];

export function syntheticEntries(count: number, dims: number, seed = 42): IndexEntry[] {
  const random = prng(seed);
  return Array.from({ length: count }, (_, i) => {
    const vector = new Float32Array(dims);
    for (let d = 0; d < dims; d += 1) vector[d] = random() * 2 - 1;
    const text = Array.from({ length: 30 }, () => WORDS[Math.floor(random() * WORDS.length)]).join(" ");
    return { id: `b${i}`, text, scope: "global", assistantId: null, conversationId: null, sourceMessageId: null, createdAt: i, vector };
  });
}

/** Builds an index of `count` synthetic memories and times hybrid searches. */
export function runBenchmark(options: { count?: number; dims?: number; runs?: number; now?: () => number } = {}): BenchmarkResult {
  const count = options.count ?? 10_000;
  const dims = options.dims ?? 768;
  const runs = Math.max(1, options.runs ?? 5);
  const now = options.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const entries = syntheticEntries(count, dims);
  const index = new MemoryIndex();
  const start = now();
  index.upsert(entries);
  const buildMs = now() - start;
  const query = syntheticEntries(1, dims, 7)[0]!;
  const times: number[] = [];
  for (let r = 0; r < runs; r += 1) {
    const t0 = now();
    index.search({ text: query.text, vector: query.vector, topK: 10, threshold: 0, semanticWeight: 0.7, filter: { mode: "all" } });
    times.push(now() - t0);
  }
  times.sort((a, b) => a - b);
  return { entries: count, dims, buildMs, searchMs: times[Math.floor(times.length / 2)]!, runs };
}
