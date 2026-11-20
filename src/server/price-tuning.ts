import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { englishMoney as money } from "@/lib/money";
import type { PlanInterval } from "@/lib/plans";
import { anchorFor, changePercent, isPriceTuningLevel, priceTuningDecision, PRICE_TUNING_RANGE_DEFAULT, PRICE_TUNING_RANGE_MAX, PRICE_TUNING_RANGE_MIN, type PriceDecision, type PriceTuning } from "@/lib/price-tuning";
import { parsePrice } from "@/lib/product-input";
import { share } from "@/lib/plan-analytics";

import { aiAutonomyPaused } from "./ai-pause";
import { audit, type Account } from "./auth";
import { listPlans, savePlan } from "./billing";
import { extensionsLaunchedAt, getExtensionCatalogue, setOneExtensionPrice } from "./extensions";
import { OwnerToolError } from "./owner-tool-error";
import { planAnalytics } from "./plan-analytics";
import type { SaveResult } from "./settings";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * The AI tunes Kaizena Flow's prices, as far as a platform owner allows (D748 E9 part two, D854, `docs/extensions.md` 9): the setting on
 * Platform → Plans, `platform_pricing_facts` (what the plans, extensions and bundles cost and how they sell, every figure counted here) and
 * `set_platform_price` (one price of a plan, an extension's size or a bundle, in one currency and interval, as a new price row: accounts paying
 * the old one keep it). `priceTuningDecision()` says whether a change is refused, waits for a yes or runs on its own within the range.
 */

const SETTING_ROW = z.object({ level: col.text, range: col.int, paused: col.bool });

/** The setting as kept (off when unreadable). */
export async function getPriceTuning(): Promise<PriceTuning & { paused: boolean }> {
  const row = await typedRow(
    SETTING_ROW,
    sql`select price_tuning as level, price_tuning_range_percent as range, ai_autonomy_paused as paused from commerce.platform_settings limit 1`,
  );
  return { level: isPriceTuningLevel(row?.level) ? row.level : "off", rangePercent: row?.range ?? PRICE_TUNING_RANGE_DEFAULT, paused: row?.paused ?? false };
}

/** Saves the setting from Platform → Plans. */
export async function savePriceTuning(actor: Account, tuning: PriceTuning): Promise<SaveResult> {
  if (!isPriceTuningLevel(tuning.level)) return { ok: false, problems: ["Choose how far the AI may go."] };
  const range = Math.round(tuning.rangePercent);
  if (!(range >= PRICE_TUNING_RANGE_MIN && range <= PRICE_TUNING_RANGE_MAX)) return { ok: false, problems: [`The range is from ${PRICE_TUNING_RANGE_MIN} to ${PRICE_TUNING_RANGE_MAX} %.`] };
  await db().execute(sql`update commerce.platform_settings set price_tuning = ${tuning.level}, price_tuning_range_percent = ${range}`);
  await audit(actor.id, null, "platform.price_tuning_saved", { level: tuning.level, rangePercent: range });
  return { ok: true };
}

const per = (interval: PlanInterval) => (interval === "year" ? "a year" : "a month");

const EXTENSION_COUNTS = z.object({
  extension_id: col.text,
  paying: col.int,
  trials_now: col.int,
  started: col.int,
  started_now_paying: col.int,
  ended: col.int,
});
const BUNDLE_COUNTS = z.object({ bundle_id: col.uuid, accounts: col.int });
const CHANGE_ROW = z.object({ at: col.timestamp, what: col.text, currency: col.currency, interval: z.enum(["month", "year"]), from_minor: col.minor, to_minor: col.minor, decided: col.text, reasons: col.text });

/** The AI's latest price changes, newest first, with what each price belongs to. */
export async function recentPriceChanges(limit: number) {
  return typedRows(
    CHANGE_ROW,
    sql`
      select c.created_at as at, coalesce(p.name, e.name || ', ' || s.label, b.name, '') as what, c.currency, c.interval, c.from_minor, c.to_minor, c.decided, c.reasons
        from commerce.platform_price_changes c
        left join commerce.plans p on p.id = c.plan_id
        left join commerce.extension_sizes s on s.id = c.size_id
        left join commerce.extensions e on e.id = s.extension_id
        left join commerce.extension_bundles b on b.id = c.bundle_id
       order by c.created_at desc limit ${limit}
    `,
  );
}

/**
 * `platform_pricing_facts`: every price on offer with who pays it, and how each sold in the last `days` (plans: their moves and the way from a
 * request to a paying store; extensions: trials started, those paying now and those that ended; bundles: the accounts on them). Counted here.
 */
