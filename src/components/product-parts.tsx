import Link from "next/link";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";

import { AppointmentPicker } from "@/components/appointment-picker";
import { SwitchToBusiness } from "@/components/buyer";
import { CampaignNotices } from "@/components/campaign-notice";
import { CustomFieldGroups, CustomFieldView } from "@/components/custom-fields-view";
import { GiftCardBuy } from "@/components/gift-card-buy";
import { JsonLdScript } from "@/components/json-ld";
import { PageArticle } from "@/components/page-article";
import { Price, VatAmount } from "@/components/price";
import { PriceBreakTable } from "@/components/price-breaks";
import { ProductBar } from "@/components/product-bar";
import { ProductGallery } from "@/components/product-gallery";
import { ProductGrid } from "@/components/product-listing";
import { PlanAmount, PlanPrice, PurchaseOptions } from "@/components/purchase-options";
import { RangePicker } from "@/components/range-picker";
import { VariantChoice, VariantPurchase } from "@/components/variant-choice";
import { OPTIONS_FROM } from "@/lib/variant-options";
import type { ShopTrack } from "@/components/shop-track";
import { toolCategories } from "@/lib/cookie-consent";
import { majorAmount } from "@/lib/shop-events";
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
import type { BreakStep } from "@/lib/price-breaks";
import { lineMax, ruleWords } from "@/lib/quantity-rules";
import { inView, shown, type Market } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { todayIn } from "@/lib/analytics-period";
import { browserText } from "@/lib/browser-text";
import type { PageContent, ProductBlock } from "@/lib/page-content";
import { localizePage } from "@/lib/page-translation";
import { marketPath, marketUrl, storeSiteUrl } from "@/lib/paths";
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
import { priceBreaksFor } from "@/server/price-breaks";
import { listPricesFor } from "@/server/price-lists";
import { getRangeOffer, getRangePricing, rangeDates } from "@/server/ranges";
import { getShippingFacts, storeFacts } from "@/server/seo";
import type { ReviewFacts } from "@/server/review-facts";
import { backInStockOn } from "@/server/stock-requests";
import type { Store } from "@/server/stores";
import { partFeatureOn } from "@/lib/part-features";
import { featureOn, type FeatureSource } from "@/lib/store-features";
import { themeLayersOf } from "@/lib/section-styles";

