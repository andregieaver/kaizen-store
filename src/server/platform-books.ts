import "server-only";

import { sql } from "drizzle-orm";
import type Stripe from "stripe";
import { z } from "zod";

import { db } from "@/db/client";
import { todayIn } from "@/lib/analytics-period";
import { CARD_FEE_ACCOUNT, PAYMENT_ACCOUNTS, type LedgerEntryInput } from "@/lib/ledger";
import { entryOfPlatformCredit, entryOfPlatformPayout, entryOfPlatformSale, PLATFORM_INCOME, PLATFORM_STRIPE_ACCOUNT, type BookedSale } from "@/lib/platform-books";
import type { PaymentModeName } from "@/lib/stripe-account";

import { audit, type Account } from "./auth";
import { addLedgerAccount, ledgerAccounts, postLedgerEntry } from "./ledger";
import { log } from "./log";
import { platformStripe } from "./stripe";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Kaizena Flow's own money in the books of the business behind it (C3 step 2 of `docs/platform-parity-plan.md`, D508,
 * `src/lib/platform-books.ts`). The platform names the store whose books hold it (`platform_settings.books_store_id`: one business keeps
 * one book and one VAT return); each live sale (D507) is posted there once on the day it was paid, in kroner as Stripe settled it, with its
 * credit notes; Kaizena Flow's own Stripe payouts are read and posted against the bank with Stripe's fees. Test payments are never posted.
 * The five-minute dispatcher's `platformBooks` job does it; a platform admin's press does it at once.
 */

export type PlatformBooks = { storeId: string; slug: string; name: string; bookId: string | null; currency: string | null; openedOn: string | null };

/** The store whose books hold Kaizena Flow's money, with its open book (none while it has none). */
export async function platformBooks(): Promise<PlatformBooks | null> {
  const row = await typedRow(
    z.object({ store_id: col.uuid, slug: col.text, name: col.text, book_id: col.uuid.nullable(), currency: col.textOrNull, opened_on: col.textOrNull }),
    sql`select s.id as store_id, s.slug, s.name, b.id as book_id, b.currency::text as currency, b.opened_on::text as opened_on
          from commerce.platform_settings p join commerce.stores s on s.id = p.books_store_id
          left join commerce.ledger_books b on b.store_id = s.id and b.closed_on is null
         limit 1`,
  );
  return row ? { storeId: row.store_id, slug: row.slug, name: row.name, bookId: row.book_id, currency: row.currency, openedOn: row.opened_on } : null;
}

/** The stores whose open books may hold Kaizena Flow's money, by name. */
export async function storesWithBooks(): Promise<{ id: string; name: string; legalName: string }[]> {
  const rows = await typedRows(
    z.object({ id: col.uuid, name: col.text, legal_name: col.text }),
    sql`select s.id, s.name, b.legal_name from commerce.ledger_books b join commerce.stores s on s.id = b.store_id
         where b.closed_on is null and not s.sandbox and not s.starter order by lower(s.name)`,
  );
  return rows.map((r) => ({ id: r.id, name: r.name, legalName: r.legal_name }));
}

/** Names the store whose books hold Kaizena Flow's money (one with open books), or none. Audited. */
export async function setPlatformBooks(admin: Account, storeId: string | null): Promise<boolean> {
  if (storeId !== null && !(await storesWithBooks()).some((s) => s.id === storeId)) return false;
  await db().execute(sql`update commerce.platform_settings set books_store_id = ${storeId}::uuid`);
  await audit(admin.id, null, "platform.books_store_set", { storeId });
  return true;
}

/**
 * What reached Kaizena Flow's Stripe balance for a sale, and Stripe's fee: from the balance transaction of each payment of its invoice (its
 * charge's), in the balance's currency. Nothing for an invoice paid outside Stripe. Never throws; false when Stripe could not tell.
 */
