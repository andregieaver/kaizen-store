/**
 * Redirects (wave 2, second run, D168, `docs/wave-2-redirects.md` 2, 3.1, 4.1, 4.4), pure: the kinds, the one check a redirect passes before it is written
 * (`validateRedirect()`: the form, the import's plan, the assistant's tool and the migration importers of a later run all use it), how a chain is followed
 * (`followChain()`, the same rule the resolver follows at serve time), what a loop is (`closesLoop()`), and the live addresses a source may not take.
 *
 * Two kinds of redirect share one table. A MANUAL redirect (kind `manual`) is a path to a path that staff, an import or the assistant made. An AUTOMATIC one
 * (`product`, `category`, `tag`) is made by a database trigger when a handle or a slug changes and points at the THING, not at an address, so it never
 * chains: a product renamed three times has three rows, each resolving to its current handle. Pages and articles keep `page_redirects` (D42, D57).
 *
 * The rules: never from a live address (a draft's or archived product's address is not live), never from a working page, never to another website, never a
 * loop, a chain stored as its final destination (and followed at serve time, at most 10 hops, in one response), at most 100,000 manual redirects a store.
 */
import { finding, type Finding } from "./data-job";
import { REDIRECTS_MAX, REDIRECT_HOPS_MAX } from "./data-limits";
import { isWorkingPath, normaliseSource, normaliseTarget, pathOfTarget, type AddressContext, type SourceReading, type TargetReading } from "./redirect-path";

export const REDIRECT_KINDS = ["manual", "product", "category", "tag"] as const;
export type RedirectKind = (typeof REDIRECT_KINDS)[number];
export const AUTOMATIC_KINDS: readonly RedirectKind[] = ["product", "category", "tag"];
export const REDIRECT_ORIGINS = ["editor", "import", "report", "assistant", "system"] as const;
export type RedirectOrigin = (typeof REDIRECT_ORIGINS)[number];

/** The cache tag of a store's redirects: the lookup of a missing address is cached under it (docs/wave-2-redirects.md section 10), and every writer refreshes it. */
export const redirectsTag = (storeId: string): string => `redirects:${storeId}`;

export const isAutomatic = (kind: RedirectKind): boolean => kind !== "manual";

/** The kinds as the manager's list names them: the pages' and articles' own (`page_redirects`, read only) included. */
export const KIND_WORDS: Record<RedirectKind | "page" | "article", string> = {
  manual: "Manual",
  product: "Product",
  category: "Category",
  tag: "Tag",
  page: "Page",
  article: "Article",
};

/** A redirect as the server reads it from the table. */
export type RedirectRow = {
  id: string;
  kind: RedirectKind;
  source: string;
  /** Manual only: as stored (a path, with an optional query and fragment). */
  target: string | null;
  productId: string | null;
  termId: string | null;
  origin: RedirectOrigin;
  hits: number;
  lastHitAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
};

// ---------------------------------------------------------------------------
// Live addresses
// ---------------------------------------------------------------------------

/** What is live on a store, as the lists the server reads (market-less, no `/p/` or other prefix added yet). */
export type LiveParts = {
  /** Handles of ACTIVE products only: a draft's or archived product's address is not live. */
  products: readonly string[];
  categories: readonly string[];
  tags: readonly string[];
  /** Slugs of published pages, the front page's and the role pages' own included. */
  pages: readonly string[];
  /** Slugs of published articles. */
  articles: readonly string[];
};

/** The addresses that are live (rule 7), as paths in the normal form: a source may not be one, a target that is one exists. `/blog` only when there are articles. */
export function liveAddresses(parts: LiveParts): Set<string> {
  const live = new Set<string>(["/products"]);
  for (const handle of parts.products) live.add(`/p/${handle}`);
  for (const slug of parts.categories) live.add(`/category/${slug}`);
  for (const slug of parts.tags) live.add(`/tag/${slug}`);
  for (const slug of parts.pages) live.add(`/${slug}`);
  for (const slug of parts.articles) live.add(`/blog/${slug}`);
  if (parts.articles.length > 0) live.add("/blog");
  return live;
}

// ---------------------------------------------------------------------------
// Following a chain
// ---------------------------------------------------------------------------

/** The redirects a chain is followed over: manual ones by source (the target as stored) and automatic ones by source (the thing's current address, null when it is not live). */
export type RedirectIndex = {
  manual: ReadonlyMap<string, string>;
  automatic: ReadonlyMap<string, string | null>;
};

export const emptyIndex = (): RedirectIndex => ({ manual: new Map(), automatic: new Map() });

