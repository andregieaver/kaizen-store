/**
 * The social media adviser's facts (D870 S1.3, `docs/social-manager.md` 4): the store's figures and its channels' in one typed object,
 * worked out by code, for the adviser to read (S1.4) and the owner to check. The model is given these and nothing else: every number in
 * its report is one of them (`AGENTS`/`CLAUDE.md`: arithmetic happens in code). Pure; `src/server/social-facts.ts` gathers the inputs.
 *
 * Shares and averages are rounded here; a figure that cannot be known is null, never 0.
 */

/** The days the sales figures cover, and the same length before them for the change. */
export const SALES_DAYS = 28;
/** How many products the adviser is offered to push, and new ones to show. */
export const PUSH_MAX = 5;
export const NEW_MAX = 3;
/** A product with this many or fewer in stock is not offered to push (a post would sell what is about to run out). */
export const LOW_STOCK = 3;
/** How many of the best Instagram posts and tagged posts are given. */
export const TOP_MAX = 3;
/** A weekday is told apart only with this many posts on it. */
export const WEEKDAY_MIN_POSTS = 2;

export type ProductInput = {
  id: string;
  title: string;
  /** Sold in the last `SALES_DAYS`, without VAT, in the store's main currency. */
  revenueMinor: number;
  units: number;
  /** Gross margin of what sold (0 to 1); null without a known cost or a sale. */
  margin: number | null;
  /** Units on hand over its stocked variants; null where nothing is stocked (digital, made to order). */
  stock: number | null;
  /** Published in the last 30 days. */
  isNew: boolean;
};

export type InstagramPostInput = {
  kind: "feed" | "reel" | "story";
  postedAt: string;
  caption: string;
  reach: number | null;
  likes: number | null;
  saves: number | null;
  shares: number | null;
};

export type SocialFactsInput = {
  store: { name: string; currency: string; timeZone: string };
  now: string;
  sales: { revenueMinor: number; orders: number; sessions: number | null; previousRevenueMinor: number; previousOrders: number };
  goals: { title: string; targets: { kind: string; target: string; now: string; met: boolean | null }[] }[];
  products: ProductInput[];
  /** Visits and sales from social channels over `SALES_DAYS` (organic and paid); null while the store does not count visits. */
  social: { sessions: number; orders: number; revenueMinor: number; allSessions: number; allRevenueMinor: number } | null;
  /** The posts with a tagged link that brought visits in the last 90 days (S1.1). */
  taggedPosts: { source: string; content: string; sessions: number; orders: number; revenueMinor: number }[];
  /** Posts written in the creator in the last 90 days, and how many were copied. */
  creator: { written: number; copied: number };
  instagram: { state: "none" | "reconnect" | "waiting" } | { state: "ready"; username: string; posts: InstagramPostInput[] };
};

export type SocialFacts = {
  store: { name: string; currency: string };
  /** The day the facts were gathered, in the store's time zone. */
  asOf: string;
  sales: {
    days: number;
    revenueMinor: number;
    orders: number;
    sessions: number | null;
    /** Change from the days before, as a share (0.12 is 12 % up); null where there was nothing before. */
    revenueChange: number | null;
    ordersChange: number | null;
  };
  goals: SocialFactsInput["goals"];
  /** Products worth a post: in stock, best margin then most sold. */
  push: { id: string; title: string; margin: number | null; units: number; stock: number | null }[];
  newProducts: { id: string; title: string; stock: number | null }[];
  social: { sessions: number; orders: number; revenueMinor: number; shareOfSessions: number | null; shareOfRevenue: number | null } | null;
  taggedPosts: SocialFactsInput["taggedPosts"];
  creator: SocialFactsInput["creator"];
  instagram:
    | { state: "none" | "reconnect" | "waiting" }
    | {
        state: "ready";
        username: string;
        posts: number;
        postsPerWeek: number;
        /** Days since the newest post; null with none. */
        daysSinceLastPost: number | null;
        byKind: Record<"feed" | "reel" | "story", { posts: number; averageReach: number | null }>;
        /** Saves per 100 reached, over the posts that have both. */
        savesPer100Reach: number | null;
        /** The weekday whose posts reached most on average (Monday is 1), among days with `WEEKDAY_MIN_POSTS` posts; null without one. */
        bestWeekday: number | null;
        top: { kind: string; postedAt: string; caption: string; reach: number | null; saves: number | null }[];
      };
};

const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;
const change = (now: number, before: number) => (before > 0 ? round((now - before) / before) : null);
const share = (part: number, whole: number) => (whole > 0 ? round(part / whole) : null);
const average = (values: number[]) => (values.length > 0 ? Math.round(values.reduce((s, v) => s + v, 0) / values.length) : null);

