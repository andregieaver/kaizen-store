// Writes the migration that loads postal-code centres into `commerce.postal_points` (D237, docs/wave-3-shipping-methods.md 4.6): local delivery by
// radius measures between them. A developer tool, run once per set of countries and never imported by the app; no service is called at run time.
//
// The source is GeoNames' postal codes, https://download.geonames.org/export/zip/ (readme read 2026-10-14): "This work is licensed under a Creative
// Commons Attribution 4.0 License", with credit to GeoNames ("Postal-code positions © GeoNames, CC BY 4.0", on the Local delivery page). Download and
// unzip the country files yourself (NO.zip, SE.zip, ...) into one folder, then:
//
//   node scripts/postal-points.mjs <folder with NO.txt, SE.txt, ...> <out.sql> NO SE DK FI
//
// Each file is tab-separated: country, postal code, place name, admin names and codes (6 columns), latitude, longitude, accuracy. A code is written as
// `cleanPostalCode()` (src/lib/delivery-options.ts) writes it: spaces out, upper case, and only kept when it is that country's form. A code listed for
// several places gets the mean of their positions and the lowest accuracy given. The output is the same bytes for the same input (sorted, fixed decimals).
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const FORMS = { NO: /^\d{4}$/, DK: /^\d{4}$/, SE: /^\d{5}$/, FI: /^\d{5}$/, DE: /^\d{5}$/ };
const CHUNK = 1000;

const [folder, out, ...countries] = process.argv.slice(2);
if (!folder || !out || countries.length === 0) {
  console.error("usage: node scripts/postal-points.mjs <folder> <out.sql> NO SE DK FI");
  process.exit(1);
}

const rows = [];
for (const country of countries.map((c) => c.toUpperCase())) {
  const form = FORMS[country] ?? /^[A-Z0-9-]{3,10}$/;
  const text = await readFile(path.join(folder, `${country}.txt`), "utf8");
  const byCode = new Map();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const cells = line.split("\t");
    if (cells[0] !== country) throw new Error(`${country}.txt holds a row of ${cells[0]}`);
    const code = cells[1].replace(/\s+/g, "").toUpperCase();
    const lat = Number(cells[9]);
    const lon = Number(cells[10]);
    const accuracy = cells[11]?.trim() ? Number(cells[11]) : null;
    if (!form.test(code) || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const seen = byCode.get(code) ?? { lat: 0, lon: 0, n: 0, accuracy: null };
    seen.lat += lat;
    seen.lon += lon;
    seen.n += 1;
    if (accuracy !== null && Number.isInteger(accuracy)) seen.accuracy = seen.accuracy === null ? accuracy : Math.min(seen.accuracy, accuracy);
    byCode.set(code, seen);
  }
  for (const [code, p] of [...byCode].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    rows.push(`('${country}','${code}',${(p.lat / p.n).toFixed(6)},${(p.lon / p.n).toFixed(6)},${p.accuracy ?? "NULL"})`);
  }
  console.log(`${country}: ${byCode.size} postal codes`);
}

const head = `-- Postal-code centres for local delivery by radius (D237, docs/wave-3-shipping-methods.md 4.6): ${countries.join(", ")}, ${rows.length} codes, written by
-- scripts/postal-points.mjs from GeoNames' postal codes (https://download.geonames.org/export/zip/, CC BY 4.0: "Postal-code positions © GeoNames").
-- Positions are GeoNames' estimates (a place's or the centre of its addresses), so distances between them are approximate. Reference data: no store, no person.
`;
const chunks = [];
for (let i = 0; i < rows.length; i += CHUNK) {
  chunks.push(
    `INSERT INTO commerce.postal_points (country, postal_code, latitude, longitude, accuracy) VALUES\n${rows.slice(i, i + CHUNK).join(",\n")}\nON CONFLICT (country, postal_code) DO NOTHING;`,
  );
}
await writeFile(out, head + chunks.join("\n--> statement-breakpoint\n") + "\n");
console.log(`wrote ${rows.length} rows to ${out}`);
