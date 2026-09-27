import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { AddToCart } from "@/components/add-to-cart";
import { AppointmentPicker } from "@/components/appointment-picker";
import { RangePicker } from "@/components/range-picker";
import { SwitchToBusiness } from "@/components/buyer";
import { JsonLdScript } from "@/components/json-ld";
import { Price, VatAmount } from "@/components/price";
import { ProductBar } from "@/components/product-bar";
import { ProductGallery } from "@/components/product-gallery";
import { WishlistHeart } from "@/components/wishlist-heart";
import { PlanPrice, PurchaseOptions } from "@/components/purchase-options";
import { pickerLabels, rangePickerLabels } from "@/lib/booking-labels";
import { seasonPrice } from "@/lib/booking-prices";
import { rangeCalendar } from "@/lib/booking-ranges";
import { slotWeek } from "@/lib/booking-slots";
import { optionLabel, t, type Messages } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { formatMoney, minorUnitDigits } from "@/lib/money";
import { stockLevel } from "@/lib/pricing";
import { marketPath, storeSiteUrl } from "@/lib/paths";
import { schemaPrice, summarize } from "@/lib/seo";
import { productJsonLd } from "@/lib/structured-data";
import { planPrice } from "@/lib/subscriptions";
import { appointmentSlots, getAppointmentOffer } from "@/server/appointments";
import { getRangeOffer, getRangePricing, rangeDates } from "@/server/ranges";
import {
  getAvailability,
  getProduct,
  listProducts,
  type EconomicOperator,
  type ProductDetail,
} from "@/server/catalog";
import {
  getShippingFacts,
  listIndexedProducts,
  storeFacts,
  storeShareImage,
  storeShareTags,
} from "@/server/seo";
import { resolveShop } from "@/server/shop";
import type { Store } from "@/server/stores";

type Props = PageProps<"/s/[store]/[market]/p/[handle]">;

/**
 * Prerender every product known at build time, so its text, price and safety
 * details are plain HTML for shoppers and crawlers; only stock streams in.
 * Products added later are rendered on first visit and then cached.
 */
export async function generateStaticParams({
  params,
}: {
  params: { store: string; market: string };
}) {
  const shop = await resolveShop(params.store, params.market);
  const products = shop
    ? await listProducts(shop.store.id, shop.market.code, shop.market.locale)
    : [];
  // Cache Components needs at least one entry; "_" simply renders a 404.
  return products.length > 0
    ? products.map((product) => ({ handle: product.handle }))
    : [{ handle: "_" }];
}

async function load(params: Props["params"]) {
  const { store: storeSlug, market: marketSlug, handle } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) return null;
  const { store, market } = shop;
  const product = await getProduct(store.id, market.code, market.locale, handle);
  return product ? { store, market, product } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const loaded = await load(params);
  if (!loaded) return {};
  const { store, market, product } = loaded;
  const path = (m: Market) => marketPath(store.slug, m.slug, `/p/${product.handle}`);
  const title = product.seoTitle || product.title;
  const description =
    product.seoDescription ||
    summarize(product.description) ||
    t(market.lang).storeSummary(store.name, market.name);
  // The product's page in the other markets it is sold in.
  const indexed = (await listIndexedProducts(store.id)).find((p) => p.handle === product.handle);
  const markets = store.markets.filter((m) => indexed?.markets.includes(m.code) ?? m.code === market.code);
  const cheapest = product.variants[0].price;
  const digits = minorUnitDigits(cheapest.currency);
  return {
    // The owner's own search title is used as written; otherwise "Product · Store".
    title: product.seoTitle ? { absolute: product.seoTitle } : product.title,
    description,
    alternates: {
      canonical: path(market),
      languages: Object.fromEntries(markets.map((m) => [m.locale, path(m)])),
    },
    ...storeShareTags(store, market, {
      title,
      description,
      url: path(market),
      images:
        product.images.length > 0
          ? product.images.slice(0, 4).map((image) => ({ url: image.url, alt: image.alt || product.title }))
          : [storeShareImage(store, market.locale)],
    }),
    other: {
      "product:price:amount": schemaPrice(cheapest.amountMinor, digits),
      "product:price:currency": cheapest.currency,
    },
  };
}

export default function ProductPage({ params }: Props) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-surface" />}>
      <ProductDetails params={params} />
    </Suspense>
  );
}

