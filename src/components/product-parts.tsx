import Link from "next/link";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";

import { AppointmentPicker } from "@/components/appointment-picker";
import { SwitchToBusiness } from "@/components/buyer";
import { CampaignNotices } from "@/components/campaign-notice";
import { CustomFieldGroups, CustomFieldView } from "@/components/custom-fields-view";
import { JsonLdScript } from "@/components/json-ld";
import { PageArticle } from "@/components/page-article";
import { HEADING_SIZES } from "@/components/page-block";
import { Price, VatAmount } from "@/components/price";
import { ProductBar } from "@/components/product-bar";
import { ProductGallery } from "@/components/product-gallery";
import { ProductGrid } from "@/components/product-listing";
import { PlanAmount, PlanPrice, PurchaseOptions } from "@/components/purchase-options";
import { RangePicker } from "@/components/range-picker";
import { VariantChoice, VariantPurchase } from "@/components/variant-choice";
import { VariantFields } from "@/components/variant-fields";
import { WishlistHeart } from "@/components/wishlist-heart";
import { noticesFor, type CampaignNotices as Notices } from "@/lib/campaign-notices";
import { percentText } from "@/lib/customer-tiers";
import { pickerLabels, rangePickerLabels } from "@/lib/booking-labels";
import { seasonName, seasonPrice } from "@/lib/booking-prices";
import { rangeCalendar } from "@/lib/booking-ranges";
import { slotWeek } from "@/lib/booking-slots";
import { structuredProperties } from "@/lib/custom-fields";
import { bindPage } from "@/lib/field-binding";
import { FieldLoopView } from "@/components/field-loop-view";
import { loopHeading, loopOf, loopShows, productLoopConfig } from "@/lib/field-loop";
import { fieldHeading, fieldToShow, groupHeading, groupsToShow } from "@/lib/field-parts";
import { optionLabel, t, type Messages } from "@/lib/i18n";
import { MAX_LINE_QUANTITY } from "@/lib/cart";
import { inView, type Market } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import type { PageContent, ProductBlock } from "@/lib/page-content";
import { localizePage } from "@/lib/page-translation";
import { marketPath, storeSiteUrl } from "@/lib/paths";
import type { VariantStock } from "@/lib/stock-availability";
import { canOffer, stockNote } from "@/lib/stock-words";
import { productJsonLd } from "@/lib/structured-data";
import { planPrice } from "@/lib/subscriptions";
import { unitLabelsOf } from "@/lib/unit-price-text";
import { db } from "@/db/client";
import { memberDiscountFor } from "@/server/customer-tiers";
import { getCustomer } from "@/server/customers";
import { appointmentSlots, getAppointmentOffer } from "@/server/appointments";
import { getVariantStock, type EconomicOperator, type ProductDetail } from "@/server/catalog";
import { relatedProducts } from "@/server/listing";
import { getRangeOffer, getRangePricing, rangeDates } from "@/server/ranges";
import { getShippingFacts, storeFacts } from "@/server/seo";
import type { Store } from "@/server/stores";

/**
 * The parts of a product's page (D79), each drawn where a product layout
 * places its product component: the back link, pictures, title (with the
 * wishlist heart), price, the business-only notice, the host, the buy
 * section (variants with stock for goods, times for appointments, dates for
 * stays and rentals), the description, the right of withdrawal, product
 * safety, related products and the store's custom fields (D118). The text parts are the page's cached shell;
 * what depends on the request (stock, free times and dates) streams in
 * inside the buy section's own `<Suspense>`, so the details stay plain HTML
 * (a finished boundary moves out of line once the page passes ~12 kB).
 */

export type ProductPageContext = {
  store: Store;
  market: Market;
  product: ProductDetail;
  m: Messages;
  /** The store's All products page (D83), which the back link returns to; else the market's front page. */
  back?: { href: string; title: string } | null;
  /** The store's campaigns (D115), announced on the page and on its related products' cards. */
  campaigns?: Notices;
};

