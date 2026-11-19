// What is inside the scripts each measured page really loaded: the browser's list (routes.json) joined to the analyzer's
// module sizes by matching each real chunk to the analyzer's chunk of the same size.  node loaded.mjs <evidenceDir>
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, statSync } from "node:fs";
const dir = process.argv[2];
const REPO = "/home/user/kaizen-store";
const routes = JSON.parse(readFileSync(`${dir}/routes.json`, "utf8"));
const MAP = {
  "store-home": "/s/[store]/[market]", "store-product": "/s/[store]/[market]/p/[handle]", "store-category": "/s/[store]/[market]/category/[slug]",
  "store-cart-empty": "/s/[store]/[market]/cart", "store-checkout-empty": "/s/[store]/[market]/checkout", "site-home": "/", "site-docs": "/docs",
  "admin-sign-in": "/admin/sign-in", "admin-home": "/admin/[store]", "admin-orders": "/admin/[store]/orders", "admin-product-editor": "/admin/[store]/products/[productId]",
  "admin-page-builder": "/admin/[store]/pages/[pageId]", "admin-settings": "/admin/[store]/settings", "admin-platform-home": "/admin/platform",
};
const kb = (n) => (n / 1024).toFixed(0);
const pkgOf = (path) => {
  const m = path.match(/node_modules\/\.pnpm\/[^/]+\/node_modules\/((?:@[^/]+\/)?[^/]+)/);
  if (m) return m[1];
  const s = path.match(/\[project\]\/src\/([^/]+)(?:\/([^/]+))?/);
  if (s) return `src/${s[1]}${s[2] && !s[2].includes(".") ? "/" + s[2] : ""}`;
  return "(other)";
};
const short = (p) => p.replace("[project]/", "").replace(/node_modules\/\.pnpm\/[^/]+\/node_modules\//, "~/");
const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
let md = `# What is inside the scripts each page really loaded

For each measured page (\`routes.md\`), the scripts the browser loaded are matched to the bundle analyzer's chunks (same bytes,
another name) and so to the source modules inside them. "Ran" is the browser's coverage for the whole chunk (bytes of the chunk
that executed before the page was idle). Sizes are minified bytes, before compression. Unmatched chunks are listed as such.

`;
const all = {};
for (const [name, route] of Object.entries(MAP)) {
  const page = routes.find((r) => r.name === name);
  if (!page || page.failed) continue;
  const raw = execFileSync(`${REPO}/node_modules/.bin/next`, ["analyze", "export", "--route", route], { cwd: REPO, maxBuffer: 1 << 30, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const outs = new Map();
  for (const line of raw.split("\n")) {
    if (!line.startsWith('{"type":"part"')) continue;
    const p = JSON.parse(line);
    if (!p.filename.startsWith("[client-fs]/") || !p.filename.endsWith(".js")) continue;
    const o = outs.get(p.filename) ?? { size: 0, parts: [] };
    o.size += p.size; o.parts.push([p.source_path, p.size]);
    outs.set(p.filename, o);
  }
  const outList = [...outs.entries()];
  const loaded = page.scripts.filter((s) => s.url.includes("/_next/static/chunks/"));
  const byPkg = new Map(), byFile = new Map();
  let matchedBytes = 0, totalBytes = 0, unmatched = [];
  const chunkRows = [];
  const used = new Set();
  for (const s of loaded) {
    const file = s.url.split("/").pop().split("?")[0];
    let size; try { size = statSync(`${REPO}/.next/static/chunks/${file}`).size; } catch { size = s.total; }
    totalBytes += size;
    // The analyzer's sum of parts leaves out the chunk's own wrapper, so allow a little slack and take the nearest unused one.
    const near = outList.filter(([f]) => !used.has(f)).map(([f, o]) => [Math.abs(o.size - size), f, o]).sort((a, b) => a[0] - b[0])[0];
    if (near && near[0] <= Math.max(600, size * 0.03)) {
      used.add(near[1]); matchedBytes += size;
      const mods = near[2].parts.sort((a, b) => b[1] - a[1]);
      for (const [path, n] of mods) { byPkg.set(pkgOf(path), (byPkg.get(pkgOf(path)) ?? 0) + n); byFile.set(short(path), (byFile.get(short(path)) ?? 0) + n); }
      chunkRows.push({ file, size, ran: s.used, modules: mods.length, top: mods.slice(0, 6).map(([p, n]) => `${short(p)} ${kb(n)}`) });
    } else { unmatched.push(`${file} ${kb(size)} KB`); chunkRows.push({ file, size, ran: s.used, modules: 0, top: ["(not matched)"] }); }
  }
  all[name] = { route, totalBytes, matchedBytes, byPackage: top(byPkg, 60), byModule: top(byFile, 250), chunks: chunkRows };
  md += `## ${name} (${route})\n\n${loaded.length} scripts, ${kb(totalBytes)} KB; ${kb(matchedBytes)} KB matched to modules.${unmatched.length ? ` Not matched: ${unmatched.join(", ")}.` : ""}\n\n`;
  md += `By package or folder: ${top(byPkg, 24).map(([k, v]) => `${k} ${kb(v)}`).join(", ")}.\n\n`;
  md += `Largest modules loaded: ${top(byFile, 45).map(([k, v]) => `\`${k}\` ${kb(v)}`).join(", ")}.\n\n`;
  md += `| Chunk | Size | Ran | Modules | Largest modules in it |\n|---|---|---|---|---|\n`;
  for (const c of chunkRows.sort((a, b) => b.size - a.size).slice(0, 16)) md += `| \`${c.file.slice(0, 18)}\` | ${kb(c.size)} KB | ${kb(c.ran)} KB (${Math.round((c.ran / c.size) * 100)}%) | ${c.modules} | ${c.top.join("; ")} |\n`;
  md += "\n";
  console.log(name.padEnd(24), "scripts", loaded.length, "total", kb(totalBytes), "matched", kb(matchedBytes), "KB");
}
writeFileSync(`${dir}/loaded.md`, md);
writeFileSync(`${dir}/loaded.json`, JSON.stringify(all, null, 1));