export async function platformPricingFacts(input: { days?: number }) {
  const days = Math.max(7, Math.min(365, Math.round(input.days ?? 90)));
  const [tuning, plans, analytics, catalogue, launched, extensionCounts, bundleCounts, changes] = await Promise.all([
    getPriceTuning(),
    listPlans(),
    planAnalytics(days),
    getExtensionCatalogue(),
    extensionsLaunchedAt(),
    typedRows(
      EXTENSION_COUNTS,
      sql`
        select o.extension_id,
               count(*) filter (where o.source = 'bought' and o.ended_at is null)::int as paying,
               count(*) filter (where o.source = 'trial' and o.ended_at is null)::int as trials_now,
               count(*) filter (where o.source in ('trial', 'bought') and o.created_at >= now() - make_interval(days => ${days}))::int as started,
               count(*) filter (where o.source = 'bought' and o.ended_at is null and o.created_at >= now() - make_interval(days => ${days}))::int as started_now_paying,
               count(*) filter (where o.ended_at >= now() - make_interval(days => ${days}))::int as ended
          from commerce.organisation_extensions o
         group by o.extension_id
      `,
    ),
    typedRows(
      BUNDLE_COUNTS,
      sql`select o.bundle_id, count(distinct o.organisation_id)::int as accounts from commerce.organisation_extensions o where o.source = 'bundle' and o.ended_at is null group by o.bundle_id`,
    ),
    recentPriceChanges(10),
  ]);
  const counts = new Map(extensionCounts.map((c) => [c.extension_id, c]));
  const moves = Object.fromEntries(analytics.moves.live.map((m) => [m.kind, m.count]));
  return {
    days,
    setting:
      tuning.level === "off"
        ? "Off: the AI changes no price."
        : tuning.level === "propose"
          ? "Each price change waits for a platform owner's yes."
          : `The AI changes a price itself within ${tuning.rangePercent} % of the price a person last set, and asks beyond it.${tuning.paused ? " Every AI acting on its own is paused now, so each change waits for a yes." : ""}`,
    plans: plans
      .filter((p) => p.active)
      .map((p) => ({
        id: p.id,
        name: p.name,
        prices: p.prices.filter((x) => x.active).map((x) => ({ currency: x.currency, interval: x.interval, price: `${money(x.amountMinor, x.currency)} ${per(x.interval)}`, stores: x.stores })),
        stores_on_older_prices: p.prices.filter((x) => !x.active).reduce((n, x) => n + x.stores, 0),
      })),
    plan_moves_in_period: { started: moves.started ?? 0, upgraded: moves.upgraded ?? 0, downgraded: moves.downgraded ?? 0, cancelled: moves.cancelled ?? 0 },
    from_request_to_paying: {
      asked: analytics.funnel.asked,
      paying: analytics.funnel.paying,
      paying_share: share(analytics.funnel.paying, analytics.funnel.asked) === null ? "none asked" : `${share(analytics.funnel.paying, analytics.funnel.asked)} %`,
    },
    extensions: catalogue.extensions
      .filter((e) => e.active)
      .map((e) => {
        const c = counts.get(e.id);
        return {
          extension: e.id,
          name: e.name,
          sizes: e.sizes
            .filter((s) => s.active)
            .map((s) => ({
              id: s.id,
              size: s.label,
              prices: s.prices.map((x) => ({ currency: x.currency, interval: x.interval, price: `${money(x.amountMinor, x.currency)} ${per(x.interval)}`, ...(x.foundingMinor !== null && { founding: money(x.foundingMinor, x.currency) }) })),
            })),
          ...(launched && {
            paying_accounts: c?.paying ?? 0,
            in_trial_now: c?.trials_now ?? 0,
            started_in_period: c?.started ?? 0,
            of_those_paying_now: c?.started_now_paying ?? 0,
            ended_in_period: c?.ended ?? 0,
          }),
        };
      }),
    ...(!launched && { extensions_note: "Extensions are not sold yet: every account has every one until the launch, so there is nothing to measure. Keep their prices until there is." }),
    bundles: catalogue.bundles
      .filter((b) => b.active)
      .map((b) => ({
        id: b.id,
        name: b.name,
        holds: b.members,
        prices: b.prices.map((x) => ({ currency: x.currency, interval: x.interval, price: `${money(x.amountMinor, x.currency)} ${per(x.interval)}`, ...(x.foundingMinor !== null && { founding: money(x.foundingMinor, x.currency) }) })),
        ...(launched && { accounts: bundleCounts.find((x) => x.bundle_id === b.id)?.accounts ?? 0 }),
      })),
    recent_ai_changes: changes.map((c) => ({
      when: c.at,
      what: c.what,
      change: `${money(c.from_minor, c.currency)} to ${money(c.to_minor, c.currency)} ${per(c.interval)}`,
      decided: c.decided === "auto" ? "on its own" : "approved",
      reasons: c.reasons,
    })),
  };
}