export function ProductPartView({ block, ctx }: { block: ProductBlock; ctx: ProductPageContext }) {
  const { store, market, product, m } = ctx;
  const base = marketPath(store.slug, market.slug);
  const headingId = `${block.id}-heading`;
  const heading = (fallback: string) =>
    block.showHeading === false ? null : (
      <h2 id={headingId} className="mb-2 font-medium">
        {block.heading || fallback}
      </h2>
    );
  const labelledBy = block.showHeading === false ? undefined : headingId;
  const forBusiness = product.audience === "businesses" ? "for-business" : "";

  switch (block.part) {
    case "back":
      return (
        <Link href={ctx.back?.href ?? base} className="text-sm underline">
          {ctx.back ? m.backTo(ctx.back.title) : m.backToProducts}
        </Link>
      );
    case "gallery": {
      const images = galleryImages(product);
      return (
        <ProductGallery
          images={images}
          productId={product.id}
          title={product.title}
          thumbnails={block.thumbnails !== false}
          labels={{
            label: m.galleryLabel,
            previous: m.galleryPrevious,
            next: m.galleryNext,
            show: images.map((_, i) => m.galleryShow(i + 1)),
            slide: images.map((_, i) => m.gallerySlide(i + 1, images.length)),
          }}
        />
      );
    }
    case "title":
      return (
        <div className="flex items-start justify-between gap-4">
          <h1 className={`${block.size ? HEADING_SIZES[block.size] : "text-3xl"} flex-1 font-heading tracking-tight`}>{product.title}</h1>
          {block.wishlist !== false && (
            <WishlistHeart
              store={store.slug}
              market={market.slug}
              base={base}
              productId={product.id}
              placement="page"
              labels={{ save: m.wishlist.save(product.title), saved: m.wishlist.saved, removed: m.wishlist.removed }}
            />
          )}
        </div>
      );
    case "price":
      return (
        <Price
          price={headlinePrice(product)}
          locale={market.locale}
          m={m}
          from={product.subscriptionOnly || new Set(product.variants.map((v) => v.price.amountMinor)).size > 1}
          large={block.large !== false}
        />
      );
    case "campaigns":
      return <CampaignNotices notices={noticesFor(ctx.campaigns, product.id)} market={market} m={m} />;
    case "notice":
      // Sold only to businesses (B2B): a private shopper is told so, and can switch.
      if (product.audience !== "businesses") return null;
      return (
        <div className="for-private flex flex-col items-start gap-3 rounded-lg border border-border p-4">
          <p>{m.buyer.businessOnly}</p>
          <SwitchToBusiness storeId={store.id} label={m.buyer.switchToBusiness} />
        </div>
      );
    case "host":
      return product.hostName ? <p className="text-sm">{m.stay.hostedBy(product.hostName)}</p> : null;
    case "buy":
      if (product.kind === "appointment") {
        // Booked for a time (D65): free times are read per request, like stock.
        return (
          <section aria-label={m.booking.chooseTime} className={forBusiness}>
            <Suspense fallback={<p className="text-sm text-muted">{m.booking.loading}</p>}>
              <MemberNotice store={store} m={m} />
              <AppointmentBooking store={store} product={product} market={market} m={m} />
            </Suspense>
          </section>
        );
      }
      if (product.kind === "stay" || product.kind === "rental") {
        // Booked for nights or days (D67): which are free is read per request, like stock.
        return (
          <section aria-label={m.stay.chooseDates} className={forBusiness}>
            <Suspense fallback={<p className="text-sm text-muted">{m.booking.loading}</p>}>
              <MemberNotice store={store} m={m} />
              <RangeBooking store={store} product={product} market={market} m={m} />
            </Suspense>
          </section>
        );
      }
      return (
        <section aria-labelledby={headingId} className={forBusiness}>
          <h2 id={headingId} className="mb-2 font-medium">
            {m.variants}
          </h2>
          <Suspense fallback={<p className="text-sm text-muted">{m.checkingStock}</p>}>
            <MemberNotice store={store} m={m} />
            <VariantsWithStock store={store} product={product} market={market} m={m} />
          </Suspense>
        </section>
      );
    case "description":
      if (!product.description) return null;
      return (
        <section aria-labelledby={labelledBy}>
          {heading(m.description)}
          <p>{product.description}</p>
        </section>
      );
    case "withdrawal": {
      const text = withdrawalText(product, m);
      return text ? <p className="text-sm">{text}</p> : null;
    }
    case "safety":
      if (!product.safetyInformation && !product.manufacturer && !product.responsiblePerson) return null;
      return (
        <section aria-labelledby={labelledBy} className="text-sm">
          {heading(m.safety)}
          {product.safetyInformation && <p className="mb-3">{product.safetyInformation}</p>}
          <dl className="grid gap-3">
            {product.manufacturer && <Operator label={m.manufacturer} operator={product.manufacturer} />}
            {product.responsiblePerson && <Operator label={m.euResponsiblePerson} operator={product.responsiblePerson} />}
          </dl>
        </section>
      );
    case "related":
      return <Related block={block} ctx={ctx} />;
    case "fields": {
      // The store's own fields (D120): the same on every product, and no variant has any.
      if (block.source === "store") {
        return (
          <CustomFieldGroups
            groups={groupsToShow(product.storeFields, block.groupId)}
            display={block.display}
            showLabel={block.showLabel !== false}
            idPrefix={block.id}
            headingFor={(group) => groupHeading(block, group, Boolean(block.groupId))}
          />
        );
      }
      // The store's public custom fields (D118): the group chosen, else every group that applies, each under its name;
      // then the chosen variant's own (they follow the picker).
      const groups = groupsToShow(product.fields, block.groupId);
      return (
        <>
          <CustomFieldGroups
            groups={groups}
            display={block.display}
            showLabel={block.showLabel !== false}
            idPrefix={block.id}
            headingFor={(group) => groupHeading(block, group, Boolean(block.groupId))}
          />
          <VariantFieldsPart
            product={product}
            panel={(fields, id) => (
              <CustomFieldGroups
                groups={groupsToShow(fields, block.groupId)}
                display={block.display}
                showLabel={block.showLabel !== false}
                idPrefix={`${block.id}-${id}`}
                headingFor={(group) => groupHeading(block, group, Boolean(block.groupId))}
              />
            )}
            has={(fields) => groupsToShow(fields, block.groupId).length > 0}
          />
        </>
      );
    }
    case "field": {
      if (block.source === "store") {
        const own = fieldToShow(product.storeFields, block.fieldId);
        return own ? (
          <CustomFieldView field={own} display={block.display} showLabel={block.showLabel !== false} heading={fieldHeading(block)} id={headingId} />
        ) : null;
      }
      const field = fieldToShow(product.fields, block.fieldId);
      const own = field ? (
        <CustomFieldView field={field} display={block.display} showLabel={block.showLabel !== false} heading={fieldHeading(block)} id={headingId} />
      ) : null;
      return (
        <>
          {own}
          <VariantFieldsPart
            product={product}
            panel={(fields, id) => {
              const chosen = fieldToShow(fields, block.fieldId);
              return chosen ? (
                <CustomFieldView field={chosen} display={block.display} showLabel={block.showLabel !== false} heading={fieldHeading(block)} id={`${headingId}-${id}`} />
              ) : null;
            }}
            has={(fields) => fieldToShow(fields, block.fieldId) !== null}
          />
        </>
      );
    }
    case "loop": {
      // A repeater's rows of the product, each as a card, list line or column (D120).
      const config = productLoopConfig(block);
      return (
        <FieldLoopView
          rows={loopOf(product.fields, config)}
          layout={config.layout}
          columns={config.columns}
          linkWholeCard={config.linkWholeCard}
          heading={loopHeading(config)}
          id={headingId}
        />
      );
    }
  }
}

