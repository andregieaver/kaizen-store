/**
 * A log switch for scripts (bloat review step 1.11): with STATEMENT_LOG=1 each statement the database client sends is written as one JSON
 * line on stdout, its text only (white space collapsed, cut to 160 characters), never its values. `scripts/server-budget.mjs` sets the
 * variable for the app it starts and counts the lines; production never sets it. This file imports nothing.
 */
const LOG = process.env.STATEMENT_LOG === "1";

export function logStatement(text: string): void {
  if (!LOG) return;
  try {
    process.stdout.write(`${JSON.stringify({ event: "db.statement", text: text.replace(/\s+/g, " ").trim().slice(0, 160) })}\n`);
  } catch {
    // a log line never breaks a query
  }
}
