import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { toolOfAction } from "@/lib/autopilot-effects";
import { minorUnitDigits } from "@/lib/money";
import { baselineWindows, isRevertible, verdictWords, WATCH_FROM_HOURS, WATCH_UNTIL_HOURS, watchVerdict, type Counts, type RevertibleTool, type Verdict } from "@/lib/autopilot-watch";

import { actingAs } from "./actor";
import { changeAdBudget } from "./ad-accounts";
import { audit, type Account, type Membership } from "./auth";
import { setCampaignActive } from "./campaigns";
import { log } from "./log";
import { savePage, unpublishPage } from "./pages";
import { setPricesTool } from "./product-tools";
import { refreshTag } from "./refresh";
import { currentStore, type Store } from "./stores";
import { switchToInstall } from "./theme-installs";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Watch and roll back (`docs/100-day-challenge.md` F4): every hour, each change the autopilot made itself in the last two days that can be
 * undone (`REVERTIBLE_TOOLS`) is judged on conversion and add-to-cart since it, against the same hours of the weeks before (`watchVerdict()`).
 * A clear fall undoes it as the autopilot, with the record each change left behind (the prices' audited before and after, the theme it
 * switched from, the ad budget it raised); a change someone has changed since is left alone. Each verdict is kept as one audit entry
 * (`ai.change_watched`): a fall at once, a quiet change when its watch ends. The dispatcher's job `autopilotWatch`. Never throws.
 */

const CHANGE = z.object({ id: col.text, store_id: col.uuid, slug: col.text, account_id: col.uuid.nullable(), action: col.text, args: z.unknown(), created_at: col.timestamp });
type Change = z.infer<typeof CHANGE>;

/** Visitors (by first seen), carts with goods (by created), paid orders (by placed) and visitors meeting an error (D663) over the windows, together. */
async function countsIn(storeId: string, windows: readonly { from: Date; to: Date }[]): Promise<Counts> {
  const ranges = sql.join(
    windows.map((w) => sql`(${w.from.toISOString()}::timestamptz, ${w.to.toISOString()}::timestamptz)`),
    sql`, `,
  );
  const row = await typedRow(
    z.object({ visitors: col.int, carts: col.int, orders: col.int, errors: col.int }),
    sql`
      with w(a, b) as (values ${ranges})
      select
        (select count(*) from commerce.visits v, w where v.store_id = ${storeId}::uuid and v.first_seen >= w.a and v.first_seen < w.b)::int as visitors,
        (select count(*) from commerce.carts c, w where c.store_id = ${storeId}::uuid and c.created_at >= w.a and c.created_at < w.b
           and exists (select 1 from commerce.cart_lines l where l.store_id = c.store_id and l.cart_id = c.id))::int as carts,
        (select count(*) from commerce.orders o, w where o.store_id = ${storeId}::uuid and o.placed_at >= w.a and o.placed_at < w.b and o.copied_from is null
           and exists (select 1 from commerce.payments p where p.store_id = o.store_id and p.order_id = o.id and p.status = 'captured'))::int as orders,
        -- Visitors who met an error page (D663), by when they first did.
        (select count(*) from commerce.visits v, w where v.store_id = ${storeId}::uuid and v.error_at >= w.a and v.error_at < w.b)::int as errors
    `,
  );
  return row ?? { visitors: 0, carts: 0, orders: 0, errors: 0 };
}

/** The entries the change's own tool wrote just before its `store.assistant.*` row (the handler runs first): same store, account and actor. */
const entriesBefore = (c: Change, action: string) =>
  typedRows(
    z.object({ target_id: col.textOrNull, details: z.unknown(), changes: z.unknown() }),
    sql`
      select target_id, details, changes from commerce.audit_log
      where store_id = ${c.store_id}::uuid and action = ${action} and acted_by = 'autopilot'
        and account_id is not distinct from ${c.account_id}::uuid
        and created_at <= ${c.created_at}::timestamptz and created_at > ${c.created_at}::timestamptz - interval '2 minutes'
      order by created_at
    `,
  );

const PRICE_CHANGE = z.object({ details: z.object({ sku: z.string(), market: z.string(), currency: z.string() }), changes: z.object({ priceMinor: z.object({ from: z.number().nullable(), to: z.number().nullable() }) }) });

