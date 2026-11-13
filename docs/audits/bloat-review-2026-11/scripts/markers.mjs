// node markers.mjs "<marker>" ["<marker>" ...] (run from the repository root after pnpm build)
import { readFileSync } from "node:fs";
const stats = JSON.parse(readFileSync(".next/diagnostics/route-bundle-stats.json", "utf8"));
const cache = new Map();
const has = (p, s) => {
  let t = cache.get(p);
  if (t === undefined) {
    t = readFileSync(p, "utf8");
    cache.set(p, t);
  }
  return t.includes(s);
};
for (const s of process.argv.slice(2)) {
  const routes = stats.filter((r) => r.firstLoadChunkPaths.some((p) => has(p, s))).map((r) => r.route);
  console.log(`${JSON.stringify(s)}: ${routes.length} routes${routes.length <= 12 ? " " + JSON.stringify(routes) : ""}`);
}
const bytes = (route) => stats.find((r) => r.route === route)?.firstLoadUncompressedJsBytes;
const admin = stats.filter((r) => r.route.startsWith("/admin")).map((r) => r.firstLoadUncompressedJsBytes).sort((a, b) => a - b);
console.log("median admin route:", admin[Math.floor(admin.length / 2)], "of", admin.length, "| over 1,300,000:", stats.filter((r) => r.firstLoadUncompressedJsBytes > 1_300_000).length, "| largest chunk:", Math.max(...[...new Set(stats.flatMap((r) => r.firstLoadChunkPaths))].map((p) => readFileSync(p).length)));
for (const r of ["/admin/[store]", "/admin/[store]/orders", "/admin/[store]/pages/[pageId]/preview", "/admin/[store]/orders/[orderId]", "/admin/[store]/products/[productId]"]) console.log(r, bytes(r));
