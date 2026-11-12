import fs from "node:fs"; import path from "node:path"; import zlib from "node:zlib";
const root = process.argv[2] ? path.resolve(process.argv[2]) : path.join(process.cwd(), ".next/server/app");
let total = 0, withList = 0, listBytes = 0, allBytes = 0, noState = 0; const byKind = {};
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!e.name.endsWith(".segments")) walk(p); continue; }
    if (!e.name.endsWith(".meta")) continue;
    let meta; try { meta = JSON.parse(fs.readFileSync(p, "utf8")); } catch { continue; }
    total++;
    const state = meta.postponed; if (!state) { noState++; continue; }
    const m = state.match(/^([0-9]*):/); const len = parseInt(m[1]); const tail = state.slice(m[1].length + 1 + len);
    if (tail === "null") { noState++; continue; }
    let json; try { json = JSON.parse(zlib.inflateSync(Buffer.from(tail, "base64")).toString("utf8")); } catch { continue; }
    let has = 0, sum = 0;
    for (const v of Object.values(json.store.cache)) {
      const val = Buffer.from(v.entry.value, "base64"); sum += val.length;
      if (v.entry.tags.some((t) => t.startsWith("pages:")) && /^0:"\$@1"\s*1:\[\{"id":"[0-9a-f-]{36}","slug":"[^"]*","content":\{/.test(val.toString("utf8"))) has += val.length;
    }
    allBytes += sum;
    const kind = path.relative(root, p).split(path.sep).slice(1, 2).join("/").replace(/\.meta$/, "") || "(home)";
    if (has) { withList++; listBytes += has; byKind[kind] = (byKind[kind] ?? 0) + 1; }
  }
})(root);
console.log({ total, noState, withList, listBytes, allBytes, share: (100 * listBytes / allBytes).toFixed(1) + "%" });
console.log(Object.entries(byKind).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, n]) => `${k} ${n}`).join(", "));
