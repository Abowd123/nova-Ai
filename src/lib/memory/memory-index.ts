import type { MemoryChunkScope } from "@/lib/models";
import { tokenize } from "./text";
import { dot, normalize } from "./vector-math";

export interface IndexEntry {
  id: string;
  text: string;
  scope: MemoryChunkScope;
  assistantId: string | null;
  conversationId: string | null;
  sourceMessageId: string | null;
  createdAt: number;
  /** Embedding for the CURRENT model, or null (keyword search only). */
  vector: Float32Array | null;
}

export type ScopeFilter =
  | { mode: "all" }
  | { mode: "global" | "assistant" | "conversation"; assistantId: string | null; conversationId: string | null };

export interface SearchQuery {
  text: string;
  /** Query embedding; null = keyword fallback. */
  vector: Float32Array | null;
  topK: number;
  /** Minimum cosine similarity for semantic hits. */
  threshold: number;
  /** 0..1 share of the semantic score in hybrid ranking. */
  semanticWeight: number;
  filter: ScopeFilter;
  /** Messages already in the request window (don't retrieve what the model can already see). */
  excludeMessageIds?: readonly string[];
}

export interface SearchHit {
  id: string;
  score: number;
  semantic: number | null;
  lexical: number;
}

interface Stored {
  entry: IndexEntry;
  terms: Map<string, number>;
  length: number;
  unit: Float32Array | null;
}

const K1 = 1.2;
const B = 0.75;

export function visible(entry: Pick<IndexEntry, "scope" | "assistantId" | "conversationId">, filter: ScopeFilter): boolean {
  if (filter.mode === "all") return true;
  if (filter.mode === "conversation") return entry.conversationId !== null && entry.conversationId === filter.conversationId;
  if (filter.mode === "assistant") {
    if (entry.assistantId !== filter.assistantId) return false;
    return entry.scope !== "conversation" || entry.conversationId === filter.conversationId;
  }
  // global: shared memories + this assistant's + this conversation's
  if (entry.scope === "global") return true;
  if (entry.scope === "assistant") return filter.assistantId !== null && entry.assistantId === filter.assistantId;
  return entry.conversationId !== null && entry.conversationId === filter.conversationId;
}

/**
 * In-memory hybrid index: cosine similarity over unit vectors + BM25 over normalized,
 * lightly stemmed Arabic/English tokens (inverted index). Runs inside a Web Worker in the
 * app; pure and synchronous so it is unit-testable and benchmarkable in Node.
 */
export class MemoryIndex {
  private readonly items = new Map<string, Stored>();
  private readonly postings = new Map<string, Map<string, number>>();
  private totalLength = 0;
  dims = 0;

  get size(): number {
    return this.items.size;
  }

  clear(): void {
    this.items.clear();
    this.postings.clear();
    this.totalLength = 0;
    this.dims = 0;
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  upsert(entries: readonly IndexEntry[]): void {
    for (const entry of entries) {
      this.remove([entry.id]);
      const terms = new Map<string, number>();
      const tokens = tokenize(entry.text);
      for (const token of tokens) terms.set(token, (terms.get(token) ?? 0) + 1);
      for (const [term, tf] of terms) {
        let posting = this.postings.get(term);
        if (!posting) this.postings.set(term, (posting = new Map()));
        posting.set(entry.id, tf);
      }
      const unit = entry.vector && entry.vector.length ? normalize(entry.vector) : null;
      if (unit) this.dims = unit.length;
      this.items.set(entry.id, { entry: { ...entry, vector: null }, terms, length: tokens.length, unit });
      this.totalLength += tokens.length;
    }
  }

  remove(ids: readonly string[]): void {
    for (const id of ids) {
      const stored = this.items.get(id);
      if (!stored) continue;
      for (const term of stored.terms.keys()) {
        const posting = this.postings.get(term);
        posting?.delete(id);
        if (posting && posting.size === 0) this.postings.delete(term);
      }
      this.totalLength -= stored.length;
      this.items.delete(id);
    }
  }

  private bm25(queryTerms: string[], allowed: (s: Stored) => boolean): Map<string, number> {
    const scores = new Map<string, number>();
    const n = this.items.size || 1;
    const avg = this.totalLength / n || 1;
    for (const term of new Set(queryTerms)) {
      const posting = this.postings.get(term);
      if (!posting) continue;
      const idf = Math.log(1 + (n - posting.size + 0.5) / (posting.size + 0.5));
      for (const [id, tf] of posting) {
        const stored = this.items.get(id)!;
        if (!allowed(stored)) continue;
        const score = idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * stored.length) / avg)));
        scores.set(id, (scores.get(id) ?? 0) + score);
      }
    }
    return scores;
  }

  search(query: SearchQuery): SearchHit[] {
    const excluded = new Set(query.excludeMessageIds ?? []);
    const allowed = (s: Stored) => visible(s.entry, query.filter) && !(s.entry.sourceMessageId && excluded.has(s.entry.sourceMessageId));
    const lexicalRaw = this.bm25(tokenize(query.text), allowed);
    let maxLexical = 0;
    for (const value of lexicalRaw.values()) maxLexical = Math.max(maxLexical, value);
    const lexicalOf = (id: string) => (maxLexical > 0 ? (lexicalRaw.get(id) ?? 0) / maxLexical : 0);

    const hits: SearchHit[] = [];
    const unitQuery = query.vector && query.vector.length ? normalize(query.vector) : null;
    const weight = Math.min(1, Math.max(0, query.semanticWeight));

    if (unitQuery) {
      for (const [id, stored] of this.items) {
        if (!allowed(stored)) continue;
        const lexical = lexicalOf(id);
        if (stored.unit && stored.unit.length === unitQuery.length) {
          const semantic = dot(stored.unit, unitQuery);
          if (semantic < query.threshold) continue;
          hits.push({ id, semantic, lexical, score: weight * semantic + (1 - weight) * lexical });
        } else if (lexical >= 0.3) {
          // Not embedded yet (or another model): keyword evidence only, ranked below semantic matches.
          hits.push({ id, semantic: null, lexical, score: (1 - weight) * lexical + weight * query.threshold * lexical });
        }
      }
    } else {
      for (const [id] of lexicalRaw) {
        const lexical = lexicalOf(id);
        if (lexical >= 0.15) hits.push({ id, semantic: null, lexical, score: lexical });
      }
    }

    hits.sort((a, b) => b.score - a.score || this.items.get(b.id)!.entry.createdAt - this.items.get(a.id)!.entry.createdAt);
    return hits.slice(0, Math.max(1, query.topK));
  }
}
