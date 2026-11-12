const pc = await import("@/lib/page-content");
const z = await import("zod");
const union = pc.pageBlockUnion;
const opts = union.options ?? union._zod?.def?.options ?? union.def?.options;
console.log("block kinds", opts.length);
const fieldNames = new Set(); let totalFields = 0;
function shapeOf(s) { let cur = s; for (let i = 0; i < 10 && cur; i++) { if (cur.shape) return cur.shape; const d = cur.def ?? cur._def ?? cur._zod?.def; cur = d?.in ?? d?.innerType ?? d?.schema ?? d?.out ?? null; } return null; }
function countLeaves(s, depth = 0, seen = new Set()) {
  if (!s || depth > 12 || seen.has(s)) return 0; seen.add(s);
  const d = s.def ?? s._def ?? s._zod?.def; if (!d) return 1;
  const t = d.type;
  if (t === "object") { let n = 0; for (const v of Object.values(s.shape ?? d.shape ?? {})) n += countLeaves(v, depth + 1, seen) || 1; return n; }
  if (t === "optional" || t === "nullable" || t === "default" || t === "readonly" || t === "nonoptional" || t === "prefault" || t === "catch") return countLeaves(d.innerType, depth + 1, seen);
  if (t === "pipe") return countLeaves(d.in?.def?.type === "transform" ? d.out : d.in, depth + 1, seen);
  if (t === "array") return countLeaves(d.element, depth + 1, seen);
  if (t === "union") return (d.options ?? []).reduce((n, o) => n + countLeaves(o, depth + 1, seen), 0);
  if (t === "record") return countLeaves(d.valueType, depth + 1, seen);
  return 1;
}
const rows = [];
for (const o of opts) {
  const shape = shapeOf(o); const type = shape?.type?.def?.values?.[0] ?? shape?.type?._zod?.def?.values?.[0] ?? "?";
  const keys = Object.keys(shape ?? {});
  keys.forEach((k) => fieldNames.add(k)); totalFields += keys.length;
  rows.push([type, keys.length, countLeaves(o)]);
}
rows.sort((a, b) => b[2] - a[2]);
console.log("type | top-level fields | leaf settings (schema leaves, each distinct sub-schema counted once per block)");
for (const r of rows) console.log(r.join(" | "));
console.log("sum top-level", totalFields, "distinct top-level names", fieldNames.size, "sum leaves", rows.reduce((n, r) => n + r[2], 0));
const consts = Object.entries(pc).filter(([k, v]) => /PARTS$|_PARTS|PART_/.test(k)).map(([k, v]) => k + ":" + (Array.isArray(v) ? v.length : typeof v === "object" ? Object.keys(v).length : "?"));
console.log(consts.join(", "));
