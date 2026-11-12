import { parse } from "./parse.mjs";
const rows = parse("store-products.rsc");
const total = rows.reduce((n, r) => n + r.len, 0);
const withProd = rows.filter((r) => r.text.includes("/p/demo-keramikkopp"));
console.log("total", total, "rows mentioning one product:", withProd.length);
for (const r of withProd) console.log(r.id, r.len, (r.text.match(/\/s\/demo\/no\/p\//g) ?? []).length, "product links |", r.text.slice(0, 160).replace(/\n/g, " "));
