import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { CONTENT_API } from "@/lib/admin-api-content";
import type { AdminAnswer, ApiRoute } from "@/lib/admin-api-routes";
import { entryStatus, type Entry } from "@/lib/content-types";
import { moneyCurrencies } from "@/lib/field-money";
import { issueId, type PageIssue } from "@/lib/page-a11y";
import type { PageType } from "@/lib/page-content";

import { fail, jsonBody, ok, readBody, record, sinceWhere, type ApiAnswer } from "./admin-api-kit";
import type { ApiCaller } from "./api-tokens";
import { uploadUrl } from "./api-uploads";
import { getEntry, listEntries, publishEntry, saveEntry, type EntryContext } from "./content-entries";
import { getContentType, listContentTypes } from "./content-types";
import { dataStorage, safeName, type DataDeps, type DataJob } from "./data-job-store";
import { downloadPart, importProblemsCsv, jobFor, registerImport, requestProductExport, startImportApply, startImportCheck, startImportUpload } from "./data-jobs";
import { listStoreMenus } from "./menus";
import { getPageForEdit, listPages, savePage } from "./pages";
import { readPriceDisplay } from "./price-display";
import { runReport } from "./report-query";
import { getSavedReport, listSavedReports } from "./saved-reports";
import { col, typedRows } from "./typed-rows";
import { addEndpoint, listEndpointDeliveries, listEndpoints, removeEndpoint, resendDelivery, switchEndpoint, updateEndpoint, type EndpointProblem } from "./webhook-endpoints";

/**
 * The Admin API's content, the store and its operations (wave 14 unit C4, D440): pages and articles through the editor's own save and publish
 * (`savePage()`, publishing only with `content:publish`), content entries through `saveEntry()`/`publishEntry()`, menus and the store's
 * settings read, saved reports run by `runReport()` (the Reports page's runner, nothing written), the owner's endpoints through the
 * Integrations page's writers with `webhooks:write` (a secret answered once), and the product file's jobs through the Data page's own steps
 * (`requestProductExport()`, `startImportUpload()`, `registerImport()`, `startImportCheck()`, `startImportApply()`). Each change audited
 * `integration.api_{what}`.
 */

export const CONTENT_NAMES = CONTENT_API.map((o) => o.name);
type ContentName = (typeof CONTENT_API)[number]["name"];
export type ContentRoute = Extract<ApiRoute, { name: ContentName }>;

// ---------------------------------------------------------------------------
// Pages and articles
// ---------------------------------------------------------------------------

type ApiPage = AdminAnswer<"pages.get">["data"];

async function pageById(caller: ApiCaller, id: string, type: PageType): Promise<ApiPage> {
  const page = await getPageForEdit(caller.member.store.id, id, type);
  if (!page) return fail("not_found", `No such ${type === "article" ? "article" : "page"} in this store.`);
  return {
    id: page.id,
    title: page.draft.title,
    slug: page.slug,
    state: page.state,
    published_at: page.publishedAt,
    updated_at: page.updatedAt,
    draft: page.draft as unknown as Record<string, unknown>,
  };
}

/** A refusal of the editor's save: the checker's blocking issues are a 409 that names them, the rest a 422. */
function pageRefusal(result: { problems: string[]; code?: string; issues?: PageIssue[] }): never {
  if (result.code === "needs_confirmation") {
    const issues = (result.issues ?? []).map((i) => `${issueId(i)} (${i.message})`).join(", ");
    return fail("conflict", `Publishing waits for these issues to be acknowledged (acknowledged_issues): ${issues}. ${result.problems.join(" ")}`.trim());
  }
  return fail("invalid", result.problems.join(" "));
}

// ---------------------------------------------------------------------------
// Content entries
// ---------------------------------------------------------------------------

const entryContext = (caller: ApiCaller): EntryContext => {
  const store = caller.member.store;
  return { accountId: caller.member.account.id, owner: store.id, locales: store.localization.locales, main: store.localization.locales[0] ?? "en", currencies: moneyCurrencies(store) };
};

