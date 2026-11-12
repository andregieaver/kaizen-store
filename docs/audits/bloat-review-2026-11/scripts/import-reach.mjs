// The static value-import graph of src, and what an entry reaches. Run from the repository root; no dependency but node.
//   node docs/audits/bloat-review-2026-11/scripts/import-reach.mjs [--cycle] [--why <target>] <entry>...
// An entry is a path under src, for example src/app/api/visit/route.ts. Type-only imports and import() calls are left out.
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// The graph: { 'lib/x.ts': { bytes, out: [{ to, names, kind } | { pkg }] } }, keys relative to src.
export function buildGraph(repo = process.cwd()) {
  const root = join(repo, 'src');
  const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const files = walk(root).filter((f) => /\.tsx?$/.test(f) && !/\.(test|spec)\.tsx?$/.test(f) && !/\.d\.ts$/.test(f));
  const exts = ['.ts', '.tsx', '/index.ts', '/index.tsx'];
  const res = (from, spec) => { let b; if (spec.startsWith('@/')) b = join(root, spec.slice(2)); else if (spec.startsWith('.')) b = resolve(dirname(from), spec); else return null; if (existsSync(b) && statSync(b).isFile()) return b; for (const e of exts) if (existsSync(b + e)) return b + e; return null; };
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');
  const stmt = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^;'"]*?)\s*from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']/g;
  const g = {};
  for (const f of files) {
    const src = strip(readFileSync(f, 'utf8'));
    const out = []; let m;
    stmt.lastIndex = 0;
    while ((m = stmt.exec(src))) {
      if (m[2]) continue;
      const names = (m[3] ?? '').trim();
      let rt = null;
      if (/^\{[^}]*\}$/.test(names)) { const parts = names.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean); if (parts.length && parts.every((p) => p.startsWith('type '))) continue; rt = parts.filter((p) => !p.startsWith('type ')).map((p) => p.split(/\s+as\s+/)[0]); }
      const spec = m[4] ?? m[5]; const t = res(f, spec);
      if (t && t !== f) out.push({ to: relative(root, t), names: rt, kind: m[1] ?? 'import' });
      else if (!t && !spec.startsWith('.') && !spec.startsWith('@/')) out.push({ pkg: spec });
    }
    g[relative(root, f)] = { bytes: statSync(f).size, out };
  }
  return g;
}

const edges = (g, f) => (g[f]?.out ?? []).filter((e) => e.to).map((e) => e.to);

export function reachFrom(g, from) {
  const seen = new Set([from]); const q = [from];
  while (q.length) { const x = q.pop(); for (const y of edges(g, x)) if (!seen.has(y)) { seen.add(y); q.push(y); } }
  return seen;
}

// One shortest chain of imports from `from` to `target`, or null.
export function chain(g, from, target) {
  const prev = new Map([[from, null]]); const q = [from];
  for (let i = 0; i < q.length; i++) {
    const x = q[i];
    if (x === target) { const out = []; for (let n = x; n !== null; n = prev.get(n)) out.unshift(n); return out; }
    for (const y of edges(g, x)) if (!prev.has(y)) { prev.set(y, x); q.push(y); }
  }
  return null;
}

// Tarjan's strongly connected components (iterative), over the nodes `keep` allows; largest first.
export function components(g, keep = () => true) {
  const nodes = Object.keys(g).filter(keep);
  const adj = new Map(nodes.map((n) => [n, edges(g, n).filter(keep)]));
  let idx = 0; const index = new Map(), low = new Map(), on = new Set(), st = []; const comps = [];
  for (const s of nodes) {
    if (index.has(s)) continue;
    const work = [[s, 0]]; index.set(s, idx); low.set(s, idx); idx++; st.push(s); on.add(s);
    while (work.length) {
      const top = work[work.length - 1]; const [v, i] = top; const es = adj.get(v);
      if (i < es.length) { top[1]++; const w = es[i]; if (!index.has(w)) { index.set(w, idx); low.set(w, idx); idx++; st.push(w); on.add(w); work.push([w, 0]); } else if (on.has(w)) low.set(v, Math.min(low.get(v), index.get(w))); }
      else {
        work.pop();
        if (work.length) { const p = work[work.length - 1][0]; low.set(p, Math.min(low.get(p), low.get(v))); }
        if (low.get(v) === index.get(v)) { const c = []; let w; do { w = st.pop(); on.delete(w); c.push(w); } while (w !== v); comps.push(c); }
      }
    }
  }
  return comps.sort((a, b) => b.length - a.length);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let args = process.argv.slice(2);
  const cycle = args.includes('--cycle'); args = args.filter((a) => a !== '--cycle');
  let why = null; const wi = args.indexOf('--why');
  if (wi >= 0) { why = args[wi + 1]; args.splice(wi, 2); }
  const rel = (p) => p.replace(/^src\//, '');
  if (!args.length) { console.error('usage: node import-reach.mjs [--cycle] [--why <target>] <entry>...'); process.exit(2); }
  const g = buildGraph(process.cwd());
  for (const a of args) {
    const e = rel(a);
    if (!g[e]) { console.log(`${a}: not a module of src`); continue; }
    const s = reachFrom(g, e);
    console.log(`${a}: ${s.size} files  admin-text=${s.has('lib/admin-text.ts')} chat-route=${s.has('server/chat-route.ts')} ai=${s.has('server/ai.ts')} schema=${s.has('db/schema.ts')}`);
    if (why) { const c = chain(g, e, rel(why)); console.log(c ? `  why ${why}: ${c.map((x) => 'src/' + x).join(' -> ')}` : `  ${why} is not reached`); }
  }
  if (cycle) { const c = components(g, (f) => f.startsWith('server/')); console.log(`largest cycle in src/server: ${c[0]?.length ?? 0} files`); }
}