export async function settlePlatformSale(mode: PaymentModeName, invoiceId: string, stripe: Stripe | null = platformStripe(mode)): Promise<boolean> {
  if (!stripe) return false;
  try {
    let settled = 0;
    let fee = 0;
    let currency: string | null = null;
    for await (const payment of stripe.invoicePayments.list({ invoice: invoiceId, status: "paid", limit: 20 })) {
      const p = payment.payment;
      const chargeId =
        p.type === "charge"
          ? typeof p.charge === "string" ? p.charge : (p.charge?.id ?? null)
          : p.type === "payment_intent"
            ? await (async () => {
                const id = typeof p.payment_intent === "string" ? p.payment_intent : p.payment_intent?.id;
                if (!id) return null;
                const intent = await stripe.paymentIntents.retrieve(id);
                return typeof intent.latest_charge === "string" ? intent.latest_charge : (intent.latest_charge?.id ?? null);
              })()
            : null;
      if (!chargeId) continue;
      const charge = await stripe.charges.retrieve(chargeId, { expand: ["balance_transaction"] });
      const bt = charge.balance_transaction;
      if (!bt || typeof bt === "string") continue;
      const btCurrency = bt.currency.toUpperCase();
      if (currency !== null && currency !== btCurrency) return false;
      currency = btCurrency;
      settled += bt.amount;
      fee += bt.fee;
    }
    if (currency === null) return false;
    await db().execute(sql`
      update commerce.platform_sales set settled_minor = ${settled}, settled_currency = ${currency}, fee_minor = ${Math.max(fee, 0)}, updated_at = now()
       where mode = ${mode} and stripe_invoice_id = ${invoiceId}`);
    return true;
  } catch (error) {
    log("warn", "platform_books.settle_failed", { mode }, error);
    return false;
  }
}

/**
 * Kaizena Flow's own payouts paid since a day, read from its Stripe account: what reached the bank and the fees of what each carried (its
 * balance transactions' fees), kept once. Returns how many were read; never throws.
 */
export async function readPlatformPayouts(mode: PaymentModeName, sinceDay: string, stripe: Stripe | null = platformStripe(mode)): Promise<number> {
  if (!stripe) return 0;
  let read = 0;
  try {
    for await (const payout of stripe.payouts.list({ created: { gte: Math.floor(Date.parse(`${sinceDay}T00:00:00Z`) / 1000) }, limit: 100 })) {
      if (payout.status !== "paid") continue;
      let fee = 0;
      for await (const bt of stripe.balanceTransactions.list({ payout: payout.id, limit: 100 })) {
        if (bt.type !== "payout") fee += bt.fee;
      }
      const arrival = new Date(payout.arrival_date * 1000).toISOString().slice(0, 10);
      await db().execute(sql`
        insert into commerce.platform_payouts (mode, stripe_payout_id, arrival_on, currency, amount_minor, fee_minor, status)
        values (${mode}, ${payout.id}, ${arrival}::date, ${payout.currency.toUpperCase()}, ${payout.amount}, ${Math.max(fee, 0)}, ${payout.status})
        on conflict (mode, stripe_payout_id) do update set status = excluded.status, fee_minor = excluded.fee_minor, updated_at = now()`);
      read += 1;
    }
  } catch (error) {
    log("warn", "platform_books.payouts_failed", { mode }, error);
  }
  return read;
}

/** A standing (not reversed) entry of the book for a source, if any. */
async function standing(bookId: string, kind: string, id: string): Promise<{ id: string } | null> {
  return typedRow(
    z.object({ id: col.uuid }),
    sql`select e.id from commerce.ledger_entries e where e.book_id = ${bookId}::uuid and e.source_kind = ${kind} and e.source_id = ${id} and e.reverses is null
          and not exists (select 1 from commerce.ledger_entries r where r.reverses = e.id) limit 1`,
  );
}

const SALE = z.object({
  id: col.uuid,
  stripe_invoice_id: col.text,
  number: col.textOrNull,
  kind: z.enum(["plan", "theme", "domain", "other"]),
  paid_on: col.text,
  currency: col.currency,
  net_minor: col.minor,
  vat_minor: col.minor,
  total_minor: col.minor,
  credited_minor: col.minor,
  settled_minor: col.minor.nullable(),
  settled_currency: col.textOrNull,
});

