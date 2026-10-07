import "server-only";

import { sql } from "drizzle-orm";
import type Stripe from "stripe";

import { db } from "@/db/client";
import { CHECKOUT_MINUTES, stripeLocale } from "@/lib/checkout";
import { formatMoney } from "@/lib/money";
import { marketPath, storeOrigin } from "@/lib/paths";
import { t } from "@/lib/i18n";
import { saleFee, type PaymentModeName } from "@/lib/stripe-account";
import type { PlanInterval } from "@/lib/subscriptions";

import { storeFeeBps } from "./billing";
import type { CheckoutProblem, CheckoutShop, PlacedOrder } from "./checkout";
import { ensurePaymentDomain, ensureTestAccount } from "./connect";
import { commissionOf, hostCheckoutAccount } from "./host-payments";
import { kaizenInvoicingOn } from "./invoice-settings";
import { getCheckoutAccount } from "./settings";
import { ensureSubscriptionEvents } from "./subscriptions";
import { platformStripe } from "./stripe";

type Row = Record<string, unknown>;

/**
 * Opens a Stripe Checkout session for an order that is already placed (D16), on the store's own connected account (a direct charge, Kaizen's fee as the
 * application fee, a host's listings on the host's account, D71), and records the payment waiting for it. The ONE place a session is made: `startCheckout()` (a
 * cart's order) and the pay link of a draft order (wave 3, D173: the order made when the draft was sent) both call it, so the line items, the fee, the metadata, the
 * invoice fields and the reverse-charge shape are one code path. It never cancels an order: a failure is answered, and the caller decides what becomes of the order.
 */

/** Tags Kaizen's storefront sessions in the Stripe Dashboard (Stripe asks for 8 random letters). */
const INTEGRATION_IDENTIFIER = "kaizen-storefront-qhwmzrtd";

/** "Of which VAT" on the order invoice, in the shopper's language. */
const VAT_LABELS: Record<string, string> = { nb: "Herav mva", sv: "Varav moms", da: "Heraf moms" };
/**
 * What a reverse-charge order's Stripe invoice says (D157): the words, the seller's and the buyer's VAT numbers and whom it
 * is bought for, in four fields. The words are a legal statement (Directive 2006/112/EC Art. 226 point 11a asks for
 * "Reverse charge" on the invoice): hand-written, never machine-translated, and need a lawyer's review (docs/wave-1a-tax.md
 * section 8); languages other than these four show English. The invoice of Kaizen's own is unit 1b's.
 */
// legal: needs review
const REVERSE_LABELS: Record<string, { words: string; seller: string; buyer: string; company: string }> = {
  nb: { words: "Omvendt avgiftsplikt", seller: "Selgers mva-nr.", buyer: "Kjøpers mva-nr.", company: "Kjøper" },
  sv: { words: "Omvänd skattskyldighet", seller: "Säljarens momsnr", buyer: "Köparens momsnr", company: "Köpare" },
  da: { words: "Omvendt betalingspligt", seller: "Sælgers momsnr.", buyer: "Købers momsnr.", company: "Køber" },
  en: { words: "Reverse charge", seller: "Seller VAT no.", buyer: "Buyer VAT no.", company: "Buyer" },
};

function reverseChargeFields(lang: string, order: Pick<PlacedOrder, "treatment" | "company">) {
  const label = REVERSE_LABELS[lang] ?? REVERSE_LABELS.en;
  return [
    { name: label.words, value: "VAT 0" },
    { name: label.seller, value: order.treatment?.sellerVatNumber ?? "-" },
    { name: label.buyer, value: order.treatment?.buyerVatNumber ?? "-" },
    ...(order.company ? [{ name: label.company, value: order.company.name.slice(0, 140) }] : []),
  ];
}

const COMPANY_LABELS: Record<string, { name: string; number: string }> = {
  nb: { name: "Kjøper", number: "Org.nr." },
  sv: { name: "Köpare", number: "Org.nr" },
  da: { name: "Køber", number: "CVR-nr." },
  en: { name: "Buyer", number: "Organisation number" },
};


