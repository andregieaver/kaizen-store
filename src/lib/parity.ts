// The parity tracker (docs/parity/README.md): pure code. Types for a row,
// the rules the data must keep, the scoring, the projection per wave and the
// Markdown that docs/shopify-parity.md is generated from. No file access here:
// callers pass the files' text and a `fileExists` function, so everything is
// testable, and scripts/parity.mjs runs it under node's type stripping (so no
// enums, no parameter properties and no imports in this file).

export const DOMAINS = [
  "catalogue",
  "storefront",
  "checkout",
  "orders",
  "customers",
  "analytics",
  "international",
  "platform",
  "ai",
] as const;
export type Domain = (typeof DOMAINS)[number];

export const DOMAIN_NAMES: Record<Domain, string> = {
  catalogue: "Catalogue and products",
  storefront: "Storefront, themes and content",
  checkout: "Checkout and payments",
  orders: "Orders, shipping, fulfilment and returns",
  customers: "Customers, marketing and loyalty",
  analytics: "Analytics, reporting and finance",
  international: "International, compliance and trust",
  platform: "Platform, extensibility and operations",
  ai: "AI and automation",
};

export const RATINGS = ["full", "partial", "missing"] as const;
export type Rating = (typeof RATINGS)[number];

export const TIERS = ["native", "app", "plus"] as const;
export type Tier = (typeof TIERS)[number];

export const BUCKETS = ["A", "B", "C", "D"] as const;
export type Bucket = (typeof BUCKETS)[number];

export const WAVES = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export const WAVE_NAMES: Record<number, string> = {
  1: "Compliance and money",
  2: "Data in and out",
  3: "Inventory and orders",
  4: "Payments",
  5: "Customers and marketing",
  6: "Catalogue",
  7: "Storefront and international",
  8: "Analytics and AI",
  9: "Platform and extensibility",
};

export const BUCKET_WORDS: Record<Bucket, string> = {
  A: "Build in-house",
  B: "Build, live only with a third party",
  C: "Strategy decision first",
  D: "Not reachable by code",
};

/** The first report's figures (2026-10-02), kept so the report can say how far it moved. */
export const FIRST_REPORT = {
  on: "2026-10-02",
  core: 59.5,
  mustHave: 69.1,
  coreCount: 232,
} as const;

export const RATING_SCORE: Record<Rating, number> = { full: 1, partial: 0.5, missing: 0 };

export interface HistoryEntry {
  on: string;
  from: Rating;
  to: Rating;
  why: string;
}

export interface ParityRow {
  id: string;
  domain: Domain;
  feature: string;
  weight: number;
  shopify: {
    tier: Tier;
    text: string;
    url?: string | null;
    fetched: boolean;
    checkedOn?: string | null;
  };
  kaizen: { rating: Rating; rechecked: boolean; was: Rating | null };
  gap: string;
  bucket: Bucket | null;
  wave: number | null;
  criteria: string[];
  evidence: { files: string[]; tests: string[]; untested: boolean };
  decisions: string[];
  history: HistoryEntry[];
}

// ---------------------------------------------------------------------------
// Validation

export interface Problem {
  id: string;
  rule: string;
  message: string;
}

