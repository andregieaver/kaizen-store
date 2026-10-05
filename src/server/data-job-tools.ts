import "server-only";

import { JOB_KINDS, STATUS_WORDS, isImport, progressPercent, type JobKind } from "@/lib/data-job";
import { groupFindings } from "@/lib/data-job-help";
import type { OwnerToolInput, OwnerToolName } from "@/lib/owner-tools";

import type { Membership } from "./auth";
import { listItems, type DataJob } from "./data-job-store";
import { jobFor, listJobs, mayUseKind } from "./data-jobs";
import { OwnerToolError } from "./owner-tool-error";
import type { Store } from "./stores";

/**
 * The AI manager's two read-only tools for data in and out (D165, `docs/wave-2-data.md` 5.5): `list_data_jobs` and `explain_import_problems`. They answer from
 * the job's own rows and stored findings, counted in code; they start, apply, cancel and download nothing (the files hold personal data and an import writes the
 * catalogue), so neither is gated, and neither gives a file's contents, a link to a file or a person's details. They show only the kinds of job the member may use
 * (`mayUseKind()`: product jobs need access to products, order and customer files are the owner's), the same rule the pages and routes ask.
 */

type Ctx = {
  account: Membership["account"];
  store: Store;
  holder?: Pick<Membership, "role" | "kind" | "permissions">;
};

/** The member the tool works for, as the job functions take it: the assistant's own holder, or an owner for a run with none. */
const memberOf = (ctx: Ctx): Membership => ({ account: ctx.account, store: ctx.store, role: ctx.holder?.role ?? "owner", kind: ctx.holder?.kind, permissions: ctx.holder?.permissions });

const pageOf = (store: Store, job: Pick<DataJob, "id" | "kind">): string => {
  const base = `/admin/${store.slug}`;
  if (job.kind === "product_import") return `${base}/products/import/${job.id}`;
  if (job.kind === "product_export") return `${base}/products/export?job=${job.id}`;
  if (job.kind === "order_export") return `${base}/orders/export?job=${job.id}`;
  if (job.kind === "redirect_import") return `${base}/redirects/import/${job.id}`;
  if (job.kind === "redirect_export") return `${base}/redirects/export?job=${job.id}`;
  return `${base}/customers/export?job=${job.id}`;
};

const KIND_WORDS: Record<JobKind, string> = {
  product_import: "Product import",
  product_export: "Product export",
  order_export: "Order file",
  customer_export: "Customer file",
  redirect_import: "Redirect import",
  redirect_export: "Redirect file",
};

const count = (job: DataJob, key: string): number | null => (typeof job.counts[key] === "number" ? (job.counts[key] as number) : null);

/** What a job is, for the assistant to repeat: its words, its progress and its counts, never a file's name, path or contents. */
function describeJob(store: Store, job: DataJob) {
  const all = isImport(job.kind)
    ? {
        created: count(job, "created"),
        updated: count(job, "updated"),
        unchanged: count(job, "unchanged"),
        skipped: count(job, "skipped"),
        saved_as_draft: count(job, "drafted"),
        failed: count(job, "failed"),
        errors: count(job, "errors"),
        warnings: count(job, "warnings"),
        prices_changed: count(job, "pricesChanged"),
        pictures_fetched: count(job, "picturesFetched"),
      }
    : null;
  // A redirect import has no drafts, prices or pictures: those figures are left out rather than shown as nothing.
  const counts = all && job.kind === "redirect_import" ? Object.fromEntries(Object.entries(all).filter(([k, v]) => v !== null && !["saved_as_draft", "prices_changed", "pictures_fetched"].includes(k))) : all;
  return {
    id: job.id,
    kind: KIND_WORDS[job.kind],
    kind_code: job.kind,
    status: STATUS_WORDS[job.status],
    status_code: job.status,
    progress_percent: progressPercent(job.rowsDone, job.rowsTotal, job.status),
    rows: job.rowsTotal,
    ...(counts ? { counts } : {}),
    ...(job.format ? { file_format: job.format } : {}),
    ...(job.problem ? { problem: job.problem } : {}),
    started: job.createdAt,
    finished: job.finishedAt,
    ...(isImport(job.kind) ? {} : job.expiresAt ? { files_deleted_at: job.expiresAt } : {}),
    page: pageOf(store, job),
  };
}

