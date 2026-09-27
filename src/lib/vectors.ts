/** Vector arithmetic for search by meaning (D73): pure, so it is tested alone. */

/** How alike two vectors point, from -1 to 1 (1: the same direction). Zero when either is empty or of another length. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa === 0 || bb === 0 ? 0 : dot / Math.sqrt(aa * bb);
}

/** A vector as pgvector reads it: `[0.1,0.2]`. Only finite numbers are taken. */
export function vectorLiteral(vector: number[]): string {
  if (vector.length === 0 || !vector.every(Number.isFinite)) throw new Error("A vector needs finite numbers.");
  return `[${vector.join(",")}]`;
}
