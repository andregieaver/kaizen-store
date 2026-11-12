const pc = await import("@/lib/page-content");
const orbit = await import("@/lib/signature/orbit");
const packs = await import("@/lib/content-packs");
const cpp = await import("@/lib/content-pack-pages");
const pic = (slot) => ({ url: `https://ybsozesfuxuitoacntfo.supabase.co/storage/v1/object/public/media/packs/orbit/${slot}.webp`, width: 1600, height: 1000, alt: "A picture of " + slot });
const pages = {};
pages.orbitHome = orbit.orbitHomePage(orbit.ORBIT_PACK, pic);
pages.orbitAbout = orbit.orbitAboutPage(orbit.ORBIT_PACK, pic);
const anyPack = packs.contentPack ? packs.contentPack(packs.PACK_KEYS[0]) : null;
if (anyPack) { pages.packHome = cpp.packHomePage(anyPack, { hero: pic("hero"), story: pic("story") }); pages.packAbout = cpp.packAboutPage(anyPack, pic("about")); pages.packProducts = cpp.packProductsPage(anyPack); }
for (const m of ["atelier", "arcade", "botanica", "kinetic", "meridian"]) {
  const mod = await import(`@/lib/signature/${m}`);
  const home = Object.keys(mod).find((k) => /HomePage$/.test(k)); const pack = Object.keys(mod).find((k) => /_PACK$/.test(k));
  if (home && pack) pages[m + "Home"] = mod[home](mod[pack], pic);
}
const fs = await import("node:fs");
const out = {};
for (const [name, page] of Object.entries(pages)) {
  const raw = JSON.stringify(page);
  const t0 = performance.now(); let parsed = null; const N = 20;
  for (let i = 0; i < N; i++) parsed = pc.parsePageContent(page);
  const ms = (performance.now() - t0) / N;
  const blocks = parsed ? pc.pageBlocks(parsed) : [];
  const types = {}; for (const b of blocks) types[b.type] = (types[b.type] ?? 0) + 1;
  const t1 = performance.now(); for (let i = 0; i < 200; i++) JSON.parse(raw); const jms = (performance.now() - t1) / 200;
  out[name] = { bytes: raw.length, parsedBytes: parsed ? JSON.stringify(parsed).length : null, rows: page.rows.length, blocks: blocks.length, zodMs: +ms.toFixed(2), jsonParseMs: +jms.toFixed(3), types };
  fs.writeFileSync(`page-${name}.json`, JSON.stringify(parsed ?? page));
}
console.log(JSON.stringify(out, null, 1));