/**
 * The variants' own fields (D118, phase 2) for a component that shows fields:
 * each variant's drawn by the server, the chosen one shown in the browser.
 * Draws nothing when no variant has anything for the component.
 */
function VariantFieldsPart({
  product,
  panel,
  has,
}: {
  product: ProductDetail;
  panel: (fields: ProductDetail["fields"], variantId: string) => ReactNode;
  has: (fields: ProductDetail["fields"]) => boolean;
}) {
  const withFields = product.variants.filter((variant) => has(product.variantFields[variant.id] ?? []));
  if (withFields.length === 0) return null;
  return (
    <VariantFields
      productId={product.id}
      initial={(withFields.find((variant) => variant.id === product.variants[0].id) ?? product.variants[0]).id}
      panels={Object.fromEntries(withFields.map((variant) => [variant.id, panel(product.variantFields[variant.id], variant.id)]))}
    />
  );
}

/** The product's pictures, or its variants' own (D82) when it has none. */
function galleryImages(product: ProductDetail): ProductDetail["images"] {
  if (product.images.length > 0) return product.images;
  const pictures = product.variants.flatMap((variant) => (variant.image ? [{ ...variant.image, alt: "" }] : []));
  return pictures.filter((picture, i) => pictures.findIndex((p) => p.url === picture.url) === i);
}