/** An account to act in the name of: the one the change was made for (the plan's maker), as the tools' own services ask. */
const accountOf = (id: string): Account => ({ id, email: "", name: null, platformAdmin: false });

/** A price in minor units as the price tool takes it: the major units with the currency's own decimals. */
const priceText = (minor: number, currency: string) => {
  const digits = minorUnitDigits(currency);
  return (minor / 10 ** digits).toFixed(digits);
};

/**
 * Each price the change set back to what it was, where it still is what the change made it, through the price tool's own save
 * (`setPricesTool()`: the product's save writes the price entry and works out derived prices as any change does). Called directly, never through
 * the tool runner, so the undo is no new change of the autopilot's to watch.
 */
async function undoPrices(c: Change, store: Store): Promise<string[]> {
  if (!c.account_id) return [];
  const byProduct = new Map<string, { sku: string; prices: Record<string, string> }[]>();
  const undone: string[] = [];
  for (const entry of await entriesBefore(c, "product.price_changed")) {
    const parsed = PRICE_CHANGE.safeParse(entry);
    if (!parsed.success || !entry.target_id) continue;
    const { sku, market, currency } = parsed.data.details;
    const { from, to } = parsed.data.changes.priceMinor;
    if (from === null || to === null) continue;
    // The shopper's price now (the view every shopper-facing read uses): only one still at what the change made it is set back.
    const now = await typedRow(
      z.object({ amount: col.minor }),
      sql`
        select cp.amount_minor as amount from commerce.current_prices cp join commerce.product_variants v on v.id = cp.variant_id
        where v.store_id = ${c.store_id}::uuid and v.sku = ${sku} and cp.market_code = ${market}
      `,
    );
    if (now?.amount !== to) continue;
    const lines = byProduct.get(entry.target_id) ?? [];
    const line = lines.find((l) => l.sku === sku) ?? { sku, prices: {} };
    line.prices[market] = priceText(from, currency);
    if (!lines.includes(line)) lines.push(line);
    byProduct.set(entry.target_id, lines);
    undone.push(`${sku} in ${market} back to its price before`);
  }
  for (const [product, changes] of byProduct) {
    await setPricesTool({ account: accountOf(c.account_id), store, invalidate: refreshTag }, { product, changes });
  }
  return undone;
}

const PAGE_VERSION = z.object({ id: col.uuid, content: z.unknown(), same_as_live: col.bool, live_is_draft: col.bool });

/**
 * A page the change published, put back as it was (F4, D651): the published version before it published again through the page builder's own
 * save, or the page taken off the site when it had never been live. Only while what is live and the draft are both still what the change
 * published (`same_as_live`, `live_is_draft`): a page someone published or edited since stays as they left it.
 */
async function undoPage(c: Change, store: Store): Promise<string[]> {
  if (!c.account_id) return [];
  const type = text(c.args, "type") === "article" ? "article" : "page";
  const pageId = (await entriesBefore(c, `store.${type}_published`))[0]?.target_id;
  if (!pageId) return [];
  // Published again by anyone after the change: what is live is no longer the change's.
  const later = await typedRow(
    z.object({ n: col.int }),
    sql`
      select count(*)::int as n from commerce.audit_log
      where store_id = ${c.store_id}::uuid and action in (${`store.${type}_published`}, ${`store.${type}_unpublished`}) and target_id = ${pageId}
        and created_at > ${c.created_at}::timestamptz + interval '1 minute'
    `,
  );
  if ((later?.n ?? 0) > 0) return [];
  // The page's two newest published versions, each with whether it is what is live, and whether the draft is still what is live.
  const versions = await typedRows(
    PAGE_VERSION,
    sql`
      select v.id, v.content, (p.published is not null and md5(v.content::text) = md5(p.published::text)) as same_as_live,
        (p.published is not null and md5(p.draft::text) = md5(p.published::text)) as live_is_draft
      from commerce.page_versions v join commerce.pages p on p.id = v.page_id and p.store_id = v.store_id
      where v.store_id = ${c.store_id}::uuid and v.page_id = ${pageId}::uuid and v.kind = 'published'
      order by v.created_at desc, v.id desc limit 2
    `,
  );
  const [made, before] = versions;
  if (!made?.same_as_live || !made.live_is_draft) return [];
  const account = accountOf(c.account_id);
  if (!before) return (await unpublishPage(account, store.id, pageId, type)) ? [`the ${type} it published taken off the site again`] : [];
  // The fonts of a version that was live before are installed already.
  const saved = await savePage(account, store.id, pageId, before.content, { publish: true, type, fonts: async () => ({ ok: true }) });
  return saved.ok ? [`the ${type} back to the version that was live before`] : [];
}

