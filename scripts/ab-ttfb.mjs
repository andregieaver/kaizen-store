import http from "node:http";
const [,, base, path, cookie = "", nStr = "200"] = process.argv;
const n = Number(nStr);
const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
function once() {
  return new Promise((resolve, reject) => {
    const t0 = process.hrtime.bigint();
    const req = http.get(new URL(path, base), { agent, headers: cookie ? { cookie } : {} }, (res) => {
      let first = null;
      let bytes = 0;
      res.on("data", (d) => {
        if (first === null) first = process.hrtime.bigint();
        bytes += d.length;
      });
      res.on("end", () => resolve({ status: res.statusCode, ttfb: Number(first - t0) / 1e6, total: Number(process.hrtime.bigint() - t0) / 1e6, bytes }));
    });
    req.on("error", reject);
  });
}
const rows = [];
for (let i = 0; i < 20; i++) await once(); // warm
for (let i = 0; i < n; i++) rows.push(await once());
const q = (key, p) => rows.map((r) => r[key]).sort((a, b) => a - b)[Math.min(rows.length - 1, Math.floor(rows.length * p))];
console.log(JSON.stringify({ path, cookie, status: [...new Set(rows.map((r) => r.status))], bytes: rows[0].bytes, ttfb_p50: +q("ttfb", 0.5).toFixed(1), ttfb_p95: +q("ttfb", 0.95).toFixed(1), total_p50: +q("total", 0.5).toFixed(1), total_p95: +q("total", 0.95).toFixed(1) }));