export type PlatformBooksRun = { posted: number; waiting: number; payouts: number };

/**
 * Posts what is due to the books that hold Kaizena Flow's money: each live sale paid on or after the book opened (settled from Stripe first
 * where it was sold in another currency than the book's), the credited share of a sale (a changed one reversed and posted again), and each
 * live payout. Each once; one that cannot be posted waits (a locked day, a currency Stripe has not settled) and is tried again.
 */
export async function postPlatformMoney(options: { deadline?: number; stripe?: Stripe | null; now?: Date } = {}): Promise<PlatformBooksRun> {
  const run: PlatformBooksRun = { posted: 0, waiting: 0, payouts: 0 };
  const books = await platformBooks();
  if (!books?.bookId || !books.currency || !books.openedOn) return run;
  const { bookId, currency, openedOn, storeId } = books;
  const have = new Set((await ledgerAccounts(bookId)).map((a) => a.number));
  for (const number of [PLATFORM_STRIPE_ACCOUNT, PLATFORM_INCOME.norway.account, PLATFORM_INCOME.norway.vatAccount, PLATFORM_INCOME.abroad.account, CARD_FEE_ACCOUNT, PAYMENT_ACCOUNTS.bank]) {
    if (!have.has(number)) await addLedgerAccount(storeId, bookId, { number });
  }
  const today = todayIn(options.now ?? new Date(), "Europe/Oslo");
  const post = async (entry: LedgerEntryInput): Promise<boolean> => {
    const posted = await postLedgerEntry(bookId, entry, null);
    if (!posted.ok) {
      log("info", "platform_books.waiting", { source: entry.source?.kind ?? "", problems: posted.problems.join(",") });
      return false;
    }
    return true;
  };
  const stripe = options.stripe === undefined ? platformStripe("live") : options.stripe;

  const sales = await typedRows(
    SALE,
    sql`select id, stripe_invoice_id, number, kind, (paid_at at time zone 'Europe/Oslo')::date::text as paid_on, currency, net_minor, vat_minor, total_minor,
               credited_minor, settled_minor, settled_currency::text as settled_currency
          from commerce.platform_sales
         where mode = 'live' and (paid_at at time zone 'Europe/Oslo')::date >= ${openedOn}::date
         order by paid_at, id limit 500`,
  );
  for (const row of sales) {
    if (options.deadline && Date.now() > options.deadline) break;
    let sale: BookedSale = {
      id: row.id,
      number: row.number,
      kind: row.kind,
      paidOn: row.paid_on,
      currency: row.currency,
      netMinor: row.net_minor,
      vatMinor: row.vat_minor,
      totalMinor: row.total_minor,
      creditedMinor: row.credited_minor,
      settledMinor: row.settled_minor,
      settledCurrency: row.settled_currency,
    };
    if (!(await standing(bookId, "platform_sale", sale.id))) {
      if (sale.currency !== currency && sale.settledMinor === null && (await settlePlatformSale("live", row.stripe_invoice_id, stripe))) {
        const again = await typedRow(z.object({ settled_minor: col.minor.nullable(), settled_currency: col.textOrNull }), sql`select settled_minor, settled_currency::text as settled_currency from commerce.platform_sales where id = ${sale.id}::uuid`);
        sale = { ...sale, settledMinor: again?.settled_minor ?? null, settledCurrency: again?.settled_currency ?? null };
      }
      const made = entryOfPlatformSale(sale, currency);
      if (made.ok && (await post(made.entry))) run.posted += 1;
      else run.waiting += 1;
    }
    // The credited share: posted once for what is credited now; a different amount before is taken back first.
    const earlier = await typedRows(
      z.object({ id: col.uuid, source_id: col.text }),
      sql`select e.id, e.source_id from commerce.ledger_entries e
           where e.book_id = ${bookId}::uuid and e.source_kind = 'platform_credit' and e.source_id like ${`${sale.id}:%`} and e.reverses is null
             and not exists (select 1 from commerce.ledger_entries r where r.reverses = e.id)`,
    );
    const current = `${sale.id}:${sale.creditedMinor}`;
    if (sale.creditedMinor > 0 && !earlier.some((e) => e.source_id === current)) {
      // A credit taken back that could not be (a locked day) keeps the new one waiting: never credited twice.
      let clear = true;
      for (const e of earlier) {
        await db()
          .execute(sql`select commerce.ledger_reverse(${e.id}::uuid, ${today}::date, ${"Tilbakeføring av kreditnota (Kaizena Flow)"}, null)`)
          .catch((error) => {
            clear = false;
            log("warn", "platform_books.credit_reverse_failed", {}, error);
          });
      }
      if (!clear) {
        run.waiting += 1;
        continue;
      }
      const made = entryOfPlatformCredit(sale, currency, today);
      if (made.ok && (await post(made.entry))) run.posted += 1;
      else run.waiting += 1;
    }
  }

  const payouts = await typedRows(
    z.object({ id: col.uuid, arrival_on: col.text, currency: col.currency, amount_minor: col.minor, fee_minor: col.minor }),
    sql`select id, arrival_on::text, currency, amount_minor, fee_minor from commerce.platform_payouts
         where mode = 'live' and status = 'paid' and arrival_on >= ${openedOn}::date order by arrival_on, id limit 200`,
  );
  for (const p of payouts) {
    if (options.deadline && Date.now() > options.deadline) break;
    if (await standing(bookId, "platform_payout", p.id)) continue;
    const made = entryOfPlatformPayout({ id: p.id, arrivalOn: p.arrival_on, currency: p.currency, amountMinor: p.amount_minor, feeMinor: p.fee_minor }, currency);
    if (made.ok && (await post(made.entry))) run.payouts += 1;
    else run.waiting += 1;
  }
  return run;
}