export interface ValidateOptions {
  /** True when the repository path exists (paths are relative to the repository root). */
  fileExists: (path: string) => boolean;
  /** Decision ids found in docs/decisions.md; when given, every listed decision must be one. */
  knownDecisions?: ReadonlySet<string>;
  /** YYYY-MM-DD; when given, no date may lie after it. */
  today?: string;
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DECISION = /^D\d+$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isDate(v: unknown): v is string {
  if (typeof v !== "string" || !DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function isNonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

function oneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === "string" && (list as readonly string[]).includes(v);
}

function stringList(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null;
}

/**
 * Checks every rule of docs/parity/README.md on rows read from JSON (so the
 * input is `unknown`, and a malformed row is a problem, never a crash).
 * Returns every problem found; an empty list means the data is valid.
 */
export function validateRows(input: readonly unknown[], options: ValidateOptions): Problem[] {
  const problems: Problem[] = [];
  const seen = new Set<string>();

  input.forEach((raw, index) => {
    if (!isRecord(raw)) {
      problems.push({ id: `#${index}`, rule: "shape", message: "a row must be an object" });
      return;
    }
    const id = isNonEmpty(raw.id) ? raw.id : `#${index}`;
    const bad = (rule: string, message: string) => problems.push({ id, rule, message });

    // Identity.
    const domain = raw.domain;
    if (!oneOf(DOMAINS, domain)) bad("domain", `domain "${String(domain)}" is not one of ${DOMAINS.join(", ")}`);
    if (!isNonEmpty(raw.id)) bad("id", "id is missing");
    else {
      if (seen.has(id)) bad("id-unique", "id is used by another row");
      seen.add(id);
      const dot = id.indexOf(".");
      const prefix = dot < 0 ? "" : id.slice(0, dot);
      const slug = dot < 0 ? "" : id.slice(dot + 1);
      if (!SLUG.test(slug) || prefix === "") bad("id", `id must be "{domain}.{slug}" with a lowercase-and-dashes slug`);
      else if (oneOf(DOMAINS, domain) && prefix !== domain) bad("id", `id starts with "${prefix}" but the domain is "${String(domain)}"`);
    }
    if (!isNonEmpty(raw.feature)) bad("feature", "feature is empty");
    if (!Number.isInteger(raw.weight) || (raw.weight as number) < 1 || (raw.weight as number) > 5) {
      bad("weight", `weight must be a whole number 1 to 5, got ${String(raw.weight)}`);
    }

    // Shopify side.
    const shopify = isRecord(raw.shopify) ? raw.shopify : null;
    if (!shopify) bad("shopify", "shopify is missing");
    else {
      if (!oneOf(TIERS, shopify.tier)) bad("tier", `shopify.tier must be one of ${TIERS.join(", ")}`);
      if (!isNonEmpty(shopify.text)) bad("shopify", "shopify.text is empty");
      if (typeof shopify.fetched !== "boolean") bad("fetched", "shopify.fetched must be true or false");
      if (shopify.url !== undefined && shopify.url !== null) {
        let ok = false;
        try {
          ok = typeof shopify.url === "string" && new URL(shopify.url).protocol === "https:";
        } catch {
          ok = false;
        }
        if (!ok) bad("fetched", "shopify.url must be an https address");
      }
      if (shopify.checkedOn !== undefined && shopify.checkedOn !== null && !isDate(shopify.checkedOn)) bad("fetched", "shopify.checkedOn must be a date (YYYY-MM-DD)");
      if (shopify.fetched === true) {
        if (shopify.url === undefined || shopify.url === null) bad("fetched", "a fetched row needs shopify.url");
        if (shopify.checkedOn === undefined || shopify.checkedOn === null) bad("fetched", "a fetched row needs shopify.checkedOn");
      }
      if (options.today && isDate(shopify.checkedOn) && shopify.checkedOn > options.today) {
        bad("fetched", `shopify.checkedOn ${shopify.checkedOn} is in the future`);
      }
    }

    // Kaizen side.
    const kaizen = isRecord(raw.kaizen) ? raw.kaizen : null;
    const rating = kaizen && oneOf(RATINGS, kaizen.rating) ? kaizen.rating : null;
    const was = kaizen && kaizen.was !== undefined && kaizen.was !== null && oneOf(RATINGS, kaizen.was) ? kaizen.was : null;
    if (!kaizen) bad("rating", "kaizen is missing");
    else {
      if (!rating) bad("rating", `kaizen.rating must be one of ${RATINGS.join(", ")}`);
      if (typeof kaizen.rechecked !== "boolean") bad("rating", "kaizen.rechecked must be true or false");
      if (kaizen.was !== null && kaizen.was !== undefined && !oneOf(RATINGS, kaizen.was)) {
        bad("rating", "kaizen.was must be a rating or null");
      }
    }

    // Evidence.
    const evidence = isRecord(raw.evidence) ? raw.evidence : null;
    const files = evidence ? stringList(evidence.files) : null;
    const tests = evidence ? stringList(evidence.tests) : null;
    if (!evidence || !files || !tests || typeof evidence.untested !== "boolean") {
      bad("evidence", "evidence needs files (list), tests (list) and untested (true or false)");
    } else {
      for (const [kind, list] of [["files", files], ["tests", tests]] as const) {
        for (const path of list) {
          if (path.startsWith("/") || path.split("/").includes("..")) bad("evidence-path", `${kind} path "${path}" must be relative to the repository`);
          else if (!options.fileExists(path)) bad("evidence-path", `${kind} path "${path}" does not exist`);
        }
      }
    }

    // Gap, bucket, wave, criteria.
    const criteria = stringList(raw.criteria);
    if (!criteria || criteria.some((c) => c.trim() === "")) bad("criteria", "criteria must be a list of non-empty sentences");
    if (typeof raw.gap !== "string") bad("gap", "gap must be a string");
    const bucketOk = raw.bucket === null || oneOf(BUCKETS, raw.bucket);
    if (!bucketOk) bad("bucket", `bucket must be ${BUCKETS.join(", ")} or null`);
    const waveOk = raw.wave === null || (Number.isInteger(raw.wave) && (raw.wave as number) >= 1 && (raw.wave as number) <= 9);
    if (!waveOk) bad("wave", "wave must be a whole number 1 to 9, or null");

    if (rating === "full") {
      if (files && files.length === 0) bad("full-evidence", "a Full row lists at least one file in evidence.files");
      if (evidence && tests && evidence.untested === false && tests.length === 0) {
        bad("full-evidence", "a Full row lists a test in evidence.tests or says untested: true");
      }
      if (raw.bucket !== null) bad("full-fields", "a Full row has bucket null");
      if (raw.wave !== null) bad("full-fields", "a Full row has wave null");
      if (!criteria || criteria.length === 0) bad("criteria", "a Full row keeps the criteria that make it Full");
    } else if (rating) {
      if (!isNonEmpty(raw.gap)) bad("gap", "a Partial or Missing row says what is lacking (gap)");
      if (raw.bucket === null) bad("bucket", "a Partial or Missing row has a bucket (A, B, C or D)");
      if (!criteria || criteria.length === 0) bad("criteria", "a Partial or Missing row lists the criteria that would make it Full");
    }

    // History.
    const history = Array.isArray(raw.history) ? raw.history : null;
    if (!history) bad("history", "history must be a list");
    else {
      let previous: HistoryEntry | null = null;
      let entriesOk = true;
      for (const entry of history) {
        if (
          !isRecord(entry) ||
          !isDate(entry.on) ||
          !oneOf(RATINGS, entry.from) ||
          !oneOf(RATINGS, entry.to) ||
          !isNonEmpty(entry.why)
        ) {
          bad("history", "each history entry needs on (date), from, to (ratings) and why");
          entriesOk = false;
          continue;
        }
        const e = entry as unknown as HistoryEntry;
        if (e.from === e.to) bad("history", `history entry of ${e.on} does not change the rating`);
        if (options.today && e.on > options.today) bad("history", `history entry of ${e.on} is in the future`);
        if (previous) {
          if (e.on < previous.on) bad("history", "history is not in date order");
          if (e.from !== previous.to) bad("history", `history entry of ${e.on} starts at ${e.from} but the one before ended at ${previous.to}`);
        }
        previous = e;
      }
      if (entriesOk) {
        if (rating && was && was !== rating && history.length === 0) {
          bad("history", `the rating moved from ${was} to ${rating} and no history entry says why`);
        }
        if (previous) {
          if (rating && previous.to !== rating) bad("history", `the last history entry ends at ${previous.to} but the rating is ${rating}`);
          if (was !== previous.from) bad("history", `kaizen.was is ${String(was)} but the last history entry started at ${previous.from}`);
        } else if (kaizen && kaizen.was !== null && kaizen.was !== undefined) {
          bad("history", "kaizen.was is set but there is no history");
        }
      }
    }

    // Decisions.
    const decisions = stringList(raw.decisions);
    if (!decisions) bad("decisions", "decisions must be a list of D-numbers");
    else {
      for (const d of decisions) {
        if (!DECISION.test(d)) bad("decisions", `"${d}" is not a decision id like D153`);
        else if (options.knownDecisions && !options.knownDecisions.has(d)) bad("decisions", `${d} is not in docs/decisions.md`);
      }
    }
  });

  return problems;
}

/** Decision ids ("D153") that have a row in docs/decisions.md's table. */
export function decisionIds(decisionsMarkdown: string): Set<string> {
  const ids = new Set<string>();
  for (const match of decisionsMarkdown.matchAll(/^\|\s*(D\d+)\s*\|/gm)) ids.add(match[1]);
  return ids;
}

export interface RowFile {
  /** File name such as "orders.json"; its stem is the domain every row in it must have. */
  name: string;
  text: string;
}

/** Reads the per-domain files: JSON errors and rows filed under the wrong domain are problems. */
export function parseRowFiles(files: readonly RowFile[]): { rows: unknown[]; problems: Problem[] } {
  const rows: unknown[] = [];
  const problems: Problem[] = [];
  for (const file of files) {
    let data: unknown;
    try {
      data = JSON.parse(file.text);
    } catch (error) {
      problems.push({ id: file.name, rule: "json", message: `not valid JSON: ${(error as Error).message}` });
      continue;
    }
    if (!Array.isArray(data)) {
      problems.push({ id: file.name, rule: "json", message: "a domain file is a list of rows" });
      continue;
    }
    const stem = file.name.replace(/\.json$/, "");
    if (!oneOf(DOMAINS, stem)) problems.push({ id: file.name, rule: "domain", message: `"${stem}" is not a domain` });
    for (const row of data) {
      if (isRecord(row) && oneOf(DOMAINS, stem) && row.domain !== stem) {
        problems.push({ id: String(row.id ?? file.name), rule: "domain", message: `is in ${file.name} but its domain is "${String(row.domain)}"` });
      }
      rows.push(row);
    }
  }
  return { rows, problems };
}

// ---------------------------------------------------------------------------
// Scoring

export interface Score {
  rows: number;
  weight: number;
  points: number;
  full: number;
  partial: number;
  missing: number;
  /** 0 to 1; 0 when there are no rows. */
  weighted: number;
  unweighted: number;
}

type RatingOf = (row: ParityRow) => Rating;
const currentRating: RatingOf = (row) => row.kaizen.rating;

export const isCore = (row: ParityRow) => row.shopify.tier === "native";
export const isMustHave = (row: ParityRow) => row.weight >= 4;

export function scoreOf(rows: readonly ParityRow[], ratingOf: RatingOf = currentRating): Score {
  let weight = 0;
  let points = 0;
  let unweighted = 0;
  const counts = { full: 0, partial: 0, missing: 0 };
  for (const row of rows) {
    const rating = ratingOf(row);
    counts[rating] += 1;
    weight += row.weight;
    points += RATING_SCORE[rating] * row.weight;
    unweighted += RATING_SCORE[rating];
  }
  return {
    rows: rows.length,
    weight,
    points,
    ...counts,
    weighted: weight === 0 ? 0 : points / weight,
    unweighted: rows.length === 0 ? 0 : unweighted / rows.length,
  };
}

/** "59.5%" from 0.595. */
export function pct(fraction: number): string {
  return `${(Math.round(fraction * 1000) / 10).toFixed(1)}%`;
}

export interface Headline {
  /** Shopify native (Basic to Advanced): the headline. */
  core: Score;
  /** Core rows with weight 4 or 5. */
  mustHave: Score;
  /** Core and app-only rows. */
  coreApp: Score;
  /** Everything, Plus-only included. */
  all: Score;
}

export function headlineOf(rows: readonly ParityRow[], ratingOf: RatingOf = currentRating): Headline {
  const core = rows.filter(isCore);
  return {
    core: scoreOf(core, ratingOf),
    mustHave: scoreOf(core.filter(isMustHave), ratingOf),
    coreApp: scoreOf(rows.filter((r) => r.shopify.tier !== "plus"), ratingOf),
    all: scoreOf(rows, ratingOf),
  };
}

export interface DomainScore {
  domain: Domain;
  name: string;
  core: Score;
  mustHave: Score;
}

export function domainScores(rows: readonly ParityRow[]): DomainScore[] {
  return DOMAINS.map((domain) => {
    const core = rows.filter((r) => r.domain === domain && isCore(r));
    return { domain, name: DOMAIN_NAMES[domain], core: scoreOf(core), mustHave: scoreOf(core.filter(isMustHave)) };
  });
}

export interface BucketCount {
  bucket: Bucket | "none";
  rows: number;
  coreRows: number;
  /** Percentage points of the core headline still to win in these rows (0 to 100). */
  corePoints: number;
}

export interface EvidenceDebt {
  /** Full rows that list a test and do not say untested. */
  fullWithTests: number;
  /** Full by reading the code, no test holds it yet (debt, counted). */
  fullUntested: number;
  fullUntestedIds: string[];
  /** Rows whose Shopify side was not read from a page. */
  unfetched: number;
  unfetchedIds: string[];
  /** Rows that are not Full, by bucket. */
  byBucket: BucketCount[];
}

export function evidenceDebt(rows: readonly ParityRow[]): EvidenceDebt {
  const full = rows.filter((r) => r.kaizen.rating === "full");
  const untested = full.filter((r) => r.evidence.untested);
  const unfetched = rows.filter((r) => !r.shopify.fetched);
  const core = rows.filter(isCore);
  const coreWeight = core.reduce((sum, r) => sum + r.weight, 0);
  const byBucket = ([...BUCKETS, "none"] as const).map((bucket) => {
    const notFull = rows.filter((r) => r.kaizen.rating !== "full" && (r.bucket ?? "none") === bucket);
    const coreRows = notFull.filter(isCore);
    const lacking = coreRows.reduce((sum, r) => sum + (1 - RATING_SCORE[r.kaizen.rating]) * r.weight, 0);
    return { bucket, rows: notFull.length, coreRows: coreRows.length, corePoints: coreWeight === 0 ? 0 : (lacking / coreWeight) * 100 };
  });
  return {
    fullWithTests: full.length - untested.length,
    fullUntested: untested.length,
    fullUntestedIds: untested.map((r) => r.id),
    unfetched: unfetched.length,
    unfetchedIds: unfetched.map((r) => r.id),
    byBucket,
  };
}

// ---------------------------------------------------------------------------
// Projection per wave

export interface Reach {
  core: Score;
  mustHave: Score;
}

function reachIf(rows: readonly ParityRow[], becomesFull: (row: ParityRow) => boolean): Reach {
  const ratingOf: RatingOf = (row) => (becomesFull(row) ? "full" : row.kaizen.rating);
  const core = rows.filter(isCore);
  return { core: scoreOf(core, ratingOf), mustHave: scoreOf(core.filter(isMustHave), ratingOf) };
}

export interface WaveStep {
  wave: number;
  name: string;
  /** Rows not yet Full that are planned for this wave (all tiers). */
  rows: number;
  coreRows: number;
  /** Cumulative: every row planned for waves 1 to N became Full. */
  all: Reach;
  /** Cumulative, only bucket A rows (B, C and D left as they are). */
  buildable: Reach;
  /** Core points (percentage points) the wave adds to the "all" line. */
  added: number;
}

export interface Projection {
  now: Reach;
  steps: WaveStep[];
  /** Rows that are not Full and have no wave. */
  unplanned: { rows: number; coreRows: number };
  /** Every bucket A row Full, in any wave; B, C and D as they are. */
  ceilingA: Reach;
  /** Every bucket A and B row Full (B built, and approved by the third party). */
  ceilingAB: Reach;
}

export function projectWaves(rows: readonly ParityRow[]): Projection {
  const notFull = rows.filter((r) => r.kaizen.rating !== "full");
  const now = reachIf(rows, () => false);
  let previous = now.core.weighted;
  const steps = WAVES.map((wave) => {
    const planned = notFull.filter((r) => r.wave === wave);
    const all = reachIf(rows, (r) => r.wave !== null && r.wave <= wave);
    const buildable = reachIf(rows, (r) => r.bucket === "A" && r.wave !== null && r.wave <= wave);
    const step: WaveStep = {
      wave,
      name: WAVE_NAMES[wave],
      rows: planned.length,
      coreRows: planned.filter(isCore).length,
      all,
      buildable,
      added: (all.core.weighted - previous) * 100,
    };
    previous = all.core.weighted;
    return step;
  });
  return {
    now,
    steps,
    unplanned: {
      rows: notFull.filter((r) => r.wave === null).length,
      coreRows: notFull.filter((r) => r.wave === null && isCore(r)).length,
    },
    ceilingA: reachIf(rows, (r) => r.bucket === "A"),
    ceilingAB: reachIf(rows, (r) => r.bucket === "A" || r.bucket === "B"),
  };
}

// ---------------------------------------------------------------------------
// Moves in the rating over time

/** The rating a row had at the end of `date` (history says when it moved). */
export function ratingOn(row: ParityRow, date: string): Rating {
  let rating: Rating = row.history.length > 0 ? row.history[0].from : row.kaizen.rating;
  for (const entry of row.history) if (entry.on <= date) rating = entry.to;
  return rating;
}

export interface Move {
  id: string;
  domain: Domain;
  feature: string;
  on: string;
  from: Rating;
  to: Rating;
  why: string;
  core: boolean;
}

/** History entries dated after `since`, in domain and row order. */
export function movesSince(rows: readonly ParityRow[], since: string): Move[] {
  const moves: Move[] = [];
  for (const row of rows) {
    for (const entry of row.history) {
      if (entry.on > since) {
        moves.push({ id: row.id, domain: row.domain, feature: row.feature, on: entry.on, from: entry.from, to: entry.to, why: entry.why, core: isCore(row) });
      }
    }
  }
  return moves;
}

// ---------------------------------------------------------------------------
// Markdown

const RATING_LABEL: Record<Rating, string> = { full: "Full", partial: "Partial", missing: "Missing" };
const TIER_LABEL: Record<Tier, string> = { native: "Native", app: "App", plus: "Plus" };

function cell(text: string): string {
  return text.replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|").trim();
}

function table(head: string[], body: string[][], align: ("l" | "r")[] = []): string {
  const rule = head.map((_, i) => (align[i] === "r" ? "---:" : "---"));
  return [`| ${head.join(" | ")} |`, `| ${rule.join(" | ")} |`, ...body.map((r) => `| ${r.join(" | ")} |`)].join("\n");
}

function counts(s: Score): string {
  return `${s.full} / ${s.partial} / ${s.missing}`;
}

/** The first sentence of a longer text, shortened for a list. */
export function firstSentence(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const end = flat.search(/[.!?](\s|$)/);
  const sentence = end < 0 ? flat : flat.slice(0, end + 1);
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
}

export function renderSummary(rows: readonly ParityRow[]): string {
  const h = headlineOf(rows);
  const byDomain = domainScores(rows).filter((d) => d.core.rows > 0);
  const sorted = [...byDomain].sort((a, b) => b.core.weighted - a.core.weighted);
  const best = sorted[0];
  const weakest = sorted.slice(-3).reverse();
  const list = (items: DomainScore[]) => items.map((d) => `${d.name.toLowerCase()} (${pct(d.core.weighted)})`).join(", ");
  const shape = h.core.partial > h.core.missing
    ? "so half-built features, not absent ones, are the main shape of the gap"
    : "so absent features, not half-built ones, are the main shape of the gap";
  return [
    `Kaizen Store has **${pct(h.core.weighted)}** weighted parity with what Shopify ships natively on its Basic, Grow and Advanced plans, across ${h.core.rows} core features weighted by importance to an EU small or mid-size merchant, and **${pct(h.mustHave.weighted)}** on the must-haves (the ${h.mustHave.rows} features with weight 4 or 5). The unweighted figures are ${pct(h.core.unweighted)} overall and ${pct(h.mustHave.unweighted)} for must-haves. Counting app-only features gives ${pct(h.coreApp.weighted)}; counting Plus-only as well gives ${pct(h.all.weighted)}.`,
    best
      ? `Kaizen is strongest on ${best.name.toLowerCase()} (${pct(best.core.weighted)}) and weakest on ${list(weakest)}. Of the ${h.core.rows} core features, ${h.core.full} are full, ${h.core.partial} partial and ${h.core.missing} missing, ${shape}.`
      : "",
  ].filter(Boolean).join(" ");
}

export function renderHeadline(rows: readonly ParityRow[]): string {
  const h = headlineOf(rows);
  const line = (label: string, s: Score, bold = false) => [
    label,
    String(s.rows),
    bold ? `**${pct(s.weighted)}**` : pct(s.weighted),
    pct(s.unweighted),
    counts(s),
  ];
  return table(
    ["Measure", "Features", "Weighted parity", "Unweighted parity", "Full / partial / missing"],
    [
      line("Headline: core (Shopify native, Basic to Advanced)", h.core, true),
      line("Must-have (core, weight 4 or 5)", h.mustHave, true),
      line("Core plus app-only features", h.coreApp),
      line("Everything, including Plus-only", h.all),
    ],
  );
}

export function renderDomains(rows: readonly ParityRow[]): string {
  const scores = domainScores(rows);
  const h = headlineOf(rows);
  const body = scores.map((d) => [
    d.name,
    String(d.core.rows),
    String(d.core.full),
    String(d.core.partial),
    String(d.core.missing),
    pct(d.core.weighted),
    String(d.mustHave.rows),
    pct(d.mustHave.weighted),
  ]);
  body.push([
    "**Total**",
    `**${h.core.rows}**`,
    `**${h.core.full}**`,
    `**${h.core.partial}**`,
    `**${h.core.missing}**`,
    `**${pct(h.core.weighted)}**`,
    `**${h.mustHave.rows}**`,
    `**${pct(h.mustHave.weighted)}**`,
  ]);
  return table(
    ["Domain", "Core features", "Full", "Partial", "Missing", "Weighted parity", "Must-have features", "Must-have parity"],
    body,
    ["l", "r", "r", "r", "r", "r", "r", "r"],
  );
}

export function renderEvidence(rows: readonly ParityRow[]): string {
  const debt = evidenceDebt(rows);
  const total = rows.length;
  const ids = (list: string[]) => (list.length === 0 ? "none" : list.map((id) => `\`${id}\``).join(", "));
  const measures = table(
    ["Evidence", "Rows"],
    [
      ["Full, with tests", String(debt.fullWithTests)],
      ["Full, untested (debt, not hidden)", String(debt.fullUntested)],
      ["Shopify side not read from a page", String(debt.unfetched)],
      ["Rows in the tracker", String(total)],
    ],
    ["l", "r"],
  );
  const buckets = table(
    ["Bucket", "What it means", "Rows not Full", "Core rows", "Core headline points lacking"],
    debt.byBucket
      .filter((b) => b.bucket !== "none" || b.rows > 0)
      .map((b) => [
        b.bucket === "none" ? "No bucket" : b.bucket,
        b.bucket === "none" ? "Not yet decided" : BUCKET_WORDS[b.bucket],
        String(b.rows),
        String(b.coreRows),
        `${b.corePoints.toFixed(1)}`,
      ]),
    ["l", "l", "r", "r", "r"],
  );
  return [
    measures,
    "",
    `Untested Full rows: ${ids(debt.fullUntestedIds)}. Shopify side not read: ${ids(debt.unfetchedIds)}.`,
    "",
    buckets,
  ].join("\n");
}

export function renderProjection(rows: readonly ParityRow[]): string {
  const p = projectWaves(rows);
  const body = p.steps.map((s) => [
    String(s.wave),
    s.name,
    `${s.rows} (${s.coreRows})`,
    pct(s.all.core.weighted),
    pct(s.all.mustHave.weighted),
    `${s.added >= 0 ? "+" : ""}${s.added.toFixed(1)}`,
    pct(s.buildable.core.weighted),
    pct(s.buildable.mustHave.weighted),
  ]);
  const table1 = table(
    ["Wave", "Scope", "Rows (core)", "Core if every row of waves 1 to N is Full", "Must-have", "Adds (points)", "Core if only bucket A rows are", "Must-have"],
    body,
    ["r", "l", "r", "r", "r", "r", "r", "r"],
  );
  return [
    `Now: **${pct(p.now.core.weighted)}** core, ${pct(p.now.mustHave.weighted)} must-have. The projections are what the score would be if the rows planned for those waves became Full: they are a plan's arithmetic, not a forecast. ${p.unplanned.rows} rows (${p.unplanned.coreRows} core) have no wave yet and are not in them.`,
    "",
    table1,
    "",
    `Ceiling with every bucket A row Full and buckets B, C and D as they are: **${pct(p.ceilingA.core.weighted)}** core, ${pct(p.ceilingA.mustHave.weighted)} must-have. With bucket B built and approved as well: ${pct(p.ceilingAB.core.weighted)} core, ${pct(p.ceilingAB.mustHave.weighted)} must-have.`,
  ].join("\n");
}

export function biggestGaps(rows: readonly ParityRow[]): ParityRow[] {
  const order = (r: ParityRow) => DOMAINS.indexOf(r.domain);
  return rows
    .filter((r) => isCore(r) && r.kaizen.rating !== "full" && r.weight >= 4)
    .sort(
      (a, b) =>
        b.weight - a.weight ||
        (a.wave ?? 99) - (b.wave ?? 99) ||
        RATING_SCORE[a.kaizen.rating] - RATING_SCORE[b.kaizen.rating] ||
        order(a) - order(b) ||
        a.id.localeCompare(b.id),
    );
}

function shortDomain(domain: Domain): string {
  return DOMAIN_NAMES[domain].split(",")[0].split(" and ")[0];
}

function planCell(row: ParityRow): string {
  if (row.kaizen.rating === "full") return "";
  const wave = row.wave === null ? "no wave yet" : `wave ${row.wave}`;
  return `${row.bucket ?? "no bucket"}, ${wave}`;
}

function ratingCell(row: ParityRow): string {
  const label = RATING_LABEL[row.kaizen.rating];
  const was = row.kaizen.was;
  return was && was !== row.kaizen.rating ? `${label} (was ${RATING_LABEL[was].toLowerCase()})` : label;
}

export function renderGaps(rows: readonly ParityRow[]): string {
  const gaps = biggestGaps(rows);
  const w5 = gaps.filter((r) => r.weight === 5).length;
  const intro = `${gaps.length} core features are rated missing or partial with weight 4 or 5 (${w5} with weight 5), ordered by weight, then by the wave that plans them (unplanned last).`;
  return [
    intro,
    "",
    table(
      ["#", "Feature", "Rating and weight", "Plan", "What is lacking"],
      gaps.map((r, i) => [
        String(i + 1),
        `${cell(r.feature)} (${shortDomain(r.domain)})`,
        `${RATING_LABEL[r.kaizen.rating]}, w${r.weight}`,
        planCell(r),
        cell(r.gap),
      ]),
    ),
  ].join("\n");
}

function shopifyCell(row: ParityRow): string {
  const tier = TIER_LABEL[row.shopify.tier];
  if (row.shopify.fetched && row.shopify.url) return `${tier}. [page](${row.shopify.url})`;
  if (row.shopify.url) return `${tier}. [page](${row.shopify.url}), not read`;
  return `${tier}. not read`;
}

function evidenceCell(row: ParityRow): string {
  const e = row.evidence;
  const code = e.files.slice(0, 3).map((f) => `\`${f}\``).join(", ");
  const more = e.files.length > 3 ? ` and ${e.files.length - 3} more` : "";
  const tests = e.untested ? "**untested**" : `${e.tests.length} test file${e.tests.length === 1 ? "" : "s"}`;
  const decisions = row.decisions.length > 0 ? `; ${row.decisions.join(", ")}` : "";
  const note = row.gap.trim() !== "" ? `${cell(row.gap)} ` : "";
  return `${note}Evidence: ${code}${more}; ${tests}${decisions}.`;
}

export function renderDetail(rows: readonly ParityRow[], domain: Domain): string {
  const own = rows.filter((r) => r.domain === domain);
  return table(
    ["Feature", "Shopify", "Kaizen", "W", "Plan", "Gap and evidence"],
    own.map((r) => [
      cell(r.feature),
      shopifyCell(r),
      ratingCell(r),
      String(r.weight),
      planCell(r),
      r.kaizen.rating === "full" ? evidenceCell(r) : `${cell(r.gap)}${r.evidence.files.length > 0 ? ` Code: ${r.evidence.files.slice(0, 2).map((f) => `\`${f}\``).join(", ")}.` : ""}`,
    ]),
    ["l", "l", "l", "r", "l", "l"],
  );
}

export function renderSince(rows: readonly ParityRow[], since: string): string {
  const h = headlineOf(rows);
  const moves = movesSince(rows, since);
  const up = moves.filter((m) => RATING_SCORE[m.to] > RATING_SCORE[m.from]);
  const down = moves.filter((m) => RATING_SCORE[m.to] < RATING_SCORE[m.from]);
  const then = headlineOf(rows, (row) => ratingOn(row, since));
  const fetched = rows.filter((r) => r.shopify.fetched).length;
  const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;
  const ratingPoints = (h.core.weighted - then.core.weighted) * 100;
  const rowSetPoints = then.core.weighted * 100 - FIRST_REPORT.core;
  const lines = [
    `- **Headline now ${pct(h.core.weighted)}** (first report ${FIRST_REPORT.core.toFixed(1)}%), **must-have ${pct(h.mustHave.weighted)}** (first report ${FIRST_REPORT.mustHave.toFixed(1)}%), over ${h.core.rows} core rows (first report ${FIRST_REPORT.coreCount}).`,
    `- Where the change comes from: ${signed(ratingPoints)} points from the ${moves.filter((m) => m.core).length} rating moves on core rows recorded below, and ${signed(rowSetPoints)} points because the re-read changed which rows count as core (the tracker has ${rows.length} rows, the first report ${FIRST_REPORT.coreCount} core ones).`,
    `- ${fetched} of ${rows.length} rows have their Shopify side read from a page; the others are listed under evidence debt.`,
  ];
  const list = (title: string, items: Move[]) =>
    items.length === 0
      ? []
      : [
          "",
          `${title} (${items.length}):`,
          "",
          ...items.map(
            (m) => `- ${cell(m.feature)} (${shortDomain(m.domain)}${m.core ? "" : ", not core"}): ${m.from} to ${m.to}. ${cell(firstSentence(m.why))}`,
          ),
        ];
  return [...lines, ...list("Rated higher", up), ...list("Rated lower", down)].join("\n");
}

export const DETAIL_PREFIX = "detail-";

/** Every generated section of docs/shopify-parity.md, by name. */
export function renderSections(rows: readonly ParityRow[], since: string): Record<string, string> {
  const sections: Record<string, string> = {
    since: renderSince(rows, since),
    summary: renderSummary(rows),
    headline: renderHeadline(rows),
    domains: renderDomains(rows),
    evidence: renderEvidence(rows),
    projection: renderProjection(rows),
    gaps: renderGaps(rows),
  };
  for (const domain of DOMAINS) sections[`${DETAIL_PREFIX}${domain}`] = renderDetail(rows, domain);
  return sections;
}

// ---------------------------------------------------------------------------
// Generated sections inside a Markdown file

const START = /^<!-- parity:generated:start ([a-z0-9-]+) -->$/;
const END = /^<!-- parity:generated:end ([a-z0-9-]+) -->$/;

interface Block {
  name: string;
  /** Line index of the start marker and of the end marker. */
  start: number;
  end: number;
}

function findBlocks(lines: string[]): { blocks: Block[]; problems: string[] } {
  const blocks: Block[] = [];
  const problems: string[] = [];
  let open: { name: string; start: number } | null = null;
  lines.forEach((line, i) => {
    const s = START.exec(line);
    const e = END.exec(line);
    if (s) {
      if (open) problems.push(`section "${s[1]}" starts inside "${open.name}"`);
      open = { name: s[1], start: i };
    } else if (e) {
      if (!open || open.name !== e[1]) problems.push(`end of "${e[1]}" has no matching start`);
      else {
        blocks.push({ name: open.name, start: open.start, end: i });
        open = null;
      }
    }
  });
  if (open) problems.push(`section "${(open as { name: string }).name}" is never closed`);
  const names = new Set<string>();
  for (const b of blocks) {
    if (names.has(b.name)) problems.push(`section "${b.name}" appears twice`);
    names.add(b.name);
  }
  return { blocks, problems };
}

/** Marker problems plus sections the document lacks or has no renderer for. */
export function markerProblems(doc: string, sections: Record<string, string>): string[] {
  const { blocks, problems } = findBlocks(doc.split("\n"));
  const present = new Set(blocks.map((b) => b.name));
  for (const name of Object.keys(sections)) if (!present.has(name)) problems.push(`the report has no marker for generated section "${name}"`);
  for (const name of present) if (!(name in sections)) problems.push(`the report has a marker "${name}" that nothing generates`);
  return problems;
}

/** Rewrites what lies between the markers; the prose around them is kept. */
export function writeSections(doc: string, sections: Record<string, string>): string {
  const lines = doc.split("\n");
  const { blocks } = findBlocks(lines);
  const out: string[] = [];
  let cursor = 0;
  for (const block of [...blocks].sort((a, b) => a.start - b.start)) {
    const body = sections[block.name];
    if (body === undefined) continue;
    out.push(...lines.slice(cursor, block.start + 1), "", ...body.trim().split("\n"), "");
    cursor = block.end;
  }
  out.push(...lines.slice(cursor));
  return out.join("\n");
}

/** Names of generated sections whose text in the document differs from what the data gives. */
export function outOfDate(doc: string, sections: Record<string, string>): string[] {
  return Object.keys(sections).filter((name) => writeSections(doc, { [name]: sections[name] }) !== doc);
}

// ---------------------------------------------------------------------------
// Plain text for the terminal

function pad(value: string, width: number, right = false): string {
  return right ? value.padStart(width) : value.padEnd(width);
}

function textTable(head: string[], body: string[][], rightFrom = 1): string {
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((r) => r[i].length)));
  const line = (r: string[]) => r.map((v, i) => pad(v, widths[i], i >= rightFrom)).join("  ").trimEnd();
  return [line(head), widths.map((w) => "-".repeat(w)).join("  "), ...body.map(line)].join("\n");
}

