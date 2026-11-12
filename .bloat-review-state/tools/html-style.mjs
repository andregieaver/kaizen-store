import { readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
const dir = process.argv[2];
const rows = [];
for (const f of readdirSync(dir).filter(f => f.endsWith(".html")).sort()) {
  const h = readFileSync(dir + "/" + f, "utf8");
  const total = Buffer.byteLength(h);
  // split markup (before first flight script) vs RSC payload scripts
  let styleBlocks = 0, nBlocks = 0; const blocks = [];
  for (const m of h.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) { styleBlocks += Buffer.byteLength(m[0]); nBlocks++; blocks.push([Buffer.byteLength(m[0]), m[0].slice(0, 90).replace(/\n/g, " ")]); }
  let attrs = 0, nAttrs = 0;
  for (const m of h.matchAll(/\sstyle="([^"]*)"/g)) { attrs += Buffer.byteLength(m[0]); nAttrs++; }
  let scripts = 0, flight = 0;
  for (const m of h.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) { const b = Buffer.byteLength(m[0]); scripts += b; if (m[1].includes("__next_f")) flight += b; }
  // style text inside flight payload: count occurrences of \"style\":{ ... } roughly and css strings
  let flightStyle = 0;
  for (const m of h.matchAll(/\\"style\\":\{[^}]*\}/g)) flightStyle += Buffer.byteLength(m[0]);
  let classAttr = 0;
  for (const m of h.matchAll(/\sclass="([^"]*)"/g)) classAttr += Buffer.byteLength(m[0]);
  const gz = gzipSync(h).length;
  rows.push({ f, total, gz, nBlocks, styleBlocks, nAttrs, attrs, scripts, flight, flightStyle, classAttr, blocks });
}
for (const r of rows) console.log(`${r.f.padEnd(30)} total ${String(r.total).padStart(7)} gz ${String(r.gz).padStart(6)} | <style> ${r.nBlocks}x ${String(r.styleBlocks).padStart(6)} (${(100 * r.styleBlocks / r.total).toFixed(1)}%) | style="" ${r.nAttrs}x ${String(r.attrs).padStart(6)} (${(100 * r.attrs / r.total).toFixed(1)}%) | class="" ${r.classAttr} (${(100 * r.classAttr / r.total).toFixed(1)}%) | scripts ${r.scripts} flight ${r.flight} (${(100 * r.flight / r.total).toFixed(0)}%) flightStyleObj ${r.flightStyle}`);
if (process.argv[3]) { const r = rows.find(r => r.f === process.argv[3]); for (const b of r.blocks.sort((a, b) => b[0] - a[0])) console.log(b[0], b[1]); }
