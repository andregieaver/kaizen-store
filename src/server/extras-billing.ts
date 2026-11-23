import "server-only";

import { sql } from "drizzle-orm";
import type Stripe from "stripe";
import { z } from "zod";

import { db } from "@/db/client";
import { billExtras, EXTRA_UNIT_OF } from "@/lib/extras";
import { EXTENSION_NAMES, isExtensionId, type ExtensionId } from "@/lib/extensions";
import type { InvoiceShape } from "@/lib/referral-billing";
import type { PaymentModeName } from "@/lib/stripe-account";

import { audit, type Account } from "./auth";
import { extraLines } from "./extras";
import { platformStripe } from "./stripe";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Use beyond the allowances on the account's bill (D880, D748 E11): the lines added to its renewal invoice, and the cap its owner sets. The
 * counting is `extras.ts`'s.
 */

/** The cap the owner sets (Account, Billing, Advanced): the most a period's extras cost, in the account's currency; null for none. */
export async function saveExtrasCap(owner: Account, organisationId: string, capMinor: number | null): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  if (capMinor !== null && (!Number.isSafeInteger(capMinor) || capMinor < 0)) return { ok: false, problems: ["Type an amount of 0 or more, or leave it empty for no cap."] };
  const rows = await db().execute(sql`
    update commerce.organisation_billing set extras_cap_minor = ${capMinor}, updated_at = now(), updated_by = ${owner.id}::uuid
     where organisation_id = ${organisationId}::uuid returning 1`);
  if (rows.length === 0) return { ok: false, problems: ["This account is still billed store by store."] };
  await audit(owner.id, null, "billing.account_extras_cap", { organisationId, capMinor }, { target: { type: "organisation", id: organisationId } });
  return { ok: true };
}

export type ExtrasOutcome = { added: number; reason?: "not_a_renewal" | "not_an_account" | "not_draft" | "nothing" };

/**
 * Adds the period's use beyond the allowances to an account's renewal invoice while it is a draft: one line an extension ("37 AI-handled
 * conversations beyond 100"), the period being the invoice's (the one just ended), never past the cap. Each line's row is written first
 * (`organisation_extra_charges`), so a retried event finds it and adds nothing twice; Stripe's call carries an idempotency key of its own.
 */
