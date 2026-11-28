import { z } from "zod";

import { all, byId, currency, deleted, id, marketCode, minor, nothing, one, op, paging, since, when } from "./admin-api-shapes";
import { JOB_STATUSES } from "./data-job";
import { EVENTS, type IntegrationEvent } from "./integrations";
import { MENU_MAX_ITEMS, MENU_NAME_MAX } from "./navigation";

/**
 * The Admin API's content, the store and its operations (wave 14 unit C4, D440, `docs/wave-14-developer-platform.md` C4): pages, headers,
 * footers (D917), blog articles and content entries read, written as drafts and published with the power scope `content:publish` (D42,
 * D326); menus read and written (D85, D917); looks of the theme library made from theme settings, live only with `content:publish` (D917);
 * the store's settings read (markets, currencies, languages, shipping, tax profile, price display); saved reports run (D345); the owner's
 * webhook endpoints and their deliveries with the power scope `webhooks:write` (D354); and the product file of the D165 pipeline exported and
 * imported as jobs. Entries of `ADMIN_API`; their handlers are `src/server/admin-api-content.ts`. Pure.
 */

// Pages and articles (D42, D57) -------------------------------------------------------------

export const PAGE_STATES_API = ["draft", "published", "changed"] as const;
/** What `/pages` holds (D917): pages, and the headers and footers of D80; `/articles` holds articles. */
export const SITE_PAGE_TYPES_API = ["page", "header", "footer"] as const;

export const apiPageSummary = z.object({
  id,
  type: z.enum([...SITE_PAGE_TYPES_API, "article"]).describe("page, header or footer under /pages (D917); article under /articles."),
  title: z.string(),
  slug: z.string().describe("Its address on the site, after the store's (a page) or blog/ (an article)."),
  state: z.enum(PAGE_STATES_API).describe("draft: never published. published: the site shows the draft as it is. changed: the draft has changes not published."),
  published_at: when.nullable(),
  updated_at: when,
});

export const apiPage = apiPageSummary.extend({
  first_published_at: when.nullable().describe("When it first appeared on the site: an article is dated by it and the blog ordered by it."),
  draft: z.record(z.string(), z.unknown()).describe("The page as the editor keeps it (its words, rows and blocks, search texts, categories): what `PATCH` takes back whole."),
});

export const pageDraftBody = z.object({
  draft: z
    .record(z.string(), z.unknown())
    .describe("The page as the editor keeps it, whole (read one with GET first); the editor's own checks run on it. It is saved as the draft; the site keeps what was published."),
});
/** A page, header or footer made over `/pages` (D917). */
export const pageCreateBody = pageDraftBody.extend({
  type: z
    .enum(SITE_PAGE_TYPES_API)
    .optional()
    .describe("page (when left out), or a header or footer (D80): the site shows one once it is published and a look that is live has it (`POST /themes`)."),
});
/** An article's draft, with the date it first appeared elsewhere (D917). */
export const articleDraftBody = pageDraftBody.extend({
  first_published_at: when
    .nullable()
    .optional()
    .describe(
      "When the article first appeared, for one brought from another site: a time not in the future, kept when it is published, so the site dates it and orders the blog by it. null, for an article not on the site: the day it is published. On an article already on the site this changes what visitors see, so it takes the power `content:publish` too (else `gated`).",
    ),
});
export const pagePublishBody = z.object({
  acknowledged_issues: z
    .array(z.string().max(200))
    .max(100)
    .optional()
    .describe("The checker's blocking issues (their ids) the owner has seen and publishes with; a publish with an issue not named is refused as `conflict` with the issues."),
});

