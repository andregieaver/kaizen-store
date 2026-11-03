import { z } from "zod";

import { all, byId, currency, deleted, id, marketCode, minor, nothing, one, op, paging, since, when } from "./admin-api-shapes";
import { JOB_STATUSES } from "./data-job";
import { EVENTS, type IntegrationEvent } from "./integrations";

/**
 * The Admin API's content, the store and its operations (wave 14 unit C4, D440, `docs/wave-14-developer-platform.md` C4): pages, blog
 * articles and content entries read, written as drafts and published with the power scope `content:publish` (D42, D326); menus read (D85);
 * the store's settings read (markets, currencies, languages, shipping, tax profile, price display); saved reports run (D345); the owner's
 * webhook endpoints and their deliveries with the power scope `webhooks:write` (D354); and the product file of the D165 pipeline exported and
 * imported as jobs. Entries of `ADMIN_API`; their handlers are `src/server/admin-api-content.ts`. Pure.
 */

// Pages and articles (D42, D57) -------------------------------------------------------------

export const PAGE_STATES_API = ["draft", "published", "changed"] as const;

export const apiPageSummary = z.object({
  id,
  title: z.string(),
  slug: z.string().describe("Its address on the site, after the store's (a page) or blog/ (an article)."),
  state: z.enum(PAGE_STATES_API).describe("draft: never published. published: the site shows the draft as it is. changed: the draft has changes not published."),
  published_at: when.nullable(),
  updated_at: when,
});

export const apiPage = apiPageSummary.extend({
  draft: z.record(z.string(), z.unknown()).describe("The page as the editor keeps it (its words, rows and blocks, search texts, categories): what `PATCH` takes back whole."),
});

export const pageDraftBody = z.object({
  draft: z
    .record(z.string(), z.unknown())
    .describe("The page as the editor keeps it, whole (read one with GET first); the editor's own checks run on it. It is saved as the draft; the site keeps what was published."),
});
export const pagePublishBody = z.object({
  acknowledged_issues: z
    .array(z.string().max(200))
    .max(100)
    .optional()
    .describe("The checker's blocking issues (their ids) the owner has seen and publishes with; a publish with an issue not named is refused as `conflict` with the issues."),
});

// Content types and entries (D326) -----------------------------------------------------------------

export const apiContentType = z.object({
  id,
  key: z.string(),
  name: z.string(),
  slug: z.string(),
  fields: z.array(z.unknown()).describe("The type's fields as its page defines them."),
  has_pages: z.boolean().describe("Its entries have pages of their own on the site."),
  entries: z.int(),
});

export const apiEntry = z.object({
  id,
  type_id: id,
  slug: z.string(),
  state: z.enum(PAGE_STATES_API),
  draft: z.record(z.string(), z.unknown()).describe("The entry's draft: its fields' values (`data`) and its search texts."),
  published_at: when.nullable(),
  updated_at: when,
});

export const entryBody = z.object({
  slug: z.string().trim().max(120).describe("Its address: lowercase letters, digits and single hyphens."),
  fields: z
    .record(z.string(), z.unknown())
    .default({})
    .describe("The change as the entry page sends it: `values` by field id, and `translations` per language of the fields written in words; a field left out stays. Checked by the type's fields as the page checks them."),
  seo: z.object({ title: z.string().max(200), description: z.string().max(400) }).optional(),
});

// Menus (D85) -----------------------------------------------------------------------------------------

export const apiMenu = z.object({ id, name: z.string(), items: z.array(z.unknown()).describe("The menu's links as the menu editor keeps them, nested.") });

// The store's settings ----------------------------------------------------------------------------------

export const apiSettings = z.object({
  name: z.string(),
  slug: z.string(),
  country: z.string().nullable(),
  time_zone: z.string(),
  audience: z.string().describe("Who it sells to: consumers, businesses or both."),
  languages: z.array(z.string()).describe("The store's languages, its main one first."),
  currencies: z.array(z.object({ currency, rate: z.number().nullable() })).describe("The currencies it keeps, with the rate it set against its main one."),
  markets: z.array(z.object({ code: marketCode, currency, own_currency: currency, locale: z.string(), name: z.string() })).describe("The countries it sells to, as offered."),
  shipping: z.object({
    rates: z.array(z.object({ market: marketCode, currency, amount_minor: minor, free_over_minor: minor.nullable() })),
    methods: z.array(z.object({ id, market: marketCode, currency, name: z.string(), estimate_days: z.object({ min: z.int().nullable(), max: z.int().nullable() }), free_over_minor: minor.nullable(), active: z.boolean() })),
  }),
  tax: z.object({
    vat_registered: z.boolean(),
    vat_number: z.string().nullable(),
    dispatch_country: z.string().nullable(),
    oss: z.boolean().describe("Registered for the EU's One-Stop Shop."),
    ioss: z.boolean().describe("Registered for the Import One-Stop Shop."),
  }),
  price_display: z.object({
    decimals: z.string(),
    quantity_chooser: z.string(),
    words: z.record(z.string(), z.object({ before: z.string(), after: z.string() })).describe("Words around prices, per language."),
  }),
});

