"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { CAMPAIGN_NAME_MAX, GIFT_QUANTITY_MAX, MULTI_BUY_MAX, type CampaignInput, type CampaignKind } from "@/lib/campaigns";

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

const input = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm font-normal";
const label = "flex flex-col gap-1 text-sm font-medium";
const hint = "text-xs font-normal text-muted";
const card = "flex flex-col gap-4 rounded-lg border border-border bg-background p-5";

const KINDS: { value: CampaignKind; title: string; text: string }[] = [
  { value: "percent", title: "A percentage off", text: "For example 20 % off the chosen products, without a code." },
  { value: "multi_buy", title: "Buy more, pay for fewer", text: "3 for 2: the cheapest of every three is free." },
  { value: "gift", title: "A free product", text: "Added to the order, free, when the basket comes to an amount." },
];

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
  const toggle = (key: "productIds" | "termIds" | "tierIds" | "markets", id: string, on: boolean) => set(key, on ? [...d[key], id] : d[key].filter((x) => x !== id));

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
        scope: d.scope,
        productIds: d.productIds,
        termIds: d.termIds,
        tierIds: d.tierIds,
        usageLimit: d.usageLimit || null,
        perCustomerLimit: d.perCustomerLimit || null,
        markets: d.markets,
        stacks: d.kind !== "gift" && d.stacks,
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
  const scopeWord = d.kind === "gift" ? "What counts towards the amount" : "What it applies to";

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex flex-col gap-6"
    >
      {problems.length > 0 && (
        <div role="alert" className="rounded-lg border border-red-700 p-4 text-sm">
          <p className="font-medium">Nothing was saved yet. Please fix:</p>
          <ul className="mt-2 list-disc pl-5">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      <section aria-labelledby="campaign-heading" className={card}>
        <h2 id="campaign-heading" className="font-medium">
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
            <label key={kind.value} className="flex items-start gap-3 rounded-md border border-border p-3 text-sm has-[:checked]:border-foreground">
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
        {d.kind !== "gift" && (
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
        <h2 id="applies-heading" className="font-medium">
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
                <ul className="grid max-h-56 gap-1 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-2">
                  {[...categories, ...tags].map((term) => (
                    <li key={term.id}>
                      <label className="flex min-h-10 items-center gap-3 rounded px-2 text-sm hover:bg-surface">
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
              <ul className="grid max-h-72 gap-1 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-2">
                {products.map((product) => (
                  <li key={product.id}>
                    <label className="flex min-h-10 items-center gap-3 rounded px-2 text-sm hover:bg-surface">
                      <input type="checkbox" checked={d.productIds.includes(product.id)} onChange={(event) => toggle("productIds", product.id, event.target.checked)} className="size-4" />
                      {product.title}
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          </div>
        )}
        {d.kind !== "gift" && (
          <p className={hint}>
            Campaigns take money off goods bought once: not appointments, stays, rentals or subscriptions. Where two campaigns apply to the same products, the one that gives the shopper more is used. The buyer&apos;s customer group discount and any discount code come off what is left.
          </p>
        )}
      </section>

      <section aria-labelledby="when-heading" className={card}>
        <h2 id="when-heading" className="font-medium">
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
          <h2 id="where-heading" className="font-medium">
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
            <ul className="grid gap-1 rounded-md border border-border p-2 sm:grid-cols-3">
              {markets.map((market) => (
                <li key={market.code}>
                  <label className="flex min-h-10 items-center gap-3 rounded px-2 text-sm hover:bg-surface">
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
        <h2 id="who-heading" className="font-medium">
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
              <ul className="grid gap-1 rounded-md border border-border p-2 sm:grid-cols-2">
                {tiers.map((tier) => (
                  <li key={tier.id}>
                    <label className="flex min-h-10 items-center gap-3 rounded px-2 text-sm hover:bg-surface">
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
        <button type="submit" disabled={saving} className="min-h-11 rounded-md bg-foreground px-5 font-medium text-background disabled:opacity-50">
          {saving ? "Saving …" : "Save campaign"}
        </button>
        <a href={back} className="text-sm underline">
          Cancel
        </a>
      </div>
    </form>
  );
}