async function ProductDetails({ params }: { params: Props["params"] }) {
  const loaded = await load(params);
  if (!loaded) notFound();
  const { store, market, product } = loaded;
  const m = t(market.lang);

  return (
    <article className="grid gap-8 md:grid-cols-2">
      {/* min-w-0: a long thumbnail strip scrolls inside the column instead of widening it. */}
      <div className="min-w-0">
        <Link href={marketPath(store.slug, market.slug)} className="text-sm underline">
          {m.backToProducts}
        </Link>
        <ProductGallery
          images={product.images}
          title={product.title}
          labels={{
            label: m.galleryLabel,
            previous: m.galleryPrevious,
            next: m.galleryNext,
            show: product.images.map((_, i) => m.galleryShow(i + 1)),
            slide: product.images.map((_, i) => m.gallerySlide(i + 1, product.images.length)),
          }}
        />
      </div>

      <div className="flex flex-col gap-6">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-3xl font-heading tracking-tight">{product.title}</h1>
          <WishlistHeart
            store={store.slug}
            market={market.slug}
            base={marketPath(store.slug, market.slug)}
            productId={product.id}
            placement="page"
            labels={{ save: m.wishlist.save(product.title), saved: m.wishlist.saved, removed: m.wishlist.removed }}
          />
        </div>
        <Price
          price={headlinePrice(product)}
          locale={market.locale}
          m={m}
          from={product.subscriptionOnly || new Set(product.variants.map((v) => v.price.amountMinor)).size > 1}
          large
        />

        {product.audience === "businesses" && (
          // Sold only to businesses (B2B): a private shopper is told so, and can switch.
          <div className="for-private flex flex-col items-start gap-3 rounded-lg border border-border p-4">
            <p>{m.buyer.businessOnly}</p>
            <SwitchToBusiness storeId={store.id} label={m.buyer.switchToBusiness} />
          </div>
        )}
        {product.hostName && <p className="text-sm">{m.stay.hostedBy(product.hostName)}</p>}
        {product.kind === "appointment" ? (
          // Booked for a time (D65): free times are read per request, like stock.
          <section aria-label={m.booking.chooseTime} className={product.audience === "businesses" ? "for-business" : ""}>
            <Suspense fallback={<p className="text-sm text-muted">{m.booking.loading}</p>}>
              <AppointmentBooking store={store} product={product} market={market} m={m} />
            </Suspense>
          </section>
        ) : product.kind === "stay" || product.kind === "rental" ? (
          // Booked for nights or days (D67): which are free is read per request, like stock.
          <section aria-label={m.stay.chooseDates} className={product.audience === "businesses" ? "for-business" : ""}>
            <Suspense fallback={<p className="text-sm text-muted">{m.booking.loading}</p>}>
              <RangeBooking store={store} product={product} market={market} m={m} />
            </Suspense>
          </section>
        ) : (
          <section aria-labelledby="variants-heading" className={product.audience === "businesses" ? "for-business" : ""}>
            <h2 id="variants-heading" className="mb-2 font-medium">
              {m.variants}
            </h2>
            <Suspense fallback={<p className="text-sm text-muted">{m.checkingStock}</p>}>
              <VariantsWithStock store={store} product={product} market={market} m={m} />
            </Suspense>
          </section>
        )}

        <section aria-labelledby="description-heading">
          <h2 id="description-heading" className="mb-2 font-medium">
            {m.description}
          </h2>
          <p>{product.description}</p>
          {product.kind === "appointment" ? (
            <p className="mt-2 text-sm">{m.booking.noWithdrawal}</p>
          ) : product.kind === "stay" || product.kind === "rental" ? (
            <p className="mt-2 text-sm">{m.stay.noWithdrawal(product.kind === "stay")}</p>
          ) : product.variants.some((v) => v.delivery === "digital") ? (
            <p className="mt-2 text-sm">{m.digitalWithdrawal}</p>
          ) : (
            product.withdrawalExclusion !== "none" && <p className="mt-2 text-sm">{m.noWithdrawal}</p>
          )}
        </section>

        {(product.safetyInformation || product.manufacturer || product.responsiblePerson) && (
          <section aria-labelledby="safety-heading" className="text-sm">
            <h2 id="safety-heading" className="mb-2 font-medium">
              {m.safety}
            </h2>
            {product.safetyInformation && <p className="mb-3">{product.safetyInformation}</p>}
            <dl className="grid gap-3">
              {product.manufacturer && (
                <Operator label={m.manufacturer} operator={product.manufacturer} />
              )}
              {product.responsiblePerson && (
                <Operator label={m.euResponsiblePerson} operator={product.responsiblePerson} />
              )}
            </dl>
          </section>
        )}
      </div>
    </article>
  );
}