// Saved reports (D345) ---------------------------------------------------------------------------------

export const apiSavedReport = z.object({ id, title: z.string(), runs: z.boolean().describe("Its spec can run as saved."), updated_at: when });

export const apiReportRun = z.object({
  report_id: id,
  title: z.string(),
  currency: z.string().describe("The main currency every amount is in, without VAT."),
  columns: z.array(z.object({ metric: z.string(), adds_up: z.boolean() })),
  rows: z.array(z.object({ keys: z.unknown(), values: z.record(z.string(), z.number().nullable()), previous: z.record(z.string(), z.number().nullable()).nullable(), rest: z.boolean() })),
  totals: z.object({ values: z.record(z.string(), z.number().nullable()), previous: z.record(z.string(), z.number().nullable()).nullable() }),
  hidden_rows: z.int(),
  period: z.unknown().describe("The period it covers, as the report builder states it."),
});

// Webhook endpoints (D354) -------------------------------------------------------------------------------

const topic = z.enum(EVENTS.map((e) => e.id) as [IntegrationEvent, ...IntegrationEvent[]]);

export const apiEndpoint = z.object({
  id,
  name: z.string(),
  hint: z.string().describe("The address's host, to tell endpoints apart: the address itself is kept encrypted and never answered."),
  topics: z.array(z.string()),
  enabled: z.boolean(),
  disabled_reason: z.enum(["failing", "owner"]).nullable().describe("failing: switched off after three days of failed deliveries."),
  failing_since: when.nullable(),
  last_delivery: z.object({ status: z.enum(["pending", "delivered", "failed"]), at: when }).nullable(),
  recent_failures: z.int().describe("Deliveries that failed in the last 7 days."),
});

export const endpointCreateBody = z.object({
  name: z.string().trim().min(1).max(80),
  url: z.string().trim().max(2000).describe("An HTTPS address on a public host."),
  topics: z.array(topic).min(1).max(40),
});
export const endpointUpdateBody = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    url: z.string().trim().max(2000).optional().describe("A new address; the one there stays when left out."),
    topics: z.array(topic).min(1).max(40).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "Send what changes.");

export const apiDelivery = z.object({
  id,
  topic: z.string(),
  status: z.enum(["pending", "delivered", "failed"]),
  attempts: z.int(),
  last_status: z.int().nullable().describe("The receiver's last HTTP status."),
  last_error: z.string().nullable(),
  created_at: when,
  next_attempt_at: when,
});

// Bulk jobs (D165): the product file ----------------------------------------------------------------------

export const apiJob = z.object({
  id,
  kind: z.enum(["product_export", "product_import"]),
  status: z.enum(JOB_STATUSES).describe("An import: uploaded, checking, checked (its dry run's counts), running, done. An export: queued, running, done."),
  rows_total: z.int().nullable(),
  rows_done: z.int().nullable(),
  counts: z.record(z.string(), z.unknown()).describe("What the dry run found or the run did: products to make, to change, unchanged, refused."),
  problem: z.string().nullable(),
  files: z.int().describe("Parts of an export's file, ready to download."),
  created_at: when,
  finished_at: when.nullable(),
  expires_at: when.nullable().describe("When an export's files are deleted."),
});

export const exportBody = z.object({
  options: z.record(z.string(), z.unknown()).default({}).describe("The export's choices as the Data page sends them (which products, the file's dialect); everything when left out."),
});
export const importStartBody = z.object({ file_name: z.string().trim().min(1).max(200).describe("The file's name, such as products.csv.") });
export const importCheckBody = z.object({
  file_name: z.string().trim().min(1).max(200).describe("The same name the upload was started with."),
  options: z.record(z.string(), z.unknown()).default({}).describe("The import's choices as the Data page sends them."),
});