export async function billInvoiceExtras(mode: PaymentModeName, eventInvoice: Pick<InvoiceShape, "id" | "billing_reason" | "parent">): Promise<ExtrasOutcome> {
  if (eventInvoice.billing_reason !== "subscription_cycle") return { added: 0, reason: "not_a_renewal" };
  const organisationId = eventInvoice.parent?.subscription_details?.metadata?.kaizen_organisation_id;
  if (!organisationId || !/^[0-9a-f-]{36}$/i.test(organisationId)) return { added: 0, reason: "not_an_account" };
  const stripe = platformStripe(mode);
  if (!stripe) throw new Error("Stripe is not set up for this mode.");
  const invoice: Stripe.Invoice = await stripe.invoices.retrieve(eventInvoice.id);
  if (invoice.status !== "draft") return { added: 0, reason: "not_draft" };
  const from = new Date(invoice.period_start * 1000);
  const to = new Date(invoice.period_end * 1000);
  if (!(to > from)) return { added: 0, reason: "nothing" };
  const currency = invoice.currency.toUpperCase();
  const cap = await typedRow(z.object({ cap: col.minorOrNull }), sql`select extras_cap_minor as cap from commerce.organisation_billing where organisation_id = ${organisationId}::uuid`);
  const billed = billExtras(await extraLines(organisationId, from, to, currency), cap?.cap ?? null).filter((line) => line.quantity > 0);
  let added = 0;
  for (const line of billed) {
    await db().execute(sql`
      insert into commerce.organisation_extra_charges (organisation_id, invoice_id, mode, extension_id, unit, used, included, quantity, unit_minor, amount_minor, currency, period_start, period_end)
      values (${organisationId}::uuid, ${invoice.id}, ${mode}, ${line.extensionId}, ${line.unit}, ${line.used}, ${line.included ?? 0}, ${line.quantity}, ${line.unitMinor},
        ${line.amountMinor}, ${currency}, ${from.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz)
      on conflict do nothing`);
    const kept = await typedRow(
      z.object({ quantity: col.int, amount_minor: col.minor, included: col.int, invoice_item_id: col.textOrNull }),
      sql`select quantity, amount_minor, included, invoice_item_id from commerce.organisation_extra_charges
           where organisation_id = ${organisationId}::uuid and invoice_id = ${invoice.id} and extension_id = ${line.extensionId}`,
    );
    if (!kept || kept.invoice_item_id) continue;
    const what = line.unit === "ai_conversation" ? "AI-handled conversations" : "people";
    const item = await stripe.invoiceItems.create(
      {
        customer_account: invoice.customer_account ?? undefined,
        invoice: invoice.id,
        amount: kept.amount_minor,
        currency: invoice.currency,
        description: `${EXTENSION_NAMES[line.extensionId]}: ${kept.quantity} ${what} beyond the ${kept.included} included`,
        metadata: { kaizen_organisation_id: organisationId, kaizen_extra: line.extensionId },
      },
      { idempotencyKey: `kaizen-extra-${invoice.id}-${line.extensionId}` },
    );
    await db().execute(sql`
      update commerce.organisation_extra_charges set invoice_item_id = ${item.id}
       where organisation_id = ${organisationId}::uuid and invoice_id = ${invoice.id} and extension_id = ${line.extensionId}`);
    added += 1;
  }
  return billed.length === 0 ? { added: 0, reason: "nothing" } : { added };
}

export type ExtraPrice = { extensionId: ExtensionId; currency: string; amountMinor: number };

/** The prices beyond the allowances on offer now, for the platform admin's card. */
export async function platformExtraPrices(): Promise<ExtraPrice[]> {
  const rows = await typedRows(
    z.object({ extension_id: col.text, currency: col.currency, amount_minor: col.minor }),
    sql`select extension_id, currency, amount_minor from commerce.extension_extra_prices where active order by extension_id, currency`,
  );
  return rows.flatMap((r) => (isExtensionId(r.extension_id) ? [{ extensionId: r.extension_id, currency: r.currency, amountMinor: r.amount_minor }] : []));
}

/**
 * The platform admin sets the prices beyond the allowances (D880): one per extension that has a unit beyond (`EXTRA_UNIT_OF`) and currency;
 * null takes it off. A changed price is a new row and the old one inactive, as prices are: what an invoice was billed at stays as it was.
 */
export async function saveExtraPrices(actor: Account, prices: readonly { extensionId: ExtensionId; currency: string; amountMinor: number | null }[]): Promise<{ ok: true; changed: number }> {
  const current = await platformExtraPrices();
  let changed = 0;
  await db().transaction(async (tx) => {
    for (const p of prices) {
      const unit = EXTRA_UNIT_OF[p.extensionId];
      if (!unit) continue;
      const now = current.find((c) => c.extensionId === p.extensionId && c.currency === p.currency)?.amountMinor ?? null;
      if (now === p.amountMinor) continue;
      await tx.execute(sql`update commerce.extension_extra_prices set active = false where extension_id = ${p.extensionId} and currency = ${p.currency} and active`);
      if (p.amountMinor !== null) {
        await tx.execute(sql`
          insert into commerce.extension_extra_prices (extension_id, unit, currency, amount_minor, created_by)
          values (${p.extensionId}, ${unit}, ${p.currency}, ${p.amountMinor}, ${actor.id}::uuid)`);
      }
      changed += 1;
    }
  });
  if (changed > 0) await audit(actor.id, null, "platform.extension_extra_prices", { changed }, { target: { type: "platform", id: "extensions" } });
  return { ok: true, changed };
}
