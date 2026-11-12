import { readFileSync, readdirSync } from "node:fs";
import { gzipSync, brotliCompressSync } from "node:zlib";
const dir = "/tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad/m/html";
console.log("page | doc bytes | style blocks (bytes) | same text again in flight (bytes, copies) | style total | share | doc br | doc br without flight copies");
for (const f of readdirSync(dir).filter((x) => /^(store|site)-/.test(x)).sort()) {
  const h = readFileSync(dir + "/" + f, "utf8");
  const styles = [...h.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)];
  const sb = styles.reduce((a, m) => a + m[0].length, 0);
  // flight raw
  const scripts = [...h.matchAll(/<script>self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)<\/script>/g)];
  let extra = 0, copies = 0; let stripped = h;
  // find each css chunk (split style content into its hoisted parts by data-href count is unknown; test first 60 chars of each distinct line group)
  for (const m of styles) {
    const css = m[1];
    // pieces: break at "}:where(.kzr" boundaries is fragile; instead probe by escaped prefix of first 80 chars and suffix
    const esc = (s) => JSON.stringify(s).slice(1, -1).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
    const e = esc(css);
    // try whole, else try halves split at known boundary between bp sheet and parts sheet
    const tryParts = [e];
    const cut = css.indexOf("\n}:where(");
    if (cut > 0) { tryParts.length = 0; tryParts.push(esc(css.slice(0, cut + 2)), esc(css.slice(cut + 2))); }
    const cut2 = css.indexOf("}\n}:where(");
    for (const part of tryParts) {
      if (part.length < 200) continue;
      let i = -1;
      while ((i = stripped.indexOf(part.slice(0, 300), i + 1)) >= 0) { extra += part.length; copies++; }
    }
  }
  const total = sb + extra;
  console.log([f, h.length, sb, `${extra} (${copies})`, total, (100 * total / h.length).toFixed(1) + "%", brotliCompressSync(h).length].join(" | "));
}
