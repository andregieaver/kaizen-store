import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { keptStore, monthlyMinor, monthlyTotals } from "@/lib/account-move";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { STAFF_EMAILS_WORDS } from "@/lib/admin-words/staff-emails";
import { renderEmail } from "@/lib/email-layout";
import { isOnPlan } from "@/lib/plans";
import { siteUrl } from "@/lib/site";
import type { PaymentModeName } from "@/lib/stripe-account";

import { accountLock } from "./account-billing";
import { audit, type Account } from "./auth";
import { applySubscription } from "./billing";
import { getStripeAccounts, stripeProblem } from "./connect";
import { sendEmail } from "./email";
import { refreshExtensionFacts } from "./extensions";
import { forgetLimits } from "./limits";
import { log } from "./log";
import type { SaveResult } from "./settings";
import { platformStripe } from "./stripe";
import { col, typedRows } from "./typed-rows";

/**
 * The move of an account from store-by-store billing to one plan (D748 step E4 part four, `docs/extensions.md` 13). The owner's answer: at
 * launch every account moves automatically. The subscription of the store on the highest plan becomes the account's (no new charge, no new
 * customer: Stripe keeps billing the same store's account), every other running store subscription ends now with credit for the time not
 * used, the latest trial becomes the account's, and the owner is told by email. A platform admin can move one account first (a test
 * account); launch (step E5) moves the rest. Nothing here runs on its own.
 */

const LINE_ROW = z.object({
  organisation_id: col.uuid,
  name: col.text,
  billed: col.bool,
  moved_at: col.timestampOrNull,
  store_id: col.uuid,
  store_name: col.text,
  created_at: col.timestamp,
  plan_name: col.textOrNull,
  position: col.int.nullable(),
  currency: col.currency.nullable(),
  interval: z.enum(["month", "year"]).nullable(),
  amount_minor: col.minorOrNull,
  mode: col.textOrNull,
  subscription_id: col.textOrNull,
  status: col.textOrNull,
  trial_ends_at: col.timestampOrNull,
  owner_email: col.textOrNull,
  owner_locale: col.textOrNull,
});

export type MoveStore = {
  storeId: string;
  name: string;
  planName: string | null;
  price: { currency: string; interval: "month" | "year"; amountMinor: number } | null;
  status: string | null;
  /** Its subscription runs (trialing, active or past due) in a mode Kaizena Flow bills. */
  running: boolean;
};

/** What the move does for one account, or did: read before it runs, shown on Platform → Plans → Accounts. */
export type MovePreview = {
  organisationId: string;
  name: string;
  ownerEmail: string | null;
  ownerLocale: string | null;
  /** Billed through its account already (`movedAt` when it was moved, null when it started so). */
  billed: boolean;
  movedAt: string | null;
  stores: MoveStore[];
  /** The store whose subscription the account keeps; null when none runs. */
  kept: (MoveStore & { subscriptionId: string; mode: PaymentModeName }) | null;
  /** The other running store subscriptions, which end with credit for the time not used. */
  ending: (MoveStore & { subscriptionId: string; mode: PaymentModeName })[];
  /** The account's trial: the latest of its stores' trials, and whether it has ended. */
  trialEndsAt: string | null;
  trialEnded: boolean;
  /** What the account pays a month now and after the move, per currency. */
  before: { currency: string; minor: number }[];
  after: { currency: string; minor: number }[];
  /** The kept plan's store limit (`stores_owned`), and whether the account owns more open stores than it allows. */
  storeLimit: number | null;
  overLimit: boolean;
};

