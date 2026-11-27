import "server-only";

/**
 * Which saved variant each variant of a save is (D914): its own id when it is one of the product's, else the product's variant with its SKU
 * that the save does not name by id, else none (a new variant). A variant sent without its id (an editor holding a copy made before it was
 * saved, or one that made its variants again) is so kept, never inserted beside itself. Loaded with import() by the save only, so the
 * entries that reach the product save without saving variants carry none of it.
 */
export function keptVariantIds(
  sent: readonly { id: string | null; sku: string }[],
  saved: readonly { id: string; sku: string }[],
): (string | null)[] {
  const own = new Set(saved.map((v) => v.id));
  const named = new Set(sent.flatMap((v) => (v.id && own.has(v.id) ? [v.id] : [])));
  const bySku = new Map(saved.filter((v) => !named.has(v.id)).map((v) => [v.sku, v.id]));
  return sent.map((v) => {
    if (v.id && own.has(v.id)) return v.id;
    const same = bySku.get(v.sku) ?? null;
    bySku.delete(v.sku);
    return same;
  });
}
