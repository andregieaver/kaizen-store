import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { customPeriod } from "@/lib/analytics-period";
import { daysBetween, utcDay, type Challenge } from "@/lib/autopilot-challenge";
import { scoredPeriod } from "@/lib/challenge-console";
import { originalPeriodSchema, type OriginalPeriod } from "@/lib/challenge-original";
import { board, originalSide, type Board, type Side } from "@/lib/challenge-scoreboard";
import { mainCurrency } from "@/lib/markets";
import { minorUnitDigits } from "@/lib/money";

import { costMicrosSql, priceFor, unpricedSql } from "./ai-price-sql";
import { getAnalyticsSettings } from "./analytics-settings";
import { periodFiguresWithVisits } from "./analytics-totals";
import { toMainOne } from "./analytics-sql";
import { sessionTotals } from "./analytics-traffic-data";
import { audit, type Account } from "./auth";
import { challengeFor, saveChallenge } from "./autopilot-settings";
import { getStoreBilling } from "./billing";
import { OwnerToolError } from "./owner-tool-error";
import { getStore, storeSlugOf, type Store } from "./stores";
import { col, typedRow } from "./typed-rows";

/**
 * The challenge's scoreboard (`docs/100-day-challenge.md` 3.3, E7): the clone over the same days as each period of the original's signed P&L
 * (within Day 1 to Day 100), on the analytics' own definition with its visits, and with Kaizena Flow's plan and the AI's cost counted as the
 * clone's costs whoever pays them; the original as its accountant signed it. Read live, so it is never more than a page load old. A figure that
 * cannot be known says why, never 0.
 */

export type CloneSide = Side & { aiMinor: number | null; planMinor: number | null };

export type Scoreboard = {
  challenge: Challenge;
  storeName: string;
  slug: string;
  currency: string;
  /** The spans compared: each signed period within the scored days, or Day 1 to today while none is signed. */
  spans: { from: string; to: string }[];
  clone: CloneSide | null;
  original: Side | null;
  agreedAdMinor: number | null;
  board: Board | null;
  /** Why something is not counted, in words. */
  notes: string[];
};

/** The AI's cost in a span, every feature, in millionths of a dollar; and the calls no price covers. */
async function aiCostMicros(storeId: string, from: string, to: string): Promise<{ micros: number; unpriced: number }> {
  const row = await typedRow(
    z.object({ cost: col.minor, unpriced: col.int }),
    sql`
      select coalesce(sum(${costMicrosSql}), 0)::bigint as cost, count(*) filter (where ${unpricedSql})::int as unpriced
      from commerce.ai_usage u
      ${priceFor}
      where u.store_id = ${storeId}::uuid and u.created_at >= ${from}::date and u.created_at < ${to}::date + 1
    `,
  );
  return { micros: row?.cost ?? 0, unpriced: row?.unpriced ?? 0 };
}

/** Kaizena Flow's plan over a span: its price for the days, in the main currency; null when it cannot be converted. 0 without a plan. */
async function planCostMinor(store: Store, days: number): Promise<number | null> {
  const billing = await getStoreBilling(store.id);
  const price = billing?.price;
  if (!price || price.amountMinor <= 0) return 0;
  const perDay = price.amountMinor / (price.interval === "year" ? 365.25 : 30.4375);
  return toMainOne(store, price.currency, Math.round(perDay * days));
}

/** The clone over the spans, with the AI and the plan as its costs. */
async function cloneSide(store: Store, spans: { from: string; to: string }[], notes: string[]): Promise<CloneSide> {
  const settings = await getAnalyticsSettings(store.id);
  let net = 0;
  let contribution: number | null = 0;
  let marketing = 0;
  let sessions: number | null = 0;
  let ai: number | null = 0;
  let plan: number | null = 0;
  for (const span of spans) {
    const f = await periodFiguresWithVisits(store, customPeriod(span.from, span.to), (p) => sessionTotals(store, p), settings);
    net += f.derived.netRevenue;
    marketing += f.totals.marketingMinor;
    contribution = contribution === null || f.derived.contributionProfit === null ? null : contribution + f.derived.contributionProfit;
    sessions = sessions === null || f.totals.sessions === null || f.visitsFrom !== null ? null : sessions + f.totals.sessions;
    const used = await aiCostMicros(store.id, span.from, span.to);
    if (used.unpriced > 0) notes.push(`${used.unpriced} AI calls between ${span.from} and ${span.to} have no price: add the model's price under Platform, AI prices.`);
    // Millionths of a dollar to cents, then to the main currency at the store's rates.
    const aiMain = toMainOne(store, "USD", Math.round(used.micros / 10_000));
    ai = ai === null || aiMain === null ? null : ai + aiMain;
    const planMain = await planCostMinor(store, daysBetween(span.from, span.to) + 1);
    plan = plan === null || planMain === null ? null : plan + planMain;
  }
  if (contribution === null) notes.push("Too few of the clone's goods have a cost, so its contribution is not known: enter each variant's cost.");
  if (ai === null) notes.push(`The AI's cost is in US dollars and the store has no rate for them to ${mainCurrency(store)}: add one under Settings, Currencies.`);
  if (plan === null) notes.push(`Kaizena Flow's plan is billed in a currency the store has no rate for to ${mainCurrency(store)}.`);
  if (sessions === null) notes.push("The clone's visits were not counted for all of the days, so revenue per visitor is not compared: switch visit counting on before Day 1.");
  return {
    netSalesMinor: net,
    contributionMinor: contribution === null || ai === null || plan === null ? null : contribution - ai - plan,
    marketingMinor: marketing,
    sessions,
    aiMinor: ai,
    planMinor: plan,
  };
}

