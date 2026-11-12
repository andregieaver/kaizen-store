import { gzipSync } from "node:zlib";
const root = "/home/user/kaizen-store/src/lib/admin-messages/";
const want = process.argv.slice(2);
for (const name of want) {
  for (const lang of ["en", "nb"]) {
    try {
      const mod = await import(`${root}${name}.${lang}.ts`);
      const value = Object.values(mod).find((v) => v && typeof v === "object");
      const json = JSON.stringify(value);
      console.log(`${name}.${lang}: json ${json.length} bytes, gzip ${gzipSync(json).length}`);
    } catch (e) { console.log(`${name}.${lang}: failed ${String(e).slice(0, 200)}`); }
  }
}
