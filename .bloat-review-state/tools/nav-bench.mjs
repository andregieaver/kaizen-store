const { storeTabs, storeAreas, STORE_SECTIONS } = await import("@/lib/store-nav");
const { canOpenPath, permissionOfPath } = await import("@/lib/permissions");
const { ADMIN_PAGES } = await import("@/lib/admin-map");
const { FEATURES } = await import("@/lib/store-features").catch(() => ({}));
const items = STORE_SECTIONS.flatMap((s) => s.groups.flatMap((g) => g.items));
console.log("sections", STORE_SECTIONS.length, "nav items", items.length, "admin pages", ADMIN_PAGES.length, "store pages", ADMIN_PAGES.filter((p) => p.area === "store").length);
const holder = { role: "owner", kind: "staff", permissions: null };
const allFeatures = [...new Set(items.map((i) => i.feature).flat().filter((f) => typeof f === "string"))];
const store = { features: allFeatures, house: false };
const canOpen = (p) => canOpenPath(holder, p);
let tabs, areas;
const t0 = performance.now();
const N = 20;
for (let i = 0; i < N; i++) { tabs = storeTabs("/admin/acme", store, canOpen, { support: 0 }); areas = storeAreas("/admin/acme", store, canOpen); }
const ms = (performance.now() - t0) / N;
console.log("one layout's nav build (tabs + areas), mean of", N, ":", ms.toFixed(2), "ms");
const json = JSON.stringify({ tabs, areas });
const { gzipSync } = await import("node:zlib");
console.log("tabs+areas props JSON:", json.length, "bytes; gzip", gzipSync(json).length, "; tabs", tabs.length, "area items", areas.reduce((n, a) => n + a.groups.reduce((m, g) => m + g.items.length, 0), 0));
