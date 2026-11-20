#!/usr/bin/env node
// One-off generator (bloat review step 2.25): every admin text area gets its module in src/lib/admin-words, in step 0.7's shape
// (`export const <AREA>_WORDS: Record<AdminLang, <X>Messages> = { en, nb }`), read from src/lib/admin-text.ts. A cut of step 2.27
// (`<cut>: cut(<source>, [groups])`) gets a module of its own too, `export const <CUT>_WORDS = cut(<AREA>_WORDS, [groups])`. Run from the
// repo root: node docs/audits/bloat-review-2026-11/scripts/admin-words-modules.mjs. It refuses to overwrite a file, skips one that already
// holds the area's constant (step 0.7's), prints the files written, and exits 1 when an area has no entry or an import it cannot match.
// It writes nothing but files in src/lib/admin-words. Once admin-text.ts holds types only, a new area is written from its entry in
// AdminAreaMessages (`area: XMessages;`) and its `import type { XMessages } from "./admin-messages/<stem>.en";` line.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const TEXT = readFileSync(join(ROOT, "src/lib/admin-text.ts"), "utf8");
const WORDS_DIR = join(ROOT, "src/lib/admin-words");

const constantOf = (area) => `${area.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase()}_WORDS`;
const kebab = (area) => area.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

const problems = [];
const written = [];
const kept = [];

/** `xEn` -> { stem, type } from `import { xEn, type XMessages } from "./admin-messages/<stem>.en";` */
const english = new Map();
for (const m of TEXT.matchAll(/^import \{ (\w+En), type (\w+Messages) \} from "\.\/admin-messages\/([\w-]+)\.en";$/gm)) english.set(m[1], { type: m[2], stem: m[3] });
/** `xNb` -> stem */
const norwegian = new Map();
for (const m of TEXT.matchAll(/^import \{ (\w+Nb) \} from "\.\/admin-messages\/([\w-]+)\.nb";$/gm)) norwegian.set(m[1], m[2]);
/** `X_WORDS` -> stem, from step 0.7's `import { X_WORDS } from "./admin-words/<stem>";` */
const modules = new Map();
for (const m of TEXT.matchAll(/^import \{ (\w+_WORDS) \} from "\.\/admin-words\/([\w-]+)";$/gm)) modules.set(m[1], m[2]);

const typeBody = /export type AdminAreaMessages = \{([\s\S]*?)\n\};/.exec(TEXT)?.[1] ?? "";
const areas = [...typeBody.matchAll(/^\s+(\w+):/gm)].map((m) => m[1]);
const tableBody = /const CATALOGUES[^=]*= \{([\s\S]*?)\n\};/.exec(TEXT)?.[1] ?? "";
const entries = new Map();
for (const line of tableBody.split("\n").map((l) => l.trim()).filter(Boolean)) {
  const m = /^(\w+): (.*),$/.exec(line);
  if (!m) problems.push(`a CATALOGUES line it cannot read: ${line}`);
  else entries.set(m[1], m[2]);
}

function write(file, body) {
  const path = join(WORDS_DIR, file);
  if (existsSync(path)) {
    problems.push(`refused to overwrite src/lib/admin-words/${file}`);
    return;
  }
  writeFileSync(path, body);
  written.push(`src/lib/admin-words/${file}`);
}

/** The module constant behind a cut's source: `X_WORDS` (step 0.7) or `{ en: xEn, nb: xNb }` (written here). */
function sourceConstant(source) {
  if (/^\w+_WORDS$/.test(source)) return modules.has(source) ? { constant: source, stem: modules.get(source) } : null;
  const pair = /^\{ en: (\w+En), nb: (\w+Nb) \}$/.exec(source);
  if (!pair || !english.has(pair[1])) return null;
  const stem = english.get(pair[1]).stem;
  for (const [area, value] of entries) if (value === source) return { constant: constantOf(area), stem };
  return null;
}

/** A module that exports `constant` already, by its file. */
const existing = new Map();
for (const name of readdirSync(WORDS_DIR).filter((file) => file.endsWith(".ts"))) {
  const constant = /export const (\w+_WORDS)\b/.exec(readFileSync(join(WORDS_DIR, name), "utf8"))?.[1];
  if (constant) existing.set(constant, name);
}
/** `XMessages` -> stem, from `import type { XMessages } from "./admin-messages/<stem>.en";` (admin-text.ts once it holds types only). */
const typeStems = new Map();
for (const m of TEXT.matchAll(/^import type \{ (\w+Messages) \} from "\.\/admin-messages\/([\w-]+)\.en";$/gm)) typeStems.set(m[1], m[2]);
const camel = (stem) => stem.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