/** A page made from a design (D898 F2): the frame as the Kaizena Flow plugin reads it, and the library items it sent for its pictures. */
export const pageImportBody = z.object({
  source: z.literal("figma").describe("Where the design comes from: `figma`, the Kaizena Flow plugin."),
  file: z.string().trim().max(200).optional().describe("The design file's name, for the page's notes."),
  desktop: z
    .record(z.string(), z.unknown())
    .describe("The frame for computers as the plugin reads it: its name, size and tree (boxes, auto layout, fills, corners, shadows, text runs, picture keys)."),
  mobile: z.record(z.string(), z.unknown()).nullable().optional().describe("A frame at phone width. Read and checked; the draft is built from the computers' frame for now."),
  pictures: z
    .record(
      z.string().max(120),
      z.object({ id: z.guid().describe("The library item (`POST /media`)."), url: z.string().max(2000), width: z.int().nullable(), height: z.int().nullable() }),
    )
    .describe("The library items sent for the frame's pictures and drawn shapes, by the plugin's keys (`image:{hash}`, `shot:{node}`)."),
});

export const apiPageImport = z.object({
  id,
  title: z.string(),
  edit_url: z.string().describe("Where the draft opens in the page builder."),
  summary: z.string().describe("What was built, in a sentence."),
  notes: z.array(z.string()).describe("What was left out or made simpler, and the typefaces installed or stood in for."),
});

// Themes (D898 F3): the theme library read, and a look brought from a design file ------------------------------------------------

export const apiTheme = z.object({
  id,
  title: z.string(),
  live: z.boolean().describe("Whether visitors see it. Only the owner makes a look live, in Design settings."),
  from_theme: z.boolean().describe("Installed from a theme of the theme store; false for the store's own looks."),
  version: z.int().nullable().describe("The theme's version installed, when it came from one."),
  installed_at: when,
});

const apiPalette = z.object({
  background: z.string(),
  surface: z.string().describe("Panels and cards."),
  text: z.string(),
  muted: z.string().describe("Secondary text."),
  border: z.string(),
  accent: z.string().describe("Buttons and highlights."),
  accent_text: z.string().describe("Words on the accent."),
});

export const apiLook = apiTheme.omit({ installed_at: true }).extend({
  mode: z.enum(["auto", "light", "dark"]).describe("auto follows the visitor's device."),
  light: apiPalette,
  dark: apiPalette,
  fonts: z.object({ heading: z.string().nullable(), body: z.string().nullable() }).describe("Google Fonts families; null: the system's own."),
  headings: z.object({ weight: z.string(), case: z.string() }),
  text_styles: z
    .array(
      z.object({
        element: z.string().describe("h1 to h6, p, list or button."),
        family: z.string().nullable(),
        weight: z.int().nullable(),
        size: z.string().nullable().describe("CSS, such as 64px."),
        line_height: z.string().nullable(),
        letter_spacing: z.string().nullable(),
        uppercase: z.boolean(),
      }),
    )
    .describe("The typography the theme gives each element on computers (the page builder's Theme tab)."),
  saved_colours: z.array(z.object({ name: z.string(), color: z.string() })).describe("Offered in every colour field of the page builder."),
  header: id.nullable().describe("The store's header (`/pages?type=header`) the look shows; null: the standard header."),
  footer: id.nullable().describe("The store's footer the look shows; null: the standard footer."),
  theme: z.record(z.string(), z.unknown()).describe("The theme settings as Design settings keep them: what `POST /themes` and `PATCH` take."),
});

/** A look of the store's own made from theme settings (D917), as Design settings keep them. */
export const themeBody = z.object({
  title: z.string().trim().min(1).max(80).describe("The look's name in the theme library."),
  theme: z
    .record(z.string(), z.unknown())
    .describe(
      "The theme settings as Design settings keep them (read a look's `theme` with GET first): `base`, a theme of the theme store's bases such as minimal, and `settings` (mode, the light and dark palettes, fonts, headings, buttons, corners, layout). Checked as Design settings check them.",
    ),
  css: z.string().max(200_000).optional().describe("The look's own CSS, checked as Design settings check it; the live look's when left out."),
  header: id.nullable().optional().describe("One of the store's headers the look shows; null: the standard header; the live look's when left out."),
  footer: id.nullable().optional().describe("One of the store's footers the look shows; null: the standard footer; the live look's when left out."),
});

export const apiThemeLive = z.object({
  id,
  title: z.string(),
  put_away: z.string().describe("The look that was live, kept in the theme library as it was."),
  notes: z.array(z.string()).describe("What visitors do not see yet, such as a header or footer of the look that is not published."),
});