export type Chain = {
  /** `none`: the path has no redirect; `ok`: it ends at `final`; `loop`: it came back to an address it had passed; `too_long`: more than the hop limit; `dead`: it ended at an automatic redirect whose thing is not live. */
  status: "none" | "ok" | "loop" | "too_long" | "dead";
  /** The target of the last redirect followed, as stored (path with an optional query and fragment); null for `none`, `loop`, `too_long` and `dead`. */
  final: string | null;
  /** The sources passed through, in order: the first is the path asked for. */
  hops: string[];
};

/**
 * Follows the redirects from a path in the normal form: a manual one to its target and on from the target's path, an automatic one to the thing's current
 * address, where it ends (a thing's own address is live). `isLive` stops a chain at a live address, which is served and never looked up. At most `max`
 * redirects are followed (Google follows 10); a path seen before is a loop. This is the rule the resolver follows at serve time and the check collapses by.
 */
export function followChain(path: string, index: RedirectIndex, options: { isLive?: (path: string) => boolean; max?: number } = {}): Chain {
  const max = options.max ?? REDIRECT_HOPS_MAX;
  const seen = new Set<string>();
  const hops: string[] = [];
  let current = path;
  let final: string | null = null;
  for (;;) {
    const manual = index.manual.get(current);
    const automatic = manual === undefined ? index.automatic.get(current) : undefined;
    if (manual === undefined && automatic === undefined) break;
    if (options.isLive?.(current)) break;
    if (seen.has(current)) return { status: "loop", final: null, hops };
    if (hops.length >= max) return { status: "too_long", final: null, hops };
    seen.add(current);
    hops.push(current);
    if (manual !== undefined) {
      final = manual;
      current = pathOfTarget(manual);
      continue;
    }
    if (automatic === null) return { status: "dead", final: null, hops };
    final = automatic ?? null;
    break;
  }
  return hops.length === 0 ? { status: "none", final: null, hops } : { status: "ok", final, hops };
}

/**
 * Whether a manual redirect from `source` to `target` would close a loop over the existing redirects: the addresses it would go through (the way round,
 * starting at the target), or null. A target equal to the source is a loop of one. The database holds the same rule (`commerce.redirects_no_loop()`).
 */
