import { readFileSync, readdirSync } from "node:fs";
const dir = "/tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad/m/html";
const count = (hay, needle) => { let n = 0, i = -1; while ((i = hay.indexOf(needle, i + 1)) >= 0) n++; return n; };
console.log("page | doc | bp sheet bytes x (html+flight) | theme bytes x (html+flight) | parts+custom bytes | style attrs | all style bytes | share");
for (const f of readdirSync(dir).filter((x) => /^(store|site)-/.test(x)).sort()) {
  const h = readFileSync(dir + "/" + f, "utf8");
  const styles = [...h.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  const all = styles.join("");
  let fl = "";
  for (const m of h.matchAll(/<script>self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)<\/script>/g)) { try { fl += JSON.parse('"' + m[1] + '"'); } catch { fl += m[1]; } }
  const bpEnd = all.indexOf("--grid-desktop, 3))}\n}") + "--grid-desktop, 3))}\n}".length;
  const bp = all.slice(0, bpEnd);
  const themeStart = all.indexOf("html:root[data-store-theme] {");
  const theme = all.slice(themeStart);
  const rest = all.length - bp.length - theme.length;
  const bpN = count(fl, bp.slice(0, 400)), thN = count(fl, theme.slice(0, 400));
  const attrs = [...h.matchAll(/\sstyle="([^"]*)"/g)].reduce((a, m) => a + m[0].length, 0);
  const total = bp.length * (1 + bpN) + theme.length * (1 + thN) + rest * 2 + attrs;
  console.log([f, h.length, `${bp.length} x (1+${bpN})`, `${theme.length} x (1+${thN})`, rest, attrs, total, (100 * total / h.length).toFixed(1) + "%"].join(" | "));
}
