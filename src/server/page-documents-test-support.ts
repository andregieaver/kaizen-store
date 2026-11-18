import type { StatementRecord } from "@/db/statement-count";

/**
 * Test support for reads of whole page documents (bloat review step 2.17): whether a statement's select list returns the column `draft`
 * or `published` whole (bare or qualified, `p.published`, with or without an alias), not a JSON operator on it, a function of it, or
 * `published_at`, `published_title`, `published_titles`. Only the outermost select list is read; a subquery's is not. The name ends in
 * test-support.ts, so the code ratchet does not count it.
 */

/** The items of a statement's first select list, split at the commas outside parentheses. */
function selectList(text: string): string[] {
  const lower = text.toLowerCase();
  const start = lower.search(/\bselect\b/);
  if (start < 0) return [];
  const items: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (let i = start + "select".length; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'") quoted = !quoted;
    if (!quoted) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (depth === 0 && /\bfrom\b/.test(lower.slice(i, i + 5)) && /\s/.test(text[i - 1] ?? " ")) break;
      else if (depth === 0 && ch === ",") {
        items.push(current.trim());
        current = "";
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) items.push(current.trim());
  return items.map((item) => item.replace(/^distinct\s+/i, ""));
}

const WHOLE = /^(?:[a-z_][a-z0-9_]*\.)?(draft|published)(?:\s+(?:as\s+)?[a-z_][a-z0-9_]*)?$/i;

/** Whether a statement returns the column draft or published whole. */
export function selectsDocument(text: string): boolean {
  return selectList(text).some((item) => WHOLE.test(item));
}

/** How many whole page documents the statements returned: the rows of each that selects draft or published whole. */
export function documentsRead(records: readonly StatementRecord[]): number {
  return records.filter((r) => !r.control && selectsDocument(r.text)).reduce((sum, r) => sum + (r.rows ?? 0), 0);
}
