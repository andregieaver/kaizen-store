const { storeTabs, storeAreas, STORE_SECTIONS } = await import("@/lib/store-nav");
const { canOpenPath } = await import("@/lib/permissions");
const sf = await import("@/lib/store-features");
const holder = { role: "owner", kind: "staff", permissions: null };
const canOpenCount = { n: 0 };
const canOpen = (p) => { canOpenCount.n++; return canOpenPath(holder, p); };
const run = (label, features) => {
  const store = { features, house: false };
  for (let i = 0; i < 10; i++) { storeTabs("/admin/acme", store, canOpen); storeAreas("/admin/acme", store, canOpen); }
  canOpenCount.n = 0;
  const t0 = performance.now(); const N = 50; let areas;
  for (let i = 0; i < N; i++) { storeTabs("/admin/acme", store, canOpen); areas = storeAreas("/admin/acme", store, canOpen); }
  const ms = (performance.now() - t0) / N;
  console.log(label.padEnd(44), "features", String(features.length).padStart(3), "| nav items shown", String(areas.reduce((n, a) => n + a.groups.reduce((m, g) => m + g.items.length, 0), 0)).padStart(4), "| permission lookups per render", canOpenCount.n / N, "|", ms.toFixed(1), "ms");
};
console.log("exports:", Object.keys(sf).filter((k) => /DEFAULT|FEATURE_IDS|normalise|START/i.test(k)).join(", "));
const ids = sf.FEATURE_IDS ?? Object.keys(sf.FEATURES_BY_ID ?? {});
run("every feature on", [...ids]);
run("the shop only", sf.normaliseFeatures ? sf.normaliseFeatures(["shop"]) : ["shop"]);
run("no features (a website)", sf.normaliseFeatures ? sf.normaliseFeatures([]) : []);
if (sf.DEFAULT_FEATURES) run("DEFAULT_FEATURES", [...sf.DEFAULT_FEATURES]);