import { ProductRating, ProductReviews } from "./product-reviews";

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
  /** The product's published reviews (D301), while the store has reviews on; null or absent draws no review part. */
  reviews?: ReviewFacts | null;
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
          <h1 className="flex-1 font-heading text-3xl tracking-tight">{product.title}</h1>
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
    case "rating":
      return ctx.reviews ? <ProductRating facts={ctx.reviews} m={m} locale={market.locale} anchor={`reviews-${product.id}`} /> : null;
    case "reviews":
      return ctx.reviews ? (
        <ProductReviews
          facts={ctx.reviews}
          m={m}
          locale={market.locale}
          store={store.name}
          endpoint={`/api/reviews?store=${encodeURIComponent(store.slug)}&market=${encodeURIComponent(market.slug)}&product=${product.id}`}
          id={`reviews-${product.id}`}
          heading={block.showHeading === false ? null : block.heading || null}
        />
      ) : null;
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
      if (product.kind === "gift_card") {
        // A gift card (D300): its amounts are its variants, priced in this market; no stock, and a day it is sent on read for this request.
        return (
          <section aria-label={product.title} className={forBusiness}>
            <Suspense fallback={null}>
              <GiftCardPurchase store={store} product={product} market={market} m={m} />
            </Suspense>
          </section>
        );
      }
      // A product of one variant has nothing to choose: no Variants heading or box, only its stock, price and Add to cart, in a
      // region named for the product (named for its button, a screen reader would say "Add to cart" twice).
      if (product.variants.length === 1) {
        return (
          <section aria-label={product.title} className={forBusiness}>
            <Suspense fallback={<p className="text-sm text-muted">{m.checkingStock}</p>}>
              <MemberNotice store={store} m={m} />
              <VariantsWithStock store={store} product={product} market={market} m={m} optionsFrom={block.optionsFrom} />
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
            <VariantsWithStock store={store} product={product} market={market} m={m} optionsFrom={block.optionsFrom} />
          </Suspense>
        </section>
      );
    case "description":
      if (!product.description && product.bundleItems.length === 0) return null;
      return (
        <>
          {/* What a bundle holds (D322), from the catalogue's cached read: above the description, in every layout that has one. */}
          {product.bundleItems.length > 0 && (
            <section aria-labelledby={`${block.id}-inside`} className="mb-4">
              <h2 id={`${block.id}-inside`} className="mb-2 font-medium">
                {m.bundleInside}
              </h2>
              <ul className="list-disc pl-5">
                {product.bundleItems.map((item, i) => (
                  <li key={`${i}-${item.title}`}>
                    {item.quantity} × {item.handle ? <Link href={`${base}/p/${item.handle}`} className="underline">{item.title}</Link> : item.title}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {product.description && (
            <section aria-labelledby={labelledBy}>
              {heading(m.description)}
              <p>{product.description}</p>
            </section>
          )}
        </>
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
export function productPartShows(
  block: ProductBlock,
  product: ProductDetail,
  campaigns?: Notices,
  features?: FeatureSource,
  reviews?: ReviewFacts | null,
): boolean {
  // A part of a store feature that is off draws nothing (D178).
  if (!partFeatureOn(block, features)) return false;
  switch (block.part) {
    case "campaigns":
      return noticesFor(campaigns, product.id).length > 0;
    case "rating":
    case "reviews":
      // Drawn only with a published review (D301): no empty stars, and never a word of one not published.
      return (reviews?.summary.count ?? 0) > 0;
    case "gallery":
      return galleryImages(product).length > 0;
    case "notice":
      return product.audience === "businesses";
    case "host":
      return Boolean(product.hostName);
    case "description":
      return Boolean(product.description) || product.bundleItems.length > 0;
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

/** A gift card's amounts and *Send it to someone* (D300), with the store's day for the earliest send, read per request. */
async function GiftCardPurchase({ store, product, market, m }: { store: Store; product: ProductDetail; market: Market; m: Messages }) {
  await connection();
  return (
    <GiftCardBuy
      store={store.slug}
      market={market.slug}
      cartHref={marketPath(store.slug, market.slug, "/cart")}
      openCart={store.openCartOnAdd}
      amounts={product.variants.map((variant) => ({ variantId: variant.id, label: formatMoney(variant.price.amountMinor, variant.price.currency, market.locale) }))}
      today={todayIn(new Date(), store.timeZone)}
      labels={browserText(market.lang).giftCard}
      cartLabels={{
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
  );
}

/** The line on the right of withdrawal: none for ordinary goods, which can be sent back. */
function withdrawalText(product: ProductDetail, m: Messages): string | null {
  if (product.kind === "gift_card") return m.giftCardLine.withdrawal;
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
        sizedColumns
        notices={ctx.campaigns}
      />
    </section>
  );
}

/** The page's structured data (JSON-LD), with stock, per request: drawn once, whatever the layout holds. */
export async function ProductJsonLdSection({ store, market, product, reviews }: Omit<ProductPageContext, "m">) {
  if (product.kind !== "goods") return <ProductJsonLd store={store} market={market} product={product} availability={new Map()} bookable reviews={reviews} />;
  await connection();
  const availability = await getVariantStock(
    store.id,
    product.variants.map((v) => v.id),
  );
  return <ProductJsonLd store={store} market={market} product={product} availability={availability} reviews={reviews} />;
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
  const [offer, week, listed] = await Promise.all([
    getAppointmentOffer(store.id, product.id),
    appointmentSlots(store.id, product.id),
    // A signed-in buyer's price lists (D321), as the cart prices an appointment.
    getCustomer(store.id).then((customer) => listPricesFor(store.id, customer?.id ?? null, product.variants.map((v) => v.id), market.code)),
  ]);
  if (!featureOn(store, "appointments") || !offer || !week) return <p>{m.booking.notBookable}</p>;
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
          price: (() => {
            const own = listed.get(variant.id);
            return own ? (
              <Price price={{ ...variant.price, amountMinor: shown(market, own.amountMinor), referenceMinor: null }} locale={market.locale} m={m} yours />
            ) : (
              <Price price={variant.price} locale={market.locale} m={m} />
            );
          })(),
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
  if (!featureOn(store, "bookings") || !offer || !month) return <p>{m.booking.notBookable}</p>;
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

/** The sold-out variants a shopper may ask to hear about (D298), with a signed-in customer's address filled in. */
async function notifyOffer(store: Store, product: ProductDetail, availability: Awaited<ReturnType<typeof getVariantStock>>, m: Messages) {
  const variants = product.variants
    .filter((v) => v.delivery === "physical" && availability.get(v.id)?.stockPolicy !== "continue" && !canOffer(availability.get(v.id)))
    .map((v) => v.id);
  if (variants.length === 0) return undefined;
  const customer = await getCustomer(store.id);
  return { variants, email: customer?.email ?? "", labels: m.backInStock };
}

/** What the store's tags hear of a product's variants (D303 I1): only while the store has a tag; SKU else id, the price as shown. */
function shopTrack(store: Store, product: ProductDetail): ShopTrack | null {
  if (toolCategories(store.tracking).length === 0 || product.variants.length === 0) return null;
  return {
    name: product.title,
    currency: product.variants[0].price.currency,
    variants: Object.fromEntries(
      product.variants.map((v) => [v.id, { id: v.sku || v.id, price: majorAmount(v.price.amountMinor, v.price.currency) }]),
    ),
  };
}

async function VariantsWithStock({
  store,
  product,
  market,
  m,
  optionsFrom,
}: {
  store: Store;
  product: ProductDetail;
  market: Market;
  m: Messages;
  /** From this many variants each option is a list of its own (D320, the buy part's `optionsFrom`). */
  optionsFrom?: number;
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
  // A signed-in buyer's price lists (D321) and the product's price breaks (D323): goods bought once only, never with purchase options, as the
  // cart prices them (`LIST_PRICED`).
  const buyer = product.plans.length === 0 ? getCustomer(store.id).then((customer) => customer?.id ?? null) : null;
  const ids = product.variants.map((v) => v.id);
  const [availability, notifyOn, listed, breaks] = await Promise.all([
    getVariantStock(store.id, ids),
    backInStockOn(store.id),
    buyer ? buyer.then((id) => listPricesFor(store.id, id, ids, market.code)) : new Map<string, { amountMinor: number; listId: string }>(),
    buyer ? buyer.then((id) => priceBreaksFor(store.id, id, ids, market.code)) : new Map<string, BreakStep[]>(),
  ]);
  // The price a variant is offered at: the buyer's list price where a list gives one (in the market's view, never a reduction), else the shop's.
  const offered = (variant: ProductDetail["variants"][number]) => {
    const own = listed.get(variant.id);
    return own ? { price: { ...variant.price, amountMinor: shown(market, own.amountMinor), referenceMinor: null }, yours: true } : { price: variant.price, yours: false };
  };
  // Units in stock, or a variant that keeps selling at zero with its days stated (a backorder is bought, never "sold out").
  const available = (variant: ProductDetail["variants"][number]) => variant.delivery === "digital" || canOffer(availability.get(variant.id));
  // A variant that keeps selling is capped by the line maximum, not by what is in stock, so the message must not say it is.
  const cappedNote = (variant: ProductDetail["variants"][number]) =>
    availability.get(variant.id)?.stockPolicy === "continue" ? m.backorder.capped(lineMax(variant.rule)) : undefined;

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

  // One price drawn per distinct price (D320): a product of 2,048 variants in a few prices sends a few, each variant naming its own by place.
  const priced = (() => {
    const places = new Map<string, number>();
    const prices: { price: ReactNode; amount: ReactNode }[] = [];
    const index = ({ price, yours }: ReturnType<typeof offered>) => {
      const key = JSON.stringify([price, yours]);
      const known = places.get(key);
      if (known !== undefined) return known;
      places.set(key, prices.length);
      prices.push({
        price: (
          <PlanPrice
            amountMinor={price.amountMinor}
            currency={price.currency}
            locale={market.locale}
            vat={price.vat}
            labels={{ vatIncluded: m.vatIncluded, vatExcluded: m.vatExcluded }}
            measure={price.measure}
            unitLabels={unitLabelsOf(m)}
          >
            <Price price={price} locale={market.locale} m={m} yours={yours} />
          </PlanPrice>
        ),
        amount: (
          <PlanAmount
            amountMinor={price.amountMinor}
            currency={price.currency}
            locale={market.locale}
            vat={price.vat}
            labels={{ vatIncluded: m.vatIncluded, vatExcluded: m.vatExcluded }}
          />
        ),
      });
      return prices.length - 1;
    };
    return { index, prices };
  })();

  // One table of price breaks drawn per distinct table (D323), each variant naming its own by place, as its price.
  const breakTables = (() => {
    const places = new Map<string, number>();
    const tables: ReactNode[] = [];
    const index = (variant: ProductDetail["variants"][number]): number | undefined => {
      const steps = breaks.get(variant.id);
      if (!steps) return undefined;
      const shownSteps = steps.map((step) => ({ from: step.from, amountMinor: shown(market, step.amountMinor) }));
      const key = JSON.stringify([shownSteps, variant.price.vat]);
      const known = places.get(key);
      if (known !== undefined) return known;
      places.set(key, tables.length);
      tables.push(<PriceBreakTable steps={shownSteps} price={variant.price} locale={market.locale} m={m} />);
      return tables.length - 1;
    };
    return { index, tables };
  })();

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
        track={shopTrack(store, product)}
      >
        <VariantPurchase
          store={store.slug}
          market={market.slug}
          cartHref={marketPath(store.slug, market.slug, "/cart")}
          openCart={store.openCartOnAdd}
          optionsFrom={optionsFrom}
          variants={product.variants.map((variant) => {
            const digital = variant.delivery === "digital";
            return {
              id: variant.id,
              // A product's only variant is named by its options alone: without any, it is the product, whose title the page shows.
              label: optionLabel(m, variant.options) || (product.variants.length > 1 ? product.title : ""),
              options: variant.options,
              image: variant.image ? { url: variant.image.thumbnailUrl, alt: "" } : null,
              // How many at a time (D323): said after the stock, as Add to cart puts in the minimum and then whole steps.
              note: [digital ? m.instantDownload : stockNote(availability.get(variant.id), m), ruleWords(variant.rule, m.quantityRule)].filter(Boolean).join(" · "),
              available: available(variant),
              capped: cappedNote(variant),
              priceIndex: priced.index(offered(variant)),
              breakIndex: breakTables.index(variant),
            };
          })}
          prices={priced.prices}
          breakTables={breakTables.tables}
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
            variantUnavailable: m.variantUnavailable,
          }}
          // Back in stock (D298, 6.4): a sold-out physical variant that does not keep selling, while the store has it on.
          notify={notifyOn ? await notifyOffer(store, product, availability, m) : undefined}
          // Weekly deliveries (D102): the store's own goods to ship, bought once, can go on a list.
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
        choosesOnPage={product.variants.length >= (optionsFrom ?? OPTIONS_FROM) && Object.keys(product.variants[0].options).length > 0}
        variants={product.variants.map((variant) => ({
          id: variant.id,
          label: optionLabel(m, variant.options) || product.title,
          amountMinor: offered(variant).price.amountMinor,
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
  reviews = null,
}: {
  store: Store;
  market: Market;
  product: ProductDetail;
  /** What each variant can be bought as (`getVariantStock()`, D172): in stock, on backorder or sold out. */
  availability: Map<string, VariantStock>;
  /** An appointment with times to book (D65): offered as in stock. */
  bookable?: boolean;
  /** The product's published reviews (D301): its rating and newest reviews, only when there is one. */
  reviews?: ReviewFacts | null;
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
        url: marketUrl(store.slug, market.slug, `/p/${product.handle}`),
        origin,
        store: storeFacts(store),
        market,
        marketHome: marketUrl(store.slug, market.slug),
        // A variant that keeps selling at zero is `BackOrder`, never `InStock` (D172); a download or a booking is always in stock.
        availability: (variantId) => {
          const stock = availability.get(variantId);
          return bookable || (stock && stock.inStock > 0) ? "in_stock" : stock && canOffer(stock) ? "backorder" : "out_of_stock";
        },
        shipping,
        // Only published reviews of this product (D301), and only when there is one.
        reviews:
          reviews && reviews.summary.count > 0 && reviews.summary.average !== null
            ? { average: reviews.summary.average, count: reviews.summary.count, latest: reviews.latest.slice(0, 5) }
            : null,
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
      place={{ pageId: null, owner: store.id, market: market.slug, product: product.id, theme: themeLayersOf(store.theme.settings) }}
      inAdmin={inAdmin}
      renderBlock={(block) =>
        block.type === "product" && productPartShows(block, product, ctx.campaigns, store, ctx.reviews) ? <ProductPartView block={block} ctx={ctx} /> : null
      }
    />
  );
}