/** The price beside the title: the cheapest, or the best subscriber's price when only subscriptions are sold. */
function headlinePrice(product: ProductDetail) {
  const cheapest = product.variants[0].price;
  if (!product.subscriptionOnly) return cheapest;
  const best = Math.max(...product.plans.map((plan) => plan.discountPercent));
  return { ...cheapest, amountMinor: planPrice(cheapest.amountMinor, best), referenceMinor: null };
}

function Operator({ label, operator }: { label: string; operator: EconomicOperator }) {
  return (
    <div>
      <dt className="font-medium">{label}</dt>
      <dd>
        {operator.name}, {operator.postalAddress}, {operator.electronicAddress}
      </dd>
    </div>
  );
}

/** An appointment's facts and free times (D65), read per request after the cached page shell. */
async function AppointmentBooking({
  store,
  product,
  market,
  m,
}: {
  store: Store;
  product: ProductDetail;
  market: Market;
  m: Messages;
}) {
  await connection();
  const [offer, week] = await Promise.all([
    getAppointmentOffer(store.id, product.id),
    appointmentSlots(store.id, product.id),
  ]);
  if (!store.bookingsOn || !offer || !week) return <p>{m.booking.notBookable}</p>;
  const facts = [
    m.booking.duration(offer.rules.durationMinutes),
    offer.staff.length === 1 && m.booking.withStaff(offer.staff[0].name),
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-1 text-sm">
        <div className="flex gap-2">
          <dt className="sr-only">{m.booking.time}</dt>
          <dd>{facts.join(" · ")}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="sr-only">{m.booking.atVenue}</dt>
          <dd>
            {[
              offer.payment.mode === "deposit" && m.booking.payDeposit(offer.payment.depositPercent),
              offer.payment.mode === "venue" && m.booking.payVenue,
              m.booking.freeCancel(offer.cancelHours),
            ]
              .filter(Boolean)
              .join(" ")}
          </dd>
        </div>
        {offer.place && (
          <div className="flex gap-2">
            <dt className="font-medium">{m.booking.where}:</dt>
            <dd>{[offer.place.name, offer.place.address].filter(Boolean).join(", ")}</dd>
          </div>
        )}
      </dl>
      <AppointmentPicker
        store={store.slug}
        market={market.slug}
        cartHref={marketPath(store.slug, market.slug, "/cart")}
        productId={product.id}
        variants={product.variants.map((variant) => ({
          id: variant.id,
          label: optionLabel(m, variant.options) || product.title,
          price: <Price price={variant.price} locale={market.locale} m={m} />,
        }))}
        staff={offer.staff}
        initial={slotWeek(week, market.locale, store.timeZone)}
        openCart={store.openCartOnAdd}
        labels={pickerLabels(m)}
      />
      <ProductJsonLd store={store} market={market} product={product} availability={new Map()} bookable />
    </div>
  );
}

