import { readFileSync, readdirSync } from "node:fs";
import { brotliCompressSync } from "node:zlib";
const dir = "/tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad/m/html";
console.log("page | doc | <style> in HTML | style text in flight (copies) | style= attrs | all style | share of doc");
let rows = [];
for (const f of readdirSync(dir).filter((x) => /^(store|site)-/.test(x)).sort()) {
  const h = readFileSync(dir + "/" + f, "utf8");
  const styles = [...h.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)];
  const sb = styles.reduce((a, m) => a + m[0].length, 0);
  const attrs = [...h.matchAll(/\sstyle="([^"]*)"/g)].reduce((a, m) => a + m[0].length, 0);
  // decode flight
  let fl = "";
  for (const m of h.matchAll(/<script>self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)<\/script>/g)) { try { fl += JSON.parse('"' + m[1] + '"'); } catch { fl += m[1]; } }
  // T rows: id:Thex,<text>
  let extra = 0, copies = 0;
  const cssSeen = styles.map((m) => m[1]).join("\n");
  const re = /(?:^|\n)[0-9a-f]+:T([0-9a-f]+),/g; let m;
  while ((m = re.exec(fl))) {
    const len = parseInt(m[1], 16);
    const start = m.index + m[0].length;
    const text = Buffer.from(fl, "utf8").length === fl.length ? fl.slice(start, start + len) : fl.slice(start, start + len);
    if (cssSeen.includes(text.slice(0, 200))) { extra += len; copies++; }
  }
  const total = sb + extra + attrs;
  rows.push([f, h.length, sb, `${extra} (${copies})`, attrs, total, (100 * total / h.length).toFixed(1) + "%"]);
}
for (const r of rows) console.log(r.join(" | "));
