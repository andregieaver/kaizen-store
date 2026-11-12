// For each route's .nft.json: which node_modules packages its trace carries. Prints, per package, the number of routes; --routes <pkg> lists them.
import fs from "node:fs";
import path from "node:path";
const root = "/home/user/kaizen-store/.next/server";
const out = {}; let routes = 0; const perRoute = {};
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".nft.json")) {
      routes++;
      const j = JSON.parse(fs.readFileSync(p, "utf8"));
      const pk = new Set();
      for (const f of j.files) { const m = f.match(/node_modules\/\.pnpm\/[^/]+\/node_modules\/((?:@[^/]+\/)?[^/]+)\//); if (m) pk.add(m[1]); }
      perRoute[path.relative(root, p)] = { pk, n: j.files.length };
      for (const k of pk) out[k] = (out[k] || 0) + 1;
    }
  }
})(path.join(root, "app"));
const want = process.argv.slice(2);
if (want[0] === "--routes") { for (const [r, v] of Object.entries(perRoute)) if (v.pk.has(want[1])) console.log(r); }
else if (want[0] === "--without") { for (const [r, v] of Object.entries(perRoute)) if (!v.pk.has(want[1])) console.log(r); }
else { console.log("routes:", routes); for (const [k, v] of Object.entries(out).sort((a, b) => b[1] - a[1])) console.log(v + "\t" + k); }
