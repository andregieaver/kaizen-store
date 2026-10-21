"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  BUY_MIN_MAX,
  CAMPAIGN_NAME_MAX,
  GET_QUANTITY_MAX,
  GIFT_QUANTITY_MAX,
  USES_PER_ORDER_MAX,
  MULTI_BUY_MAX,
  TIER_QUANTITY_MAX,
  TIERS_MAX,
  TIERS_MIN,
  type CampaignInput,
  type CampaignKind,
  type GetKind,
  type TierBasis,
} from "@/lib/campaigns";

type Save = (input: CampaignInput) => Promise<{ ok: true; id?: string } | { ok: false; problems: string[] }>;
type Market = { code: string; name: string; currency: string };

export type CampaignDraft = {
  name: string;
  kind: CampaignKind;
  percent: string;
  buyQuantity: string;
  payQuantity: string;
  giftVariantId: string;
  giftQuantity: string;
  thresholds: Record<string, string>;
  /** An amount campaign's amounts off, typed per market (D299 E3). */
  amounts: Record<string, string>;
  /** A tiered campaign's basis and steps, typed. */
  tierBasis: TierBasis;
  tiers: { quantity: string; amounts: Record<string, string>; percent: string }[];
  /** Buy X get Y (D299 E4): what one use asks for, what they get and what each given item takes off, typed. */
  buyBasis: "items" | "spend";
  buyMinQuantity: string;
  buyMinAmounts: Record<string, string>;
  getScope: "same" | "some";
  getProductIds: string[];
  getTermIds: string[];
  getQuantity: string;
  getKind: GetKind;
  getPercent: string;
  getAmounts: Record<string, string>;
  usesPerOrder: string;
  scope: "all" | "some";
  productIds: string[];
  termIds: string[];
  /** Customer groups it is for; none for everyone. */
  tierIds: string[];
  usageLimit: string;
  perCustomerLimit: string;
  /** Countries (market codes) it runs in; none for all. */
  markets: string[];
  stacks: boolean;
  startsAt: string;
  endsAt: string;
  active: boolean;
};

const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm font-normal";
const label = "flex flex-col gap-1 text-sm font-medium";
const hint = "text-xs font-normal text-muted";
const card = "flex flex-col gap-4 rounded-lg border border-line bg-card p-5";

const KINDS: { value: CampaignKind; title: string; text: string }[] = [
  { value: "percent", title: "A percentage off", text: "For example 20 % off the chosen products, without a code." },
  { value: "multi_buy", title: "Buy more, pay for fewer", text: "3 for 2: the cheapest of every three is free." },
  { value: "amount", title: "An amount off", text: "For example NOK 100 off, optionally when the basket comes to NOK 500." },
  { value: "tiered", title: "Bigger discounts for buying more", text: "For example 10 % off 2 items and 15 % off 4, or by what the basket comes to." },
  { value: "free_shipping", title: "Free shipping", text: "No shipping to pay, optionally when the basket comes to an amount." },
  { value: "bxgy", title: "Buy one thing, get another", text: "For example buy 2 shirts, get a cap free, or buy 2 and get the cheapest at half price." },
  { value: "gift", title: "A free product", text: "Added to the order, free, when the basket comes to an amount." },
];

/** Kinds that can also come on top of other campaigns. */
const STACKING: readonly CampaignKind[] = ["percent", "multi_buy", "tiered"];

/**
 * A store's campaign (D114): what it gives, on what, and when. Saved as a
 * whole; nothing changes for shoppers until then, and orders already placed
 * keep what they got.
 */