/** The dispatcher's `platformBooks` job: Kaizena Flow's live payouts of the last 40 days read, then what is due posted, within 30 seconds. */
export async function runPlatformBooks(): Promise<PlatformBooksRun & { read: number }> {
  const books = await platformBooks();
  if (!books?.bookId) return { posted: 0, waiting: 0, payouts: 0, read: 0 };
  const since = new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10);
  const read = await readPlatformPayouts("live", since);
  return { ...(await postPlatformMoney({ deadline: Date.now() + 30_000 })), read };
}

/** What the books hold of Kaizena Flow's money: the live sales and payouts posted, and those waiting. */
export async function platformBooksState(): Promise<{ books: PlatformBooks | null; sales: number; posted: number; payouts: number; payoutsPosted: number }> {
  const books = await platformBooks();
  const row = await typedRow(
    z.object({ sales: col.int, posted: col.int, payouts: col.int, payouts_posted: col.int }),
    sql`select
          (select count(*)::int from commerce.platform_sales where mode = 'live') as sales,
          (select count(*)::int from commerce.platform_sales s where s.mode = 'live' and exists (select 1 from commerce.ledger_entries e
              where e.book_id = ${books?.bookId ?? null}::uuid and e.source_kind = 'platform_sale' and e.source_id = s.id::text and e.reverses is null)) as posted,
          (select count(*)::int from commerce.platform_payouts where mode = 'live' and status = 'paid') as payouts,
          (select count(*)::int from commerce.platform_payouts p where p.mode = 'live' and exists (select 1 from commerce.ledger_entries e
              where e.book_id = ${books?.bookId ?? null}::uuid and e.source_kind = 'platform_payout' and e.source_id = p.id::text and e.reverses is null)) as payouts_posted`,
  );
  return { books, sales: row?.sales ?? 0, posted: row?.posted ?? 0, payouts: row?.payouts ?? 0, payoutsPosted: row?.payouts_posted ?? 0 };
}