const entryOut = (entry: Entry): AdminAnswer<"content.entry">["data"] => ({
  id: entry.id,
  type_id: entry.typeId,
  slug: entry.slug,
  state: entryStatus(entry),
  draft: entry.draft as unknown as Record<string, unknown>,
  published_at: entry.publishedAt,
  updated_at: entry.updatedAt,
});

async function entryById(storeId: string, id: string) {
  const entry = await getEntry(storeId, id);
  return entry ? entryOut(entry) : fail("not_found", "No such entry in this store.");
}

// ---------------------------------------------------------------------------
// Webhook endpoints
// ---------------------------------------------------------------------------

async function endpointById(storeId: string, id: string): Promise<AdminAnswer<"webhooks.update">["data"]> {
  const found = (await listEndpoints(storeId)).find((e) => e.id === id) ?? fail("not_found", "No such endpoint in this store.");
  return {
    id: found.id,
    name: found.name,
    hint: found.hint,
    topics: found.topics,
    enabled: found.enabled,
    disabled_reason: found.disabledReason,
    failing_since: found.failingSince,
    last_delivery: found.lastDelivery,
    recent_failures: found.recentFailures,
  };
}

function endpointRefusal(problem: EndpointProblem, detail?: string): never {
  const words: Record<EndpointProblem, string> = {
    name: "name: 1 to 80 characters.",
    topics: "topics: choose at least one.",
    url: `url: an HTTPS address${detail ? ` (${detail})` : ""}.`,
    address: `url: that address cannot take events${detail ? `: ${detail}` : ""}.`,
    key: "Kaizena Flow cannot keep the address safe right now. Try again later.",
    limit: "The store has as many endpoints as it may. Remove one first.",
    gone: "No such endpoint in this store.",
  };
  if (problem === "gone") return fail("not_found", words.gone);
  if (problem === "limit") return fail("conflict", words.limit);
  if (problem === "key") return fail("failed", words.key);
  return fail("invalid", words[problem]);
}

// ---------------------------------------------------------------------------
// The product file's jobs
// ---------------------------------------------------------------------------

const PRODUCT_JOBS = ["product_export", "product_import"] as const;

/** The private buckets, named for each step (the Data page's own default, read here so one reading serves the whole call). */
const jobDeps = (): DataDeps => ({ storage: dataStorage() });

function jobOut(job: DataJob): AdminAnswer<"jobs.get">["data"] {
  return {
    id: job.id,
    kind: job.kind === "product_import" ? "product_import" : "product_export",
    status: job.status,
    rows_total: job.rowsTotal,
    rows_done: job.rowsDone,
    counts: job.counts,
    problem: job.problem,
    files: job.files.length,
    created_at: job.createdAt,
    finished_at: job.finishedAt,
    expires_at: job.expiresAt,
  };
}

async function productJob(caller: ApiCaller, id: string): Promise<DataJob> {
  const job = await jobFor(caller.member, id);
  if (!job || !(PRODUCT_JOBS as readonly string[]).includes(job.kind)) return fail("not_found", "No such job of the product file in this store.");
  return job;
}

// ---------------------------------------------------------------------------
// The routes
// ---------------------------------------------------------------------------