const exportAnswer = one(
  z.object({
    job: apiJob.nullable().describe("A job to poll, for a file of more than 2,000 rows; null when the file is answered here."),
    file: z.object({ name: z.string(), content_type: z.literal("text/csv"), csv: z.string(), rows: z.int() }).nullable(),
  }),
);

// ---------------------------------------------------------------------------
// The operations
// ---------------------------------------------------------------------------

const pageOps = <const P extends "pages" | "articles">(plural: P, kind: string, tag: string) =>
  [
    op({
      name: `${plural}.list` as const,
      method: "GET",
      path: `/${plural}` as const,
      scope: "content:read",
      permission: "website:read",
      tag,
      summary: `List ${kind}s`,
      description: `The store's ${kind}s, the most recently changed first, each with whether its draft is published.`,
      query: z.object(since),
      response: all(apiPageSummary),
      status: 200,
      errors: ["invalid"],
    }),
    op({
      name: `${plural}.get` as const,
      method: "GET",
      path: `/${plural}/{id}` as const,
      scope: "content:read",
      permission: "website:read",
      tag,
      summary: `Get a ${kind}`,
      description: `One ${kind} with its draft as the editor keeps it.`,
      params: byId,
      response: one(apiPage),
      status: 200,
      errors: ["not_found"],
    }),
    op({
      name: `${plural}.create` as const,
      method: "POST",
      path: `/${plural}` as const,
      scope: "content:write",
      permission: "website:write",
      tag,
      summary: `Create a draft ${kind}`,
      description: `Makes a ${kind} as a draft through the editor's own save and its checks; nothing is on the site until it is published.`,
      body: pageDraftBody,
      response: one(apiPage),
      status: 201,
      errors: ["invalid", "conflict"],
    }),
    op({
      name: `${plural}.update` as const,
      method: "PATCH",
      path: `/${plural}/{id}` as const,
      scope: "content:write",
      permission: "website:write",
      tag,
      summary: `Save a ${kind}'s draft`,
      description: `Saves the ${kind}'s draft whole through the editor's save; what the site shows stays as published until it is published again.`,
      params: byId,
      body: pageDraftBody,
      response: one(apiPage),
      status: 200,
      errors: ["not_found", "invalid"],
    }),
    op({
      name: `${plural}.publish` as const,
      method: "POST",
      path: `/${plural}/{id}/publish` as const,
      scope: "content:publish",
      permission: "website:write",
      tag,
      summary: `Publish a ${kind}`,
      description: `Publishes the ${kind}'s draft through the editor's own publish: its checks run, and a blocking issue not acknowledged is refused as \`conflict\` naming it.`,
      params: byId,
      body: pagePublishBody,
      response: one(apiPage),
      status: 200,
      errors: ["not_found", "invalid", "conflict"],
    }),
  ] as const;