const text = (args: unknown, key: string): string | null => {
  const v = args && typeof args === "object" ? (args as Record<string, unknown>)[key] : undefined;
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
const flag = (args: unknown, key: string): boolean | null => {
  const v = args && typeof args === "object" ? (args as Record<string, unknown>)[key] : undefined;
  return typeof v === "boolean" ? v : null;
};

/** Undoes one change, as the autopilot; returns what was undone in words (empty: nothing could be, or someone changed it since). */
async function undo(c: Change, tool: RevertibleTool, store: Store): Promise<string[]> {
  switch (tool) {
    case "set_prices":
      return undoPrices(c, store);
    case "publish_page":
      return undoPage(c, store);
    case "create_discount":
    case "set_discount_active": {
      const code = text(c.args, "code");
      if (!code || (tool === "set_discount_active" && flag(c.args, "active") !== true)) return [];
      const off = await db().execute(sql`
        update commerce.discount_codes set active = false where store_id = ${c.store_id}::uuid and upper(code) = upper(${code}) and active returning id
      `);
      return off.length > 0 ? [`the code ${code.toUpperCase()} switched off`] : [];
    }
    case "create_campaign":
    case "set_campaign_active": {
      const name = text(c.args, tool === "create_campaign" ? "name" : "campaign");
      if (!name || (tool === "set_campaign_active" && flag(c.args, "active") !== true) || !c.account_id) return [];
      const found = await typedRow(z.object({ id: col.uuid }), sql`select id from commerce.campaigns where store_id = ${c.store_id}::uuid and lower(name) = lower(${name}) and active limit 1`);
      if (!found) return [];
      const member: Membership = { account: accountOf(c.account_id), store, role: "owner" };
      const done = await setCampaignActive(member, found.id, false);
      return done.ok ? [`the campaign "${name}" switched off`] : [];
    }
    case "make_theme_live": {
      if (!c.account_id) return [];
      const switched = await entriesBefore(c, "store.theme_switched");
      const applied = await entriesBefore(c, "store.design_preset_applied");
      const back = [...switched.map((e) => text(e.details, "from")), ...applied.map((e) => text(e.details, "previousInstall"))].find((id) => id !== null);
      const madeLive = switched[0]?.target_id ?? text(applied[0]?.details, "install");
      if (!back || !madeLive) return [];
      // Only while the theme it made live is still the live one: a theme someone chose since stays.
      const live = await typedRow(z.object({ id: col.uuid }), sql`select id from commerce.store_theme_installs where store_id = ${c.store_id}::uuid and live`);
      if (live?.id !== madeLive) return [];
      const done = await switchToInstall(c.store_id, back, c.account_id);
      return done.ok ? ["the theme switched back to the one before"] : [];
    }
    case "set_ad_budget": {
      const changes = await entriesBefore(c, "marketing.ad_budget_changed");
      const parsed = z
        .object({ target_id: z.string(), changes: z.object({ dailyMinor: z.object({ from: z.number(), to: z.number() }).optional(), on: z.object({ from: z.boolean(), to: z.boolean() }).optional() }) })
        .safeParse(changes[0]);
      if (!parsed.success || !c.account_id) return [];
      const { dailyMinor, on } = parsed.data.changes;
      const done = await changeAdBudget(c.store_id, c.account_id, { id: parsed.data.target_id, ...(dailyMinor ? { dailyMinor: dailyMinor.from } : {}), ...(on ? { on: on.from } : {}) });
      return done.ok ? ["the ad budget set back to what it was"] : [];
    }
  }
}

/** Keeps the verdict on a change as one audit entry, as the autopilot. */
const record = (c: Change, tool: string, verdict: Verdict | { kind: "not_watched"; why: string }, undone: string[]) =>
  actingAs("autopilot", () =>
    audit(c.account_id, c.store_id, "ai.change_watched", {
      change: c.id,
      tool,
      verdict: verdict.kind,
      words: "why" in verdict ? verdict.why : verdictWords(verdict),
      undone,
    }),
  );

export type WatchRun = { judged: number; reverted: number; waiting: number };

/** The hourly watch (the dispatcher's job `autopilotWatch`, in the first five minutes of each hour). */
export async function watchAutopilotChanges(options: { now?: Date; everyRun?: boolean } = {}): Promise<WatchRun> {
  const now = options.now ?? new Date();
  const run: WatchRun = { judged: 0, reverted: 0, waiting: 0 };
  if (!options.everyRun && now.getUTCMinutes() >= 5) return run;
  try {
    const changes = await typedRows(
      CHANGE,
      sql`
        select a.id::text as id, a.store_id, s.slug, a.account_id, a.action, a.details -> 'args' as args, a.created_at
        from commerce.audit_log a join commerce.stores s on s.id = a.store_id
        where a.acted_by = 'autopilot' and a.action like 'store.assistant.%'
          and a.created_at < ${now.toISOString()}::timestamptz - make_interval(hours => ${WATCH_FROM_HOURS})
          and a.created_at > ${now.toISOString()}::timestamptz - make_interval(hours => ${WATCH_UNTIL_HOURS + 2})
          and commerce.store_is_active(a.store_id)
          and not exists (
            select 1 from commerce.audit_log w where w.store_id = a.store_id and w.action = 'ai.change_watched' and w.created_at > a.created_at
              and w.details ->> 'change' = a.id::text
          )
        order by a.created_at limit 100
      `,
    );
    for (const c of changes) {
      const tool = toolOfAction(c.action);
      if (!tool || !isRevertible(tool)) continue;
      try {
        const store = await currentStore(c.slug);
        if (!store) continue;
        const ended = now.getTime() - Date.parse(c.created_at) >= WATCH_UNTIL_HOURS * 3_600_000;
        if (!store.visitCounting) {
          await record(c, tool, { kind: "not_watched", why: "Visit counting is off, so conversion and add-to-cart cannot be compared." }, []);
          run.judged++;
          continue;
        }
        const since = new Date(c.created_at);
        const until = new Date(Math.min(now.getTime(), since.getTime() + WATCH_UNTIL_HOURS * 3_600_000));
        const verdict = watchVerdict(await countsIn(c.store_id, [{ from: since, to: until }]), await countsIn(c.store_id, baselineWindows(since, until)));
        if (verdict.kind === "fall") {
          const undone = await actingAs("autopilot", () => undo(c, tool, store));
          await record(c, tool, verdict, undone);
          log("info", "autopilot.change_rolled_back", { storeId: c.store_id, tool, undone: undone.length });
          run.judged++;
          if (undone.length > 0) run.reverted++;
        } else if (ended) {
          await record(c, tool, verdict, []);
          run.judged++;
        } else {
          run.waiting++;
        }
      } catch (error) {
        log("error", "autopilot.watch_failed", { storeId: c.store_id, tool }, error);
      }
    }
  } catch (error) {
    log("error", "autopilot.watch_run_failed", {}, error);
  }
  return run;
}

const WATCHED = z.object({ at: col.timestamp, details: z.unknown() });

/** The verdicts kept on a store's changes in the last days, newest first: what the console and the owner read. */
export async function watchedChanges(storeId: string, days = 14): Promise<{ at: string; tool: string; verdict: string; words: string; undone: string[] }[]> {
  const rows = await typedRows(
    WATCHED,
    sql`select created_at as at, details from commerce.audit_log where store_id = ${storeId}::uuid and action = 'ai.change_watched' and created_at > now() - make_interval(days => ${days}) order by created_at desc limit 50`,
  );
  const shape = z.object({ tool: z.string(), verdict: z.string(), words: z.string(), undone: z.array(z.string()).default([]) });
  return rows.flatMap((r) => {
    const d = shape.safeParse(r.details);
    return d.success ? [{ at: r.at, ...d.data }] : [];
  });
}
