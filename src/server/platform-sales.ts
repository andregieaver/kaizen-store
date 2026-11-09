import "server-only";

import { sql } from "drizzle-orm";
import type Stripe from "stripe";
import { z } from "zod";

import { db } from "@/db/client";
import { saleOf, salesByMonth, type InvoiceLike, type SalesMonth } from "@/lib/platform-sales";
import type { PaymentModeName } from "@/lib/stripe-account";

import { audit, type Account } from "./auth";
import { log } from "./log";
import { platformModes, platformStripe } from "./stripe";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * What Kaizena Flow itself sold (C3 of `docs/platform-parity-plan.md`, D507, `src/lib/platform-sales.ts`): each paid invoice of its own
 * Stripe account kept in `commerce.platform_sales`, from the billing webhook (`invoice.paid`, `credit_note.created`) and from Stripe again
 * on a platform admin's press; and a year's sales by month for Plans → Analytics. Every step is safe to repeat.
 */

type CustomerInvoice = InvoiceLike & { customer_account?: string | null };

/** Keeps a paid invoice as a sale (once, by its id), with the store that bought it and that store's country. */
export async function recordPlatformSale(mode: PaymentModeName, invoice: CustomerInvoice): Promise<boolean> {
  const sale = saleOf(invoice);
  if (!sale) return false;
  const buyer = invoice.customer_account
    ? await typedRow(
        z.object({ store_id: col.uuid, country: col.textOrNull }),
        sql`select a.store_id, s.country from commerce.stripe_accounts a join commerce.stores s on s.id = a.store_id
             where a.mode = ${mode} and a.account_id = ${invoice.customer_account} limit 1`,
      )
    : null;
  const country = buyer?.country && /^[A-Z]{2}$/.test(buyer.country) ? buyer.country : null;
  await db().execute(sql`
    insert into commerce.platform_sales (mode, stripe_invoice_id, buyer_store_id, number, kind, country, paid_at, currency, net_minor, vat_minor, total_minor)
    values (${mode}, ${sale.stripeInvoiceId}, ${buyer?.store_id ?? null}::uuid, ${sale.number}, ${sale.kind}, ${country}, ${sale.paidAt}::timestamptz,
            ${sale.currency}, ${sale.netMinor}, ${sale.vatMinor}, ${sale.totalMinor})
    on conflict (mode, stripe_invoice_id) do update set number = excluded.number, kind = excluded.kind, updated_at = now()`);
  return true;
}

/** What an invoice's credit notes gave back, as Stripe has them now (the void ones not counted), kept on its sale. */
export async function recordPlatformCredits(mode: PaymentModeName, invoiceId: string, stripe: Stripe | null = platformStripe(mode)): Promise<void> {
  if (!stripe || !/^in_[A-Za-z0-9]+$/.test(invoiceId)) return;
  let credited = 0;
  for await (const note of stripe.creditNotes.list({ invoice: invoiceId, limit: 100 })) {
    if (note.status !== "void") credited += note.total;
  }
  await db().execute(sql`
    update commerce.platform_sales set credited_minor = least(greatest(${credited}, 0), total_minor), updated_at = now()
     where mode = ${mode} and stripe_invoice_id = ${invoiceId}`);
}

/** A billing webhook event as it touches the sales: an invoice paid, or a credit note made. */
export async function applyPlatformSaleEvent(mode: PaymentModeName, event: Stripe.Event): Promise<boolean> {
  if (event.type === "invoice.paid") return recordPlatformSale(mode, event.data.object as unknown as CustomerInvoice);
  if (event.type === "credit_note.created") {
    const note = event.data.object as Stripe.CreditNote;
    const invoice = typeof note.invoice === "string" ? note.invoice : note.invoice?.id;
    if (invoice) await recordPlatformCredits(mode, invoice);
    return Boolean(invoice);
  }
  return false;
}

/**
 * *Read from Stripe* (a platform admin's press): every paid invoice of a year, in each mode Kaizena Flow has keys for, kept as a sale with
 * its credit notes; what the webhook missed is caught up. Audited.
 */
export async function catchUpPlatformSales(admin: Account, year: number, deps: { stripeFor?: (mode: PaymentModeName) => Stripe | null } = {}): Promise<{ read: number }> {
  const from = Math.floor(Date.UTC(year, 0, 1) / 1000);
  const to = Math.floor(Date.UTC(year + 1, 0, 1) / 1000);
  let read = 0;
  for (const mode of platformModes()) {
    const stripe = (deps.stripeFor ?? platformStripe)(mode);
    if (!stripe) continue;
    try {
      for await (const invoice of stripe.invoices.list({ status: "paid", created: { gte: from, lt: to }, limit: 100 })) {
        if (await recordPlatformSale(mode, invoice as unknown as CustomerInvoice)) {
          read += 1;
          if ((invoice.post_payment_credit_notes_amount ?? 0) > 0 || (invoice.pre_payment_credit_notes_amount ?? 0) > 0) await recordPlatformCredits(mode, invoice.id ?? "", stripe);
        }
      }
    } catch (error) {
      log("warn", "platform_sales.catch_up_failed", { mode, year }, error);
    }
  }
  await audit(admin.id, null, "platform.sales_read", { year, read });
  return { read };
}

export type PlatformSalesView = { live: { months: SalesMonth[]; totals: SalesMonth[] }; test: { months: SalesMonth[]; totals: SalesMonth[] }; count: number };

/** A year's sales by month in Kaizena Flow's own time (Oslo), live and test apart. */
export async function platformSalesView(year: number): Promise<PlatformSalesView> {
  const rows = await typedRows(
    z.object({ mode: col.text, month: col.text, kind: z.enum(["plan", "theme", "domain", "other"]), currency: col.currency, net: col.minor, vat: col.minor, total: col.minor, credited: col.minor }),
    sql`select mode, to_char(paid_at at time zone 'Europe/Oslo', 'YYYY-MM') as month, kind, currency,
               coalesce(sum(net_minor), 0) as net, coalesce(sum(vat_minor), 0) as vat, coalesce(sum(total_minor), 0) as total, coalesce(sum(credited_minor), 0) as credited
          from commerce.platform_sales
         where (paid_at at time zone 'Europe/Oslo') >= make_date(${year}, 1, 1) and (paid_at at time zone 'Europe/Oslo') < make_date(${year + 1}, 1, 1)
         group by mode, month, kind, currency`,
  );
  const of = (mode: string) =>
    salesByMonth(rows.filter((r) => (mode === "live" ? r.mode === "live" : r.mode !== "live")).map((r) => ({ month: r.month, kind: r.kind, currency: r.currency, netMinor: r.net, vatMinor: r.vat, totalMinor: r.total, creditedMinor: r.credited })));
  return { live: of("live"), test: of("test"), count: rows.length };
}
