import { readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
const dir = "/tmp/claude-0/-home-user-kaizen-store/875cb21b-0ebd-5663-b7c0-2d04a7548e24/scratchpad/m/html";
console.log("page | bytes | gz | <style> n | <style> bytes | style= n | style= bytes | css links | flight bytes | style-ish in flight (est)");
for (const f of readdirSync(dir).sort()) {
  const h = readFileSync(dir + "/" + f, "utf8");
  const styles = [...h.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)];
  const sb = styles.reduce((a, m) => a + m[0].length, 0);
  const attrs = [...h.matchAll(/\sstyle="([^"]*)"/g)];
  const ab = attrs.reduce((a, m) => a + m[0].length, 0);
  const links = [...h.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)].map((m) => (m[0].match(/href="([^"]+)"/) || [])[1]);
  const flight = [...h.matchAll(/<script>self\.__next_f\.push\(([\s\S]*?)\)<\/script>/g)];
  const fb = flight.reduce((a, m) => a + m[0].length, 0);
  // style props in flight: "style":{...}
  const fl = flight.map((m) => m[1]).join("");
  const fstyle = [...fl.matchAll(/\\"style\\":\{[^}]*\}/g)].reduce((a, m) => a + m[0].length, 0);
  // dangerouslySetInnerHTML css in flight
  const fcss = [...fl.matchAll(/\\"dangerouslySetInnerHTML\\":\{\\"__html\\":\\"((?:[^"\\]|\\\\.|\\[^"])*?)\\"\}/g)].reduce((a, m) => a + m[0].length, 0);
  console.log([f, h.length, gzipSync(h).length, styles.length, sb, attrs.length, ab, links.map((l) => l.split("/").pop()).join(","), fb, fstyle + "+" + fcss].join(" | "));
}
