import fs from "node:fs";
const file = process.argv[2];
const html = fs.readFileSync(file, "utf8");
const re = /<script[^>]*>self\.__next_f\.push\((\[.*?\])\)<\/script>/gs;
let m, out = "";
while ((m = re.exec(html))) {
  try { const a = JSON.parse(m[1]); if (a[0] === 1) out += a[1]; } catch (e) { /* skip */ }
}
fs.writeFileSync(process.argv[3], out);
console.log(file, "html", html.length, "rsc decoded", out.length);