/**
 * The store's imports and exports, newest first, for the kinds the member may see. A kind asked for that the member may not use is refused in words, never
 * answered with an empty list that would read as "none".
 */
export async function listDataJobsTool(ctx: Ctx, { kind, limit }: OwnerToolInput<"list_data_jobs">) {
  const member = memberOf(ctx);
  if (kind && !mayUseKind(member, kind)) {
    throw new OwnerToolError(kind.startsWith("redirect") ? "I can't show that: your role has no access to the website's redirects." : isImport(kind) || kind === "product_export" ? "I can't show that: your role has no access to products." : "I can't show that: order and customer files are the owner's.");
  }
  const kinds = (kind ? [kind] : JOB_KINDS).filter((k) => mayUseKind(member, k));
  const found = (await Promise.all(kinds.map((k) => listJobs(member, k, limit)))).flat();
  found.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  const jobs = found.slice(0, limit).map((j) => describeJob(ctx.store, j));
  return {
    jobs,
    shown_kinds: kinds,
    notes: [
      "Nothing is started, applied or downloaded from here: the person does that on the page named for each job.",
      "A file made by an export is deleted 7 days after it is made; an import's own file is kept 30 days.",
      ...(jobs.length === 0 ? ["There are no jobs of these kinds yet."] : []),
    ],
  };
}

const EXPLAIN_SCAN = 100_000;

/** The findings of a product import grouped by code, counted in code from the stored items; what to do about each; the page to check again from. */
export async function explainImportProblemsTool(ctx: Ctx, { job_id }: OwnerToolInput<"explain_import_problems">) {
  const member = memberOf(ctx);
  if (!mayUseKind(member, "product_import")) throw new OwnerToolError("I can't show that: your role has no access to products.");
  let job: DataJob | null = null;
  if (job_id) {
    job = await jobFor(member, job_id);
    if (!job || job.kind !== "product_import") throw new OwnerToolError("There is no product import with that id in this store. list_data_jobs shows the store's imports.");
  } else {
    [job] = await listJobs(member, "product_import", 1);
    if (!job) {
      return {
        job: null,
        findings: { errors: 0, warnings: 0, information: 0 },
        problems: [],
        notes: ["This store has no product import yet, so there is nothing to explain. An import starts on the import page (Products, Import)."],
        page: `/admin/${ctx.store.slug}/products/import`,
      };
    }
  }
  const items = [];
  let total = 0;
  for (let offset = 0; offset < EXPLAIN_SCAN; offset += 500) {
    const page = await listItems(ctx.store.id, job.id, { offset, limit: 500 });
    total = page.total;
    items.push(...page.items);
    if (page.items.length < 500) break;
  }
  const { groups, totals } = groupFindings(items);
  const waiting = job.status === "uploaded" || job.status === "checking";
  return {
    job: describeJob(ctx.store, job),
    products_in_file: items.filter((i) => i.kind === "product").length,
    findings: { errors: totals.error, warnings: totals.warning, information: totals.info },
    problems: groups,
    ...(total > items.length ? { truncated: `Only the first ${items.length} of ${total} products were read.` } : {}),
    notes: [
      "A product with an error was left as it was, and nothing of it was written. A warning was written with a note. Information is only said.",
      "An import never deletes a product, never changes a web address and never imports a compare-at price.",
      waiting ? "The check has not finished, so the findings are not complete yet." : "To fix: change the file (or the product in the editor), then check the file again on the import page before importing.",
    ],
    page: pageOf(ctx.store, job),
  };
}

/** The two tools' names, for the registry's test. */
export const DATA_JOB_TOOLS = ["list_data_jobs", "explain_import_problems"] as const satisfies readonly OwnerToolName[];