export function renderText(rows: readonly ParityRow[]): string {
  const h = headlineOf(rows);
  const debt = evidenceDebt(rows);
  const p = projectWaves(rows);
  const out: string[] = [];
  out.push(
    "Headline",
    textTable(
      ["Measure", "Rows", "Weighted", "Unweighted", "Full/partial/missing"],
      [
        ["Core (Shopify native)", String(h.core.rows), pct(h.core.weighted), pct(h.core.unweighted), counts(h.core)],
        ["Must-have (core, w4-5)", String(h.mustHave.rows), pct(h.mustHave.weighted), pct(h.mustHave.unweighted), counts(h.mustHave)],
        ["Core + app-only", String(h.coreApp.rows), pct(h.coreApp.weighted), pct(h.coreApp.unweighted), counts(h.coreApp)],
        ["Everything (Plus too)", String(h.all.rows), pct(h.all.weighted), pct(h.all.unweighted), counts(h.all)],
      ],
    ),
    `First report (${FIRST_REPORT.on}): ${FIRST_REPORT.core.toFixed(1)}% core, ${FIRST_REPORT.mustHave.toFixed(1)}% must-have.`,
    "",
    "By domain (core rows)",
    textTable(
      ["Domain", "Rows", "Full", "Partial", "Missing", "Weighted", "Must-have"],
      domainScores(rows).map((d) => [
        d.name,
        String(d.core.rows),
        String(d.core.full),
        String(d.core.partial),
        String(d.core.missing),
        pct(d.core.weighted),
        pct(d.mustHave.weighted),
      ]),
    ),
    "",
    "Evidence debt",
    `  Full with tests:     ${debt.fullWithTests}`,
    `  Full, untested:      ${debt.fullUntested}${debt.fullUntestedIds.length > 0 ? `  (${debt.fullUntestedIds.join(", ")})` : ""}`,
    `  Shopify side unread: ${debt.unfetched}${debt.unfetchedIds.length > 0 ? `  (${debt.unfetchedIds.join(", ")})` : ""}`,
    "  Not Full by bucket:  " +
      debt.byBucket.filter((b) => b.rows > 0).map((b) => `${b.bucket === "none" ? "none" : b.bucket} ${b.rows} (${b.corePoints.toFixed(1)} points)`).join(", "),
    "",
    "Projection (core / must-have if every row of waves 1 to N is Full; then if only bucket A rows are)",
    textTable(
      ["Wave", "Scope", "Rows", "Core", "Must-have", "Adds", "A only core", "A only must"],
      [
        ["now", "", "", pct(p.now.core.weighted), pct(p.now.mustHave.weighted), "", "", ""],
        ...p.steps.map((s) => [
          String(s.wave),
          s.name,
          `${s.rows} (${s.coreRows})`,
          pct(s.all.core.weighted),
          pct(s.all.mustHave.weighted),
          `${s.added >= 0 ? "+" : ""}${s.added.toFixed(1)}`,
          pct(s.buildable.core.weighted),
          pct(s.buildable.mustHave.weighted),
        ]),
      ],
      2,
    ),
    `No wave yet: ${p.unplanned.rows} rows (${p.unplanned.coreRows} core).`,
    `Ceiling, bucket A Full and B, C, D as they are: ${pct(p.ceilingA.core.weighted)} core, ${pct(p.ceilingA.mustHave.weighted)} must-have.`,
    `Ceiling, buckets A and B Full: ${pct(p.ceilingAB.core.weighted)} core, ${pct(p.ceilingAB.mustHave.weighted)} must-have.`,
  );
  return out.join("\n");
}
