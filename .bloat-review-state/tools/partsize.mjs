import "./hooks.mjs";
const { gzipSync, brotliCompressSync } = await import("node:zlib");
const L = "/home/user/kaizen-store/src/lib/";
const pc = await import(L + "part-css.ts");
const bp = await import(L + "breakpoints.ts");
const te = await import(L + "theme-elements.ts");
const th = await import(L + "theme.ts");
const cc = await import(L + "custom-css.ts");
const pic = () => null;
const names = ["orbit", "atelier", "arcade", "botanica", "kinetic", "meridian"];
const bpCss = pc.breakpointClassCss(bp.DEFAULT_BREAKPOINTS, "media");
console.log("breakpoint sheet", bpCss.length);
console.log("theme | page | rows | part css total | per row min/median/max | one sheet for all rows (deduped) | theme css | theme own css (snapshot.css) | header rows css | footer rows css | bp sheet x rows");
for (const n of names) {
  const sig = await import(L + "signature/" + n + ".ts");
  const U = n.toUpperCase();
  const theme = sig[U]; const pack = sig[U + "_PACK"];
  const settings = theme.snapshot.theme.settings;
  const full = th.parseStoreTheme ? th.parseStoreTheme({ base: theme.snapshot.theme.base, settings }).settings : settings;
  const themeCss = th.themeCss(full, th.STORE_THEME_SELECTOR);
  const own = theme.snapshot.css ?? "";
  const layoutCss = (layout) => { const rows = layout?.rows ?? layout?.content?.rows ?? []; const themed = te.themedRows(rows, full.elements, full.sectionStyles); return [rows.length, themed.map((r) => pc.partCss([r], "site", bp.DEFAULT_BREAKPOINTS).length).reduce((a, b) => a + b, 0)]; };
  const hdr = layoutCss(theme.snapshot.header), ftr = layoutCss(theme.snapshot.footer);
  for (const fn of [n + "HomePage", n + "AboutPage"]) {
    if (!sig[fn]) continue;
    let content; try { content = sig[fn](pack, pic); } catch (e) { console.log(n, fn, "failed", e.message.slice(0, 80)); continue; }
    const rows = te.themedRows(content.rows, full.elements, full.sectionStyles);
    const per = rows.map((r) => pc.partCss([r], "site", bp.DEFAULT_BREAKPOINTS));
    const sizes = per.map((s) => s.length).sort((a, b) => a - b);
    const total = sizes.reduce((a, b) => a + b, 0);
    const one = pc.partCss(rows, "site", bp.DEFAULT_BREAKPOINTS);
    console.log([n, fn, rows.length, total, `${sizes[0]}/${sizes[sizes.length >> 1]}/${sizes[sizes.length - 1]}`, one.length, themeCss.length, own.length, `${hdr[0]} rows ${hdr[1]}`, `${ftr[0]} rows ${ftr[1]}`, bpCss.length * rows.length].join(" | "));
    if (n === "orbit" && fn.endsWith("HomePage")) {
      const doc = per.join("\n"); console.log("   orbit home part css gz", gzipSync(doc).length, "br", brotliCompressSync(doc).length, "| page css", (content.css ?? "").length);
    }
  }
}