type PriceInput = { target?: unknown; id?: unknown; currency?: unknown; interval?: unknown; price?: unknown; reasons?: unknown };

/** The price a call names, as it is now: what it is called, its amount, founding price and the AI's last change of it. */
type Target = {
  kind: "plan" | "size" | "bundle";
  ownerId: string;
  name: string;
  currency: string;
  interval: PlanInterval;
  currentMinor: number;
  foundingMinor: number | null;
  toMinor: number | null;
  reasons: string;
};

const LAST_ROW = z.object({ to_minor: col.minor, anchor_minor: col.minor });

/** The AI's last change of one price, by fixed queries: nothing is built from input. */
const LAST_CHANGE = {
  plan: (id: string, currency: string, interval: string) =>
    sql`select to_minor, anchor_minor from commerce.platform_price_changes where plan_id = ${id}::uuid and currency = ${currency} and interval = ${interval} order by created_at desc limit 1`,
  size: (id: string, currency: string, interval: string) =>
    sql`select to_minor, anchor_minor from commerce.platform_price_changes where size_id = ${id}::uuid and currency = ${currency} and interval = ${interval} order by created_at desc limit 1`,
  bundle: (id: string, currency: string, interval: string) =>
    sql`select to_minor, anchor_minor from commerce.platform_price_changes where bundle_id = ${id}::uuid and currency = ${currency} and interval = ${interval} order by created_at desc limit 1`,
};

const UUID = z.uuid();

async function resolveTarget(input: PriceInput): Promise<Target> {
  const id = UUID.safeParse(input.id);
  if (!id.success) throw new OwnerToolError("Give the id of the plan, the extension's size or the bundle from platform_pricing_facts.");
  const currency = typeof input.currency === "string" ? input.currency.trim().toUpperCase() : "";
  const interval = input.interval === "year" ? "year" : input.interval === "month" ? "month" : null;
  if (!/^[A-Z]{3}$/.test(currency) || !interval) throw new OwnerToolError("Give the currency and the interval (month or year) of the price.");
  const typed = typeof input.price === "string" ? input.price.trim() : "";
  const toMinor = typed ? parsePrice(typed, currency) : null;
  const reasons = typeof input.reasons === "string" ? input.reasons.trim() : "";
  const found = (kind: Target["kind"], ownerId: string, name: string, prices: readonly { currency: string; interval: PlanInterval; amountMinor: number; foundingMinor?: number | null }[]): Target => {
    const price = prices.find((p) => p.currency === currency && p.interval === interval);
    if (!price) throw new OwnerToolError(`${name} has no price in ${currency} ${per(interval)} to change: a new price is added on Platform → Plans.`);
    return { kind, ownerId, name, currency, interval, currentMinor: price.amountMinor, foundingMinor: price.foundingMinor ?? null, toMinor, reasons };
  };
  if (input.target === "plan") {
    const plan = (await listPlans()).find((p) => p.id === id.data && p.active);
    if (!plan) throw new OwnerToolError("There is no such plan on offer.");
    return found("plan", plan.id, plan.name, plan.prices.filter((p) => p.active));
  }
  const catalogue = await getExtensionCatalogue();
  if (input.target === "extension") {
    for (const extension of catalogue.extensions) {
      const size = extension.sizes.find((s) => s.id === id.data && s.active);
      if (size && extension.active) return found("size", size.id, `${extension.name}, ${size.label}`, size.prices);
    }
    throw new OwnerToolError("There is no such size of an extension on offer.");
  }
  if (input.target === "bundle") {
    const bundle = catalogue.bundles.find((b) => b.id === id.data && b.active);
    if (!bundle) throw new OwnerToolError("There is no such bundle on offer.");
    return found("bundle", bundle.id, bundle.name, bundle.prices);
  }
  throw new OwnerToolError("Say whether it is a plan, an extension or a bundle.");
}

/** The target and what the setting says of its change now. */
async function decide(input: PriceInput): Promise<{ target: Target; anchorMinor: number; decision: PriceDecision }> {
  const target = await resolveTarget(input);
  if (target.toMinor === null) throw new OwnerToolError(`The price could not be read: give it in ${target.currency}, such as 249 or 249.50.`);
  if (target.reasons.length < 10) throw new OwnerToolError("Say why, from the figures platform_pricing_facts gave.");
  const [tuning, last] = await Promise.all([getPriceTuning(), typedRow(LAST_ROW, LAST_CHANGE[target.kind](target.ownerId, target.currency, target.interval))]);
  const anchorMinor = anchorFor(last ? { toMinor: last.to_minor, anchorMinor: last.anchor_minor } : null, target.currentMinor);
  const decision = priceTuningDecision(tuning, {
    currentMinor: target.currentMinor,
    toMinor: target.toMinor,
    anchorMinor,
    foundingMinor: target.foundingMinor,
    autonomyPaused: tuning.paused || (await aiAutonomyPaused()),
  });
  return { target, anchorMinor, decision };
}