/** Whether a part has anything to show for this product; one that has not is left out, space and all. */
export function productPartShows(block: ProductBlock, product: ProductDetail, campaigns?: Notices): boolean {
  switch (block.part) {
    case "campaigns":
      return noticesFor(campaigns, product.id).length > 0;
    case "gallery":
      return galleryImages(product).length > 0;
    case "notice":
      return product.audience === "businesses";
    case "host":
      return Boolean(product.hostName);
    case "description":
      return Boolean(product.description);
    case "withdrawal":
      return withdrawalText(product, t("en")) !== null;
    case "safety":
      return Boolean(product.safetyInformation || product.manufacturer || product.responsiblePerson);
    case "fields":
      if (block.source === "store") return groupsToShow(product.storeFields, block.groupId).length > 0;
      return (
        groupsToShow(product.fields, block.groupId).length > 0 ||
        Object.values(product.variantFields).some((groups) => groupsToShow(groups, block.groupId).length > 0)
      );
    case "field":
      if (block.source === "store") return fieldToShow(product.storeFields, block.fieldId) !== null;
      return (
        fieldToShow(product.fields, block.fieldId) !== null ||
        Object.values(product.variantFields).some((groups) => fieldToShow(groups, block.fieldId) !== null)
      );
    case "loop":
      return loopShows(product.fields, productLoopConfig(block));
    default:
      return true;
  }
}

/** The line on the right of withdrawal: none for ordinary goods, which can be sent back. */
function withdrawalText(product: ProductDetail, m: Messages): string | null {
  return product.kind === "appointment"
    ? m.booking.noWithdrawal
    : product.kind === "stay" || product.kind === "rental"
      ? m.stay.noWithdrawal(product.kind === "stay")
      : product.variants.some((v) => v.delivery === "digital")
        ? m.digitalWithdrawal
        : product.withdrawalExclusion !== "none"
          ? m.noWithdrawal
          : null;
}

/** Products like this one (D79), as the store's product cards. */
async function Related({ block, ctx }: { block: ProductBlock; ctx: ProductPageContext }) {
  const { store, market, product, m } = ctx;
  const products = await relatedProducts(store.id, market, product.id, block.limit ?? 4);
  if (products.length === 0) return null;
  const headingId = `${block.id}-heading`;
  return (
    <section aria-labelledby={block.showHeading === false ? undefined : headingId} aria-label={block.showHeading === false ? m.related : undefined}>
      {block.showHeading !== false && (
        <h2 id={headingId} className="mb-4 text-xl font-heading">
          {block.heading || m.related}
        </h2>
      )}
      <ProductGrid
        products={products}
        market={market}
        m={m}
        store={store.slug}
        base={marketPath(store.slug, market.slug)}
        columns={block.columns ?? { mobile: 2, tablet: 4, desktop: 4 }}
        notices={ctx.campaigns}
      />
    </section>
  );
}