/** The scoreboard of a store with a challenge set; null without one. */
export async function scoreboardOf(storeId: string, now: Date = new Date()): Promise<Scoreboard | null> {
  const challenge = await challengeFor(storeId);
  const slug = await storeSlugOf(storeId);
  const store = slug ? await getStore(slug) : null;
  if (!challenge || !store) return null;
  const currency = mainCurrency(store);
  const scored = scoredPeriod(challenge, utcDay(now));
  const agreedAdMinor = challenge.adMoney === null ? null : Math.round(challenge.adMoney * 10 ** minorUnitDigits(currency));
  const base = { challenge, storeName: store.name, slug: store.slug, currency, agreedAdMinor, notes: [] as string[] };
  if (!scored) return { ...base, spans: [], clone: null, original: null, board: null, notes: ["The scoreboard counts from Day 1."] };
  // The clone is counted over exactly the days each signed period covers, within Day 1 to Day 100 and today; while none is signed, over all of them.
  const spans = (
    challenge.original.length > 0
      ? challenge.original.map((p) => ({ from: p.from > scored.from ? p.from : scored.from, to: p.to < scored.to ? p.to : scored.to }))
      : [{ from: scored.from, to: scored.to }]
  )
    .filter((s) => s.from <= s.to)
    .sort((a, b) => a.from.localeCompare(b.from));
  const notes = base.notes;
  const clone = spans.length > 0 ? await cloneSide(store, spans, notes) : null;
  const added = originalSide(challenge.original);
  let original: Side | null = null;
  if (added === null) notes.push("No period of the original's signed P&L is entered yet.");
  else if ("problem" in added) notes.push(added.problem);
  else if (added.currency !== currency) notes.push(`The original's P&L is in ${added.currency} and the clone counts in ${currency}: enter the original's figures in ${currency}, at the rate the accountant used.`);
  else original = added.side;
  const outside = challenge.original.filter((p) => p.to < scored.from || p.from > scored.to);
  if (outside.length > 0) notes.push(`${outside.length} signed periods fall outside Day 1 to Day 100 and count for the original only.`);
  return { ...base, spans, clone, original, board: clone && original ? board(clone, original, agreedAdMinor) : null, notes };
}

/** Adds a period of the original's signed P&L, or replaces the one that starts on the same day (a platform admin's, audited). */
export async function saveOriginalPeriod(a: { account: Account }, storeId: string, input: unknown): Promise<OriginalPeriod> {
  if (!a.account.platformAdmin) throw new OwnerToolError("Only a platform admin enters the original's figures.");
  const challenge = await challengeFor(storeId);
  if (!challenge) throw new OwnerToolError("This store has no challenge.");
  const parsed = originalPeriodSchema.safeParse(input);
  if (!parsed.success) throw new OwnerToolError(parsed.error.issues.map((i) => i.message).join(" "));
  const period = parsed.data;
  const original = [...challenge.original.filter((p) => p.from !== period.from), period].sort((x, y) => x.from.localeCompare(y.from));
  const added = originalSide(original);
  if (added && "problem" in added) throw new OwnerToolError(added.problem);
  await saveChallenge(a, storeId, { ...challenge, original });
  await audit(a.account.id, storeId, "ai.challenge_original_saved", { from: period.from, to: period.to, signedOn: period.signedOn }, { area: "platform" });
  return period;
}

/** Takes a period of the original's figures off (a platform admin's, audited). */
export async function removeOriginalPeriod(a: { account: Account }, storeId: string, from: string): Promise<void> {
  if (!a.account.platformAdmin) throw new OwnerToolError("Only a platform admin changes the original's figures.");
  const challenge = await challengeFor(storeId);
  if (!challenge) throw new OwnerToolError("This store has no challenge.");
  await saveChallenge(a, storeId, { ...challenge, original: challenge.original.filter((p) => p.from !== from) });
  await audit(a.account.id, storeId, "ai.challenge_original_removed", { from }, { area: "platform" });
}