/** How often a subscription's lines renew, as Stripe takes it. */
function recurring(plan: { interval: PlanInterval; intervalCount: number }) {
  return { interval: plan.interval, interval_count: plan.intervalCount };
}

/**
 * Shipping as lines of a subscription checkout, which takes no shipping
 * options: what renews with each delivery, and what the first delivery
 * costs on top (items bought once when the subscription itself ships nothing).
 */
export function subscriptionShipping(
  order: Pick<PlacedOrder, "subscription" | "shippingMinor">,
  currency: string,
  label: string,
): Stripe.Checkout.SessionCreateParams.LineItem[] {
  if (!order.subscription) return [];
  const renewing = order.subscription.shippingMinor;
  // In a free trial, the renewing line is not charged now (D29).
  const once = order.shippingMinor - (order.subscription.trialDays > 0 ? 0 : renewing);
  const line = (amount: number, renews: boolean) => ({
    quantity: 1,
    price_data: {
      currency,
      unit_amount: amount,
      product_data: { name: label },
      ...(renews && order.subscription && { recurring: recurring(order.subscription) }),
    },
  });
  return [...(renewing > 0 ? [line(renewing, true)] : []), ...(once > 0 ? [line(once, false)] : [])];
}

/**
 * The store's Stripe connection for a session: the mode, the connected account and whether Stripe's own invoice option is on, with Kaizen's platform client for that mode; null when payments are off
 * (no provider on, or no account ready). In test mode the store's test account that was not ready when last seen is asked for again (Stripe checks Kaizen's test values within a minute or two).
 */
export async function paymentConnection(storeId: string): Promise<{ connection: PaymentSessionOptions["connection"]; stripe: Stripe } | null> {
  const found = await getCheckoutAccount(storeId);
  const stripe = found && platformStripe(found.mode);
  if (!found || !stripe) return null;
  let accountId = found.accountId;
  if (!accountId) {
    const test = await ensureTestAccount(storeId);
    if (!test.ok || !test.ready) return null;
    accountId = test.accountId;
  }
  return { connection: { mode: found.mode, accountId, orderInvoices: found.orderInvoices }, stripe };
}

export type PaymentSessionOptions = {
  /** The store's Stripe connection: the mode, the connected account and whether Stripe's own invoice option is on. */
  connection: { mode: PaymentModeName; accountId: string; orderInvoices: boolean };
  /** Kaizen's own page (Stripe's form in it) or Stripe's hosted page. */
  ui: "custom" | "hosted";
  stripe: Stripe;
  /** Each line at its amount due, quantity 1, no coupon (the order's own amounts): the shape a reverse-charge or part-paid order has; a draft order always. */
  exactAmounts?: boolean;
  /** How long the session lives; Stripe's limit is 24 hours. A checkout's is `CHECKOUT_MINUTES` and a minute. */
  expiresInSeconds?: number;
  /** Where Stripe's hosted page sends a buyer who leaves (the cart for a checkout). */
  cancelUrl?: string;
  /** The buyer's address, put in Stripe's form already (a draft order's email, which staff typed). */
  customerEmail?: string;
  /**
   * Stripe's idempotency key for the session. A cart's checkout makes a new order for every attempt, so `checkout-{order}` is new each time; a draft order keeps ONE order for every press of its pay link, so its caller passes
   * a key of its own per press (Stripe refuses a reused key with other parameters, and gives back the first session for the same ones).
   */
  idempotencyKey?: string;
  /** The countries Stripe's address form allows: the order's own market (the VAT it carries was decided for it), never the one in the address bar. */
  allowedCountry?: string;
  /**
   * The session pays an order change's difference (D174): the metadata and the payment row name the change, so `applySession()` applies the change and never
   * completes the order a second time; no Stripe invoice is made for it (the change's own documents are Kaizen's).
   */
  orderEditId?: string;
};

