// The pure part of scripts/claim-decision.mjs (bloat review step 0.41): which number is next, the stub row that holds it, and the
// retry when main moved. Plain Node, built-ins only.

const ROW = /^\| D(\d+) \|/;

/** The next free decision number: the highest one on any row, plus one. Gaps (D541 to D549) are never reused. */
export function nextDecision(text) {
  let highest = -1;
  for (const match of text.matchAll(/^\| D(\d+) \|/gm)) highest = Math.max(highest, Number(match[1]));
  if (highest < 0) throw new Error("No decision rows found");
  return highest + 1;
}

/** The row that holds a number until its text is written. */
export function stubRow(id, title, date) {
  const clean = String(title).replace(/[|\r\n]/g, "").trim().slice(0, 120);
  return `| D${id} | **${clean}** (claimed ${date}, text follows) | ${date} | |`;
}

/** The text with the stub row directly after the last decision row; refuses a number a row already has. */
export function withStub(text, id, title, date) {
  const lines = text.split("\n");
  let last = -1;
  lines.forEach((line, i) => {
    const match = ROW.exec(line);
    if (match) {
      if (Number(match[1]) === Number(id)) throw new Error(`D${id} is taken`);
      last = i;
    }
  });
  if (last < 0) throw new Error("No decision rows found");
  lines.splice(last + 1, 0, stubRow(id, title, date));
  return lines.join("\n");
}

/**
 * Claims the next number. io.read() gives docs/decisions.md as it is on origin/main; io.push(newText, message) gives true when the
 * push was accepted and false when it was refused because main moved (then the next try reads main again).
 */
export async function claimWith(io, title, date, tries = 5) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const text = await io.read();
    const id = nextDecision(text);
    const ok = await io.push(withStub(text, id, title, date), `Decision D${id} claimed: ${title}`);
    if (ok) return id;
  }
  throw new Error("main kept moving: no number claimed");
}

/** The two facts that make a claim free: docs are outside CI's paths and Vercel does not deploy main by itself. */
export function claimIsFree(ci, vercelJson) {
  if (!ci.includes(' - "!docs/**"')) return false;
  try {
    return JSON.parse(vercelJson)?.git?.deploymentEnabled?.main === false;
  } catch {
    return false;
  }
}