export const CONTENT_API = [
  ...pageOps("pages", "page", "Pages"),
  ...pageOps("articles", "blog article", "Blog"),
  // Content types and entries (D326)
  op({
    name: "content.types",
    method: "GET",
    path: "/content-types",
    scope: "content:read",
    permission: "website:read",
    tag: "Content",
    summary: "List content types",
    description: "The store's content types (D326) in their order, each with its fields.",
    response: all(apiContentType),
    status: 200,
    errors: [],
  }),
  op({
    name: "content.entries",
    method: "GET",
    path: "/content-types/{id}/entries",
    scope: "content:read",
    permission: "website:read",
    tag: "Content",
    summary: "List a type's entries",
    description: "A content type's entries in the owner's order, each with its draft.",
    params: byId,
    query: z.object(since),
    response: all(apiEntry),
    status: 200,
    errors: ["not_found", "invalid"],
  }),
  op({
    name: "content.entry",
    method: "GET",
    path: "/content-entries/{id}",
    scope: "content:read",
    permission: "website:read",
    tag: "Content",
    summary: "Get an entry",
    description: "One entry with its draft.",
    params: byId,
    response: one(apiEntry),
    status: 200,
    errors: ["not_found"],
  }),
  op({
    name: "content.entry_create",
    method: "POST",
    path: "/content-types/{id}/entries",
    scope: "content:write",
    permission: "website:write",
    tag: "Content",
    summary: "Create an entry",
    description: "Makes an entry of the type as a draft, its values checked by the type's fields as the entry page checks them.",
    params: byId,
    body: entryBody,
    response: one(apiEntry),
    status: 201,
    errors: ["not_found", "invalid", "conflict"],
  }),
  op({
    name: "content.entry_update",
    method: "PATCH",
    path: "/content-entries/{id}",
    scope: "content:write",
    permission: "website:write",
    tag: "Content",
    summary: "Save an entry's draft",
    description: "Changes the entry's draft: the values given, laid over its draft as kept.",
    params: byId,
    body: entryBody.partial({ slug: true }),
    response: one(apiEntry),
    status: 200,
    errors: ["not_found", "invalid"],
  }),
  op({
    name: "content.entry_publish",
    method: "POST",
    path: "/content-entries/{id}/publish",
    scope: "content:publish",
    permission: "website:write",
    tag: "Content",
    summary: "Publish an entry",
    description: "Publishes the entry's draft: it needs a title and its type's required fields.",
    params: byId,
    body: nothing,
    response: one(apiEntry),
    status: 200,
    errors: ["not_found", "invalid", "conflict"],
  }),
  // Menus (D85)
  op({
    name: "menus.list",
    method: "GET",
    path: "/menus",
    scope: "content:read",
    permission: "website:read",
    tag: "Menus",
    summary: "List menus",
    description: "The store's menus with their links.",
    query: z.object(since),
    response: all(apiMenu),
    status: 200,
    errors: ["invalid"],
  }),
  op({
    name: "menus.get",
    method: "GET",
    path: "/menus/{id}",
    scope: "content:read",
    permission: "website:read",
    tag: "Menus",
    summary: "Get a menu",
    description: "One menu with its links.",
    params: byId,
    response: one(apiMenu),
    status: 200,
    errors: ["not_found"],
  }),
  // The store's settings
  op({
    name: "settings.get",
    method: "GET",
    path: "/settings",
    scope: "settings:read",
    permission: "settings:read",
    tag: "Settings",
    summary: "Get the store's settings",
    description: "The store's markets, currencies and languages, shipping rates and methods, tax profile and price display, as its settings pages keep them.",
    response: one(apiSettings),
    status: 200,
    errors: [],
  }),
  // Saved reports (D345)
  op({
    name: "reports.list",
    method: "GET",
    path: "/reports",
    scope: "reports:read",
    permission: "analytics:read",
    feature: "shop",
    tag: "Reports",
    summary: "List saved reports",
    description: "The store's saved reports (D345), by name, each saying whether it can run as saved.",
    query: z.object(since),
    response: all(apiSavedReport),
    status: 200,
    errors: ["invalid"],
  }),
  op({
    name: "reports.run",
    method: "GET",
    path: "/reports/{id}/run",
    scope: "reports:read",
    permission: "analytics:read",
    feature: "shop",
    tag: "Reports",
    summary: "Run a saved report",
    description: "Runs the saved report on the data as it is now, as the Reports page runs it: its rows and totals in the main currency, without VAT. Nothing is written.",
    params: byId,
    response: one(apiReportRun),
    status: 200,
    errors: ["not_found", "conflict"],
  }),
  // Webhook endpoints (D354)
  op({
    name: "webhooks.list",
    method: "GET",
    path: "/webhooks",
    scope: "webhooks:write",
    permission: "owner",
    tag: "Webhook endpoints",
    summary: "List webhook endpoints",
    description: "The owner's endpoints, each with how its deliveries go; never an address or a secret.",
    response: all(apiEndpoint),
    status: 200,
    errors: [],
  }),
  op({
    name: "webhooks.create",
    method: "POST",
    path: "/webhooks",
    scope: "webhooks:write",
    permission: "owner",
    tag: "Webhook endpoints",
    summary: "Add a webhook endpoint",
    description:
      "Adds an endpoint, on, through the Integrations page's own writer (an HTTPS address on a public host, checked again at every send). Its signing secret is answered this once, never again (a replay of the request answers it as null).",
    body: endpointCreateBody,
    response: one(apiEndpoint.extend({ secret: z.string().nullable().describe("The signing secret, this once.") })),
    status: 201,
    errors: ["invalid", "conflict"],
  }),
  op({
    name: "webhooks.update",
    method: "PATCH",
    path: "/webhooks/{id}",
    scope: "webhooks:write",
    permission: "owner",
    tag: "Webhook endpoints",
    summary: "Change a webhook endpoint",
    description: "Changes its name, address or topics, or switches it on or off.",
    params: byId,
    body: endpointUpdateBody,
    response: one(apiEndpoint),
    status: 200,
    errors: ["not_found", "invalid"],
  }),
  op({
    name: "webhooks.delete",
    method: "DELETE",
    path: "/webhooks/{id}",
    scope: "webhooks:write",
    permission: "owner",
    tag: "Webhook endpoints",
    summary: "Remove a webhook endpoint",
    description: "Removes the endpoint; what it still has waiting is not sent.",
    params: byId,
    response: deleted,
    status: 200,
    errors: ["not_found"],
  }),
  op({
    name: "webhooks.deliveries",
    method: "GET",
    path: "/webhooks/{id}/deliveries",
    scope: "webhooks:write",
    permission: "owner",
    tag: "Webhook endpoints",
    summary: "List an endpoint's deliveries",
    description: "The endpoint's latest deliveries (kept 30 days), newest first, with how each went.",
    params: byId,
    query: z.object({ limit: paging.limit }),
    response: all(apiDelivery),
    status: 200,
    errors: ["not_found", "invalid"],
  }),
  op({
    name: "webhooks.resend",
    method: "POST",
    path: "/webhooks/{id}/deliveries/{delivery_id}/resend",
    scope: "webhooks:write",
    permission: "owner",
    tag: "Webhook endpoints",
    summary: "Send a delivery again",
    description: "Sends a delivery that ended (failed or delivered) again, with the same payload and id, to an endpoint that is on.",
    params: byId.extend({ delivery_id: id.describe("The delivery.") }),
    body: nothing,
    response: one(z.object({ queued: z.literal(true) })),
    status: 200,
    errors: ["not_found", "invalid", "conflict"],
  }),
  // Bulk jobs (D165): the product file
  op({
    name: "jobs.product_export",
    method: "POST",
    path: "/jobs/product-exports",
    scope: "products:read",
    permission: "products:read",
    tag: "Bulk jobs",
    summary: "Export the product file",
    description: "The product CSV of the Data page (D165): answered here when it has at most 2,000 rows, else a job to poll and download.",
    body: exportBody,
    response: exportAnswer,
    status: 201,
    errors: ["invalid", "conflict"],
  }),
  op({
    name: "jobs.product_import",
    method: "POST",
    path: "/jobs/product-imports",
    scope: "products:write",
    permission: "products:write",
    tag: "Bulk jobs",
    summary: "Start a product import",
    description: "Gives a one-time address to PUT a product CSV (Kaizena Flow's, Shopify's or WooCommerce's) to; then check it with `POST /jobs/product-imports/{id}/check`.",
    body: importStartBody,
    response: one(z.object({ upload_id: id, upload_url: z.string(), method: z.literal("PUT"), headers: z.record(z.string(), z.string()) })),
    status: 201,
    errors: ["invalid", "conflict"],
  }),
  op({
    name: "jobs.product_import_check",
    method: "POST",
    path: "/jobs/product-imports/{id}/check",
    scope: "products:write",
    permission: "products:write",
    tag: "Bulk jobs",
    summary: "Check an uploaded product file",
    description: "Takes the file sent to the upload's address as an import job and runs its dry run, as the Data page does: poll the job until it is checked, then apply it.",
    params: byId.extend({ id: id.describe("The upload's id.") }),
    body: importCheckBody,
    response: one(apiJob),
    status: 201,
    errors: ["not_found", "invalid", "conflict"],
  }),
  op({
    name: "jobs.apply",
    method: "POST",
    path: "/jobs/{id}/apply",
    scope: "products:write",
    permission: "products:write",
    tag: "Bulk jobs",
    summary: "Apply a checked import",
    description: "Imports what the dry run found, through the product editor's own save; never deletes and never changes a handle.",
    params: byId,
    body: nothing,
    response: one(apiJob),
    status: 200,
    errors: ["not_found", "invalid", "conflict"],
  }),
  op({
    name: "jobs.get",
    method: "GET",
    path: "/jobs/{id}",
    scope: "products:read",
    permission: "products:read",
    tag: "Bulk jobs",
    summary: "Poll a job",
    description: "A product file's job as it is now: its status, counts and parts.",
    params: byId,
    response: one(apiJob),
    status: 200,
    errors: ["not_found"],
  }),
  op({
    name: "jobs.download",
    method: "GET",
    path: "/jobs/{id}/download",
    scope: "products:read",
    permission: "products:read",
    tag: "Bulk jobs",
    summary: "Download a job's file",
    description: "A done export's file parts as short-lived addresses, or an import's problems as CSV.",
    params: byId,
    response: one(z.object({ parts: z.array(z.object({ name: z.string(), url: z.string() })), problems_csv: z.string().nullable() })),
    status: 200,
    errors: ["not_found", "conflict"],
  }),
] as const;