/** The session's own failures: the caller decides what becomes of the order. */
export type PaymentSessionResult =
  | { ok: true; url: string; sessionId: string }
  | { ok: false; problem: Extract<CheckoutProblem, "payment_error" | "host_payments_off"> };

export async function openPaymentSession(
  shop: CheckoutShop,
  order: PlacedOrder,
  origin: string,
  shippingLabel: string,
  options: PaymentSessionOptions,
): Promise<PaymentSessionResult> {
  const { connection, ui, stripe } = options;
  // Renewals (D25) and refunds that complete later or are made in Stripe (D159) arrive as webhook events that older platform
  // webhooks were not sent; checked once per server instance and mode.
  await ensureSubscriptionEvents(connection.mode);
  // A host's listings are paid on the host's own account (D71), in the store's mode.
  let seller = connection.accountId;
  let commissionBps = 0;
  if (order.hostId) {
    const hostAccount = await hostCheckoutAccount(shop.storeId, order.hostId, connection.mode);
    if (!hostAccount) {
      // The caller cancels the order waiting for it.
      return { ok: false, problem: "host_payments_off" };
    }
    seller = hostAccount;
    const [host] = await db().execute<Row>(sql`
      select commission_bps from commerce.hosts where store_id = ${shop.storeId}::uuid and id = ${order.hostId}::uuid
    `);
    commissionBps = Number(host?.commission_bps ?? 0);
  }

  const [store] = await db().execute<Row>(sql`
    select legal_name, organisation_number from commerce.stores where id = ${shop.storeId}::uuid
  `);
  const feeBps = await storeFeeBps(shop.storeId);
  // Kaizen's fee is on what is paid through Stripe; the rest is paid at the venue (D66).
  const kaizenFee = saleFee(order.dueNowMinor, feeBps);
  // On a host's charge, the store's commission rides in the application fee, to be sent on to the store (D71).
  const commission = commissionOf(order.dueNowMinor, commissionBps);
  const fee = commission > 0 ? Math.min(order.dueNowMinor, (kaizenFee ?? 0) + commission) : kaizenFee;
  if (commission > 0) {
    await db().execute(sql`
      update commerce.orders set commission_minor = ${(fee ?? 0) - (kaizenFee ?? 0)}
      where store_id = ${shop.storeId}::uuid and id = ${order.orderId}::uuid
    `);
  }
  const partial = order.balanceMinor > 0;
  // Kaizen's own invoice and credit notes (D159) are made by the database when the order is paid: Stripe's invoice option is then not used.
  const kaizenInvoices = await kaizenInvoicingOn(shop.storeId);
  // Reverse charge (D157): Stripe is sent the order's own net amounts, each line at its amount due, no coupon (the discounts
  // and the VAT not charged are inside them) and the shipping at its net amount, so what Stripe charges is `dueNowMinor`.
  const reverse = order.vatKind === "reverse_charge";
  // A draft order's amounts are its own (a staff discount and a custom price are already inside each line), so Stripe is sent each line at its amount due too.
  const exact = options.exactAmounts === true;
  const depositLabel = t(shop.market.lang).booking.deposit;
  // Back to the store's own host once it has one (P7), whichever host the request came from.
  const base = `${storeOrigin(shop.storeSlug) ?? origin}${marketPath(shop.storeSlug, shop.market.slug)}`;
  const currency = order.currency.toLowerCase();
  const metadata = { order_id: order.orderId, order_number: order.number, store_id: shop.storeId, ...(options.orderEditId ? { order_edit_id: options.orderEditId } : {}) };
  const sellerLine = [store?.legal_name, store?.organisation_number && `Org.nr. ${store.organisation_number}`]
    .filter(Boolean)
    .join(" · ");
  const returnUrl = `${base}/order/${order.orderId}?session_id={CHECKOUT_SESSION_ID}`;
  // Wallets, Link and Klarna show in Stripe's form only on registered domains.
  if (ui === "custom" && origin.startsWith("https://")) {
    await ensurePaymentDomain(shop.storeId, connection.mode, seller, new URL(origin).hostname);
  }

  let session: Stripe.Checkout.Session;
  try {
    // A discount code (D31) reaches Stripe as a coupon for this checkout alone.
    // With a part paid at the venue, each line is sent as what is due now, discount included.
    const coupon =
      !partial && !reverse && !exact && order.discount && order.discount.couponMinor > 0
        ? await stripe.coupons.create(
            {
              amount_off: order.discount.couponMinor,
              currency,
              duration: "once",
              max_redemptions: 1,
              name: order.discount.code.slice(0, 40),
              metadata,
            },
            { stripeAccount: seller, idempotencyKey: `coupon-${order.orderId}` },
          )
        : null;
    session = await stripe.checkout.sessions.create(
      {
        client_reference_id: order.orderId,
        ...(options.customerEmail && { customer_email: options.customerEmail }),
        metadata,
        ...(coupon && { discounts: [{ coupon: coupon.id }] }),
        integration_identifier: INTEGRATION_IDENTIFIER,
        line_items: partial || reverse || exact
          ? order.lines
              .filter((line) => line.dueNowMinor > 0)
              .map((line) => ({
                quantity: 1,
                price_data: {
                  currency,
                  unit_amount: line.dueNowMinor,
                  product_data: {
                    name: `${line.quantity > 1 ? `${line.quantity} × ` : ""}${line.title}${line.deposit ? ` (${depositLabel})` : ""}`,
                  },
                },
              }))
          : [
              ...order.lines.map((line) => ({
                quantity: line.quantity,
                price_data: {
                  currency,
                  unit_amount: line.unitPriceMinor,
                  product_data: { name: line.title },
                  ...(line.recurring && order.subscription && { recurring: recurring(order.subscription) }),
                },
              })),
              ...subscriptionShipping(order, currency, shippingLabel),
            ],
        ...(order.subscription
          ? // A subscription (D25): Stripe Billing on the store's account charges
            // each renewal. Shipping can only be a line here: the part that
            // renews, and any extra for items bought once.
            {
              mode: "subscription" as const,
              subscription_data: {
                metadata: { ...metadata, subscription_id: order.subscription.id },
                description: `Subscription ${order.number}`,
                ...(order.subscription.trialDays > 0 && { trial_period_days: order.subscription.trialDays }),
                ...(feeBps > 0 && { application_fee_percent: Math.round(feeBps) / 100 }),
              },
            }
          : {
              mode: "payment" as const,
              payment_intent_data: {
                metadata,
                description: `Order ${order.number}`,
                ...(fee !== null && { application_fee_amount: fee }),
                // A deposit keeps the card for a no-show fee staff may charge later (D66).
                ...(order.lines.some((line) => line.deposit) && { setup_future_usage: "off_session" as const }),
              },
              ...(order.lines.some((line) => line.deposit) && { customer_creation: "always" as const }),
            }),
        // A business's invoice needs its full address (Art. 226 point 5, D159): Stripe asks for a billing address, not only a postal code.
        ...(order.company && { billing_address_collection: "required" as const }),
        ...(order.ships && {
          shipping_address_collection: {
            allowed_countries: [
              (options.allowedCountry ?? shop.market.code) as Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry,
            ],
          },
        }),
        // Downloads only: no address to ask for and nothing to ship (D24).
        ...(order.ships &&
          !order.subscription && {
            shipping_options: [
              {
                shipping_rate_data: {
                  type: "fixed_amount",
                  display_name: order.deliveryLabel ?? shippingLabel,
                  fixed_amount: { amount: order.shippingMinor - order.shippingDiscountMinor - order.shippingReliefMinor, currency },
                },
              },
            ],
          }),
        // No payment_method_types: Stripe shows the methods the store has
        // turned on in its Stripe Dashboard that suit the shopper.
        // Subscriptions always get Stripe invoices; this is for single payments.
        // An invoice for part of an order would mislead: the store invoices the whole at the venue.
        // A host is the seller of their own bookings, so the store's invoices are not theirs (D71).
        ...(connection.orderInvoices &&
          !kaizenInvoices &&
          !options.orderEditId &&
          !order.subscription &&
          !partial &&
          !order.hostId && {
          invoice_creation: {
            enabled: true,
            invoice_data: {
              description: `Order ${order.number}`,
              metadata,
              ...(sellerLine && { footer: sellerLine }),
              // Stripe takes at most four custom fields.
              custom_fields: reverse
                ? reverseChargeFields(shop.market.lang, order)
                : [
                    {
                      name: VAT_LABELS[shop.market.lang] ?? "Incl. VAT",
                      value: formatMoney(order.taxMinor, order.currency, shop.market.locale),
                    },
                    // Bought for a business (B2B): whom for, as the invoice must say.
                    ...(order.company
                      ? [
                          { name: (COMPANY_LABELS[shop.market.lang] ?? COMPANY_LABELS.en).name, value: order.company.name.slice(0, 140) },
                          { name: (COMPANY_LABELS[shop.market.lang] ?? COMPANY_LABELS.en).number, value: order.company.number },
                        ]
                      : []),
                    // Consignments marked with the store's IOSS number (D157): VAT was collected at checkout.
                    ...(order.vatKind === "ioss" && order.treatment?.iossNumber
                      ? [{ name: "IOSS", value: order.treatment.iossNumber }]
                      : []),
                  ],
            },
          },
        }),
        ...(ui === "custom"
          ? // Stripe's form on Kaizen's page; its language is set in the browser.
            { ui_mode: "elements" as const, return_url: returnUrl }
          : {
              locale: stripeLocale(shop.market.lang) as Stripe.Checkout.SessionCreateParams.Locale,
              success_url: returnUrl,
              cancel_url: options.cancelUrl ?? `${base}/cart`,
            }),
        expires_at: Math.floor(Date.now() / 1000) + (options.expiresInSeconds ?? CHECKOUT_MINUTES * 60 + 60),
      },
      { stripeAccount: seller, idempotencyKey: options.idempotencyKey ?? `checkout-${order.orderId}` },
    );
  } catch {
    // The caller decides what becomes of the order: a checkout cancels it, the pay link of a draft leaves it as it was.
    return { ok: false, problem: "payment_error" };
  }

  // Which payment methods Stripe offers this shopper, for support questions.
  await db().execute(sql`
    insert into commerce.order_events (store_id, order_id, type, data, actor)
    values (${shop.storeId}::uuid, ${order.orderId}::uuid, 'payment.started',
            ${JSON.stringify({ ui, methods: session.payment_method_types ?? [] })}::jsonb, 'system')
  `);
  await db().execute(sql`
    insert into commerce.payments (
      store_id, order_id, provider, provider_reference, provider_account, client_secret, amount_minor, currency, status,
      kaizen_fee_minor, order_edit_id
    ) values (
      ${shop.storeId}::uuid, ${order.orderId}::uuid, 'stripe', ${session.id}, ${seller},
      ${ui === "custom" ? session.client_secret : null}, ${order.dueNowMinor}, ${order.currency}, 'pending',
      ${order.subscription ? 0 : (kaizenFee ?? 0)}, ${options.orderEditId ?? null}::uuid
    )
    on conflict (store_id, provider, provider_reference) do nothing
  `);

  if (ui === "custom") return session.client_secret ? { ok: true, url: `${base}/checkout`, sessionId: session.id } : { ok: false, problem: "payment_error" };
  if (!session.url) return { ok: false, problem: "payment_error" };
  return { ok: true, url: session.url, sessionId: session.id };
}