export function CampaignEditor({
  initial,
  markets,
  products,
  terms,
  gifts,
  tiers,
  orders,
  save,
  back,
}: {
  initial: CampaignDraft;
  markets: Market[];
  products: { id: string; title: string }[];
  terms: { id: string; name: string; kind: "category" | "tag"; parentId: string | null }[];
  gifts: { variantId: string; label: string }[];
  /** The store's customer groups (D108). */
  tiers: { id: string; name: string; percent: number; active: boolean }[];
  /** Orders that got something from it. */
  orders: number;
  save: Save;
  back: string;
}) {
  const router = useRouter();
  const [d, setD] = useState(initial);
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, startSaving] = useTransition();
  const set = <K extends keyof CampaignDraft>(key: K, value: CampaignDraft[K]) => setD((current) => ({ ...current, [key]: value }));
  const toggle = (key: "productIds" | "termIds" | "tierIds" | "markets" | "getProductIds" | "getTermIds", id: string, on: boolean) => set(key, on ? [...d[key], id] : d[key].filter((x) => x !== id));

  const submit = () =>
    startSaving(async () => {
      const result = await save({
        name: d.name,
        kind: d.kind,
        percent: d.percent,
        buyQuantity: d.buyQuantity,
        payQuantity: d.payQuantity,
        giftVariantId: d.giftVariantId || null,
        giftQuantity: d.giftQuantity,
        thresholds: d.thresholds,
        amounts: d.amounts,
        tierBasis: d.tierBasis,
        tiers: d.tiers,
        buyBasis: d.buyBasis,
        buyMinQuantity: d.buyMinQuantity,
        buyMinAmounts: d.buyMinAmounts,
        getScope: d.getScope,
        getProductIds: d.getProductIds,
        getTermIds: d.getTermIds,
        getQuantity: d.getQuantity,
        getKind: d.getKind,
        getPercent: d.getPercent,
        getAmounts: d.getAmounts,
        usesPerOrder: d.usesPerOrder || null,
        scope: d.scope,
        productIds: d.productIds,
        termIds: d.termIds,
        tierIds: d.tierIds,
        usageLimit: d.usageLimit || null,
        perCustomerLimit: d.perCustomerLimit || null,
        markets: d.markets,
        stacks: STACKING.includes(d.kind) && d.stacks,
        startsAt: d.startsAt || null,
        endsAt: d.endsAt || null,
        active: d.active,
      } as CampaignInput);
      if (result.ok) {
        router.push(back);
        router.refresh();
      } else {
        setProblems(result.problems);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });

  const categories = terms.filter((term) => term.kind === "category");
  const tags = terms.filter((term) => term.kind === "tag");
  // A subcategory is shown under its parent's name, so "Shoes › Sneakers" reads as it is.
  const path = (term: { name: string; parentId: string | null }): string => {
    const parent = term.parentId ? terms.find((t) => t.id === term.parentId) : null;
    return parent ? `${path(parent)} › ${term.name}` : term.name;
  };
  const scopeWord = d.kind === "bxgy" ? "What they buy" : d.kind === "gift" || d.kind === "free_shipping" ? "What counts towards the amount" : "What it applies to";
  /** Fields for an amount in each country's currency. */
  const perMarket = (values: Record<string, string>, change: (next: Record<string, string>) => void, placeholder: string, prefix: string) => (
    <div className="grid gap-3 sm:grid-cols-3">
      {markets.map((market) => (
        <label key={market.code} className={label}>
          {market.name} ({market.currency})
          <input
            value={values[market.code] ?? ""}
            onChange={(event) => change({ ...values, [market.code]: event.target.value })}
            inputMode="decimal"
            placeholder={placeholder}
            aria-label={`${prefix}, ${market.name}`}
            className={input}
          />
        </label>
      ))}
    </div>
  );
  const setTier = (i: number, patch: Partial<CampaignDraft["tiers"][number]>) => set("tiers", d.tiers.map((tier, j) => (j === i ? { ...tier, ...patch } : tier)));

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex flex-col gap-6"
    >
      {problems.length > 0 && (
        <div role="alert" className="rounded-lg border border-danger-text p-4 text-sm">
          <p className="font-medium">Nothing was saved yet. Please fix:</p>
          <ul className="mt-2 list-disc pl-5">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      <section aria-labelledby="campaign-heading" className={card}>
        <h2 id="campaign-heading" className="text-title text-ink">
          The campaign
        </h2>
        <label className={label}>
          Name
          <input
            value={d.name}
            onChange={(event) => set("name", event.target.value)}
            required
            maxLength={CAMPAIGN_NAME_MAX}
            className={input}
            aria-describedby="name-hint"
          />
          <span id="name-hint" className={hint}>
            Shoppers see it in their cart, at checkout and on their order, so write it for them: “Summer sale”, “3 for 2 on mugs”.
            {orders > 0 && ` ${orders} ${orders === 1 ? "order has" : "orders have"} got something from it and keep it, whatever you change here.`}
          </span>
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">What it gives</legend>
          {KINDS.map((kind) => (
            <label key={kind.value} className="flex items-start gap-3 rounded-md border border-line p-3 text-sm has-[:checked]:border-brand">
              <input type="radio" name="kind" checked={d.kind === kind.value} onChange={() => set("kind", kind.value)} className="mt-0.5 size-4" />
              <span>
                <span className="font-medium">{kind.title}</span>
                <span className={`block ${hint}`}>{kind.text}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {d.kind === "percent" && (
          <label className={`${label} max-w-40`}>
            Percent off
            <input type="number" min={1} max={100} value={d.percent} onChange={(event) => set("percent", event.target.value)} required inputMode="numeric" className={input} />
          </label>
        )}
        {d.kind === "amount" && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Amount off, in each country&apos;s currency</p>
            {perMarket(d.amounts, (next) => set("amounts", next), "Not offered", "Amount off")}
            <p className={hint}>Shared over the products it applies to by what each costs, never more than they cost. Leave a country empty and the campaign does not run there.</p>
          </div>
        )}
        {(d.kind === "amount" || d.kind === "free_shipping") && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">When the basket comes to (optional)</p>
            {perMarket(d.thresholds, (next) => set("thresholds", next), "Any basket", "When the basket comes to")}
            <p className={hint}>
              What the products it applies to come to, with VAT{d.kind === "free_shipping" ? ", after any campaign price reductions" : ""}. Empty: any basket. The cart tells shoppers how much more they need.
            </p>
          </div>
        )}
        {d.kind === "free_shipping" && (
          <p className={hint}>The order&apos;s whole shipping is free, whichever delivery the shopper chooses. Not for subscriptions, which pay shipping on each delivery.</p>
        )}
        {d.kind === "tiered" && (
          <div className="flex flex-col gap-3">
            <fieldset className="flex flex-wrap gap-4">
              <legend className="mb-1 text-sm font-medium">Each step counts</legend>
              <label className="flex min-h-10 items-center gap-2 text-sm">
                <input type="radio" name="tierBasis" checked={d.tierBasis === "quantity"} onChange={() => set("tierBasis", "quantity")} className="size-4" />
                Items bought
              </label>
              <label className="flex min-h-10 items-center gap-2 text-sm">
                <input type="radio" name="tierBasis" checked={d.tierBasis === "spend"} onChange={() => set("tierBasis", "spend")} className="size-4" />
                What the basket comes to
              </label>
            </fieldset>
            <ol className="flex flex-col gap-3">
              {d.tiers.map((tier, i) => (
                <li key={i} className="flex flex-col gap-2 rounded-md border border-line p-3">
                  <div className="flex flex-wrap items-end gap-3">
                    <span className="text-sm font-medium">Step {i + 1}</span>
                    {d.tierBasis === "quantity" && (
                      <label className={`${label} w-32`}>
                        From items
                        <input type="number" min={1} max={TIER_QUANTITY_MAX} value={tier.quantity} onChange={(event) => setTier(i, { quantity: event.target.value })} required inputMode="numeric" className={input} />
                      </label>
                    )}
                    <label className={`${label} w-32`}>
                      Percent off
                      <input type="number" min={1} max={100} value={tier.percent} onChange={(event) => setTier(i, { percent: event.target.value })} required inputMode="numeric" className={input} />
                    </label>
                    {d.tiers.length > TIERS_MIN && (
                      <button type="button" onClick={() => set("tiers", d.tiers.filter((_, j) => j !== i))} className="min-h-10 rounded-pill px-3 text-sm underline">
                        Remove step {i + 1}
                      </button>
                    )}
                  </div>
                  {d.tierBasis === "spend" && perMarket(tier.amounts, (next) => setTier(i, { amounts: next }), "Not offered", `Step ${i + 1} from`)}
                </li>
              ))}
            </ol>
            {d.tiers.length < TIERS_MAX && (
              <button
                type="button"
                onClick={() => set("tiers", [...d.tiers, { quantity: "", amounts: {}, percent: "" }])}
                className="self-start rounded-pill border border-line px-4 py-2 text-sm"
              >
                Add a step
              </button>
            )}
            <p className={hint}>
              The highest step the shopper reaches applies, to every product it applies to. Each step asks for more and gives more than the one before. The product page shows the steps, and the cart how far the next one is.
            </p>
          </div>
        )}
        {d.kind === "bxgy" && (
          <div className="flex flex-col gap-3">
            <fieldset className="flex flex-wrap gap-4">
              <legend className="mb-1 text-sm font-medium">They buy</legend>
              <label className="flex min-h-10 items-center gap-2 text-sm">
                <input type="radio" name="buyBasis" checked={d.buyBasis === "items"} onChange={() => set("buyBasis", "items")} className="size-4" />
                A number of items
              </label>
              <label className="flex min-h-10 items-center gap-2 text-sm">
                <input type="radio" name="buyBasis" checked={d.buyBasis === "spend"} onChange={() => set("buyBasis", "spend")} className="size-4" />
                For an amount
              </label>
            </fieldset>
            {d.buyBasis === "items" ? (
              <label className={`${label} w-32`}>
                Items
                <input type="number" min={1} max={BUY_MIN_MAX} value={d.buyMinQuantity} onChange={(event) => set("buyMinQuantity", event.target.value)} required inputMode="numeric" className={input} />
              </label>
            ) : (
              perMarket(d.buyMinAmounts, (next) => set("buyMinAmounts", next), "Not offered", "They spend")
            )}
            <div className="flex flex-wrap items-end gap-3">
              <label className={`${label} w-32`}>
                They get
                <input type="number" min={1} max={GET_QUANTITY_MAX} value={d.getQuantity} onChange={(event) => set("getQuantity", event.target.value)} required inputMode="numeric" className={input} />
              </label>
              <label className={`${label} w-56`}>
                At
                <select value={d.getKind} onChange={(event) => set("getKind", event.target.value as GetKind)} className={input}>
                  <option value="free">No cost</option>
                  <option value="percent">A percentage off</option>
                  <option value="amount">An amount off each</option>
                </select>
              </label>
              {d.getKind === "percent" && (
                <label className={`${label} w-32`}>
                  Percent off
                  <input type="number" min={1} max={100} value={d.getPercent} onChange={(event) => set("getPercent", event.target.value)} required inputMode="numeric" className={input} />
                </label>
              )}
            </div>
            {d.getKind === "amount" && perMarket(d.getAmounts, (next) => set("getAmounts", next), "Not offered", "Off each")}
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">What they get</legend>
              <label className="flex min-h-10 items-center gap-3 text-sm">
                <input type="radio" name="getScope" checked={d.getScope === "same"} onChange={() => set("getScope", "same")} className="size-4" />
                The same as what they buy (the cheapest)
              </label>
              <label className="flex min-h-10 items-center gap-3 text-sm">
                <input type="radio" name="getScope" checked={d.getScope === "some"} onChange={() => set("getScope", "some")} className="size-4" />
                Other products, categories or tags
              </label>
            </fieldset>
            {d.getScope === "some" && (
              <ul className="grid max-h-72 gap-1 overflow-y-auto rounded-md border border-line p-2 sm:grid-cols-2" aria-label="What they get">
                {terms.map((term) => (
                  <li key={`t:${term.id}`}>
                    <label className="flex min-h-10 items-center gap-3 rounded px-2 text-sm hover:bg-sunken">
                      <input type="checkbox" checked={d.getTermIds.includes(term.id)} onChange={(event) => toggle("getTermIds", term.id, event.target.checked)} className="size-4" />
                      {term.kind === "tag" ? `#${term.name}` : path(term)}
                    </label>
                  </li>
                ))}
                {products.map((product) => (
                  <li key={`p:${product.id}`}>
                    <label className="flex min-h-10 items-center gap-3 rounded px-2 text-sm hover:bg-sunken">
                      <input type="checkbox" checked={d.getProductIds.includes(product.id)} onChange={(event) => toggle("getProductIds", product.id, event.target.checked)} className="size-4" />
                      {product.title}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <label className={`${label} max-w-56`}>
              Times per order (optional)
              <input type="number" min={1} max={USES_PER_ORDER_MAX} value={d.usesPerOrder} onChange={(event) => set("usesPerOrder", event.target.value)} placeholder="As often as the basket allows" inputMode="numeric" className={input} />
            </label>
            <p className={hint}>
              The shopper puts the items in the basket; the cheapest of what they get comes off, never an item counted as bought. Product pages of both say so.
            </p>
          </div>
        )}
        {STACKING.includes(d.kind) && (
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" checked={d.stacks} onChange={(event) => set("stacks", event.target.checked)} className="mt-0.5 size-4" />
            <span>
              Also apply on top of other campaigns
              <span className={`block ${hint}`}>
                Normally a product gets one campaign, the one that gives the shopper most. With this on, {d.kind === "multi_buy" ? "it also works on the items still to be paid for after the other campaigns, so two 3 for 2 free more items" : "the percentage also comes off what the other campaign left"}, one campaign after the other in the order they were made.
              </span>
            </span>
          </label>
        )}

        {d.kind === "multi_buy" && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-end gap-3">
              <label className={`${label} w-32`}>
                Shopper buys
                <input type="number" min={2} max={MULTI_BUY_MAX} value={d.buyQuantity} onChange={(event) => set("buyQuantity", event.target.value)} required inputMode="numeric" className={input} />
              </label>
              <label className={`${label} w-32`}>
                and pays for
                <input type="number" min={1} max={MULTI_BUY_MAX} value={d.payQuantity} onChange={(event) => set("payQuantity", event.target.value)} required inputMode="numeric" className={input} />
              </label>
            </div>
            <p className={hint}>
              In every full group of {d.buyQuantity || "N"} items the {Number(d.buyQuantity) - Number(d.payQuantity) > 1 ? `${Number(d.buyQuantity) - Number(d.payQuantity)} cheapest are` : "cheapest is"} free. The items can be different products, as long as the campaign applies to them.
            </p>
          </div>
        )}

        {d.kind === "gift" && (
          <>
            <label className={label}>
              The free product
              <select value={d.giftVariantId} onChange={(event) => set("giftVariantId", event.target.value)} required className={input}>
                <option value="">Choose a product</option>
                {gifts.map((gift) => (
                  <option key={gift.variantId} value={gift.variantId}>
                    {gift.label}
                  </option>
                ))}
              </select>
              <span className={hint}>Goods you ship yourself. It is only added when it is in stock and the order ships anyway.</span>
            </label>
            <label className={`${label} w-40`}>
              How many
              <input type="number" min={1} max={GIFT_QUANTITY_MAX} value={d.giftQuantity} onChange={(event) => set("giftQuantity", event.target.value)} required inputMode="numeric" className={input} />
            </label>
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">When the basket comes to, in each country&apos;s currency</p>
              <div className="grid gap-3 sm:grid-cols-3">
                {markets.map((market) => (
                  <label key={market.code} className={label}>
                    {market.name} ({market.currency})
                    <input
                      value={d.thresholds[market.code] ?? ""}
                      onChange={(event) => set("thresholds", { ...d.thresholds, [market.code]: event.target.value })}
                      inputMode="decimal"
                      placeholder="Not offered"
                      className={input}
                    />
                  </label>
                ))}
              </div>
              <p className={hint}>
                Counted after any campaign price reductions, before shipping and codes, with VAT. Leave a country empty and the campaign does not run there.
              </p>
            </div>
          </>
        )}
      </section>

      <section aria-labelledby="applies-heading" className={card}>
        <h2 id="applies-heading" className="text-title text-ink">
          {scopeWord}
        </h2>
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">{scopeWord}</legend>
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input type="radio" name="scope" checked={d.scope === "all"} onChange={() => set("scope", "all")} className="size-4" />
            Everything in the store
          </label>
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input type="radio" name="scope" checked={d.scope === "some"} onChange={() => set("scope", "some")} className="size-4" />
            Only some products, categories or tags
          </label>
        </fieldset>
        {d.scope === "some" && (
          <div className="flex flex-col gap-4">
            {categories.length + tags.length > 0 && (
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium">Categories and tags</legend>
                <ul className="grid max-h-56 gap-1 overflow-y-auto rounded-md border border-line p-2 sm:grid-cols-2">
                  {[...categories, ...tags].map((term) => (
                    <li key={term.id}>
                      <label className="flex min-h-10 items-center gap-3 rounded px-2 text-sm hover:bg-sunken">
                        <input type="checkbox" checked={d.termIds.includes(term.id)} onChange={(event) => toggle("termIds", term.id, event.target.checked)} className="size-4" />
                        {term.kind === "tag" ? `#${term.name}` : path(term)}
                      </label>
                    </li>
                  ))}
                </ul>
                <p className={hint}>A category takes in the products in its subcategories.</p>
              </fieldset>
            )}
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">Products</legend>
              <ul className="grid max-h-72 gap-1 overflow-y-auto rounded-md border border-line p-2 sm:grid-cols-2">
                {products.map((product) => (
                  <li key={product.id}>
                    <label className="flex min-h-10 items-center gap-3 rounded px-2 text-sm hover:bg-sunken">
                      <input type="checkbox" checked={d.productIds.includes(product.id)} onChange={(event) => toggle("productIds", product.id, event.target.checked)} className="size-4" />
                      {product.title}
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          </div>
        )}
        {d.kind !== "gift" && d.kind !== "free_shipping" && (
          <p className={hint}>
            Campaigns take money off goods bought once: not appointments, stays, rentals or subscriptions. Where two campaigns apply to the same products, the one that gives the shopper more is used. The buyer&apos;s customer group discount and any discount code come off what is left.
          </p>
        )}
      </section>

      <section aria-labelledby="when-heading" className={card}>
        <h2 id="when-heading" className="text-title text-ink">
          When
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={label}>
            Starts (optional)
            <input type="datetime-local" value={d.startsAt} onChange={(event) => set("startsAt", event.target.value)} className={input} />
          </label>
          <label className={label}>
            Ends (optional)
            <input type="datetime-local" value={d.endsAt} onChange={(event) => set("endsAt", event.target.value)} className={input} />
          </label>
        </div>
        <p className={hint}>Norwegian time. It starts and stops by itself; without dates it runs while it is switched on.</p>
        <label className={`${label} max-w-56`}>
          Orders it can go to in all (optional)
          <input type="number" min={1} value={d.usageLimit} onChange={(event) => set("usageLimit", event.target.value)} placeholder="No limit" inputMode="numeric" className={input} />
          <span className={hint}>An order counts once, however many products it took effect on. It stops by itself when they are used up.</span>
        </label>
        <label className={`${label} max-w-56`}>
          Orders for each customer (optional)
          <input type="number" min={1} value={d.perCustomerLimit} onChange={(event) => set("perCustomerLimit", event.target.value)} placeholder="No limit" inputMode="numeric" className={input} />
          <span className={hint}>Once per customer is 1. Shoppers must be signed in to My account to get it, so the store knows who they are; the product pages say so.</span>
        </label>
        <label className="flex items-center gap-3 text-sm font-medium">
          <input type="checkbox" checked={d.active} onChange={(event) => set("active", event.target.checked)} className="size-4" />
          Switched on
        </label>
      </section>

      {markets.length > 1 && (
        <section aria-labelledby="where-heading" className={card}>
          <h2 id="where-heading" className="text-title text-ink">
            Where
          </h2>
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">Countries</legend>
            <label className="flex min-h-10 items-center gap-3 text-sm">
              <input type="radio" name="where" checked={d.markets.length === 0} onChange={() => set("markets", [])} className="size-4" />
              Every country the store sells to
            </label>
            <label className="flex min-h-10 items-center gap-3 text-sm">
              <input type="radio" name="where" checked={d.markets.length > 0} onChange={() => d.markets.length === 0 && set("markets", [markets[0].code])} className="size-4" />
              Only some countries
            </label>
          </fieldset>
          {d.markets.length > 0 && (
            <ul className="grid gap-1 rounded-md border border-line p-2 sm:grid-cols-3">
              {markets.map((market) => (
                <li key={market.code}>
                  <label className="flex min-h-10 items-center gap-3 rounded px-2 text-sm hover:bg-sunken">
                    <input type="checkbox" checked={d.markets.includes(market.code)} onChange={(event) => toggle("markets", market.code, event.target.checked)} className="size-4" />
                    {market.name}
                  </label>
                </li>
              ))}
            </ul>
          )}
          <p className={hint}>A free product over an amount also needs the amount for each country it runs in.</p>
        </section>
      )}

      <section aria-labelledby="who-heading" className={card}>
        <h2 id="who-heading" className="text-title text-ink">
          Who
        </h2>
        {tiers.length === 0 ? (
          <p className="text-sm text-muted">It is for every shopper. Make customer groups under Customer groups to give a campaign to some customers only.</p>
        ) : (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">Who it is for</legend>
              <label className="flex min-h-10 items-center gap-3 text-sm">
                <input type="radio" name="who" checked={d.tierIds.length === 0} onChange={() => set("tierIds", [])} className="size-4" />
                Every shopper
              </label>
              <label className="flex min-h-10 items-center gap-3 text-sm">
                <input type="radio" name="who" checked={d.tierIds.length > 0} onChange={() => d.tierIds.length === 0 && set("tierIds", [tiers[0].id])} className="size-4" />
                Only customers in these groups
              </label>
            </fieldset>
            {d.tierIds.length > 0 && (
              <ul className="grid gap-1 rounded-md border border-line p-2 sm:grid-cols-2">
                {tiers.map((tier) => (
                  <li key={tier.id}>
                    <label className="flex min-h-10 items-center gap-3 rounded px-2 text-sm hover:bg-sunken">
                      <input type="checkbox" checked={d.tierIds.includes(tier.id)} onChange={(event) => toggle("tierIds", tier.id, event.target.checked)} className="size-4" />
                      {tier.name}
                      {!tier.active && <span className={hint}> (switched off)</span>}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <p className={hint}>
              Shoppers must be signed in to My account. A company&apos;s employees are in its group. A campaign for chosen groups is not announced on product pages, which are the same for everyone.
            </p>
          </>
        )}
      </section>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving} className="min-h-11 rounded-pill bg-brand px-5 font-medium text-brand-ink disabled:opacity-50">
          {saving ? "Saving …" : "Save campaign"}
        </button>
        <a href={back} className="text-sm underline">
          Cancel
        </a>
      </div>
    </form>
  );
}
