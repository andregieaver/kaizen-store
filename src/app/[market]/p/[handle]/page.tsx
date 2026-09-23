import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Price } from "@/components/price";
import { optionLabel, t, type Messages } from "@/lib/i18n";
import { getMarket, type Market } from "@/lib/markets";
import { minorUnitDigits } from "@/lib/money";
import { stockLevel } from "@/lib/pricing";
import { siteUrl } from "@/lib/site";
import {
  getAvailability,
  getProduct,
  type EconomicOperator,
  type ProductDetail,
} from "@/server/catalog";

type Props = PageProps<"/[market]/p/[handle]">;

async function load(params: Props["params"]) {
  const { market: slug, handle } = await params;
  const market = getMarket(slug);
  if (!market) return null;
  const product = await getProduct(market.code, market.locale, handle);
  return product ? { market, product } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const loaded = await load(params);
  if (!loaded) return {};
  const { market, product } = loaded;
  return {
    title: product.title,
    description: product.description,
    alternates: { canonical: `/${market.slug}/p/${product.handle}` },
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
  const { market, product } = loaded;
  const m = t(market.slug);
  const [image] = product.images;

  return (
    <article className="grid gap-8 md:grid-cols-2">
      <div>
        <Link href={`/${market.slug}`} className="text-sm underline">
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
          price={product.variants[0].price}
          locale={market.locale}
          m={m}
          from={new Set(product.variants.map((v) => v.price.amountMinor)).size > 1}
          large
        />

        <section aria-labelledby="variants-heading">
          <h2 id="variants-heading" className="mb-2 font-medium">
            {m.variants}
          </h2>
          <Suspense fallback={<p className="text-sm text-muted">{m.checkingStock}</p>}>
            <VariantsWithStock product={product} market={market} m={m} />
          </Suspense>
        </section>

        <section aria-labelledby="description-heading">
          <h2 id="description-heading" className="mb-2 font-medium">
            {m.description}
          </h2>
          <p>{product.description}</p>
          {product.withdrawalExclusion !== "none" && (
            <p className="mt-2 text-sm">{m.noWithdrawal}</p>
          )}
        </section>

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
      </div>
    </article>
  );
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
  product,
  market,
  m,
}: {
  product: ProductDetail;
  market: Market;
  m: Messages;
}) {
  const availability = await getAvailability(product.variants.map((v) => v.id));
  const stockText = (available: number) => {
    const level = stockLevel(available);
    return level === "out" ? m.outOfStock : level === "low" ? m.lowStock(available) : m.inStock;
  };

  return (
    <>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {product.variants.map((variant) => {
          const available = availability.get(variant.id) ?? 0;
          const label = optionLabel(m, variant.options);
          return (
            <li key={variant.id} className="flex items-center justify-between gap-4 p-3">
              <div>
                {label && <p>{label}</p>}
                <p className="text-sm text-muted">{stockText(available)}</p>
              </div>
              <Price price={variant.price} locale={market.locale} m={m} />
            </li>
          );
        })}
      </ul>
      <ProductJsonLd product={product} market={market} availability={availability} />
    </>
  );
}

function ProductJsonLd({
  product,
  market,
  availability,
}: {
  product: ProductDetail;
  market: Market;
  availability: Map<string, number>;
}) {
  const url = `${siteUrl()}/${market.slug}/p/${product.handle}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: product.description,
    image: product.images.map((image) => `${siteUrl()}${image.url}`),
    ...(product.manufacturer && {
      manufacturer: { "@type": "Organization", name: product.manufacturer.name },
    }),
    offers: product.variants.map((variant) => ({
      "@type": "Offer",
      url,
      sku: variant.sku,
      ...(variant.gtin && { gtin: variant.gtin }),
      price: (
        variant.price.amountMinor /
        10 ** minorUnitDigits(variant.price.currency)
      ).toFixed(minorUnitDigits(variant.price.currency)),
      priceCurrency: variant.price.currency,
      availability:
        (availability.get(variant.id) ?? 0) > 0
          ? "https://schema.org/InStock"
          : "https://schema.org/OutOfStock",
    })),
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
      }}
    />
  );
}