/** A stay's or rental's facts and free dates (D67), read per request after the cached page shell. */
async function RangeBooking({
  store,
  product,
  market,
  m,
}: {
  store: Store;
  product: ProductDetail;
  market: Market;
  m: Messages;
}) {
  await connection();
  // The calendar opens for the first variant: by the day, or (a rental, D69) by the half day or hour.
  const firstPeriod = product.kind === "rental" ? (product.variants[0]?.rentalPeriod ?? "day") : "day";
  const [offer, month, pricing] = await Promise.all([
    getRangeOffer(store.id, product.id),
    rangeDates(store.id, product.id, null, undefined, firstPeriod),
    getRangePricing(store.id, product.id, market.code),
  ]);
  if (!store.bookingsOn || !offer || !month) return <p>{m.booking.notBookable}</p>;
  const stay = offer.kind === "stay";
  const { rules } = offer;
  // The fee and the seasons' prices (D70), for the variant by the night or day (else the first).
  const { seasons, feeMinor } = pricing;
  const shown = product.variants.find((v) => v.rentalPeriod === "day") ?? product.variants[0];
  const amount = (minor: number) => (
    <VatAmount amountMinor={minor} currency={shown.price.currency} locale={market.locale} vat={shown.price.vat} labels={m} label={false} />
  );
  const dayMonth = new Intl.DateTimeFormat(market.locale, { day: "numeric", month: "long", timeZone: "UTC" });
  const weekdayName = new Intl.DateTimeFormat(market.locale, { weekday: "short", timeZone: "UTC" });
  // Any year's date will do for a day of the year: a leap year keeps 29 February.
  const yearDay = (day: string) => dayMonth.format(new Date(`2028-${day}T12:00:00Z`));
  const weekdays = (days: number[]) =>
    days.length === 7 ? null : days.map((d) => weekdayName.format(new Date(Date.UTC(2028, 0, 2 + d, 12)))).join(", ");
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-1 text-sm">
        <div className="flex gap-2">
          <dt className="sr-only">{m.booking.time}</dt>
          <dd>
            {[
              m.stay.times(rules.checkInTime, rules.checkOutTime, stay),
              rules.minNights > 1 && m.stay.tooShort(rules.minNights, stay),
            ]
              .filter(Boolean)
              .join(" ")}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="sr-only">{m.booking.atVenue}</dt>
          <dd>
            {[
              offer.payment.mode === "deposit" && m.booking.payDeposit(offer.payment.depositPercent),
              offer.payment.mode === "venue" && m.booking.payVenue,
              m.stay.freeCancel(offer.cancelHours, stay),
            ]
              .filter(Boolean)
              .join(" ")}
          </dd>
        </div>
        {offer.place && (
          <div className="flex gap-2">
            <dt className="font-medium">{m.booking.where}:</dt>
            <dd>{[offer.place.name, offer.place.address].filter(Boolean).join(", ")}</dd>
          </div>
        )}
        {feeMinor > 0 && (
          <div className="flex gap-2">
            <dt>{stay ? m.stay.cleaningFee : m.stay.bookingFee}</dt>
            <dd>
              {amount(feeMinor)} {m.stay.perBooking(stay)}
            </dd>
          </div>
        )}
      </dl>
      {seasons.length > 0 && shown && (
        <section aria-labelledby="seasons-heading" className="text-sm">
          <h3 id="seasons-heading" className="mb-1 font-medium">
            {m.stay.seasonsHeading}
          </h3>
          <ul className="flex flex-col gap-1">
            {seasons.map((season, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-x-4">
                <span>
                  {season.name}
                  <span className="text-muted">
                    {" "}
                    ({[season.fromDay && season.toDay ? `${yearDay(season.fromDay)}–${yearDay(season.toDay)}` : m.stay.allYear, weekdays(season.weekdays)]
                      .filter(Boolean)
                      .join(", ")}
                    )
                  </span>
                </span>
                <span className="tabular-nums">
                  {amount(seasonPrice(shown.price.amountMinor, season.percent, shown.price.currency))} {m.stay.perNight(stay)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <RangePicker
        store={store.slug}
        market={market.slug}
        cartHref={marketPath(store.slug, market.slug, "/cart")}
        productId={product.id}
        kind={offer.kind}
        variants={product.variants.map((variant) => ({
          id: variant.id,
          label: optionLabel(m, variant.options) || product.title,
          price: <Price price={variant.price} locale={market.locale} m={m} />,
          period: variant.rentalPeriod,
        }))}
        initial={rangeCalendar(month, market.locale)}
        checkInTime={rules.checkInTime}
        timeZone={offer.timeZone}
        minNights={rules.minNights}
        maxNights={rules.maxNights}
        openCart={store.openCartOnAdd}
        labels={rangePickerLabels(m, stay, rules.minNights, rules.maxNights)}
      />
      <ProductJsonLd store={store} market={market} product={product} availability={new Map()} bookable />
    </div>
  );
}

/** Stock is read per request, so this renders after the cached page shell. */
async function VariantsWithStock({
  store,
  product,
  market,
  m,
}: {
  store: Store;
  product: ProductDetail;
  market: Market;
  m: Messages;
}) {
  const availability = await getAvailability(
    store.id,
    product.variants.map((v) => v.id),
  );
  const stockText = (available: number) => {
    const level = stockLevel(available);
    return level === "out" ? m.outOfStock : level === "low" ? m.lowStock(available) : m.inStock;
  };

  const plans = product.plans.map((plan) => ({
    id: plan.id,
    discountPercent: plan.discountPercent,
    label: m.planEvery(plan.interval, plan.intervalCount),
    note: [
      plan.discountPercent > 0 && m.planSave(plan.discountPercent),
      plan.trialDays > 0 && m.planTrial(plan.trialDays),
      plan.signupFeeMinor > 0 && m.planSignupFee(formatMoney(plan.signupFeeMinor, market.currency, market.locale)),
      plan.minCycles > 0 && m.planMinCycles(plan.minCycles),
    ]
      .filter(Boolean)
      .join(" · "),
  }));

  return (
    <PurchaseOptions
      plans={plans}
      subscriptionOnly={product.subscriptionOnly}
      labels={{ legend: m.purchaseOptions, oneTime: m.oneTimePurchase }}
    >
      <ul className="divide-y divide-border rounded-lg border border-border">
        {product.variants.map((variant) => {
          const digital = variant.delivery === "digital";
          const available = digital ? Infinity : (availability.get(variant.id) ?? 0);
          const label = optionLabel(m, variant.options);
          return (
            <li key={variant.id} className="flex items-start justify-between gap-4 p-3">
              <div>
                {label && <p>{label}</p>}
                <p className="text-sm text-muted">{digital ? m.instantDownload : stockText(available)}</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <PlanPrice
                  amountMinor={variant.price.amountMinor}
                  currency={variant.price.currency}
                  locale={market.locale}
                  vat={variant.price.vat}
                  labels={{ vatIncluded: m.vatIncluded, vatExcluded: m.vatExcluded }}
                >
                  <Price price={variant.price} locale={market.locale} m={m} />
                </PlanPrice>
                <AddToCart
                  store={store.slug}
                  market={market.slug}
                  cartHref={marketPath(store.slug, market.slug, "/cart")}
                  variantId={variant.id}
                  disabled={available <= 0}
                  openCart={store.openCartOnAdd}
                  labels={{
                    addToCart: m.addToCart,
                    adding: m.adding,
                    added: m.added,
                    capped: m.capped,
                    unavailable: m.unavailable,
                    planConflict: m.planConflict,
                    tryAgain: m.tryAgain,
                    goToCart: m.goToCart,
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <ProductBar
        store={store.slug}
        market={market.slug}
        cartHref={marketPath(store.slug, market.slug, "/cart")}
        currency={market.currency}
        locale={market.locale}
        vat={product.variants[0].price.vat}
        storeAudience={store.audience}
        openCart={store.openCartOnAdd}
        variants={product.variants.map((variant) => ({
          id: variant.id,
          label: optionLabel(m, variant.options) || product.title,
          amountMinor: variant.price.amountMinor,
          available: variant.delivery === "digital" || (availability.get(variant.id) ?? 0) > 0,
        }))}
        labels={{
          addToCart: m.addToCart,
          adding: m.adding,
          added: m.added,
          capped: m.capped,
          unavailable: m.unavailable,
          planConflict: m.planConflict,
          tryAgain: m.tryAgain,
          goToCart: m.goToCart,
          chooseVariant: m.chooseVariantLabel,
          soldOut: m.soldOut,
          goCart: m.goCart,
        }}
      />
      <ProductJsonLd store={store} market={market} product={product} availability={availability} />
    </PurchaseOptions>
  );
}


/** Stock is part of the offer, so this renders with the stock, per request. */
async function ProductJsonLd({
  store,
  market,
  product,
  availability,
  bookable = false,
}: {
  store: Store;
  market: Market;
  product: ProductDetail;
  availability: Map<string, number>;
  /** An appointment with times to book (D65): offered as in stock. */
  bookable?: boolean;
}) {
  const origin = storeSiteUrl(store.slug);
  const m = t(market.lang);
  const labels = m.options as Record<string, string>;
  const shipping = await getShippingFacts(store.id, market.code);
  return (
    <JsonLdScript
      data={productJsonLd({
        product: {
          ...product,
          description: product.seoDescription || product.description,
          // Option names and values as shoppers read them ("Farge: Hvit").
          variants: product.variants.map((variant) => ({
            ...variant,
            // Sold only by subscription: the subscriber's price is the price.
            price: product.subscriptionOnly
              ? { ...variant.price, amountMinor: headlinePrice({ ...product, variants: [variant] }).amountMinor }
              : variant.price,
            options: Object.fromEntries(
              Object.entries(variant.options).map(([name, value]) => [labels[name] ?? name, labels[value] ?? value]),
            ),
          })),
        },
        url: `${origin}${marketPath(store.slug, market.slug, `/p/${product.handle}`)}`,
        origin,
        store: storeFacts(store),
        market,
        marketHome: `${origin}${marketPath(store.slug, market.slug)}`,
        inStock: (variantId) => bookable || (availability.get(variantId) ?? 0) > 0,
        shipping,
      })}
    />
  );
}
