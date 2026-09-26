import Image from "next/image";
import Link from "next/link";

import { CheckoutButton } from "@/components/checkout-button";
import { DiscountCodeForm } from "@/components/discount-code-form";
import { companyRequired, withoutVat } from "@/lib/b2b";
import { cartSubtotal, MAX_LINE_QUANTITY } from "@/lib/cart";
import { vatIncluded } from "@/lib/checkout";
import { basketShipping } from "@/lib/subscriptions";
import { checkoutLabels } from "@/lib/checkout-labels";
import { optionLabel, type Messages } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { marketPath } from "@/lib/paths";
import { formatMoney } from "@/lib/money";
import { getBuyer } from "@/server/b2b";
import { getCart, type CartLine } from "@/server/cart";
import { getCustomer } from "@/server/customers";
import { previewCartDiscount } from "@/server/discounts";
import { getCheckoutInfo } from "@/server/orders";
import type { Store } from "@/server/stores";

import { updateCartLine } from "./actions";

/**
 * The shopper's cart: its lines, summary and way to checkout. The cart page
 * shows it, and on phones the slide-out cart (`@drawer/(.)cart`) too.
 */
export async function CartContents({
  store,
  market,
  m,
  drawer = false,
}: {
  store: Store;
  market: Market;
  m: Messages;
  /** In the slide-out cart (D64): narrower, so smaller pictures and the summary without a frame. */
  drawer?: boolean;
}) {
  const [cart, buyer] = await Promise.all([getCart({ storeId: store.id, market }), getBuyer(store)]);
  const home = marketPath(store.slug, market.slug);

  if (cart.lines.length === 0) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p>{m.emptyCart}</p>
        <Link href={home} className="underline">
          {m.continueShopping}
        </Link>
      </div>
    );
  }

  const payable = cart.lines.filter(
    (line): line is CartLine & { unitPriceMinor: number } =>
      line.status !== "unavailable" && line.unitPriceMinor !== null,
  );
  const blocked = cart.lines.some((line) => line.status !== "ok");
  const checkout = await getCheckoutInfo(store.id, market.code);
  const plan = payable.find((line) => line.plan)?.plan ?? null;
  // In a free trial, what renews costs nothing today (D29).
  const trial = (plan?.trialDays ?? 0) > 0;
  const today = (line: CartLine & { unitPriceMinor: number }) => (trial && line.plan ? 0 : line.unitPriceMinor * line.quantity);
  // One sign-up fee per purchase option (D29).
  const fees = [...new Map(payable.filter((l) => l.plan && l.plan.signupFeeMinor > 0).map((l) => [l.plan!.id, l.plan!.signupFeeMinor])).values()];
  const feeMinor = fees.reduce((sum, fee) => sum + fee, 0);
  const subtotal = cartSubtotal(payable.map((line) => ({ unitPriceMinor: today(line), quantity: 1 })));
  // Downloads alone need no shipping (D24); a subscription pays it per delivery (D25).
  const ships = cart.lines.some((line) => line.delivery === "physical");
  const digital = cart.lines.some((line) => line.delivery === "digital");
  const basket = basketShipping(
    payable.map((line) => ({
      totalMinor: line.unitPriceMinor * line.quantity,
      delivery: line.delivery,
      recurring: line.plan !== null,
    })),
    checkout.shipping,
    { trial },
  );
  const shipping = !ships ? 0 : checkout.shipping ? basket.first : null;
  // The discount code, checked against this basket as checkout will (D31).
  const code = await previewCartDiscount(
    { storeId: store.id, market },
    {
      lines: payable.map((line, i) => ({
        key: String(i),
        productId: line.productId,
        unitMinor: line.unitPriceMinor,
        quantity: line.quantity,
        todayMinor: today(line),
        recurring: line.plan !== null,
      })),
      shippingMinor: shipping ?? 0,
    },
  );
  const applied = code?.ok ? code.applied : null;
  const discountMinor = applied?.totalMinor ?? 0;
  // A recurring percentage lowers what each renewal costs, and so its shipping.
  const renewUnit = (line: (typeof payable)[number], i: number) => applied?.renewalUnits[String(i)] ?? line.unitPriceMinor;
  const renewing = payable
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => line.plan)
    .reduce((sum, { line, i }) => sum + renewUnit(line, i) * line.quantity, 0);
  const renewalShipping =
    applied && Object.keys(applied.renewalUnits).length > 0
      ? basketShipping(
          payable.map((line, i) => ({
            totalMinor: renewUnit(line, i) * line.quantity,
            delivery: line.delivery,
            recurring: line.plan !== null,
          })),
          checkout.shipping,
          { trial },
        ).renewal
      : basket.renewal;
  const renewal = plan ? renewing + renewalShipping : null;
  const every = plan ? m.planEvery(plan.interval, plan.intervalCount) : "";
  // Businesses see amounts without VAT, and the VAT on its own line (B2B); they pay the total with it.
  const business = buyer === "business";
  const money = (minor: number) => formatMoney(minor, cart.currency, market.locale);
  const net = (minor: number) => money(business ? withoutVat(minor, checkout.vatRate) : minor);
  const total = subtotal + feeMinor + (shipping ?? 0) - discountMinor;
  // A signed-in business customer's saved company fills the fields in.
  const saved = business && !cart.company ? await getCustomer(store.id) : null;
  const companyNeeded = companyRequired(store.audience, cart.lines.map((line) => line.audience));
  const company = cart.company ?? { name: saved?.companyName ?? "", number: saved?.organisationNumber ?? "" };
  // The subscription's terms, said the same way in the summary and the consent (D29).
  const terms = plan
    ? [
        m.renewsEvery(every, money(renewal ?? 0)),
        plan.trialDays > 0 && m.trialNote(plan.trialDays),
        plan.minCycles > 0 && m.commitmentNote(plan.minCycles),
      ]
        .filter(Boolean)
        .join(" ")
    : null;

  return (
    // minmax(0, …): nothing inside may make a column wider than the screen.
    <div className={`grid grid-cols-[minmax(0,1fr)] ${drawer ? "gap-4" : "gap-8 md:grid-cols-[minmax(0,1fr)_18rem]"}`}>
      <ul className={`divide-y divide-border border-border ${drawer ? "border-b" : "border-y"}`}>
        {cart.lines.map((line) => (
          <li key={`${line.variantId}:${line.plan?.id ?? ""}`} className={`flex py-4 ${drawer ? "gap-3" : "gap-4"}`}>
            {line.image && (
              <Image
                src={line.image.url}
                alt={line.image.alt}
                width={96}
                height={96}
                unoptimized
                className={`${drawer ? "size-16" : "size-24"} shrink-0 rounded-md bg-surface object-cover`}
              />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex justify-between gap-4">
                <div className="min-w-0">
                  <Link href={`${home}/p/${line.handle}`} className="font-medium underline-offset-2 hover:underline">
                    {line.title}
                  </Link>
                  {Object.keys(line.options).length > 0 && (
                    <p className="text-sm text-muted">{optionLabel(m, line.options)}</p>
                  )}
                  {line.delivery === "digital" && <p className="text-sm text-muted">{m.digitalDelivery}</p>}
                  {line.plan && (
                    <p className="text-sm text-muted">
                      {m.subscription}: {m.planEvery(line.plan.interval, line.plan.intervalCount).toLowerCase()}
                      {line.plan.discountPercent > 0 && ` · ${m.planSave(line.plan.discountPercent)}`}
                    </p>
                  )}
                </div>
                {line.unitPriceMinor !== null && line.status !== "unavailable" && (
                  <p className="shrink-0 text-right font-medium whitespace-nowrap">
                    {trial && line.plan ? (
                      <>
                        {money(0)}
                        <span className="block text-sm font-normal text-muted">
                          {m.planTrial(line.plan.trialDays)}, {net(line.unitPriceMinor * line.quantity)}
                        </span>
                      </>
                    ) : (
                      net(line.unitPriceMinor * line.quantity)
                    )}
                  </p>
                )}
              </div>

              {line.status === "insufficient" && (
                <p role="alert" className="text-sm">{m.onlyAvailable(line.available)}</p>
              )}
              {line.status === "unavailable" && (
                <p role="alert" className="text-sm">{m.noLongerAvailable}</p>
              )}

              <div className="flex flex-wrap items-end gap-2">
                {line.status !== "unavailable" && (
                  <form action={updateCartLine} className="flex items-end gap-2">
                    <input type="hidden" name="store" value={store.slug} />
                  <input type="hidden" name="market" value={market.slug} />
                    <input type="hidden" name="variantId" value={line.variantId} />
                    {line.plan && <input type="hidden" name="sellingPlanId" value={line.plan.id} />}
                    <label className="flex flex-col text-sm">
                      {m.quantity}
                      <input
                        type="number"
                        name="quantity"
                        min={0}
                        max={MAX_LINE_QUANTITY}
                        defaultValue={line.quantity}
                        className={`min-h-11 ${drawer ? "w-16" : "w-20"} rounded-md border border-border bg-background px-2`}
                      />
                    </label>
                    <button type="submit" className="min-h-11 rounded-md border border-border px-3 text-sm">
                      {m.update}
                    </button>
                  </form>
                )}
                <form action={updateCartLine}>
                  <input type="hidden" name="store" value={store.slug} />
                  <input type="hidden" name="market" value={market.slug} />
                  <input type="hidden" name="variantId" value={line.variantId} />
                  {line.plan && <input type="hidden" name="sellingPlanId" value={line.plan.id} />}
                  <input type="hidden" name="quantity" value="0" />
                  {/* In the drawer it lines up with the quantity when it wraps under it. */}
                  <button type="submit" className={`min-h-11 text-sm underline ${drawer ? "px-1" : "px-3"}`}>
                    {m.remove}
                    <span className="sr-only">: {line.title}</span>
                  </button>
                </form>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <aside
        aria-label={m.subtotal}
        className={`flex h-fit min-w-0 flex-col gap-3 ${drawer ? "" : "rounded-lg border border-border p-4"}`}
      >
        <dl className="flex flex-col gap-2">
          <div className="flex justify-between gap-4">
            <dt>{m.subtotal}</dt>
            <dd>{net(subtotal)}</dd>
          </div>
          {feeMinor > 0 && (
            <div className="flex justify-between gap-4">
              <dt>{m.signupFee}</dt>
              <dd>{net(feeMinor)}</dd>
            </div>
          )}
          {shipping !== null && ships && (
            <div className="flex justify-between gap-4">
              <dt>
                {m.shipping}
                {basket.renewal > 0 && <span className="text-sm text-muted"> {m.perDelivery}</span>}
              </dt>
              <dd>{shipping === 0 ? m.freeShipping : net(shipping)}</dd>
            </div>
          )}
          {discountMinor > 0 && code && (
            <div className="flex justify-between gap-4">
              <dt>
                {m.discount} <span className="text-sm text-muted">({code.code})</span>
              </dt>
              <dd>−{net(discountMinor)}</dd>
            </div>
          )}
          {business && (
            <>
              <div className="flex justify-between gap-4 border-t border-border pt-2">
                <dt>{m.totalExclVat}</dt>
                <dd>{money(withoutVat(total, checkout.vatRate))}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>{m.vatLine}</dt>
                <dd>{money(vatIncluded(total, checkout.vatRate))}</dd>
              </div>
            </>
          )}
          <div className="flex justify-between gap-4 border-t border-border pt-2 font-semibold">
            <dt>{business ? m.toPay : m.total}</dt>
            <dd>{money(total)}</dd>
          </div>
        </dl>
        {(!business || shipping === null) && (
          <p className="text-sm text-muted">
            {[!business && m.vatIncluded, shipping === null && m.shippingAtCheckout].filter(Boolean).join(" · ")}
          </p>
        )}
        {terms && <p className="text-sm">{terms}</p>}
        {applied && Object.keys(applied.renewalUnits).length > 0 && <p className="text-sm">{m.discountRenews}</p>}
        <DiscountCodeForm
          store={store.slug}
          market={market.slug}
          code={code?.code ?? null}
          problem={
            code && !code.ok
              ? code.problem === "minimum" && code.minimumMinor
                ? `${m.minimumFor} ${money(code.minimumMinor)}.`
                : m.codeProblems[code.problem]
              : null
          }
          labels={{ code: m.discountCode, apply: m.applyCode, remove: m.removeCode, applying: m.savingChange }}
        />
        {checkout.paymentsOn ? (
          <CheckoutButton
            store={store.slug}
            market={market.slug}
            disabled={blocked}
            labels={checkoutLabels(m)}
            company={{
              // Asked of businesses, and of anyone whose order needs it.
              ask: business || companyNeeded,
              required: companyNeeded,
              name: company.name,
              number: company.number,
              labels: m.company,
            }}
            consents={{
              digital: digital ? m.digitalConsent : undefined,
              subscription:
                renewal !== null && plan
                  ? [
                      m.subscriptionConsent(every, money(renewal)),
                      plan.trialDays > 0 && m.trialNote(plan.trialDays),
                      plan.minCycles > 0 && m.commitmentNote(plan.minCycles),
                    ]
                      .filter(Boolean)
                      .join(" ")
                  : undefined,
            }}
          />
        ) : (
          <p className="text-sm">{m.checkoutUnavailable}</p>
        )}
        {blocked && <p className="text-sm">{m.noLongerAvailable}</p>}
      </aside>
    </div>
  );
}
