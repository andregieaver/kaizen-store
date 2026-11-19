// One file per decision, with a generated index (bloat review step 2.40). Plain Node, no dependencies.
//
//   node scripts/decisions.mjs check          exit 1 while the files and the index in docs/decisions.md disagree or a line is too long
//   node scripts/decisions.mjs write          rewrite the index between its two markers from the files in docs/decisions/
//   node scripts/decisions.mjs new "Title."   take the next number: write docs/decisions/D<n>.md, rewrite the index, print D<n>
//   node scripts/decisions.mjs split          write a file for every old-form table row of docs/decisions.md (each proved word for word)
//   node scripts/decisions.mjs fold           split, then take those rows out of docs/decisions.md and rewrite the index
//
// A decision's text lives in docs/decisions/D<n>.md: line 1 '# D<n>: <title>', then the text, then 'Date: <date>' and the
// consequence when it has one. docs/decisions.md keeps one short row per decision between '<!-- decisions:index -->' and
// '<!-- /decisions:index -->', which only `write` produces. `fold` is for a row written the old way (a whole row in the table, or a
// merge with an old checkout): it turns the row into its file without changing a word.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const ROOT = path.join(import.meta.dirname, "..");
export const OPEN = "<!-- decisions:index -->";
export const CLOSE = "<!-- /decisions:index -->";
export const HEADER = "| # | Decision | Date | Text |";
export const RULE = "|---|---|---|---|";
export const MAX_LINE = 500;
export const MAX_INDEX_ROW = 190;
export const MAX_FILE_BYTES = 200_000;
export const FIX = "run node scripts/decisions.mjs write; a decision's text goes in docs/decisions/D{n}.md, lines under 500 characters";

const ROW = /^\| (D\d+) \|/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NEW_FORM = /\]\(decisions\/D\d+\.md\) \|$/;
const bytes = (text) => Buffer.byteLength(text);

/** The text between backticks, as [start, end) ranges: a run of n backticks opens a span that the next run of n closes. */
function codeSpans(text) {
  const spans = [];
  let open = null;
  for (let i = 0; i < text.length; ) {
    if (text[i] !== "`") {
      i += 1;
      continue;
    }
    let j = i;
    while (text[j] === "`") j += 1;
    if (open === null) open = { size: j - i, start: i };
    else if (open.size === j - i) {
      spans.push([open.start, j]);
      open = null;
    }
    i = j;
  }
  if (open) spans.push([open.start, text.length]);
  return spans;
}

const inside = (spans, i) => spans.some(([a, b]) => i >= a && i < b);

/** A row's cells: split at ' | ' outside code spans; the first is the id. Throws with the id when the row does not give 2 or 4. */
export function parseRow(line) {
  const id = ROW.exec(line)?.[1] ?? "?";
  let body = line.slice(2);
  if (body.endsWith("|")) body = body.slice(0, -1);
  const spans = codeSpans(body);
  const cells = [];
  let from = 0;
  for (let i = 0; i < body.length; i += 1) {
    if (body.startsWith(" | ", i) && !inside(spans, i + 1) && body[i - 1] !== "\\") {
      cells.push(body.slice(from, i));
      from = i + 3;
      i += 2;
    }
  }
  cells.push(body.slice(from));
  const trimmed = cells.map((cell) => cell.trim());
  // A row written without the space after its date's bar ('| 2026-11-18 |Migration versions ...'): the date and the consequence.
  const glued = trimmed.length === 3 ? /^(\d{4}-\d{2}-\d{2}) \|\s*(.*)$/s.exec(trimmed[2]) : null;
  if (glued) trimmed.splice(2, 1, glued[1], glued[2]);
  if (trimmed.length < 2 || trimmed.length > 4) throw new Error(`${id}: the row has ${trimmed.length} cells, not 2, 3 or 4`);
  // A date, or the one word an old row has there ('Decided'); a longer cell means a pipe was split at the wrong place.
  if (trimmed.length >= 3 && !DATE.test(trimmed[2]) && !/^[A-Za-z]{1,20}$/.test(trimmed[2])) throw new Error(`${id}: the third cell "${trimmed[2].slice(0, 30)}" is not a date: a pipe is misplaced`);
  return { id, cells: trimmed };
}