/** Every account's move (or a single one's), Kaizena Flow's own never: accounts with an open store, those still billed store by store first. */
export async function movePreviews(organisationId?: string): Promise<MovePreview[]> {
  const rows = await typedRows(
    LINE_ROW,
    sql`
      select o.id as organisation_id, o.name, ob.organisation_id is not null as billed, ob.moved_at,
             s.id as store_id, s.name as store_name, s.created_at, p.name as plan_name, p.position, pp.currency, pp.interval, pp.amount_minor,
             b.mode::text as mode, b.subscription_id, b.status, b.trial_ends_at, owner.email as owner_email, owner.admin_locale as owner_locale
        from commerce.organisations o
        join commerce.stores s on s.organisation_id = o.id and s.status <> 'closed' and not (s.is_template or s.starter or s.sandbox or s.house)
        left join commerce.organisation_billing ob on ob.organisation_id = o.id
        left join commerce.store_billing b on b.store_id = s.id
        left join commerce.plans p on p.id = b.plan_id
        left join commerce.plan_prices pp on pp.id = b.price_id
        left join lateral (
          select a.email, a.admin_locale from commerce.organisation_members m join commerce.accounts a on a.id = m.account_id
           where m.organisation_id = o.id and m.role = 'owner' order by m.created_at limit 1
        ) owner on true
       where not o.platform ${organisationId ? sql`and o.id = ${organisationId}::uuid` : sql``}
       order by (ob.organisation_id is not null), lower(o.name), o.id, s.created_at, s.id
    `,
  );
  const byAccount = new Map<string, typeof rows>();
  for (const row of rows) byAccount.set(row.organisation_id, [...(byAccount.get(row.organisation_id) ?? []), row]);
  const limits = await planStoreLimits();
  return [...byAccount.values()].map((lines) => {
    const first = lines[0];
    const stores = lines.map((r) => ({
      storeId: r.store_id,
      name: r.store_name,
      planName: r.plan_name,
      price: r.currency && r.interval && r.amount_minor !== null ? { currency: r.currency, interval: r.interval, amountMinor: r.amount_minor } : null,
      status: r.status,
      running: Boolean(r.subscription_id && r.mode && isOnPlan(r.status)),
      subscriptionId: r.subscription_id,
      mode: r.mode as PaymentModeName | null,
      createdAt: r.created_at,
      position: r.position,
    }));
    const keptId = keptStore(
      stores.map((s) => ({ storeId: s.storeId, createdAt: s.createdAt, running: s.running, planPosition: s.position, monthly: s.price ? monthlyMinor(s.price) : null })),
    );
    const view = ({ storeId, name, planName, price, status, running }: (typeof stores)[number]): MoveStore => ({ storeId, name, planName, price, status, running });
    const withSubscription = (s: (typeof stores)[number]) => ({ ...view(s), subscriptionId: s.subscriptionId as string, mode: s.mode as PaymentModeName });
    const kept = stores.find((s) => s.storeId === keptId) ?? null;
    const ending = stores.filter((s) => s.running && s.storeId !== keptId);
    const trials = lines.map((r) => r.trial_ends_at).filter((t): t is string => t !== null).sort();
    const keptPlan = kept ? lines.find((r) => r.store_id === kept.storeId)?.plan_name ?? null : null;
    const storeLimit = keptPlan ? (limits.get(keptPlan) ?? null) : null;
    return {
      organisationId: first.organisation_id,
      name: first.name,
      ownerEmail: first.owner_email,
      ownerLocale: first.owner_locale,
      billed: first.billed,
      movedAt: first.moved_at,
      stores: stores.map(view),
      kept: kept ? withSubscription(kept) : null,
      ending: ending.map(withSubscription),
      trialEndsAt: trials.at(-1) ?? null,
      trialEnded: trials.length > 0 && new Date(trials.at(-1)!).getTime() <= Date.now(),
      before: monthlyTotals(stores.flatMap((s) => (s.running && s.price ? [s.price] : []))),
      after: monthlyTotals(kept?.price ? [kept.price] : []),
      storeLimit,
      overLimit: storeLimit !== null && stores.length > storeLimit,
    };
  });
}

/** Each plan's store limit (`stores_owned`), by the plan's name as the preview reads it. */
async function planStoreLimits(): Promise<Map<string, number | null>> {
  const rows = await typedRows(
    z.object({ name: col.text, value: col.minorOrNull }),
    sql`select p.name, l.value from commerce.plan_limits l join commerce.plans p on p.id = l.plan_id where l.key = 'stores_owned'`,
  );
  return new Map(rows.map((r) => [r.name, r.value]));
}

/**
 * Moves one account to one plan, as its preview says. The account's row is written first, with the move's switch on so the plan's history
 * and events see no change for the kept subscription; then Stripe is told: the kept subscription names the account (its events would reach
 * the account by its id anyway), and each other running subscription ends now with credit for the unused time. Refused for an account
 * already billed through its account.
 */
