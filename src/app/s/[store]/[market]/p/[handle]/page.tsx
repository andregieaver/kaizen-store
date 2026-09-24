import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { AddToCart } from "@/components/add-to-cart";
import { JsonLdScript } from "@/components/json-ld";
import { Price } from "@/components/price";
import { PlanPrice, PurchaseOptions } from "@/components/purchase-options";
import { optionLabel, t, type Messages } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { formatMoney, minorUnitDigits } from "@/lib/money";
import { stockLevel } from "@/lib/pricing";
import { marketPath } from "@/lib/paths";
import { schemaPrice, summarize } from "@/lib/seo";
import { siteUrl } from "@/lib/site";
import { productJsonLd } from "@/lib/structured-data";
import { planPrice } from "@/lib/subscriptions";
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
  const [image] = product.images;

  return (
    <article className="grid gap-8 md:grid-cols-2">
      <div>
        <Link href={marketPath(store.slug, market.slug)} className="text-sm underline">
          {m.backToProducts}
        </Link>
        {image && (
          <Image
            src={image.url}
            alt={image.alt}
            width={600}
            height={600}
            priority
            unoptimized
            className="mt-4 aspect-square w-full rounded-lg bg-surface object-cover"
          />
        )}
      </div>

      <div className="flex flex-col gap-6">
        <h1 className="text-3xl font-semibold tracking-tight">{product.title}</h1>
        <Price
          price={headlinePrice(product)}
          locale={market.locale}
          m={m}
          from={product.subscriptionOnly || new Set(product.variants.map((v) => v.price.amountMinor)).size > 1}
          large
        />

        <section aria-labelledby="variants-heading">
          <h2 id="variants-heading" className="mb-2 font-medium">
            {m.variants}
          </h2>
          <Suspense fallback={<p className="text-sm text-muted">{m.checkingStock}</p>}>
            <VariantsWithStock store={store} product={product} market={market} m={m} />
          </Suspense>
        </section>

        <section aria-labelledby="description-heading">
          <h2 id="description-heading" className="mb-2 font-medium">
            {m.description}
          </h2>
          <p>{product.description}</p>
          {product.variants.some((v) => v.delivery === "digital") ? (
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
                  vatIncluded={m.vatIncluded}
                >
                  <Price price={variant.price} locale={market.locale} m={m} />
                </PlanPrice>
                <AddToCart
                  store={store.slug}
                  market={market.slug}
                  cartHref={marketPath(store.slug, market.slug, "/cart")}
                  variantId={variant.id}
                  disabled={available <= 0}
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
}: {
  store: Store;
  market: Market;
  product: ProductDetail;
  availability: Map<string, number>;
}) {
  const origin = siteUrl();
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
        inStock: (variantId) => (availability.get(variantId) ?? 0) > 0,
        shipping,
      })}
    />
  );
}