/** The page's structured data (JSON-LD), with stock, per request: drawn once, whatever the layout holds. */
export async function ProductJsonLdSection({ store, market, product }: Omit<ProductPageContext, "m">) {
  if (product.kind !== "goods") return <ProductJsonLd store={store} market={market} product={product} availability={new Map()} bookable />;
  await connection();
  const availability = await getVariantStock(
    store.id,
    product.variants.map((v) => v.id),
  );
  return <ProductJsonLd store={store} market={market} product={product} availability={availability} />;
}

/** The price beside the title: the cheapest, or the best subscriber's price when only subscriptions are sold. */
export function headlinePrice(product: ProductDetail) {
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
          image: variant.image,
        }))}
        staff={offer.staff}
        initial={slotWeek(week, market.locale, store.timeZone)}
        openCart={store.openCartOnAdd}
        labels={pickerLabels(m)}
      />
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
    getRangePricing(store.id, product.id, market.code, market),
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
                  {seasonName(season, market.locale)}
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
          image: variant.image,
          period: variant.rentalPeriod,
          base: { amountMinor: variant.price.amountMinor, currency: variant.price.currency, vat: variant.price.vat },
        }))}
        pricing={pricing}
        locale={market.locale}
        initial={rangeCalendar(month, market.locale)}
        checkInTime={rules.checkInTime}
        timeZone={offer.timeZone}
        minNights={rules.minNights}
        maxNights={rules.maxNights}
        openCart={store.openCartOnAdd}
        labels={rangePickerLabels(m, stay, rules.minNights, rules.maxNights)}
      />
    </div>
  );
}

/** Stock is read per request, so this renders after the cached page shell. */
/**
 * What the signed-in customer's group or company discount is (D108), said
 * where they choose: the price above is the list price, and the discount is
 * taken off in the cart. Read per request, inside the buy section's Suspense.
 */
async function MemberNotice({ store, m }: { store: Store; m: Messages }) {
  const customer = await getCustomer(store.id);
  const discount = await memberDiscountFor(db(), store.id, customer?.id ?? null);
  return discount ? <p className="mb-2 text-sm">{m.companyAccount.memberNotice(percentText(discount.percent))}</p> : null;
}

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
  // Only sold as a subscription, and subscriptions are in the country's own currency (D109).
  if (product.needsNativeCurrency) {
    const own = inView(market, { currency: market.nativeCurrency });
    return (
      <p className="text-sm">
        {m.companyAccount.subscriptionCurrency(market.nativeCurrency)}{" "}
        <Link href={`${marketPath(store.slug, own.slug)}/p/${product.handle}`} className="underline">
          {m.companyAccount.showPricesIn(market.nativeCurrency)}
        </Link>
      </p>
    );
  }
  // Stock, policy and the days a backorder states are read for this request, never cached (D172).
  const availability = await getVariantStock(
    store.id,
    product.variants.map((v) => v.id),
  );
  // Units in stock, or a variant that keeps selling at zero with its days stated (a backorder is bought, never "sold out").
  const available = (variant: ProductDetail["variants"][number]) => variant.delivery === "digital" || canOffer(availability.get(variant.id));
  // A variant that keeps selling is capped by the line maximum, not by what is in stock, so the message must not say it is.
  const cappedNote = (variant: ProductDetail["variants"][number]) =>
    availability.get(variant.id)?.stockPolicy === "continue" ? m.backorder.capped(MAX_LINE_QUANTITY) : undefined;

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
      <VariantChoice
        initial={(product.variants.find(available) ?? product.variants[0]).id}
        productId={product.id}
        pictures={Object.fromEntries(product.variants.map((variant) => [variant.id, variant.image]))}
      >
        <VariantPurchase
          store={store.slug}
          market={market.slug}
          cartHref={marketPath(store.slug, market.slug, "/cart")}
          openCart={store.openCartOnAdd}
          variants={product.variants.map((variant) => {
            const digital = variant.delivery === "digital";
            return {
              id: variant.id,
              label: optionLabel(m, variant.options) || product.title,
              image: variant.image ? { url: variant.image.thumbnailUrl, alt: "" } : null,
              note: digital ? m.instantDownload : stockNote(availability.get(variant.id), m),
              available: available(variant),
              capped: cappedNote(variant),
              price: (
                <PlanPrice
                  amountMinor={variant.price.amountMinor}
                  currency={variant.price.currency}
                  locale={market.locale}
                  vat={variant.price.vat}
                  labels={{ vatIncluded: m.vatIncluded, vatExcluded: m.vatExcluded }}
                  measure={variant.price.measure}
                  unitLabels={unitLabelsOf(m)}
                >
                  <Price price={variant.price} locale={market.locale} m={m} />
                </PlanPrice>
              ),
              amount: (
                <PlanAmount
                  amountMinor={variant.price.amountMinor}
                  currency={variant.price.currency}
                  locale={market.locale}
                  vat={variant.price.vat}
                  labels={{ vatIncluded: m.vatIncluded, vatExcluded: m.vatExcluded }}
                />
              ),
            };
          })}
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
          }}          // Weekly deliveries (D102): the store's own goods to ship, bought once, can go on a list.
          delivery={
            store.deliveriesOn && product.kind === "goods" && !product.subscriptionOnly
              ? {
                  variants: product.variants.filter((v) => v.delivery === "physical").map((v) => v.id),
                  listHref: marketPath(store.slug, market.slug, "/deliveries"),
                  labels: {
                    add: m.deliveries.addToList,
                    adding: m.adding,
                    added: m.deliveries.addedToList,
                    seeList: m.deliveries.seeList,
                    needsList: m.deliveries.needsList,
                    needsSignIn: m.deliveries.needsSignIn,
                    notListable: m.deliveries.notListable,
                    full: m.deliveries.listFull,
                    tryAgain: m.tryAgain,
                  },
                }
              : undefined
          }
        />
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
          available: available(variant),
          capped: cappedNote(variant),
          image: variant.image ? { url: variant.image.thumbnailUrl, alt: "" } : null,
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
      </VariantChoice>
    </PurchaseOptions>
  );
}