/** Refuses before it waits for a yes what could not be done: off, an unknown price, nothing changed, below the founding price. */
export async function preflightPlatformPrice(raw: unknown): Promise<void> {
  const { decision } = await decide((raw ?? {}) as PriceInput);
  if (decision.kind === "refuse") throw new OwnerToolError(decision.reason);
}

/** Whether `set_platform_price` waits for a yes: always, but for a change within the range while the AI may change prices on its own. */
export async function platformPriceGateNeeded(raw: unknown): Promise<boolean> {
  try {
    return (await decide((raw ?? {}) as PriceInput)).decision.kind !== "run";
  } catch (error) {
    if (error instanceof OwnerToolError) return true;
    throw error;
  }
}

/** The approval's words, from the price as it is now: what, from and to, the change in percent and the reasons given. */
export async function platformPriceApprovalWords(args: Record<string, unknown>): Promise<string | null> {
  try {
    const { target } = await decide(args);
    if (target.toMinor === null) return null;
    const pct = changePercent(target.currentMinor, target.toMinor);
    return `Change ${target.name} from ${money(target.currentMinor, target.currency)} to ${money(target.toMinor, target.currency)} ${per(target.interval)} (${pct > 0 ? "+" : ""}${pct} %). Accounts paying today keep their price. Why: ${target.reasons}`;
  } catch (error) {
    if (error instanceof OwnerToolError) return null;
    throw error;
  }
}

/**
 * `set_platform_price`: the change made as a new price row (a plan's through `savePlan()`, so Stripe gets it; a size's or a bundle's through
 * `setOneExtensionPrice()`), kept with its reasons. It runs on its own within the range, else only after a platform owner's yes.
 */
export async function setPlatformPriceTool(ctx: { account: Account }, input: PriceInput) {
  if (!ctx.account.platformAdmin) throw new OwnerToolError("Only platform owners change Kaizena Flow's prices.");
  const { target, anchorMinor, decision } = await decide(input);
  if (decision.kind === "refuse") throw new OwnerToolError(decision.reason);
  const toMinor = target.toMinor!;
  let stripe: string | undefined;
  if (target.kind === "plan") {
    const plan = (await listPlans()).find((p) => p.id === target.ownerId);
    if (!plan) throw new OwnerToolError("There is no such plan on offer.");
    const result = await savePlan(ctx.account, plan.id, {
      name: plan.name,
      description: plan.description,
      saleFeeBps: plan.saleFeeBps,
      position: plan.position,
      active: plan.active,
      prices: plan.prices
        .filter((p) => p.active)
        .map((p) => ({ currency: p.currency, interval: p.interval, amountMinor: p.currency === target.currency && p.interval === target.interval ? toMinor : p.amountMinor })),
    });
    if (!result.ok) throw new OwnerToolError(result.problems.join(" "));
    stripe = result.note;
  } else {
    const done = await setOneExtensionPrice(ctx.account, target.kind, target.ownerId, { currency: target.currency, interval: target.interval, amountMinor: toMinor });
    if (!done) throw new OwnerToolError(`${target.name} has no price in ${target.currency} ${per(target.interval)} to change.`);
  }
  const decided = decision.kind === "run" ? "auto" : "approved";
  const column = { plan: [target.ownerId, null, null], size: [null, target.ownerId, null], bundle: [null, null, target.ownerId] }[target.kind];
  await db().execute(sql`
    insert into commerce.platform_price_changes (plan_id, size_id, bundle_id, currency, interval, from_minor, to_minor, anchor_minor, reasons, decided, account_id)
    values (${column[0]}::uuid, ${column[1]}::uuid, ${column[2]}::uuid, ${target.currency}, ${target.interval}, ${target.currentMinor}, ${toMinor}, ${anchorMinor},
            ${target.reasons.slice(0, 600)}, ${decided}, ${ctx.account.id}::uuid)
  `);
  await audit(ctx.account.id, null, "platform.assistant.set_platform_price", { target: target.kind, id: target.ownerId, currency: target.currency, interval: target.interval, from: target.currentMinor, to: toMinor, decided });
  const pct = changePercent(target.currentMinor, toMinor);
  return {
    done: `${target.name} is ${money(toMinor, target.currency)} ${per(target.interval)} from now (was ${money(target.currentMinor, target.currency)}, ${pct > 0 ? "+" : ""}${pct} %). Accounts paying the old price keep it.`,
    ...(stripe && { stripe: stripe }),
    admin: target.kind === "plan" ? "/admin/platform/plans" : "/admin/platform/plans/extensions",
  };
}
