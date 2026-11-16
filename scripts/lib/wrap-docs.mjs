// Wraps the long prose lines of Markdown (bloat review step 0.40) and proves no word changed.
// A prose line over LIMIT that cannot be broken (no single space outside its code spans, so wrapText leaves it as it is) is
// "unbreakable": it is counted apart and is not a failure of the check. Used by `scripts/wrap-docs.mjs`
// and held by `src/lib/wrap-docs.test.ts`. Plain Node, no reading of the working directory: the caller passes the text.

export const LIMIT = 500;
export const WIDTH = 130;

const FENCE = /^\s*(```|~~~)/;
const LIST_START = /^(\s*)([-*+]|\d+[.)])(\s+)/;
/** What a continuation line must not start with, or Markdown would read it as a new block. */
const BLOCK_START = /^([-*+>#|=]|\d+[.)]\s|```|~~~)/;

function continuationIndent(line) {
  const list = LIST_START.exec(line);
  if (list) return " ".repeat(list[0].length);
  if (line.startsWith(">")) return "";
  return /^\s*/.exec(line)[0];
}

/** Wrap one long prose line at single spaces outside code spans. */
function wrapLine(line) {
  const indent = continuationIndent(line);
  const lead = /^\s*/.exec(line)[0].length;
  // Allowed break points: a single space whose count of backticks before it is even.
  const allowed = [];
  let ticks = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "`") ticks++;
    else if (line[i] === " " && i >= lead && line[i - 1] !== " " && line[i + 1] !== " " && i + 1 < line.length && ticks % 2 === 0) allowed.push(i);
  }
  const pieces = [];
  let start = 0;
  for (;;) {
    const col = (i) => (pieces.length === 0 ? i : indent.length + (i - start));
    if (col(line.length) <= WIDTH) break;
    const usable = allowed.filter((i) => i > start);
    if (usable.length === 0) break;
    let k = -1;
    for (let j = 0; j < usable.length; j++) if (col(usable[j]) <= WIDTH) k = j;
    if (k === -1) k = 0;
    while (k >= 0 && BLOCK_START.test(line.slice(usable[k] + 1))) k--;
    if (k < 0) {
      k = usable.findIndex((i) => col(i) > WIDTH && !BLOCK_START.test(line.slice(i + 1)));
      if (k === -1) break;
    }
    const at = usable[k];
    pieces.push((pieces.length === 0 ? "" : indent) + line.slice(start, at));
    start = at + 1;
  }
  pieces.push((pieces.length === 0 ? "" : indent) + line.slice(start));
  return pieces.join("\n");
}

/** The text with every over-long prose line wrapped. Headings, table rows and fenced blocks are kept. */
export function wrapText(text) {
  let inFence = false;
  return text
    .split("\n")
    .map((line) => {
      if (FENCE.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence || line.length <= LIMIT || line.trimStart().startsWith("|") || line.startsWith("#")) return line;
      return wrapLine(line);
    })
    .join("\n");
}

/** True when the two texts have the same words in the same order (whitespace collapsed). */
export function sameWords(before, after) {
  return before.replace(/\s+/g, " ") === after.replace(/\s+/g, " ");
}

/** How many lines are over LIMIT: prose that can be wrapped, prose that cannot (unbreakable), and table rows (never wrapped). */
export function longLines(text) {
  let inFence = false;
  let prose = 0;
  let table = 0;
  let unbreakable = 0;
  for (const line of text.split("\n")) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || line.length <= LIMIT) continue;
    if (line.trimStart().startsWith("|")) table++;
    else if (wrapText(line) === line) unbreakable++;
    else prose++;
  }
  return { prose, table, unbreakable };
}
