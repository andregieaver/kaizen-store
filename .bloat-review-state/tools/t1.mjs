const pc = await import("@/lib/page-content");
console.log(Object.keys(pc).length, "exports");
const packs = await import("@/lib/content-packs");
console.log(Object.keys(packs));
