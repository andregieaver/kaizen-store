// The checks of the restore drill (docs/runbooks/restore.md), on a restored copy of the database. Read-only on both sides:
// every query runs in a read-only transaction, and nothing is changed, not even the copy's scheduled jobs (it says how).
//
//   RESTORED_URL=postgres://...copy node scripts/restore-check.mjs
//   RESTORED_URL=postgres://...copy REFERENCE_URL=postgres://...production node scripts/restore-check.mjs --at=2026-10-24T20:00:00Z
//
// With a reference and the moment the copy was restored to, counts and the newest documents are compared with what the
// reference had at that moment (rows written since are left out by their time). Exits 1 when a check fails.
import postgres from "postgres";

import { listMigrationFiles } from "./lib/migrations.mjs";
import { countFindings, cronFinding, documentFindings, finding, migrationFinding, orderSequenceFinding, report } from "./lib/restore-check.mjs";

/** The tables counted, each with the column that says when a row was made. */
const COUNTED = {
  accounts: "created_at",
  stores: "created_at",
  customers: "created_at",
  products: "created_at",
  pages: "created_at",
  orders: "created_at",
  payments: "created_at",
  refunds: "created_at",
  invoices: "issued_at",
  credit_notes: "issued_at",
};
const SEQUENCE_STORES = 3;
const DOCUMENT_STORES = 5;

const copyUrl = process.env.RESTORED_URL;
const referenceUrl = process.env.REFERENCE_URL || null;
const atArg = process.argv.find((a) => a.startsWith("--at="))?.slice(5) ?? null;
if (!copyUrl) {
  console.error("RESTORED_URL is not set: point it at the restored copy, never at production.");
  process.exit(1);
}
if (referenceUrl && copyUrl === referenceUrl) {
  console.error("RESTORED_URL and REFERENCE_URL are the same database.");
  process.exit(1);
}
const at = atArg ? new Date(atArg) : null;
if (atArg && Number.isNaN(at.getTime())) {
  console.error(`--at is not a time: ${atArg}`);
  process.exit(1);
}
if (referenceUrl && !at) {
  console.error("With REFERENCE_URL, give the moment the copy was restored to: --at=2026-10-24T20:00:00Z");
  process.exit(1);
}

/** Runs `work` in a read-only transaction on a fresh connection, and closes it. */
async function readOnly(url, work) {
  const sql = postgres(url, { max: 1, onnotice: () => {}, connect_timeout: 30 });
  try {
    return await sql.begin("read only", work);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const findings = [];

const copy = await readOnly(copyUrl, async (sql) => {
  const [server] = await sql`select current_setting('server_version') as version, now() as now`;
  // A failed query would end the transaction, so what may be missing (pg_cron, the ledger) is looked for first.
  const [present] = await sql`
    select to_regclass('cron.job') is not null as cron, to_regclass('supabase_migrations.kaizen_files') is not null as ledger
  `;
  const jobs = present.cron ? await sql`select jobname, active, command ilike '%net.http%' as calls_out from cron.job` : [];
  const ledger = present.ledger ? await sql`select file from supabase_migrations.kaizen_files order by file` : null;
  const counts = {};
  for (const table of Object.keys(COUNTED)) {
    const [row] = await sql`select count(*)::bigint as n from ${sql(`commerce.${table}`)}`;
    counts[table] = Number(row.n);
  }
  const busiest = await sql`
    select s.id, s.slug from commerce.stores s
    where not (s.is_template or s.starter)
    order by (select count(*) from commerce.orders o where o.store_id = s.id and o.copied_from is null) desc, s.slug
    limit ${SEQUENCE_STORES}
  `;
  const sequences = [];
  for (const store of busiest) {
    const [audit] = await sql`select * from commerce.order_number_audit(${store.id}::uuid)`;
    if (audit) sequences.push({ slug: store.slug, audit });
  }
  const newest = async (table) =>
    Object.fromEntries(
      (
        await sql`
          select distinct on (s.slug) s.slug, d.document_number from ${sql(`commerce.${table}`)} d join commerce.stores s on s.id = d.store_id
          order by s.slug, d.number desc limit ${DOCUMENT_STORES}
        `
      ).map((r) => [r.slug, r.document_number]),
    );
  const [usage] = await sql`
    select count(*)::int as n from commerce.store_usage_daily where day = (coalesce(${at}::timestamptz, now()) at time zone 'utc')::date - 1
  `;
  return { server, jobs, ledger, counts, sequences, invoices: await newest("invoices"), credits: await newest("credit_notes"), usage: usage.n };
});

findings.push(finding("ok", "connected", `Postgres ${copy.server.version}`));
findings.push(cronFinding(copy.jobs));
findings.push(copy.ledger ? migrationFinding(await listMigrationFiles(), copy.ledger.map((r) => r.file)) : finding("fail", "migrations", "the copy has no migration ledger"));

let reference = null;
if (referenceUrl) {
  reference = await readOnly(referenceUrl, async (sql) => {
    const counts = {};
    for (const [table, column] of Object.entries(COUNTED)) {
      const [row] = await sql`select count(*)::bigint as n from ${sql(`commerce.${table}`)} where ${sql(column)} <= ${at}`;
      counts[table] = Number(row.n);
    }
    const newest = async (table) =>
      Object.fromEntries(
        (
          await sql`
            select distinct on (s.slug) s.slug, d.document_number from ${sql(`commerce.${table}`)} d join commerce.stores s on s.id = d.store_id
            where d.issued_at <= ${at}
            order by s.slug, d.number desc
          `
        ).map((r) => [r.slug, r.document_number]),
      );
    return { counts, invoices: await newest("invoices"), credits: await newest("credit_notes") };
  });
}

findings.push(...countFindings(copy.counts, reference?.counts ?? null));
for (const { slug, audit } of copy.sequences) findings.push(orderSequenceFinding(slug, audit));
const pick = (all, keys) => (all ? Object.fromEntries(keys.filter((k) => k in all).map((k) => [k, all[k]])) : null);
findings.push(...documentFindings("invoice", copy.invoices, pick(reference?.invoices, Object.keys(copy.invoices))));
findings.push(...documentFindings("credit note", copy.credits, pick(reference?.credits, Object.keys(copy.credits))));
findings.push(
  copy.usage > 0
    ? finding("ok", "usage job", `${copy.usage} store rows for the day before`)
    : finding("differs", "usage job", "no rows for the day before (the daily usage job had not run, or the store has none)"),
);

const { text, failed } = report(findings);
console.log(text);
process.exit(failed ? 1 : 0);
