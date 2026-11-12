const sp = await import("@/lib/store-parts");
console.log("STORE_PARTS", Object.keys(sp.STORE_PARTS).length, Object.keys(sp.STORE_PARTS).join(","));
const pc = await import("@/lib/page-content");
console.log("PRODUCT_PARTS", Object.keys(pc.PRODUCT_PARTS).length, "SITE_PARTS", Object.keys(pc.SITE_PARTS).length);
const ts = await import("@/lib/theme-store-parts");
console.log("THEME_STORE_PARTS", ts.THEME_STORE_PARTS.length);