for (const area of areas) {
  let value = entries.get(area);
  if (value === undefined && existing.has(constantOf(area))) continue;
  if (value === undefined) {
    // No table any more (step 2.25's last commit): a new area is its type entry, `area: XMessages;`, and its type import.
    const type = new RegExp(`^\\s+${area}: (\\w+Messages);`, "m").exec(typeBody)?.[1];
    const stem = type && typeStems.get(type);
    if (!stem) {
      problems.push(`${area} has no module, no CATALOGUES entry and no "import type { XMessages }" line to make one from`);
      continue;
    }
    const en = `${camel(stem)}En`;
    const nb = `${camel(stem)}Nb`;
    const exported = (lang, name) => new RegExp(`export const ${name}\\b`).test(readFileSync(join(ROOT, `src/lib/admin-messages/${stem}.${lang}.ts`), "utf8"));
    if (!exported("en", en) || !exported("nb", nb)) {
      problems.push(`${area}: src/lib/admin-messages/${stem}.{en,nb}.ts do not export ${en} and ${nb}`);
      continue;
    }
    english.set(en, { type, stem });
    norwegian.set(nb, stem);
    value = `{ en: ${en}, nb: ${nb} }`;
  }
  const constant = constantOf(area);
  if (/^\w+_WORDS$/.test(value)) {
    if (value !== constant) problems.push(`${area}: its module's constant is ${value}, not ${constant}`);
    continue;
  }
  const pair = /^\{ en: (\w+En), nb: (\w+Nb) \}$/.exec(value);
  if (pair) {
    const en = english.get(pair[1]);
    if (!en || norwegian.get(pair[2]) !== en.stem) {
      problems.push(`${area}: no import line matches ${pair[1]} and ${pair[2]}`);
      continue;
    }
    const file = `${en.stem}.ts`;
    const path = join(WORDS_DIR, file);
    if (existsSync(path)) {
      // Step 0.7 made this module already; its CATALOGUES entry still reads the pair.
      if (readFileSync(path, "utf8").includes(`export const ${constant}: Record<AdminLang, ${en.type}> = { en: ${pair[1]}, nb: ${pair[2]} };`)) kept.push(`src/lib/admin-words/${file}`);
      else problems.push(`src/lib/admin-words/${file} exists and is not ${area}'s module`);
      continue;
    }
    write(
      file,
      `/**
 * The ${area} area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * ${constant}[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { ${pair[1]}, type ${en.type} } from "../admin-messages/${en.stem}.en";
import { ${pair[2]} } from "../admin-messages/${en.stem}.nb";

export const ${constant}: Record<AdminLang, ${en.type}> = { en: ${pair[1]}, nb: ${pair[2]} };
`,
    );
    continue;
  }
  const cutOf = /^cut\((.+), (\[[^\]]*\])\)$/.exec(value);
  if (cutOf) {
    const source = sourceConstant(cutOf[1]);
    if (!source) {
      problems.push(`${area}: cannot match the cut's source ${cutOf[1]}`);
      continue;
    }
    const groups = [...cutOf[2].matchAll(/"(\w+)"/g)].map((m) => m[1]);
    write(
      `${kebab(area)}.ts`,
      `/**
 * The ${area} cut (bloat review step 2.27): the groups ${groups.join(", ")} of ${source.constant},
 * the same objects in both languages (bloat review step 2.25). Server code reads it as ${constant}[lang].
 * Never import this from a "use client" file: it holds both languages.
 */
import { cut } from "../admin-area";
import { ${source.constant} } from "./${source.stem}";

export const ${constant} = cut(${source.constant}, ${cutOf[2]});
`,
    );
    continue;
  }
  problems.push(`${area}: a CATALOGUES entry it cannot read: ${value}`);
}

for (const file of written) console.log(`wrote ${file}`);
for (const file of kept) console.log(`kept ${file} (step 0.7's)`);
for (const problem of problems) console.error(problem);
console.log(`${written.length} written, ${kept.length} kept, ${areas.length} areas`);
process.exit(problems.length > 0 ? 1 : 0);