/** Stock is part of the offer, so this renders with the stock, per request. */
export async function ProductJsonLd({
  store,
  market,
  product,
  availability,
  bookable = false,
}: {
  store: Store;
  market: Market;
  product: ProductDetail;
  /** What each variant can be bought as (`getVariantStock()`, D172): in stock, on backorder or sold out. */
  availability: Map<string, VariantStock>;
  /** An appointment with times to book (D65): offered as in stock. */
  bookable?: boolean;
}) {
  const origin = storeSiteUrl(store.slug);
  const m = t(market.lang);
  const labels = m.options as Record<string, string>;
  const shipping = await getShippingFacts(store.id, market);
  return (
    <JsonLdScript
      data={productJsonLd({
        product: {
          ...product,
          description: product.seoDescription || product.description,
          properties: structuredProperties(product.fields),
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
        // A variant that keeps selling at zero is `BackOrder`, never `InStock` (D172); a download or a booking is always in stock.
        availability: (variantId) => {
          const stock = availability.get(variantId);
          return bookable || (stock && stock.inStock > 0) ? "in_stock" : stock && canOffer(stock) ? "backorder" : "out_of_stock";
        },
        shipping,
      })}
    />
  );
}

/**
 * A product in a layout (D79): the layout's rows in the market's language,
 * with the product's parts where its product components are and the
 * layout's other components around them. The product's title is the page's
 * title. Used by the product's page and by a layout's preview.
 */
export function ProductLayoutView({ layout, ctx, inAdmin = false }: { layout: PageContent; ctx: ProductPageContext; inAdmin?: boolean }) {
  const { store, market, product } = ctx;
  // Blocks bound to a custom field of the product show its value (D118); the product's fields are read with it, so this costs nothing more.
  const content = bindPage(localizePage(layout, market.locale), product.fields, product.storeFields);
  return (
    <PageArticle
      content={{ ...content, title: product.title }}
      place={{ pageId: null, owner: store.id, market: market.slug, product: product.id }}
      inAdmin={inAdmin}
      renderBlock={(block) =>
        block.type === "product" && productPartShows(block, product, ctx.campaigns) ? <ProductPartView block={block} ctx={ctx} /> : null
      }
    />
  );
}