export async function answerContent(caller: ApiCaller, route: ContentRoute, request: Request): Promise<ApiAnswer> {
  const store = caller.member.store;
  const storeId = store.id;
  const account = caller.member.account;
  const params = new URL(request.url).searchParams;
  const pageType = (name: string): PageType => (name.startsWith("articles.") ? "article" : "page");
  switch (route.name) {
    case "pages.list":
    case "articles.list": {
      const since = params.get("updated_after");
      if (since) sinceWhere(params, sql`now()`);
      const pages = (await listPages(storeId, pageType(route.name))).filter((p) => !since || p.updatedAt > new Date(since).toISOString());
      return ok(route.name, { data: pages.map((p) => ({ id: p.id, title: p.title, slug: p.slug, state: p.state, published_at: p.publishedAt, updated_at: p.updatedAt })) });
    }
    case "pages.get":
    case "articles.get":
      return ok(route.name, { data: await pageById(caller, route.id, pageType(route.name)) });
    case "pages.create":
    case "articles.create": {
      const type = pageType(route.name);
      const { draft } = route.name === "pages.create" ? await readBody("pages.create", request) : await readBody("articles.create", request);
      const saved = await savePage(account, storeId, null, draft, { publish: false, type });
      if (!saved.ok) return pageRefusal(saved);
      await record(caller, `${type}_created`, {}, { type, id: saved.id });
      return ok(route.name, { data: await pageById(caller, saved.id, type) }, 201);
    }
    case "pages.update":
    case "articles.update": {
      const type = pageType(route.name);
      await pageById(caller, route.id, type);
      const { draft } = route.name === "pages.update" ? await readBody("pages.update", request) : await readBody("articles.update", request);
      // The draft only: what the site shows stays as published until it is published again.
      const saved = await savePage(account, storeId, route.id, draft, { publish: false, type });
      if (!saved.ok) return pageRefusal(saved);
      await record(caller, `${type}_draft_saved`, {}, { type, id: route.id });
      return ok(route.name, { data: await pageById(caller, route.id, type) });
    }
    case "pages.publish":
    case "articles.publish": {
      const type = pageType(route.name);
      const page = await pageById(caller, route.id, type);
      const input = route.name === "pages.publish" ? await readBody("pages.publish", request) : await readBody("articles.publish", request);
      const saved = await savePage(account, storeId, route.id, page.draft, { publish: true, type, acknowledgedIssues: input.acknowledged_issues });
      if (!saved.ok) return pageRefusal(saved);
      await record(caller, `${type}_published`, {}, { type, id: route.id });
      return ok(route.name, { data: await pageById(caller, route.id, type) });
    }
    case "content.types": {
      const types = await listContentTypes(storeId);
      return ok(route.name, {
        data: types.map((t) => ({ id: t.id, key: t.key, name: t.name, slug: t.slug, fields: t.fields as unknown[], has_pages: t.hasPages, entries: t.entries ?? 0 })),
      });
    }
    case "content.entries": {
      if (!(await getContentType(storeId, route.id))) return fail("not_found", "No such content type in this store.");
      const since = params.get("updated_after");
      if (since) sinceWhere(params, sql`now()`);
      const entries = (await listEntries(storeId, route.id)).filter((e) => !since || e.updatedAt > new Date(since).toISOString());
      return ok(route.name, { data: entries.map(entryOut) });
    }
    case "content.entry":
      return ok(route.name, { data: await entryById(storeId, route.id) });
    case "content.entry_create": {
      if (!(await getContentType(storeId, route.id))) return fail("not_found", "No such content type in this store.");
      const input = await readBody(route.name, request);
      const saved = await saveEntry(entryContext(caller), { typeId: route.id, slug: input.slug, fields: input.fields, ...(input.seo && { seo: input.seo }) });
      if (!saved.ok || !saved.id) return fail(saved.ok ? "failed" : /taken/i.test(saved.problems.join(" ")) ? "conflict" : "invalid", saved.ok ? "The entry was saved but could not be read back." : saved.problems.join(" "));
      await record(caller, "entry_created", {}, { type: "content_entry", id: saved.id });
      return ok(route.name, { data: await entryById(storeId, saved.id) }, 201);
    }
    case "content.entry_update": {
      const entry = (await getEntry(storeId, route.id)) ?? fail("not_found", "No such entry in this store.");
      const input = await readBody(route.name, request);
      const saved = await saveEntry(entryContext(caller), {
        id: entry.id,
        typeId: entry.typeId,
        slug: input.slug ?? entry.slug,
        fields: input.fields ?? {},
        seo: input.seo ?? entry.draft.seo,
        seoTranslations: entry.draft.seoTranslations,
      });
      if (!saved.ok) return fail("invalid", saved.problems.join(" "));
      await record(caller, "entry_draft_saved", {}, { type: "content_entry", id: entry.id });
      return ok(route.name, { data: await entryById(storeId, entry.id) });
    }
    case "content.entry_publish": {
      await entryById(storeId, route.id);
      await readBody(route.name, request);
      const published = await publishEntry(entryContext(caller), route.id);
      if (!published.ok) return fail("invalid", published.problems.join(" "));
      await record(caller, "entry_published", {}, { type: "content_entry", id: route.id });
      return ok(route.name, { data: await entryById(storeId, route.id) });
    }
    case "menus.list":
    case "menus.get": {
      const changed = params.get("updated_after")
        ? new Set((await typedRows(z.object({ id: col.uuid }), sql`select id from commerce.menus where store_id = ${storeId}::uuid and ${sinceWhere(params, sql`updated_at`)}`)).map((r) => r.id))
        : null;
      const menus = (await listStoreMenus(storeId)).map((m) => ({ id: m.id, name: m.name, items: m.items as unknown[] }));
      if (route.name === "menus.get") return ok(route.name, { data: menus.find((m) => m.id === route.id) ?? fail("not_found", "No such menu in this store.") });
      return ok(route.name, { data: menus.filter((m) => !changed || changed.has(m.id)) });
    }
    case "settings.get": {
      const [[own], rates, methods, tax, display] = await Promise.all([
        typedRows(z.object({ country: col.textOrNull }), sql`select country from commerce.stores where id = ${storeId}::uuid`),
        typedRows(
          z.object({ market: col.text, currency: col.currency, amount_minor: col.minor, free_over_minor: col.minor.nullable() }),
          sql`select market_code as market, currency, amount_minor, free_over_minor from commerce.shipping_rates where store_id = ${storeId}::uuid order by market_code`,
        ),
        typedRows(
          z.object({ id: col.uuid, market: col.text, currency: col.currency, name: col.text, min: col.int.nullable(), max: col.int.nullable(), free_over_minor: col.minor.nullable(), active: col.bool }),
          sql`
            select id, market_code as market, currency, name, estimate_min_days as min, estimate_max_days as max, free_over_minor, active
            from commerce.shipping_methods where store_id = ${storeId}::uuid order by market_code, position, id
          `,
        ),
        typedRows(
          z.object({ vat_registered: col.bool, vat_number: col.textOrNull, dispatch_country: col.textOrNull, oss: col.bool, ioss: col.bool }),
          sql`
            select vat_registered, vat_number, dispatch_country, oss_scheme is not null as oss, ioss_number is not null as ioss
            from commerce.store_tax_profile where store_id = ${storeId}::uuid
          `,
        ),
        readPriceDisplay(storeId),
      ]);
      return ok(route.name, {
        data: {
          name: store.name,
          slug: store.slug,
          country: own?.country ?? null,
          time_zone: store.timeZone,
          audience: store.audience,
          languages: store.localization.locales,
          currencies: store.localization.currencies.map((c) => ({ currency: c.currency, rate: c.rate })),
          markets: store.markets.map((m) => ({ code: m.code, currency: m.currency, own_currency: m.nativeCurrency, locale: m.locale, name: m.name })),
          shipping: { rates, methods: methods.map(({ min, max, ...m }) => ({ ...m, estimate_days: { min, max } })) },
          tax: tax[0] ?? { vat_registered: false, vat_number: null, dispatch_country: null, oss: false, ioss: false },
          price_display: {
            decimals: display.decimals,
            quantity_chooser: display.quantityPicker,
            words: Object.fromEntries(store.localization.locales.map((locale) => [locale, { before: display.words[locale]?.prefix ?? "", after: display.words[locale]?.suffix ?? "" }])),
          },
        },
      });
    }
    case "reports.list": {
      const since = params.get("updated_after");
      if (since) sinceWhere(params, sql`now()`);
      const reports = (await listSavedReports(storeId)).filter((r) => !since || r.updatedAt > new Date(since).toISOString());
      return ok(route.name, { data: reports.map((r) => ({ id: r.id, title: r.title, runs: r.spec !== null && r.problems.length === 0, updated_at: r.updatedAt })) });
    }
    case "reports.run": {
      const saved = (await getSavedReport(storeId, route.id)) ?? fail("not_found", "No such saved report in this store.");
      if (!saved.spec || saved.problems.length > 0) return fail("conflict", "The report cannot run as saved: open it in the report builder.");
      const outcome = await runReport(store, saved.spec);
      if (!outcome.ok) return fail("conflict", "The report cannot run as saved: open it in the report builder.");
      const r = outcome.report;
      return ok(route.name, {
        data: {
          report_id: saved.id,
          title: saved.title,
          currency: r.currency,
          columns: r.columns.map((c) => ({ metric: c.metric, adds_up: c.addsUp })),
          rows: r.rows.map((row) => ({ keys: row.keys, values: row.values as Record<string, number | null>, previous: (row.previous as Record<string, number | null> | null) ?? null, rest: row.rest })),
          totals: { values: r.totals.values as Record<string, number | null>, previous: (r.totals.previous as Record<string, number | null> | null) ?? null },
          hidden_rows: r.hiddenRows,
          period: r.period,
        },
      });
    }
    case "webhooks.list": {
      const endpoints = await listEndpoints(storeId);
      return ok(route.name, { data: await Promise.all(endpoints.map((e) => endpointById(storeId, e.id))) });
    }
    case "webhooks.create": {
      const input = await readBody(route.name, request);
      const made = await addEndpoint(caller.member, { name: input.name, url: input.url, topics: input.topics });
      if (!made.ok) return endpointRefusal(made.problem, made.detail);
      await record(caller, "endpoint_added", { topics: input.topics.length }, { type: "webhook_endpoint", id: made.id });
      const endpoint = await endpointById(storeId, made.id);
      // The signing secret is answered this once; a replay of the request, and what is kept for it, has none.
      return { ...ok(route.name, { data: { ...endpoint, secret: made.secret ?? null } }, 201), replay: { data: { ...endpoint, secret: null } } };
    }
    case "webhooks.update": {
      const before = await endpointById(storeId, route.id);
      const input = await readBody(route.name, request);
      if (input.name !== undefined || input.url !== undefined || input.topics !== undefined) {
        const saved = await updateEndpoint(caller.member, route.id, { name: input.name ?? before.name, ...(input.url !== undefined && { url: input.url }), topics: input.topics ?? before.topics });
        if (!saved.ok) return endpointRefusal(saved.problem, saved.detail);
      }
      if (input.enabled !== undefined && input.enabled !== before.enabled && !(await switchEndpoint(caller.member, route.id, input.enabled))) return fail("not_found", "No such endpoint in this store.");
      await record(caller, "endpoint_changed", {}, { type: "webhook_endpoint", id: route.id });
      return ok(route.name, { data: await endpointById(storeId, route.id) });
    }
    case "webhooks.delete": {
      await endpointById(storeId, route.id);
      if (!(await removeEndpoint(caller.member, route.id))) return fail("not_found", "No such endpoint in this store.");
      await record(caller, "endpoint_removed", {}, { type: "webhook_endpoint", id: route.id });
      return ok(route.name, { data: { id: route.id, deleted: true } });
    }
    case "webhooks.deliveries": {
      await endpointById(storeId, route.id);
      const limit = Math.min(Math.max(Number(params.get("limit")) || 25, 1), 100);
      const rows = await listEndpointDeliveries(storeId, route.id, limit);
      return ok(route.name, {
        data: rows.map((d) => ({ id: d.id, topic: d.event, status: d.status, attempts: d.attempts, last_status: d.lastStatus, last_error: d.lastError, created_at: d.createdAt, next_attempt_at: d.nextAttemptAt })),
      });
    }
    case "webhooks.resend": {
      await endpointById(storeId, route.id);
      await readBody(route.name, request);
      const [delivery] = await typedRows(
        z.object({ id: col.uuid }),
        sql`select id from commerce.integration_deliveries where store_id = ${storeId}::uuid and endpoint_id = ${route.id}::uuid and id = ${route.delivery_id}::uuid`,
      );
      if (!delivery) return fail("not_found", "No such delivery of this endpoint.");
      const sent = await resendDelivery(caller.member, route.delivery_id);
      if (sent === "gone") return fail("conflict", "That delivery is still being sent: wait for it to end.");
      if (sent === "off") return fail("conflict", "The endpoint is switched off: switch it on first.");
      await record(caller, "delivery_resent", {}, { type: "webhook_endpoint", id: route.id });
      return ok(route.name, { data: { queued: true } });
    }
    case "jobs.product_export": {
      const { options } = await readBody(route.name, request);
      const made = await requestProductExport(caller.member, options, jobDeps());
      if (!made.ok) return fail(made.code === "too_many" ? "conflict" : made.code === "forbidden" ? "forbidden" : "invalid", made.problem);
      await record(caller, "product_export_started", { direct: made.mode === "file" });
      if (made.mode === "file") return ok(route.name, { data: { job: null, file: { name: made.filename, content_type: "text/csv", csv: made.csv, rows: made.rows } } }, 201);
      return ok(route.name, { data: { job: jobOut(await productJob(caller, made.jobId)), file: null } }, 201);
    }
    case "jobs.product_import": {
      const { file_name } = await readBody(route.name, request);
      const started = await startImportUpload(caller.member, file_name, jobDeps());
      if (!started.ok) return fail(/not set up/i.test(started.problem) ? "failed" : "invalid", started.problem);
      const uploadId = started.path.split("/")[1];
      await record(caller, "product_import_started", {});
      return ok(route.name, { data: { upload_id: uploadId, upload_url: uploadUrl(started.path, { token: started.token }), method: "PUT", headers: { "Content-Type": "text/csv" } } }, 201);
    }
    case "jobs.product_import_check": {
      const input = await readBody(route.name, request);
      // The upload's own address in the store's folder: the id and name it was started with, never a path a caller names.
      const registered = await registerImport(caller.member, { path: `${storeId}/${route.id}/${safeName(input.file_name)}`, name: input.file_name }, jobDeps());
      if (!registered.ok) return fail("invalid", registered.problems.join(" "));
      const checked = await startImportCheck(caller.member, registered.jobId, input.options, jobDeps());
      if (!checked.ok) return fail("conflict", checked.problem);
      await record(caller, "product_import_checked", {}, { type: "data_job", id: registered.jobId });
      return ok(route.name, { data: jobOut(await productJob(caller, registered.jobId)) }, 201);
    }
    case "jobs.apply": {
      const job = await productJob(caller, route.id);
      await jsonBody(request);
      if (job.kind !== "product_import") return fail("conflict", "Only a checked import is applied.");
      const applied = await startImportApply(caller.member, route.id, jobDeps());
      if (!applied.ok) return fail("conflict", applied.problem);
      await record(caller, "product_import_applied", {}, { type: "data_job", id: route.id });
      return ok(route.name, { data: jobOut(await productJob(caller, route.id)) });
    }
    case "jobs.get":
      return ok(route.name, { data: jobOut(await productJob(caller, route.id)) });
    case "jobs.download": {
      const job = await productJob(caller, route.id);
      if (job.kind === "product_import") {
        const problems = await importProblemsCsv(caller.member, route.id);
        return ok(route.name, { data: { parts: [], problems_csv: problems.ok ? problems.csv : null } });
      }
      if (job.status !== "done") return fail("conflict", "The export is not ready yet: poll the job.");
      const parts = [];
      for (const [i, file] of job.files.entries()) {
        const link = await downloadPart(caller.member, route.id, i, jobDeps());
        if (!link.ok) return fail("conflict", link.problem);
        parts.push({ name: file.name, url: link.url });
      }
      return ok(route.name, { data: { parts, problems_csv: null } });
    }
  }
}
