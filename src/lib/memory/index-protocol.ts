import type { BenchmarkResult } from "./benchmark";
import type { IndexEntry, SearchHit, SearchQuery } from "./memory-index";

export type IndexRequest =
  | { id: number; type: "reset"; entries: IndexEntry[] }
  | { id: number; type: "upsert"; entries: IndexEntry[] }
  | { id: number; type: "remove"; ids: string[] }
  | { id: number; type: "search"; query: SearchQuery }
  | { id: number; type: "size" }
  | { id: number; type: "benchmark"; count: number; dims: number };

export type IndexResponse =
  | { id: number; ok: true; hits?: SearchHit[]; size?: number; benchmark?: BenchmarkResult }
  | { id: number; ok: false; error: string };