/** A look from a design file (D898 F3): the colours and text styles the Kaizena Flow plugin read. */
export const themeImportBody = z.object({
  source: z.literal("figma").describe("Where the design comes from: `figma`, the Kaizena Flow plugin."),
  file: z.string().trim().max(200).optional().describe("The design file's name: the new look is named after it."),
  title: z.string().trim().max(80).optional().describe("The new look's name, over the file's."),
  install: z.guid().nullable().optional().describe("The look made from this file before (its id): brought up to date while it is not live."),
  colours: z
    .array(z.record(z.string(), z.unknown()))
    .max(300)
    .describe("Colour styles and colour variables, at most 300: `name`, `color` (#rrggbb), and a variable's `mode` and whether it is its collection's first (`main`)."),
  text: z
    .array(z.record(z.string(), z.unknown()))
    .max(100)
    .describe("Text styles, at most 100: `name`, `family`, `style` (Regular, Semi Bold Italic), `size`, `line` and `tracking` in pixels, `upper`."),
});

export const apiThemeImport = z.object({
  id,
  title: z.string(),
  created: z.boolean().describe("false: the look made before was brought up to date."),
  try_url: z.string().describe("Where the owner tries the look and makes it live."),
  summary: z.string().describe("What was made, in a sentence."),
  notes: z.array(z.string()).describe("Colours made readable or guessed, typefaces stood in for, and what was left out."),
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
/** A menu as the menu editor saves it (D85, D917). */
export const menuBody = z.object({
  name: z.string().trim().min(1).max(MENU_NAME_MAX).describe("The menu's name, one of a kind in the store."),
  items: z
    .array(z.record(z.string(), z.unknown()))
    .max(MENU_MAX_ITEMS)
    .describe(
      "The links in order, as GET answers them: each `label` (its text by locale, such as en-US: a page's, article's or product's own title when left out), `link` (`kind` page, article, category, tag or blogCategory with its `slug`, product with its `handle`, url with its `url`, or home, products, account, cart or blog), `depth` (0 at the top, else at most one deeper than the link before) and `newTab`. Checked as the menu editor checks them: a page, article or product linked must be the store's own.",
    ),
});

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

// A/B tests (D148 phase 15) ------------------------------------------------------------------------------

/** One A/B test as its page reads it (`experimentCard()`): the stage, how far along, the one next step and, once it has an answer, each version against the original. */
export const apiExperiment = z.object({
  id,
  name: z.string(),
  status: z.enum(["draft", "scheduled", "running", "stopped", "applied", "discarded"]),
  stage: z.enum(["draft", "scheduled", "learning", "answer", "broken", "applied", "discarded"]).describe("As the test's page shows it: a running test is learning until it has an answer, or broken when the visitors are not divided as planned."),
  next: z.enum(["start", "wait", "use", "keep_original", "start_again", "done"]).describe("The one next step the page offers."),
  best: z.string().nullable().describe("For next = use: the version to use."),
  goal: z
    .enum(["orders", "revenue", "cart", "checkout", "click", "form", "signup", "page"])
    .describe("signup: a sign-up to Kaizena Flow, a goal only Kaizena Flow's own store has. page: going on to a chosen page of the store."),
  target: z.object({ kind: z.enum(["page", "layout", "header", "footer", "role"]), title: z.string(), slug: z.string(), part: z.string().nullable() }),
  versions: z.array(z.object({ key: z.string().describe("a is the original."), name: z.string(), share: z.number() })),
  progress: z.object({
    days: z.int(),
    min_days: z.int(),
    visitors: z.int().describe("Visitors of the version with the fewest."),
    min_visitors: z.int(),
    share: z.number().describe("How far along, 0 to 1: the lesser of days and visitors."),
    reached: z.boolean(),
    ready_around: z.string().nullable().describe("The day (YYYY-MM-DD) it is likely ready at today's pace; null when reached or nothing to go on."),
  }),
  comparisons: z
    .array(
      z.object({
        key: z.string(),
        original: z.number().describe("The original's rate (a share) or revenue per visitor (minor units)."),
        version: z.number(),
        relative: z.number().nullable().describe("The change as a share of the original."),
        low: z.number().nullable().describe("The likely range's low end, at the verdict's level."),
        high: z.number().nullable(),
        side: z.enum(["better", "worse", "unsure"]).describe("Where the range lies: wholly above no change, wholly below, or across it."),
      }),
    )
    .describe("Only once the test has an answer: empty while it is too early, so no one reads a peek as a result."),
  impact: z.object({ key: z.string(), per_week: z.int(), low: z.int(), high: z.int() }).nullable().describe("If everyone saw the better version: how many more visitors a week would do the thing, with its likely range."),
  learning: z.string().nullable().describe("What the owner wrote the test taught."),
  started_at: when.nullable(),
  stopped_at: when.nullable(),
  answered_at: when.nullable(),
  applied_version: z.string().nullable(),
  created_at: when,
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
  counts: z
    .record(z.string(), z.unknown())
    .describe(
      "What the dry run found or the run did: products to make, to change, unchanged, refused. An import's `dry` has `toCreate`, `toUpdate`, `unchanged`, `withProblems` and `onShop` (products the apply would publish, archive, bring back or change on the site).",
    ),
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

const pageOps = <const P extends "pages" | "articles", Q extends z.ZodObject, C extends z.ZodObject, U extends z.ZodObject>(
  plural: P,
  kind: string,
  tag: string,
  bodies: { query: Q; create: C; update: U },
) =>
  [
    op({
      name: `${plural}.list` as const,
      method: "GET",
      path: `/${plural}` as const,
      scope: "content:read",
      permission: "website:read",
      tag,
      summary: `List ${kind}s`,
      description: `The store's ${kind}s, the most recently changed first, each with whether its draft is published.${plural === "pages" ? " With `type`, its headers or footers (D917)." : ""}`,
      query: bodies.query,
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
      description: `One ${kind}${plural === "pages" ? ", header or footer" : ""} with its draft as the editor keeps it.`,
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
      description: `Makes a ${kind} as a draft through the editor's own save and its checks; nothing is on the site until it is published. A draft that carries \`globalEdits\` is refused: global parts change in the admin.${plural === "pages" ? " With `type`, a header or footer (D917), holding the site's own parts (logo, menus, languages, cart) as the builder offers them." : " With `first_published_at`, the date it first appeared elsewhere (D917)."}`,
      body: bodies.create,
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
      description: `Saves the ${kind}'s draft whole through the editor's save; what the site shows stays as published until it is published again. A draft that carries \`globalEdits\` is refused: global parts, and the pages using them, change in the admin.${kind === "page" ? " A new address for a page never published also moves the pages under it at once: when one of them is published, that takes the power \`content:publish\` too (else \`gated\`)." : ""}`,
      params: byId,
      body: bodies.update,
      response: one(apiPage),
      status: 200,
      errors: ["not_found", "invalid", "gated"],
    }),
    op({
      name: `${plural}.publish` as const,
      method: "POST",
      path: `/${plural}/{id}/publish` as const,
      scope: "content:publish",
      permission: "website:write",
      tag,
      summary: `Publish a ${kind}`,
      description: `Publishes the ${kind}'s draft through the editor's own publish: its checks run, and a blocking issue not acknowledged is refused as \`conflict\` naming it.${plural === "pages" ? " A header or footer shows on the site once it is published and the live look has it." : ""}`,
      params: byId,
      body: pagePublishBody,
      response: one(apiPage),
      status: 200,
      errors: ["not_found", "invalid", "conflict"],
    }),
  ] as const;

export const CONTENT_API = [
  ...pageOps("pages", "page", "Pages", {
    query: z.object({ ...since, type: z.enum(SITE_PAGE_TYPES_API).optional().describe("page (when left out), header or footer.") }),
    create: pageCreateBody,
    update: pageDraftBody,
  }),
  op({
    name: "pages.import",
    method: "POST",
    path: "/pages/import",
    scope: "content:write",
    permission: "website:write",
    tag: "Pages",
    summary: "Make a draft page from a design",
    description:
      "Builds a draft page from a Figma frame the Kaizena Flow plugin read (D898): the page copy engine lays it out as rows, columns and blocks in the store's builder, its pictures are the library items sent with `POST /media`, and its typefaces are installed from Google Fonts or stood in for by the nearest one. Nothing is on the site until it is published.",
    body: pageImportBody,
    response: one(apiPageImport),
    status: 201,
    errors: ["invalid", "conflict"],
  }),
  ...pageOps("articles", "blog article", "Blog", { query: z.object(since), create: articleDraftBody, update: articleDraftBody }),
  op({
    name: "themes.list",
    method: "GET",
    path: "/themes",
    scope: "content:read",
    permission: "website:read",
    tag: "Themes",
    summary: "List the theme library",
    description: "The store's installed themes and own looks (D241), the live one first. At most 20.",
    response: all(apiTheme),
    status: 200,
    errors: [],
  }),
  op({
    name: "themes.get",
    method: "GET",
    path: "/themes/{id}",
    scope: "content:read",
    permission: "website:read",
    tag: "Themes",
    summary: "Get a look",
    description: "One look of the theme library: its colours for light and dark, its typefaces, the typography of its headings, paragraphs and buttons, and its saved colours.",
    params: byId,
    response: one(apiLook),
    status: 200,
    errors: ["not_found"],
  }),
  op({
    name: "themes.import",
    method: "POST",
    path: "/themes/import",
    scope: "content:write",
    permission: "website:write",
    tag: "Themes",
    summary: "Make a look from a design file",
    description:
      "Makes a look in the theme library from a Figma file's colour styles, colour variables and text styles, as the Kaizena Flow plugin reads them (D898 F3): the colours named for the brand, the page and its text become both palettes, each made readable; a dark mode is the dark palette; the heading and body typefaces are installed from Google Fonts or stood in for by the nearest; the text styles named for headings, paragraphs and buttons are their typography; every colour is saved. Never live: the owner makes it live in Design settings. With `install`, the look made before is brought up to date while it is not live.",
    body: themeImportBody,
    response: one(apiThemeImport),
    status: 201,
    errors: ["invalid", "conflict"],
  }),
  op({
    name: "themes.create",
    method: "POST",
    path: "/themes",
    scope: "content:write",
    permission: "website:write",
    tag: "Themes",
    summary: "Make a look from theme settings",
    description:
      "Makes a look of the store's own in the theme library (D917) from theme settings as Design settings keep them, checked as Design settings check them, with the header, footer and CSS given (the live look's where left out). Never live: making it live is `POST /themes/{id}/live`, or the owner's in Design settings. At most 20 looks; a store not open is refused.",
    body: themeBody,
    response: one(apiLook),
    status: 201,
    errors: ["invalid", "conflict"],
  }),
  op({
    name: "themes.update",
    method: "PATCH",
    path: "/themes/{id}",
    scope: "content:write",
    permission: "website:write",
    tag: "Themes",
    summary: "Change a look that is not live",
    description:
      "Changes what a look that is not live keeps (D917): its name, theme settings, CSS, header or footer, each checked as Design settings check it. Visitors see nothing of it until it is made live. The live look is refused as `conflict`: it changes in Design settings, where changes reach visitors at once.",
    params: byId,
    body: themeBody.partial(),
    response: one(apiLook),
    status: 200,
    errors: ["not_found", "invalid", "conflict"],
  }),
  op({
    name: "themes.live",
    method: "POST",
    path: "/themes/{id}/live",
    scope: "content:publish",
    permission: "website:write",
    tag: "Themes",
    summary: "Make a look live",
    description:
      "Makes a look of the theme library the one visitors see (D917), as switching in Design settings does: the live look is put away with every change made to it kept, and the chosen one's settings, CSS, header and footer become the store's. Words, pictures, pages, products and menus are not touched. A premium theme the store has not bought is refused: it is bought in the theme store.",
    params: byId,
    body: nothing,
    response: one(apiThemeLive),
    status: 200,
    errors: ["not_found", "invalid", "conflict"],
  }),
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
    description:
      "Changes the entry's draft: the values given, laid over its draft as kept. Its address is not drafted: a published entry's changes on the site at once, so it takes the power `content:publish` too (else `gated`).",
    params: byId,
    body: entryBody.partial({ slug: true }),
    response: one(apiEntry),
    status: 200,
    errors: ["not_found", "invalid", "gated"],
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
  op({
    name: "menus.create",
    method: "POST",
    path: "/menus",
    scope: "content:write",
    permission: "website:write",
    tag: "Menus",
    summary: "Create a menu",
    description:
      "Makes a menu through the menu editor's own save (D917): its links checked as the editor checks them, a link's texts kept for the store's languages. It shows where a header, footer or page names it in a menu component.",
    body: menuBody,
    response: one(apiMenu),
    status: 201,
    errors: ["invalid", "conflict"],
  }),
  op({
    name: "menus.update",
    method: "PATCH",
    path: "/menus/{id}",
    scope: "content:write",
    permission: "website:write",
    tag: "Menus",
    summary: "Save a menu",
    description:
      "Saves a menu whole through the menu editor's save (D917). A menu is not drafted: one the site shows (the standard header's or footer's, or named in a published page, header or footer) changes for visitors at once, so it takes the power `content:publish` too (else `gated`).",
    params: byId,
    body: menuBody,
    response: one(apiMenu),
    status: 200,
    errors: ["not_found", "invalid", "conflict", "gated"],
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
  // A/B tests (D148 phase 15)
  op({
    name: "experiments.list",
    method: "GET",
    path: "/experiments",
    scope: "reports:read",
    permission: "marketing:read",
    tag: "A/B tests",
    summary: "List A/B tests",
    description: "The store's A/B tests, newest first, each as its page reads it: the stage, how far along, the next step and, once it has an answer, each version against the original. Worked out by the store; nothing is written.",
    response: all(apiExperiment),
    status: 200,
    errors: [],
  }),
  op({
    name: "experiments.get",
    method: "GET",
    path: "/experiments/{id}",
    scope: "reports:read",
    permission: "marketing:read",
    tag: "A/B tests",
    summary: "Get an A/B test",
    description: "One A/B test as its page reads it.",
    params: byId,
    response: one(apiExperiment),
    status: 200,
    errors: ["not_found"],
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
    scope: "products:manage",
    permission: "products:write",
    tag: "Bulk jobs",
    summary: "Start a product import",
    description: "Gives a one-time address to PUT a product CSV (Kaizena Flow's, Shopify's or WooCommerce's) to; then check it with `POST /jobs/product-imports/{id}/check`.",
    body: importStartBody,
    response: one(
      z.object({
        upload_id: id,
        upload_url: z.string().nullable().describe("A one-time address to PUT the file to. Answered once: a replay of the request (the same Idempotency-Key) answers null."),
        method: z.literal("PUT"),
        headers: z.record(z.string(), z.string()),
      }),
    ),
    status: 201,
    errors: ["invalid", "conflict"],
  }),
  op({
    name: "jobs.product_import_check",
    method: "POST",
    path: "/jobs/product-imports/{id}/check",
    scope: "products:manage",
    permission: "products:write",
    tag: "Bulk jobs",
    summary: "Check an uploaded product file",
    description:
      "Takes the file sent to the upload's address as an import job and runs its dry run, as the Data page does: poll the job until it is checked, then apply it. Its `counts.dry.onShop` is how many products the file would publish, archive, bring back or change on the site, which takes `products:publish`: without it, the check is of drafts only and refuses those products.",
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
    scope: "products:manage",
    permission: "products:write",
    tag: "Bulk jobs",
    summary: "Apply a checked import",
    description:
      "Imports what the dry run found, through the product editor's own save; never deletes and never changes a handle. Without the power `products:publish`, an import whose dry run counted products to publish, archive, bring back or change on the site (`counts.dry.onShop`) is refused as `gated` and cancelled, and one checked by a token with the power (or in the admin) must be checked again; what is applied is drafts only, so a product that went on the site since the check is left as it is.",
    params: byId,
    body: nothing,
    response: one(apiJob),
    status: 200,
    errors: ["not_found", "invalid", "gated", "conflict"],
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

