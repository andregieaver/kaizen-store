// The judging half of scripts/restore-check.mjs (docs/runbooks/restore.md): pure, so its tests run without a database.
// Every check is a line: `ok`, `differs` (worth a look, not a failure: the copy is at another moment than the reference)
// or `fail` (the copy is not safe to use, or a rule that must hold does not).

/**
 * @typedef {{ status: "ok" | "differs" | "fail", check: string, detail: string }} Finding
 */

/** A few names of a list, and how many more. */
const names = (list, shown = 5) => (list.length <= shown ? list.join(", ") : `${list.slice(0, shown).join(", ")} and ${list.length - shown} more`);

/** @returns {Finding} */
export const finding = (status, check, detail) => ({ status, check, detail });

/**
 * The copy's scheduled jobs that call out (pg_net): on a restored copy they still post to production's own routes with
 * production's secret, so they must be unscheduled before anything else is done with it.
 * @param {{ jobname: string, active: boolean, calls_out: boolean }[]} jobs
 * @returns {Finding}
 */
export function cronFinding(jobs) {
  const calling = jobs.filter((j) => j.active && j.calls_out);
  if (calling.length === 0) return finding("ok", "scheduled jobs", jobs.length === 0 ? "none scheduled" : `${jobs.length} scheduled, none calls out`);
  return finding(
    "fail",
    "scheduled jobs",
    `${calling.length} still call out (${calling.map((j) => j.jobname).join(", ")}): run "select cron.unschedule(jobid) from cron.job;" on the copy first`,
  );
}

/**
 * The migration ledger against the files in the repository. A copy restored to an earlier moment lacks the newest files
 * (expected, listed); a file the ledger has that the repository does not, or a gap before the newest applied file, fails.
 * @param {string[]} files the repository's migration files, oldest first
 * @param {string[]} applied the copy's ledger
 * @returns {Finding}
 */
export function migrationFinding(files, applied) {
  if (applied.length === 0) return finding("fail", "migrations", "the ledger is empty: this is not a copy of a database CI migrated");
  const have = new Set(applied);
  const known = new Set(files);
  const unknown = applied.filter((f) => !known.has(f));
  if (unknown.length > 0) return finding("fail", "migrations", `the ledger has files the repository does not: ${names(unknown)}`);
  const lastApplied = files.reduce((last, f, i) => (have.has(f) ? i : last), -1);
  const gaps = files.slice(0, lastApplied + 1).filter((f) => !have.has(f));
  if (gaps.length > 0) return finding("fail", "migrations", `files missing before the newest applied one: ${names(gaps)}`);
  const after = files.slice(lastApplied + 1);
  if (after.length === 0) return finding("ok", "migrations", `all ${files.length} applied`);
  return finding("differs", "migrations", `${after.length} newer than the copy (expected for an earlier moment): ${names(after)}`);
}

/**
 * Counts on the copy against the reference's counts at the copy's moment. Equal is ok; a difference is worth a look, since
 * rows written in the same second, or deleted since (pruned logs), move the reference's count.
 * @param {Record<string, number>} copy
 * @param {Record<string, number> | null} reference
 * @returns {Finding[]}
 */
export function countFindings(copy, reference) {
  return Object.entries(copy).map(([table, n]) => {
    if (!reference || reference[table] === undefined) return finding("ok", `rows: ${table}`, String(n));
    const want = reference[table];
    return n === want ? finding("ok", `rows: ${table}`, `${n}, as the reference had then`) : finding("differs", `rows: ${table}`, `${n} on the copy, ${want} on the reference then`);
  });
}

/**
 * The order sequence of a store (D141, `commerce.order_number_audit()`): a gap or a number off the series' format fails.
 * @param {string} store
 * @param {{ ok: boolean, missing: number | string, off_format: number | string, orders: number | string }} audit
 * @returns {Finding}
 */
export function orderSequenceFinding(store, audit) {
  if (audit.ok) return finding("ok", `order numbers: ${store}`, `${audit.orders} orders, no gap`);
  return finding("fail", `order numbers: ${store}`, `${audit.missing} missing and ${audit.off_format} off the format among ${audit.orders} orders`);
}

/**
 * The newest invoice or credit note number per store on the copy against the reference's newest at the copy's moment (D159).
 * @param {string} kind "invoice" or "credit note"
 * @param {Record<string, string>} copy store slug to newest document number
 * @param {Record<string, string> | null} reference
 * @returns {Finding[]}
 */
export function documentFindings(kind, copy, reference) {
  if (!reference) return Object.entries(copy).map(([store, number]) => finding("ok", `newest ${kind}: ${store}`, number));
  const stores = [...new Set([...Object.keys(copy), ...Object.keys(reference)])].sort();
  return stores.map((store) => {
    const mine = copy[store] ?? "none";
    const theirs = reference[store] ?? "none";
    return mine === theirs
      ? finding("ok", `newest ${kind}: ${store}`, mine)
      : finding("differs", `newest ${kind}: ${store}`, `${mine} on the copy, ${theirs} on the reference then`);
  });
}

/** The report as lines, and whether anything failed. */
export function report(findings) {
  const width = Math.max(...findings.map((f) => f.check.length), 10);
  const lines = findings.map((f) => `${f.status.padEnd(7)} ${f.check.padEnd(width)}  ${f.detail}`);
  const counts = ["ok", "differs", "fail"].map((s) => `${findings.filter((f) => f.status === s).length} ${s}`).join(", ");
  return { text: [...lines, "", counts].join("\n"), failed: findings.some((f) => f.status === "fail") };
}
