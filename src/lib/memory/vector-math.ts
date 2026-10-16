/** Returns a unit-length copy (cosine similarity becomes a dot product). */
export function normalize(vector: ArrayLike<number>): Float32Array {
  const out = new Float32Array(vector.length);
  let norm = 0;
  for (let i = 0; i < vector.length; i += 1) norm += vector[i]! * vector[i]!;
  norm = Math.sqrt(norm);
  if (norm === 0) return out;
  for (let i = 0; i < vector.length; i += 1) out[i] = vector[i]! / norm;
  return out;
}

export function dot(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  let i = 0;
  // 4-way unrolled: ~2× faster in V8/JSC for 384–3072 dims.
  for (; i + 3 < n; i += 4) sum += a[i]! * b[i]! + a[i + 1]! * b[i + 1]! + a[i + 2]! * b[i + 2]! + a[i + 3]! * b[i + 3]!;
  for (; i < n; i += 1) sum += a[i]! * b[i]!;
  return sum;
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  return dot(normalize(a), normalize(b));
}
