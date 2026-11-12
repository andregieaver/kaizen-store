import { readFileSync, writeFileSync } from "node:fs";
const dir = process.argv[2];
const rows = JSON.parse(readFileSync(`${dir}/routes.json`, "utf8")).filter((r) => !r.failed);
const kb = (n) => (n / 1024).toFixed(0);
const pct = (n) => `${Math.round(n * 100)}%`;
const k = (r, kind, field = "transfer") => r.requests.byKind[kind]?.[field] ?? 0;
const n = (r, kind) => r.requests.byKind[kind]?.requests ?? 0;
let md = `# What real pages send to a browser (production build, measured 11 Nov 2026)

Measured by \`work/measure-routes.mjs\` with Chromium against \`pnpm start\` on this machine: the build CI's \`signed-in\` job makes
(commit 0bd814c), the seeded demo catalogue, a warm server and a cold browser (empty cache) for each page. Storefront and site pages
on a phone-sized screen (390 px), the admin on 1440 px, signed in as the test owner of a store copied from the template (10 products).
"Transferred" is bytes on the wire with the server's gzip (Vercel sends Brotli, a little smaller). "Unused" is the share of the
script or style bytes loaded that had not run or matched anything when the page was idle (network quiet, plus three seconds), by
Chromium's own coverage: a visitor who presses nothing. Times on this machine say nothing about production and are left out.
Raw data: \`routes.json\` (every response, every script with its used bytes, the after-load requests) and \`html/<name>.html\`.

CAUTION for store-category and store-search: on this local build (stores at /s/{store}/... addresses) the client router asked for
one link's segment prefetch about 160 times a second without stopping (see \`prefetch-storm.md\`); their request counts and "rsc"
bytes are that loop, not the page. Production (stores on their own hosts) did not do it when checked.

## Bytes by page

| Page | Address | Document raw / gzip | of which RSC payload | Scripts transferred (files) | Scripts raw | unused | Styles raw | unused | Fonts | Requests | All transferred |
|---|---|---|---|---|---|---|---|---|---|---|---|
`;
for (const r of rows) {
  md += `| ${r.name} | \`${r.path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/, "{id}")}\` | ${kb(r.document.raw)} / ${kb(r.document.gzip)} KB | ${kb(r.document.rscPayload)} KB (${pct(r.document.rscPayload / r.document.raw)}) | ${kb(k(r, "script"))} KB (${n(r, "script")}) | ${kb(r.scriptCoverage.total)} KB | ${pct(r.scriptCoverage.unusedShare)} | ${kb(r.styleCoverage.total)} KB | ${pct(r.styleCoverage.unusedShare)} | ${kb(k(r, "font"))} KB (${n(r, "font")}) | ${r.requests.total} | ${kb(r.requests.transfer)} KB |\n`;
}
md += `
## What each document is made of (raw bytes)

| Page | Document | Markup | RSC payload (inline script) | Other inline script | JSON-LD | Style blocks | Style attributes | Elements | Hidden markup (display:none) | class attributes | data- attributes | Inline SVG (count) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
`;
for (const r of rows) {
  const d = r.document, m = r.dom;
  md += `| ${r.name} | ${kb(d.raw)} KB | ${kb(d.markup)} KB | ${kb(d.rscPayload)} KB | ${kb(d.otherInlineScript)} KB | ${kb(d.jsonLd)} KB | ${kb(d.styleBlocks)} KB | ${kb(d.styleAttrs)} KB | ${m.elements} | ${kb(m.hiddenMarkupBytes)} KB | ${kb(m.classAttrBytes)} KB | ${kb(m.dataAttrBytes)} KB | ${kb(m.svgBytes)} KB (${m.svgs}) |\n`;
}
md += `
## What each page asks for after it has loaded (a visitor who does nothing)

Counted from the load event until the page was idle. "rsc" is the router prefetching a link's page (one request per segment of the
target route); "fetch" is the page's own calls.

| Page | Prefetches (rsc) | bytes | Fetches | Beacons | Other after load | Addresses fetched (not rsc) |
|---|---|---|---|---|---|---|
`;
for (const r of rows) {
  const a = r.afterLoad;
  const rsc = a.filter((x) => x.kind === "rsc"), fetches = a.filter((x) => x.kind === "fetch"), beacons = a.filter((x) => x.kind === "beacon");
  const rest = a.filter((x) => !["rsc", "fetch", "beacon"].includes(x.kind));
  const named = [...new Set([...fetches, ...beacons].map((x) => `${x.method} ${x.url.replace(/\?.*$/, "").replace(/[0-9a-f]{8}-[0-9a-f-]{27}/, "{id}")}`))].slice(0, 8).join("; ");
  md += `| ${r.name} | ${rsc.length} | ${kb(rsc.reduce((s, x) => s + x.transfer, 0))} KB | ${fetches.length} | ${beacons.length} | ${rest.length} (${[...new Set(rest.map((x) => x.kind))].join(", ")}) | ${named} |\n`;
}
md += `
## The largest scripts each page loaded, with the bytes that ran

`;
for (const name of ["store-home", "store-product", "store-cart-empty", "store-checkout-empty", "site-home", "admin-home", "admin-product-editor", "admin-page-builder"]) {
  const r = rows.find((x) => x.name === name);
  if (!r) continue;
  md += `### ${name} (${r.scripts.length} scripts, ${kb(r.scriptCoverage.total)} KB raw, ${pct(r.scriptCoverage.unusedShare)} unused)\n\n| Script | Raw | Ran | Unused |\n|---|---|---|---|\n`;
  for (const s of r.scripts.slice(0, 14)) md += `| \`${s.url.split("/").pop().slice(0, 40)}\` | ${kb(s.total)} KB | ${kb(s.used)} KB | ${pct(1 - s.used / s.total)} |\n`;
  md += "\n";
}
// Scripts shared by every page of a group.
md += `## Scripts every page of a group loads\n\n`;
for (const group of ["storefront", "site", "admin"]) {
  const pages = rows.filter((r) => r.group === group);
  const sets = pages.map((r) => new Map(r.scripts.map((s) => [s.url, s])));
  const common = [...sets[0].keys()].filter((u) => sets.every((s) => s.has(u)));
  const total = common.reduce((sum, u) => sum + sets[0].get(u).total, 0);
  const usedAnywhere = common.reduce((sum, u) => sum + Math.max(...sets.map((s) => s.get(u).used)), 0);
  md += `- **${group}** (${pages.length} pages): ${common.length} scripts in common, ${kb(total)} KB raw; the most any one page ran of them: ${kb(usedAnywhere)} KB.\n`;
}
writeFileSync(`${dir}/routes.md`, md);
console.log(md.split("\n").slice(14, 52).join("\n"));
