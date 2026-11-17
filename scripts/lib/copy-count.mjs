// What the copies budget of bloat review step 1.17 counts (findings CP-14, FM-13 and FM-7), shared by `scripts/copies.mjs` (which
// writes `src/lib/copies.baseline.json`) and `src/lib/copies.scan.test.ts` (which holds the code to it). Plain Node, no dependency.
// Four counters, each the library form of a script of the review's folder (docs/audits/bloat-review-2026-11/scripts/copy-count.mjs,
// twin-count.mjs and helper-count.mjs), with the same rules, so the numbers are theirs:
//   exactCopies(root)     lines that lie in a window of 10 lines repeated elsewhere, across files and inside one file;
//   nearCopies(root)      the same with strings, numbers and names blanked, so a renamed copy is seen;
//   twinPairs(root)       pairs of files that share 20 or more long lines and 30% of the smaller file;
//   repeatedHelpers(root) small top-level functions whose text is identical in three or more files.
// All four read the source tree through one cache (`sourceText`), so a run reads every file once.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** The window of lines, the least characters in it and the least distinct lines (a catalogue or a props list is not a copy). */
export const WINDOW = 10;
export const MIN_WINDOW_CHARS = 220;
export const MIN_DISTINCT_LINES = 6;
/** Twins: shared lines of at least this many characters, this many of them, and this share of the smaller file. */
export const TWIN_LINE_CHARS = 30;
export const TWIN_SHARED_LINES = 20;
export const TWIN_SHARE = 0.3;
/** A helper: a top-level function or arrow of this many characters, the same text in this many files. */
export const HELPER_MIN_CHARS = 60;
export const HELPER_MAX_CHARS = 600;
export const HELPER_FILES = 3;

const cache = new Map();

/** The text of a file, read once per process for the root it was read under. */
function sourceText(root, rel) {
  const key = `${root}\u0000${rel}`;
  let text = cache.get(key);
  if (text === undefined) {
    text = readFileSync(path.join(root, rel), "utf8");
    cache.set(key, text);
  }
  return text;
}

/** Forget what was read (the detector's own tests write small trees under a temporary folder). */
export function forgetSources() {
  cache.clear();
}

function walk(root, dir, acc = []) {
  for (const name of readdirSync(path.join(root, dir)).sort()) {
    const rel = path.posix.join(dir, name);
    if (statSync(path.join(root, rel)).isDirectory()) walk(root, rel, acc);
    else if (/\.(ts|tsx)$/.test(name)) acc.push(rel);
  }
  return acc;
}

const isTest = (rel) => /\.(test|spec)\./.test(path.posix.basename(rel));
const isMessages = (rel) => /\/lib\/(admin-messages|messages)\//.test(`/${rel}`);

/** The files the copy counter reads: source, tests aside, and what is copied by design (word catalogues, the schema). */
function copyFiles(root) {
  return walk(root, "src").filter(
    (f) => !isTest(f) && !f.endsWith(".d.ts") && !/test-helper/.test(path.posix.basename(f)) && !f.startsWith("src/test/") && !isMessages(f) && !f.endsWith("/db/schema.ts"),
  );
}

const KEYWORDS = new Set(
  "const let var function return if else for while do await async new typeof export default type interface extends implements class try catch finally throw switch case break continue null undefined true false in of as satisfies void this yield delete instanceof enum keyof readonly static public private protected string number boolean unknown never any object symbol bigint import from get set is infer declare namespace abstract super LIT".split(
    " ",
  ),
);