/** Breaks a paragraph into lines of at most 500 bytes (so 500 characters in any counter): after a sentence end when there is one in reach, else at a space; never inside a code span. */
export function wrapParagraph(text, id) {
  const spans = codeSpans(text);
  const lines = [];
  let start = 0;
  while (bytes(text.slice(start)) > MAX_LINE) {
    let used = 0;
    let end = start;
    while (end < text.length && used + bytes(text[end]) <= MAX_LINE) {
      used += bytes(text[end]);
      end += 1;
    }
    // A space at index i can end a line when the line before it fits: i <= end.
    let sentence = -1;
    let space = -1;
    for (let i = start + 1; i <= end && i < text.length; i += 1) {
      if (text[i] !== " " || inside(spans, i)) continue;
      space = i;
      if (/[.!?]/.test(text[i - 1]) && /^[A-Z`]/.test(text.slice(i + 1))) sentence = i;
    }
    const at = sentence >= 0 ? sentence : space;
    if (at < 0) throw new Error(`${id}: a stretch of more than ${MAX_LINE} characters has no space outside a code span`);
    lines.push(text.slice(start, at));
    start = at + 1;
  }
  lines.push(text.slice(start));
  return lines.join("\n");
}

/** The title of a decision: the bold lead of its text cut at its first '(', ':' or sentence end. */
export function titleOf(text) {
  const lead = /\*\*(.+?)\*\*/.exec(text)?.[1] ?? text.slice(0, 80);
  const cut = lead.search(/\(|: |\. |\.$|:$/);
  return (cut > 0 ? lead.slice(0, cut) : lead).trim() || "Decision";
}

const strip = (text) => text.replace(/[\s|]/g, "");

/** Throws naming the id unless the file holds every word of the row: without line 1 and the one label the script wrote, and without blanks and pipes, it is the row without its id cell. */
export function prove(line, file) {
  const id = ROW.exec(line)?.[1] ?? "?";
  const label = file.indexOf("\n\nDate: ");
  const body = (label < 0 ? file : `${file.slice(0, label)}\n\n${file.slice(label + 8)}`).split("\n").slice(1).join("\n");
  const have = strip(body);
  const want = strip(line.slice(line.indexOf("|", 2) + 1));
  if (have === want) return;
  let at = 0;
  while (at < have.length && have[at] === want[at]) at += 1;
  throw new Error(`${id}: the file differs from the row at position ${at}: a word changed`);
}

/** One old-form row as the text of its file, proved to hold every word of the row. Throws naming the id. */
export function fileOf(line) {
  const { id, cells } = parseRow(line);
  const parts = [`# ${id}: ${titleOf(cells[1])}`, "", wrapParagraph(cells[1], id)];
  if (cells.length >= 3) {
    parts.push("", `Date: ${cells[2]}`);
    if ((cells[3] ?? "") !== "") parts.push("", wrapParagraph(cells[3], id));
  }
  const file = `${parts.join("\n")}\n`;
  prove(line, file);
  return { id, n: Number(id.slice(1)), text: file };
}

/** The rows of a text that are written the old way, with the lines they stand on. */
export function oldRows(text) {
  return text.split("\n").flatMap((line, i) => (ROW.test(line) && !NEW_FORM.test(line) ? [{ line, i }] : []));
}

/** The index row of one decision, at most 190 characters. The one builder: `write` and the claim script use it. */
export function indexRow(n, title, date) {
  const head = `| D${n} | **`;
  const tail = `** | ${date ?? ""} | [text](decisions/D${n}.md) |`;
  let clean = String(title).replace(/`/g, "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
  const room = MAX_INDEX_ROW - head.length - tail.length;
  if (clean.length > room) clean = `${clean.slice(0, room - 1).replace(/\\$/, "").trimEnd()}…`;
  return `${head}${clean}${tail}`;
}

/** What a file says about itself: its number, its title (line 1) and its date (the first 'Date: ' line after a blank one). */
export function describe(name, text) {
  const n = Number(/^D(\d+)\.md$/.exec(name)?.[1]);
  const first = text.split("\n", 1)[0];
  const title = first.startsWith(`# D${n}: `) ? first.slice(`# D${n}: `.length) : "";
  const date = /\n\nDate: ([^\n]*)/.exec(text)?.[1].trim() ?? "";
  return { n, title, date };
}

const dir = (root) => path.join(root, "docs", "decisions");
const indexPath = (root) => path.join(root, "docs", "decisions.md");
const fileNames = (root) => (existsSync(dir(root)) ? readdirSync(dir(root)).filter((name) => /^D\d+\.md$/.test(name)) : []);

/** The decision files, in number order. */
export function readFiles(root = ROOT) {
  return fileNames(root)
    .map((name) => ({ name, text: readFileSync(path.join(dir(root), name), "utf8") }))
    .map((file) => ({ ...file, ...describe(file.name, file.text) }))
    .sort((a, b) => a.n - b.n);
}

/** The block between the markers, as `write` produces it. */
export function indexBlock(files) {
  return [OPEN, HEADER, RULE, ...files.map((file) => indexRow(file.n, file.title, file.date)), CLOSE].join("\n");
}

/** The text of docs/decisions.md with the index between its markers replaced; throws when a marker is missing. */
export function withIndex(text, files) {
  const a = text.indexOf(OPEN);
  const b = text.indexOf(CLOSE);
  if (a < 0 || b < a) throw new Error("no index markers in docs/decisions.md");
  return `${text.slice(0, a)}${indexBlock(files)}${text.slice(b + CLOSE.length)}`;
}

/** The message for rows written the old way: what to run instead, and that `write` would drop them. */
export function oldRowMessage(rows) {
  const ids = rows.map(({ line }) => ROW.exec(line)[1]).join(", ");
  return `${ids} ${rows.length === 1 ? "is" : "are"} written into docs/decisions.md as a whole row: run node scripts/decisions.mjs fold, which makes docs/decisions/<id>.md from each row word for word and rewrites the index (write would drop the row, so it refuses)`;
}

export function write(root = ROOT) {
  const files = readFiles(root);
  const text = readFileSync(indexPath(root), "utf8");
  const old = oldRows(text);
  if (old.length > 0) throw new Error(oldRowMessage(old));
  writeFileSync(indexPath(root), withIndex(text, files));
  return `index written: ${files.length} decisions`;
}

/** Every old-form row of docs/decisions.md as a file in docs/decisions, each proved. Writes nothing when one fails. */
export function split(root = ROOT) {
  const rows = oldRows(readFileSync(indexPath(root), "utf8"));
  const made = rows.map(({ line }) => fileOf(line));
  const taken = made.filter((file) => existsSync(path.join(dir(root), `${file.id}.md`))).map((file) => file.id);
  if (taken.length > 0) throw new Error(`${taken.join(", ")} already has a file: a number is used once`);
  mkdirSync(dir(root), { recursive: true });
  let longest = 0;
  for (const file of made) {
    writeFileSync(path.join(dir(root), `${file.id}.md`), file.text);
    longest = Math.max(longest, ...file.text.split("\n").map((line) => line.length));
  }
  return `rows read: ${rows.length}, files written: ${made.length}, longest line: ${longest}`;
}

/** split, then drop the old-form rows from docs/decisions.md and rewrite the index. */
export function fold(root = ROOT) {
  const summary = split(root);
  const text = readFileSync(indexPath(root), "utf8");
  const gone = new Set(oldRows(text).map((row) => row.i));
  const kept = text.split("\n").filter((_, i) => !gone.has(i)).join("\n");
  writeFileSync(indexPath(root), withIndex(kept, readFiles(root)));
  return `${summary}; ${gone.size} rows folded`;
}

/** Takes the next free number: its file (line 1 and the date) and its index row. Returns the id. */
export function newDecision(title, date, root = ROOT) {
  const files = readFiles(root);
  const n = (files.at(-1)?.n ?? 0) + 1;
  const clean = fileStubTitle(title);
  mkdirSync(dir(root), { recursive: true });
  writeFileSync(path.join(dir(root), `D${n}.md`), fileStub(n, clean, date));
  write(root);
  return `D${n}`;
}

/** A title as a claim keeps it: no bar or line break, at most 120 characters. */
export function fileStubTitle(title) {
  return String(title).replace(/[|\r\n]/g, "").trim().slice(0, 120);
}

/** What `new` writes, and the claim script commits: line 1, then the date. */
export function fileStub(n, title, date) {
  return `# D${n}: ${title}\n\nDate: ${date}\n`;
}

/** The problems the files and the index have; an empty list is a pass. */
export function check(root = ROOT) {
  const problems = [];
  const indexText = readFileSync(indexPath(root), "utf8");
  const names = existsSync(dir(root)) ? readdirSync(dir(root)) : [];
  const files = readFiles(root);
  for (const name of names) {
    if (name === "migration-versions.md") continue;
    if (!/^D\d+\.md$/.test(name)) problems.push(`docs/decisions/${name} is not named D<number>.md`);
  }
  for (const file of files) {
    if (file.title === "") problems.push(`docs/decisions/${file.name} does not start with '# D${file.n}: '`);
  }
  const seen = new Set();
  for (const file of files) {
    if (seen.has(file.n)) problems.push(`D${file.n} has two files`);
    seen.add(file.n);
  }
  const ids = [...indexText.matchAll(/^\| (D\d+) \|/gm)].map((m) => m[1]);
  for (const id of new Set(ids.filter((id, i) => ids.indexOf(id) !== i))) problems.push(`${id} stands twice in docs/decisions.md`);
  const old = oldRows(indexText);
  if (old.length > 0) problems.push(oldRowMessage(old));
  let expected = null;
  try {
    expected = withIndex(indexText, files);
  } catch (error) {
    problems.push(error.message);
  }
  if (expected !== null && expected !== indexText && old.length === 0) {
    const have = indexText.split("\n");
    const want = expected.split("\n");
    let at = 0;
    while (at < have.length && have[at] === want[at]) at += 1;
    problems.push(`the index in docs/decisions.md is not what the files make (first difference near line ${at + 1}: ${(have[at] ?? "").slice(0, 60)})`);
  }
  const all = [{ name: "docs/decisions.md", text: indexText }, ...names.filter((n) => n.endsWith(".md")).map((n) => ({ name: `docs/decisions/${n}`, text: readFileSync(path.join(dir(root), n), "utf8") }))];
  for (const file of all) {
    const long = file.text.split("\n").filter((line) => [...line].length > MAX_LINE).length;
    if (long > 0) problems.push(`${file.name} has ${long} line(s) over ${MAX_LINE} characters`);
    if (bytes(file.text) > MAX_FILE_BYTES) problems.push(`${file.name} is over ${MAX_FILE_BYTES} bytes`);
  }
  for (const line of indexText.split("\n")) {
    if (ROW.test(line) && [...line].length > 200) problems.push(`the index row ${ROW.exec(line)[1]} is over 200 characters`);
  }
  return problems;
}

function longest(root) {
  const lines = [readFileSync(indexPath(root), "utf8"), ...fileNames(root).map((n) => readFileSync(path.join(dir(root), n), "utf8"))].flatMap((t) => t.split("\n"));
  return Math.max(...lines.map((line) => [...line].length));
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  try {
    if (command === "check") {
      const problems = check();
      if (problems.length > 0) {
        for (const problem of problems) console.error(problem);
        console.error(`${FIX}.`);
        console.log(`decisions: ${problems.length} problem(s)`);
        process.exit(1);
      }
      console.log(`decisions: ${readFiles().length} files, longest line ${longest(ROOT)}`);
    } else if (command === "write") console.log(write());
    else if (command === "split") console.log(split());
    else if (command === "fold") console.log(fold());
    else if (command === "new") {
      const title = rest.join(" ").trim();
      if (!title) throw new Error('Give the decision a title: node scripts/decisions.mjs new "Title."');
      process.stdout.write(`${newDecision(title, new Date().toISOString().slice(0, 10))}\n`);
    } else throw new Error('Use: check, write, split, fold or new "Title."');
  } catch (error) {
    console.error(String(error.message ?? error));
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