export function closesLoop(source: string, target: string, index: RedirectIndex, isLive?: (path: string) => boolean): string[] | null {
  const manual = new Map(index.manual);
  manual.set(source, target);
  const chain = followChain(source, { manual, automatic: index.automatic }, { isLive });
  return chain.status === "loop" || chain.status === "too_long" ? chain.hops : null;
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

export type RedirectEnv = {
  ctx: AddressContext;
  /** `liveAddresses()`. */
  live: ReadonlySet<string>;
  index: RedirectIndex;
  /** Manual redirects the store has now (for the limit). */
  manualCount: number;
  /** Defaults to `REDIRECTS_MAX`; a test injects a smaller one. */
  limit?: number;
};

export type RedirectInput = { from: string; to: string };

export type ExistingRedirect = { kind: "manual"; target: string } | { kind: "automatic" } | null;

export type RedirectCheck = {
  /** No finding is an error: the redirect may be written. */
  ok: boolean;
  /** The normalised source, or null when it could not be read. */
  source: string | null;
  /** The target to store: the final destination when the target was itself redirected. */
  target: string | null;
  findings: Finding[];
  /** What the store has for this source now. */
  existing: ExistingRedirect;
  /** The addresses a chain went through (the warning's), empty when the target was not redirected. */
  hops: string[];
};

/** Which field a finding is about: the old address, the new address, or the line as a whole. */
export function findingField(code: Finding["code"]): "from" | "to" | "line" {
  if (code.startsWith("source.")) return "from";
  if (code.startsWith("target.")) return "to";
  return "line";
}

/** Whether a path is somewhere a shopper can arrive: live, a working page, or the front page. */
export const targetExists = (path: string, live: ReadonlySet<string>): boolean => path === "/" || live.has(path) || isWorkingPath(path);

/**
 * The one check of a redirect from an address to an address, against the store's live addresses and redirects. Pure: the server reads the store, calls this,
 * and writes only what passes. Findings are the stable codes of 4.4, each sentence naming only normalised addresses. A line with an error is not written;
 * a warning is.
 */
export function validateRedirect(input: RedirectInput, env: RedirectEnv): RedirectCheck {
  const findings: Finding[] = [];
  const limit = env.limit ?? REDIRECTS_MAX;
  const source: SourceReading = normaliseSource(input.from, env.ctx);
  const target: TargetReading = normaliseTarget(input.to, env.ctx);
  if (!source.ok) findings.push(finding(source.code, { address: source.address }));
  else for (const note of source.notes) findings.push(finding(note));
  if (!target.ok) findings.push(finding(target.code));
  else for (const note of target.notes) findings.push(finding(note));
  const sourcePath = source.ok ? source.source : null;
  const base = { ok: false, source: sourcePath, target: null, existing: null, hops: [] as string[] };
  if (!source.ok || !target.ok) return { ...base, findings };

  const from = source.source;
  const existing: ExistingRedirect = env.index.manual.has(from)
    ? { kind: "manual", target: env.index.manual.get(from) as string }
    : env.index.automatic.has(from)
      ? { kind: "automatic" }
      : null;
  if (env.live.has(from)) findings.push(finding("source.live", { address: from }));
  if (target.path === from) findings.push(finding("target.self", { address: from }));
  if (findings.some((f) => f.severity === "error")) return { ...base, findings, existing };

  // A chain: the target is itself redirected, so the final destination is stored; a loop is refused.
  const isLive = (p: string) => env.live.has(p);
  const loop = closesLoop(from, target.target, env.index, isLive);
  if (loop) {
    findings.push(finding("target.loop", { address: from, addresses: loop }));
    return { ...base, findings, existing };
  }
  let stored = target.target;
  let hops: string[] = [];
  const chain = followChain(target.path, env.index, { isLive });
  if ((chain.status === "ok" || chain.status === "dead") && chain.hops.length > 0) {
    hops = chain.hops;
    if (chain.status === "ok" && chain.final !== null) stored = chain.final;
    findings.push(finding("target.chain", { addresses: chain.hops }));
  }
  const storedPath = pathOfTarget(stored);
  if (!targetExists(storedPath, env.live)) findings.push(finding("target.not_found", { address: storedPath }));

  if (existing?.kind === "manual") {
    // The same redirect as far as a shopper can tell: its target is stored as typed, a chain through it ends where this one does.
    const through = followChain(pathOfTarget(existing.target), env.index, { isLive });
    const effect = through.status === "ok" && through.final !== null ? through.final : existing.target;
    findings.push(finding(existing.target === stored || effect === stored ? "exists.same" : "exists.update", { address: from }));
  }
  else if (existing?.kind === "automatic") findings.push(finding("exists.replaced_automatic", { address: from }));
  // A new manual redirect past the limit is refused; replacing or keeping one is not a new one.
  if (existing?.kind !== "manual" && env.manualCount >= limit) findings.push(finding("limit.reached", { max: limit, address: from }));

  return { ok: !findings.some((f) => f.severity === "error"), source: from, target: stored, findings, existing, hops };
}

// ---------------------------------------------------------------------------
// The list's status words
// ---------------------------------------------------------------------------

export type RedirectStatus = "active" | "not_used" | "target_missing" | "chain";

/** The status the manager's list shows for a row (2.2.1): a source that is now a live address is not used; a target that is not a live address is a warning; a chain says how many more. */
export function redirectStatus(row: Pick<RedirectRow, "kind" | "source" | "target">, env: { live: ReadonlySet<string>; index: RedirectIndex }): { status: RedirectStatus; more: number } {
  if (env.live.has(row.source)) return { status: "not_used", more: 0 };
  if (row.kind === "manual" && row.target !== null) {
    const chain = followChain(row.source, env.index, { isLive: (p) => env.live.has(p) });
    if (chain.hops.length > 1) return { status: "chain", more: chain.hops.length - 1 };
    if (!targetExists(pathOfTarget(chain.final ?? row.target), env.live)) return { status: "target_missing", more: 0 };
  }
  return { status: "active", more: 0 };
}

/** What the list says for a status. */
export function redirectStatusWords(status: RedirectStatus, more = 0): string {
  switch (status) {
    case "active":
      return "Active";
    case "not_used":
      return "Not used: this address is live";
    case "target_missing":
      return "Target not found";
    case "chain":
      return `Goes through ${more} more redirect${more === 1 ? "" : "s"}`;
  }
}

/** The sentences the manager shows around the form and the list; English only, in no catalogue (the admin is English). */
export const redirectSentences = {
  permanent: "Redirects are permanent. Browsers and search engines remember them, so change or remove one with care.",
  fromHelp: (from: string, to: string) => `Shoppers who open ${from} in any country go to ${to} in the same country.`,
  replaceAsk: (from: string, old: string) => `Replace the redirect from ${from}? It goes to ${old} now.`,
  automaticReplaced: (from: string) => `Kaizen made a redirect from ${from} when an address changed. Saving this one replaces it.`,
  count: (n: number, max: number) => `${n.toLocaleString("en")} of ${max.toLocaleString("en")} manual redirects`,
  handleChanged: (from: string, to: string) => `The old address ${from} now redirects to ${to}.`,
  atLeast: "Counts are at least what happened: a request answered from a cache is not seen.",
} as const;