/** A line made alike: level 0 as it is, level 2 with strings and numbers as LIT and every name that is not a keyword as ID. */
function normalise(text, level) {
  if (level === 0) return text;
  let s = text
    .replace(/"(?:[^"\\]|\\.)*"/g, "\u0001")
    .replace(/'(?:[^'\\]|\\.)*'/g, "\u0001")
    .replace(/`(?:[^`\\]|\\.)*`/g, "\u0001")
    .replace(/\b\d[\d_]*(?:\.\d+)?n?\b/g, "\u0001");
  if (level >= 2) s = s.replace(/[A-Za-z_$][\w$]*/g, (m) => (KEYWORDS.has(m) ? m : "ID"));
  return s.replace(/\u0001/g, "LIT").replace(/\s+/g, " ");
}

/** The lines of a file that count: no blank line, comment, import or lone closing bracket. */
function keptLines(text, level) {
  const kept = [];
  let inBlock = false;
  text.split("\n").forEach((line, idx) => {
    let t = line.trim();
    if (inBlock) {
      if (t.includes("*/")) inBlock = false;
      return;
    }
    if (t.startsWith("/*")) {
      if (!t.includes("*/")) inBlock = true;
      return;
    }
    if (!t || t.startsWith("//") || t.startsWith("*") || t.startsWith("import ") || /^[)}\]];?,?$/.test(t)) return;
    t = t.replace(/\s+/g, " ");
    kept.push({ text: t, n: idx + 1, norm: normalise(t, level) });
  });
  return kept;
}

/** Every window of 10 kept lines that passes the filters, by hash of its normalised lines: { hash: [{ file, i }] }. */
function scanWindows(root, level) {
  const files = copyFiles(root);
  const data = new Map();
  const windows = new Map();
  let keptAll = 0;
  for (const file of files) {
    const kept = keptLines(sourceText(root, file), level);
    data.set(file, kept);
    keptAll += kept.length;
    for (let i = 0; i + WINDOW <= kept.length; i++) {
      let rawLength = 0;
      const distinct = new Set();
      for (let k = i; k < i + WINDOW; k++) {
        rawLength += kept[k].text.length;
        distinct.add(kept[k].norm);
      }
      if (rawLength < MIN_WINDOW_CHARS || distinct.size < MIN_DISTINCT_LINES) continue;
      const hash = createHash("md5").update(kept.slice(i, i + WINDOW).map((l) => l.norm).join("\n")).digest("base64").slice(0, 14);
      let list = windows.get(hash);
      if (!list) windows.set(hash, (list = []));
      list.push({ file, i });
    }
  }
  return { data, windows, keptAll, files: files.length };
}

/** The windows repeated in two or more places, the lines they cover (anywhere, and across files), and the file pairs and families they make. */
function scanCopies(root, level) {
  const { data, windows, keptAll, files } = scanWindows(root, level);
  const copiedAny = new Map();
  const copiedCross = new Map();
  const mark = (m, file, i) => {
    let s = m.get(file);
    if (!s) m.set(file, (s = new Set()));
    for (let k = i; k < i + WINDOW; k++) s.add(k);
  };
  const multi = [];
  for (const [hash, list] of windows) {
    if (list.length < 2) continue;
    const fset = new Set(list.map((x) => x.file));
    for (const { file, i } of list) {
      mark(copiedAny, file, i);
      if (fset.size >= 2) mark(copiedCross, file, i);
    }
    if (fset.size >= 2) multi.push({ hash, list, nfiles: fset.size });
  }
  const sum = (m) => [...m.values()].reduce((a, s) => a + s.size, 0);

  // Families: a window shared by the most files first, grown forward and back while the next window is still shared by 60% of the same places.
  multi.sort((a, b) => b.nfiles - a.nfiles || b.list.length - a.list.length);
  const used = new Set();
  const key = (file, i) => `${file}#${i}`;
  const hashAt = new Map();
  for (const [hash, list] of windows) for (const { file, i } of list) hashAt.set(key(file, i), hash);
  const families = [];
  for (const m of multi) {
    const places = m.list.filter((p) => !used.has(key(p.file, p.i)));
    const fset = new Set(places.map((p) => p.file));
    if (fset.size < 2) continue;
    let start = 0;
    let end = 0;
    const shared = (off) => {
      const hs = new Map();
      for (const p of places) {
        const h = hashAt.get(key(p.file, p.i + off));
        if (h) hs.set(h, (hs.get(h) ?? 0) + 1);
      }
      let best = 0;
      for (const v of hs.values()) best = Math.max(best, v);
      return best;
    };
    const need = Math.max(2, Math.ceil(places.length * 0.6));
    while (shared(end + 1) >= need) end++;
    while (shared(start - 1) >= need) start--;
    for (const p of places) for (let o = start - WINDOW + 1; o <= end + WINDOW - 1; o++) used.add(key(p.file, p.i + o));
    families.push({
      files: fset.size,
      places: places.length,
      lines: end - start + WINDOW,
      at: places.map((p) => `${p.file}:${data.get(p.file)[Math.max(0, p.i + start)]?.n}`),
    });
  }
  families.sort((a, b) => (b.places - 1) * b.lines - (a.places - 1) * a.lines);

  // Pairs of files by the windows they share (a window in more than 12 files is a pattern, not a pair).
  const pairCounts = new Map();
  for (const m of multi) {
    const fl = [...new Set(m.list.map((x) => x.file))];
    if (fl.length > 12) continue;
    for (let a = 0; a < fl.length; a++) {
      for (let b = a + 1; b < fl.length; b++) {
        const k = fl[a] < fl[b] ? `${fl[a]}|${fl[b]}` : `${fl[b]}|${fl[a]}`;
        pairCounts.set(k, (pairCounts.get(k) ?? 0) + 1);
      }
    }
  }
  const pairs = [...pairCounts.entries()]
    .map(([k, windowsShared]) => {
      const [a, b] = k.split("|");
      return { a, b, windows: windowsShared };
    })
    .sort((x, y) => y.windows - x.windows || (x.a + x.b < y.a + y.b ? -1 : 1));
  return { any: sum(copiedAny), cross: sum(copiedCross), keptAll, files, pairs, families };
}

/**
 * Exact copies (level 0): `acrossFiles` lines that lie in a window repeated in another file, `insideFiles` lines in a window repeated only
 * inside its own file, `pairs` the file pairs with the windows they share, largest first.
 */