/** The weekday of an instant in a time zone, Monday 1 to Sunday 7. */
export function weekdayIn(iso: string, timeZone: string): number {
  const name = new Date(iso).toLocaleDateString("en-GB", { weekday: "short", timeZone });
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(name) + 1;
}

function instagramFacts(input: SocialFactsInput, now: Date): SocialFacts["instagram"] {
  const ig = input.instagram;
  if (ig.state !== "ready") return { state: ig.state };
  const posts = ig.posts;
  const kinds = ["feed", "reel", "story"] as const;
  const byKind = Object.fromEntries(
    kinds.map((k) => {
      const of = posts.filter((p) => p.kind === k);
      return [k, { posts: of.length, averageReach: average(of.flatMap((p) => (p.reach === null ? [] : [p.reach]))) }];
    }),
  ) as Record<(typeof kinds)[number], { posts: number; averageReach: number | null }>;
  const withBoth = posts.filter((p) => p.reach !== null && p.reach > 0 && p.saves !== null);
  const reached = withBoth.reduce((s, p) => s + (p.reach ?? 0), 0);
  const saved = withBoth.reduce((s, p) => s + (p.saves ?? 0), 0);
  const days = new Map<number, number[]>();
  for (const p of posts) {
    if (p.reach === null || p.kind === "story") continue;
    const day = weekdayIn(p.postedAt, input.store.timeZone);
    days.set(day, [...(days.get(day) ?? []), p.reach]);
  }
  const eligible = [...days.entries()].filter(([, reaches]) => reaches.length >= WEEKDAY_MIN_POSTS);
  const best = eligible.sort((a, b) => average(b[1])! - average(a[1])! || a[0] - b[0])[0];
  const newest = posts.reduce<number | null>((max, p) => Math.max(max ?? 0, Date.parse(p.postedAt)), null);
  return {
    state: "ready",
    username: ig.username,
    posts: posts.length,
    postsPerWeek: round((posts.length / 90) * 7, 1),
    daysSinceLastPost: newest === null ? null : Math.floor((now.getTime() - newest) / 86_400_000),
    byKind,
    savesPer100Reach: reached > 0 ? round((saved / reached) * 100, 1) : null,
    bestWeekday: best ? best[0] : null,
    top: [...posts]
      .filter((p) => p.reach !== null)
      .sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0) || b.postedAt.localeCompare(a.postedAt))
      .slice(0, TOP_MAX)
      .map((p) => ({ kind: p.kind, postedAt: p.postedAt, caption: p.caption.slice(0, 120), reach: p.reach, saves: p.saves })),
  };
}

/** The facts, from what the server gathered. */
export function socialFacts(input: SocialFactsInput): SocialFacts {
  const now = new Date(input.now);
  const inStock = (p: ProductInput) => p.stock === null || p.stock > LOW_STOCK;
  const push = input.products
    .filter((p) => inStock(p) && p.units > 0)
    .sort((a, b) => (b.margin ?? -1) - (a.margin ?? -1) || b.units - a.units || a.title.localeCompare(b.title))
    .slice(0, PUSH_MAX)
    .map((p) => ({ id: p.id, title: p.title, margin: p.margin === null ? null : round(p.margin), units: p.units, stock: p.stock }));
  const pushed = new Set(push.map((p) => p.id));
  const newProducts = input.products
    .filter((p) => p.isNew && inStock(p) && !pushed.has(p.id))
    .sort((a, b) => a.title.localeCompare(b.title))
    .slice(0, NEW_MAX)
    .map((p) => ({ id: p.id, title: p.title, stock: p.stock }));
  const s = input.social;
  return {
    store: { name: input.store.name, currency: input.store.currency },
    asOf: now.toLocaleDateString("sv-SE", { timeZone: input.store.timeZone }),
    sales: {
      days: SALES_DAYS,
      revenueMinor: input.sales.revenueMinor,
      orders: input.sales.orders,
      sessions: input.sales.sessions,
      revenueChange: change(input.sales.revenueMinor, input.sales.previousRevenueMinor),
      ordersChange: change(input.sales.orders, input.sales.previousOrders),
    },
    goals: input.goals,
    push,
    newProducts,
    social: s
      ? { sessions: s.sessions, orders: s.orders, revenueMinor: s.revenueMinor, shareOfSessions: share(s.sessions, s.allSessions), shareOfRevenue: share(s.revenueMinor, s.allRevenueMinor) }
      : null,
    taggedPosts: [...input.taggedPosts].sort((a, b) => b.revenueMinor - a.revenueMinor || b.sessions - a.sessions).slice(0, TOP_MAX),
    creator: input.creator,
    instagram: instagramFacts(input, now),
  };
}