export async function moveAccount(actor: Account, organisationId: string): Promise<SaveResult> {
  return accountLock(organisationId, async () => {
    const [preview] = await movePreviews(organisationId);
    if (!preview) return { ok: false, problems: ["That account has no open store to move."] };
    if (preview.billed) return { ok: false, problems: ["That account is billed through its account already."] };
    const kept = preview.kept;
    const customer = kept ? ((await getStripeAccounts(kept.storeId))[kept.mode]?.accountId ?? null) : null;

    await db().transaction(async (tx) => {
      await tx.execute(sql`select set_config('commerce.billing_move', 'on', true)`);
      await tx.execute(sql`
        insert into commerce.organisation_billing (
          organisation_id, plan_id, price_id, mode, subscription_id, status, current_period_end, cancel_at_period_end,
          platform_discount_id, discount_applied_at, trial_ends_at, customer_account, moved_at, updated_by
        )
        select ${organisationId}::uuid, b.plan_id, b.price_id, b.mode, b.subscription_id, b.status, b.current_period_end, coalesce(b.cancel_at_period_end, false),
               b.platform_discount_id, b.discount_applied_at, ${preview.trialEndsAt}::timestamptz, ${customer}, now(), ${actor.id}::uuid
          from (select 1) one left join commerce.store_billing b on b.store_id = ${kept?.storeId ?? null}::uuid
      `);
      // The kept subscription is the account's now: the store's own row keeps its plan as history, no longer its subscription.
      if (kept) {
        await tx.execute(sql`
          update commerce.store_billing set subscription_id = null, status = null, updated_at = now(), updated_by = ${actor.id}::uuid
           where store_id = ${kept.storeId}::uuid
        `);
      }
    });

    const problems: string[] = [];
    if (kept) {
      const stripe = platformStripe(kept.mode);
      try {
        const current = await stripe?.subscriptions.retrieve(kept.subscriptionId);
        await stripe?.subscriptions.update(kept.subscriptionId, { metadata: { ...current?.metadata, kaizen_organisation_id: organisationId } });
      } catch (error) {
        // The account's row names the subscription, so its events still reach the account: told, not undone.
        log("warn", "account_move.kept_metadata_failed", { organisationId }, error);
        problems.push(stripeProblem(error));
      }
    }
    for (const store of preview.ending) {
      const stripe = platformStripe(store.mode);
      if (!stripe) continue;
      try {
        const ended = await stripe.subscriptions.cancel(store.subscriptionId, { prorate: true, invoice_now: true });
        await applySubscription(ended, store.mode, actor);
      } catch (error) {
        log("warn", "account_move.end_failed", { organisationId, storeId: store.storeId }, error);
        problems.push(`${store.name}: ${stripeProblem(error)}`);
      }
    }

    await refreshExtensionFacts({ organisationId });
    forgetLimits();
    await audit(actor.id, null, "billing.account_moved", { organisationId, kept: kept?.storeId ?? null, ended: preview.ending.length }, { target: { type: "organisation", id: organisationId } });
    await tellOwner(preview);
    return problems.length > 0 ? { ok: true, note: `Moved. Stripe said: ${problems.join(" ")}` } : { ok: true };
  });
}

/** The owner's email about the move, in their admin language: one plan now, what ended and its credit, and where the plan is changed. */
async function tellOwner(preview: MovePreview): Promise<void> {
  if (!preview.ownerEmail) return;
  const lang = adminLangOf(preview.ownerLocale);
  const w = STAFF_EMAILS_WORDS[lang].accountMoved;
  const subject = w.subject;
  const paragraphs = [
    preview.kept?.planName ? fillWords(w.plan, { plan: preview.kept.planName }) : w.noPlan,
    ...(preview.ending.length > 0 ? [fillWords(w.ended, { stores: preview.ending.map((s) => s.name).join(", ") })] : []),
    w.limits,
  ];
  const message = renderEmail({
    subject,
    preview: subject,
    lang: lang === "nb" ? "nb" : "en",
    footer: ["Kaizena Flow · kaizenaflow.com"],
    blocks: [
      { type: "heading", text: subject },
      ...paragraphs.map((text) => ({ type: "paragraph" as const, text })),
      { type: "paragraph", text: `${siteUrl()}/admin/account/billing` },
    ],
  });
  await sendEmail({
    storeId: null,
    kind: "billing.account_moved",
    to: preview.ownerEmail,
    email: message,
    fromName: "Kaizena Flow",
    idempotencyKey: `account-moved:${preview.organisationId}`,
  });
}