export function exactCopies(root) {
  const r = scanCopies(root, 0);
  return { acrossFiles: r.cross, insideFiles: r.any - r.cross, pairs: r.pairs };
}

/** Near copies (level 2): `lines` copied once names, strings and numbers are blanked, `families` the groups of files sharing windows, largest first. */
export function nearCopies(root) {
  const r = scanCopies(root, 2);
  return { lines: r.any, families: r.families };
}

/** The copy counter's figure for test files, printed in the report and never held. */
export function exactCopiesInTests(root) {
  const files = walk(root, "src").filter((f) => isTest(f) && !f.endsWith(".d.ts"));
  const windows = new Map();
  for (const file of files) {
    const kept = keptLines(sourceText(root, file), 0);
    for (let i = 0; i + WINDOW <= kept.length; i++) {
      let rawLength = 0;
      const distinct = new Set();
      for (let k = i; k < i + WINDOW; k++) {
        rawLength += kept[k].text.length;
        distinct.add(kept[k].norm);
      }
      if (rawLength < MIN_WINDOW_CHARS || distinct.size < MIN_DISTINCT_LINES) continue;
      const hash = createHash("md5").update(kept.slice(i, i + WINDOW).map((l) => l.norm).join("\n")).digest("base64").slice(0, 14);
      let list = windows.get(hash);
      if (!list) windows.set(hash, (list = []));
      list.push({ file, i });
    }
  }
  const lines = new Map();
  for (const list of windows.values()) {
    if (new Set(list.map((x) => x.file)).size < 2) continue;
    for (const { file, i } of list) {
      let s = lines.get(file);
      if (!s) lines.set(file, (s = new Set()));
      for (let k = i; k < i + WINDOW; k++) s.add(k);
    }
  }
  return [...lines.values()].reduce((a, s) => a + s.size, 0);
}

/** Twin pairs: 'fileA|fileB' (paths from the root), sorted. Two files twin when they share 20 or more lines of 30 or more characters and 30% of the smaller. */
export function twinPairs(root) {
  const files = walk(root, "src").filter((f) => !isTest(f) && !f.endsWith(".d.ts") && !f.includes("/admin-messages/") && !f.includes("/lib/messages/"));
  const signatures = new Map();
  const sizes = [];
  files.forEach((f, i) => {
    const set = new Set();
    for (const l of sourceText(root, f).split("\n")) {
      const t = l.trim();
      if (t.length < TWIN_LINE_CHARS || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("import ") || t.startsWith("} from")) continue;
      set.add(t);
    }
    sizes[i] = set.size;
    for (const t of set) {
      let a = signatures.get(t);
      if (!a) signatures.set(t, (a = []));
      a.push(i);
    }
  });
  const shared = new Map();
  for (const a of signatures.values()) {
    if (a.length < 2 || a.length > 8) continue;
    for (let x = 0; x < a.length; x++) {
      for (let y = x + 1; y < a.length; y++) {
        const k = a[x] * 100000 + a[y];
        shared.set(k, (shared.get(k) ?? 0) + 1);
      }
    }
  }
  const pairs = [];
  for (const [k, n] of shared) {
    const x = Math.floor(k / 100000);
    const y = k % 100000;
    if (n >= TWIN_SHARED_LINES && n / Math.min(sizes[x], sizes[y]) >= TWIN_SHARE) pairs.push([files[x], files[y]].sort().join("|"));
  }
  return pairs.sort();
}

/**
 * Helpers declared with identical text in three or more files: `names` the number of distinct helpers (the figure the review calls 84),
 * `declarations` their declarations in all, `list` each helper's name with its files, most declared first.
 */
export function repeatedHelpers(root) {
  const files = walk(root, "src").filter((f) => !isTest(f) && !isMessages(f));
  const byText = new Map();
  for (const f of files) {
    const src = sourceText(root, f);
    const seen = new Set();
    const re = /^(?:export )?(?:const|function|async function) ([A-Za-z_$][\w$]*)\b[^\n]*(?:\n(?!\n)(?:  |\}|\))[^\n]*){0,5}/gm;
    let m;
    while ((m = re.exec(src))) {
      const text = m[0].replace(/^export /, "").replace(/\s+/g, " ").trim();
      if (!/=>|function/.test(text) || text.length < HELPER_MIN_CHARS || text.length > HELPER_MAX_CHARS) continue;
      if (seen.has(text)) continue;
      seen.add(text);
      const e = byText.get(text) ?? { name: m[1], files: [] };
      e.files.push(f);
      byText.set(text, e);
    }
  }
  const repeated = [...byText.values()].filter((e) => e.files.length >= HELPER_FILES).sort((a, b) => b.files.length - a.files.length || (a.name < b.name ? -1 : 1));
  return {
    names: repeated.length,
    declarations: repeated.reduce((a, e) => a + e.files.length, 0),
    list: repeated.map((e) => ({ name: e.name, files: e.files })),
  };
}
