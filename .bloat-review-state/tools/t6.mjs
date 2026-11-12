import fs from "node:fs";
const { partCss, breakpointClassCss } = await import("@/lib/part-css");
const { DEFAULT_BREAKPOINTS } = await import("@/lib/breakpoints");
const bp = breakpointClassCss(DEFAULT_BREAKPOINTS, "media");
console.log("breakpoint sheet bytes", bp.length);
for (const name of ["atelierHome", "orbitHome", "packHome", "botanicaHome"]) {
  const page = JSON.parse(fs.readFileSync(`page-${name}.json`, "utf8"));
  const per = page.rows.map((r) => partCss([r], "site", DEFAULT_BREAKPOINTS, "media", []).length);
  const whole = partCss(page.rows, "site", DEFAULT_BREAKPOINTS, "media", []).length;
  const t0 = performance.now(); for (let i = 0; i < 50; i++) partCss(page.rows, "site", DEFAULT_BREAKPOINTS, "media", []); const ms = (performance.now() - t0) / 50;
  console.log(name, "rows", page.rows.length, "json", JSON.stringify(page).length, "| part css per row", per.join(","), "| sum", per.reduce((a, b) => a + b, 0), "| as one sheet", whole, "| bp copies in RSC (one per row):", page.rows.length * bp.length, "| partCss ms", ms.toFixed(2));
}
