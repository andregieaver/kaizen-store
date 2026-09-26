// Writes src/lib/fonts/google-fonts.json: every Google Fonts family with
// Latin letters, most popular first, as [family, category, weights,
// italic weights] with weights as hundreds ("4" is 400). Run it again to
// pick up new families: `node scripts/google-fonts.mjs`.
import { writeFile } from "node:fs/promises";

const CATEGORIES = {
  "Sans Serif": "sans-serif",
  Serif: "serif",
  Display: "display",
  Handwriting: "handwriting",
  Monospace: "monospace",
};

const response = await fetch("https://fonts.google.com/metadata/fonts");
if (!response.ok) throw new Error(`Google Fonts answered ${response.status}`);
const { familyMetadataList } = await response.json();

const hundreds = (keys, italic) =>
  keys
    .filter((key) => (italic ? /^\d00i$/.test(key) : /^\d00$/.test(key)))
    .map((key) => key[0])
    .sort()
    .join("");

const fonts = familyMetadataList
  // Open fonts only, free for any site to use and host.
  .filter((font) => font.isOpenSource !== false)
  .filter((font) => font.subsets.includes("latin") && CATEGORIES[font.category] && /^[A-Za-z0-9 ]{1,100}$/.test(font.family))
  .map((font) => {
    const keys = Object.keys(font.fonts);
    return { font, weights: hundreds(keys, false), italics: hundreds(keys, true) };
  })
  // A few families have only italics; they cannot be a site's upright text.
  .filter(({ weights }) => weights.length > 0)
  .sort((a, b) => a.font.popularity - b.font.popularity)
  .map(({ font, weights, italics }) => [font.family, CATEGORIES[font.category], weights, italics]);

const file = new URL("../src/lib/fonts/google-fonts.json", import.meta.url);
await writeFile(file, `[\n${fonts.map((font) => JSON.stringify(font)).join(",\n")}\n]\n`);
console.log(`wrote ${fonts.length} families`);
