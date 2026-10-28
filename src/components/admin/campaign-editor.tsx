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
import { countWords, fillWords } from "@/lib/admin-fill";

import { useAdminText } from "./admin-text";

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
  /** Whether discount codes may be used beside it (D367). */
  combinesWithCodes: boolean;
  /** A segment whose people get it (D380). */
  segmentId: string | null;
  startsAt: string;
  endsAt: string;
  active: boolean;
};

const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm font-normal";
const label = "flex flex-col gap-1 text-sm font-medium";
const hint = "text-xs font-normal text-muted";
const card = "flex flex-col gap-4 rounded-lg border border-line bg-card p-5";

/** The kinds in the order the editor offers them; their words are the catalogue's (`campaignEditor.kinds`). */
const KINDS: readonly CampaignKind[] = ["percent", "multi_buy", "amount", "tiered", "free_shipping", "bxgy", "gift"];

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
  segments = [],
  orders,
  save,
  back,
}: {
  /** The store's segments (D380), to give it to one's people. */
  segments?: { id: string; name: string }[];
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
  const t = useAdminText("discounts");
  const f = t.form;
  const w = t.campaignEditor;
  const router = useRouter();
  const [d, setD] = useState(initial);
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, startSaving] = useTransition();
  const set = <K extends keyof CampaignDraft>(key: K, value: CampaignDraft[K]) => setD((current) => ({ ...current, [key]: value }));
  const [who, setWho] = useState<"everyone" | "groups" | "segment">(initial.segmentId ? "segment" : initial.tierIds.length > 0 ? "groups" : "everyone");
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
        tierIds: who === "groups" ? d.tierIds : [],
        segmentId: who === "segment" ? d.segmentId : null,
        usageLimit: d.usageLimit || null,
        perCustomerLimit: d.perCustomerLimit || null,
        markets: d.markets,
        stacks: STACKING.includes(d.kind) && d.stacks,
        combinesWithCodes: d.combinesWithCodes,
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
  const scopeWord = d.kind === "bxgy" ? w.scopeBuy : d.kind === "gift" || d.kind === "free_shipping" ? w.scopeCounts : f.whatItAppliesTo;
  /** Fields for an amount in each country's currency. */
  const perMarket = (values: Record<string, string>, change: (next: Record<string, string>) => void, placeholder: string, prefix: string) => (
    <div className="grid gap-3 sm:grid-cols-3">
      {markets.map((market) => (
        <label key={market.code} className={label}>
          {fillWords(f.market, { name: market.name, currency: market.currency })}
          <input
            value={values[market.code] ?? ""}
            onChange={(event) => change({ ...values, [market.code]: event.target.value })}
            inputMode="decimal"
            placeholder={placeholder}
            aria-label={fillWords(w.fieldFor, { what: prefix, market: market.name })}
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
          <p className="font-medium">{f.fix}</p>
          <ul className="mt-2 list-disc pl-5">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      <section aria-labelledby="campaign-heading" className={card}>
        <h2 id="campaign-heading" className="text-title text-ink">
          {w.theCampaign}
        </h2>
        <label className={label}>
          {w.name}
          <input
            value={d.name}
            onChange={(event) => set("name", event.target.value)}
            required
            maxLength={CAMPAIGN_NAME_MAX}
            className={input}
            aria-describedby="name-hint"
          />
          <span id="name-hint" className={hint}>
            {w.nameHint}
            {orders > 0 && countWords(orders, w.ordersHint)}
          </span>
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">{f.whatItGives}</legend>
          {KINDS.map((kind) => (
            <label key={kind} className="flex items-start gap-3 rounded-md border border-line p-3 text-sm has-[:checked]:border-brand">
              <input type="radio" name="kind" checked={d.kind === kind} onChange={() => set("kind", kind)} className="mt-0.5 size-4" />
              <span>
                <span className="font-medium">{w.kinds[kind].title}</span>
                <span className={`block ${hint}`}>{w.kinds[kind].text}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {d.kind === "percent" && (
          <label className={`${label} max-w-40`}>
            {f.percentOff}
            <input type="number" min={1} max={100} value={d.percent} onChange={(event) => set("percent", event.target.value)} required inputMode="numeric" className={input} />
          </label>
        )}
        {d.kind === "amount" && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">{f.amountPerCountry}</p>
            {perMarket(d.amounts, (next) => set("amounts", next), f.notOffered, w.amountOff)}
            <p className={hint}>{w.amountHint}</p>
          </div>
        )}
        {(d.kind === "amount" || d.kind === "free_shipping") && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">{w.threshold}</p>
            {perMarket(d.thresholds, (next) => set("thresholds", next), w.anyBasket, w.basketComesTo)}
            <p className={hint}>{fillWords(w.thresholdHint, { after: d.kind === "free_shipping" ? w.afterReductions : "" })}</p>
          </div>
        )}
        {d.kind === "free_shipping" && (
          <p className={hint}>{w.freeShippingHint}</p>
        )}
        {d.kind === "tiered" && (
          <div className="flex flex-col gap-3">
            <fieldset className="flex flex-wrap gap-4">
              <legend className="mb-1 text-sm font-medium">{w.stepCounts}</legend>
              <label className="flex min-h-10 items-center gap-2 text-sm">
                <input type="radio" name="tierBasis" checked={d.tierBasis === "quantity"} onChange={() => set("tierBasis", "quantity")} className="size-4" />
                {w.itemsBought}
              </label>
              <label className="flex min-h-10 items-center gap-2 text-sm">
                <input type="radio" name="tierBasis" checked={d.tierBasis === "spend"} onChange={() => set("tierBasis", "spend")} className="size-4" />
                {w.basketTotal}
              </label>
            </fieldset>
            <ol className="flex flex-col gap-3">
              {d.tiers.map((tier, i) => (
                <li key={i} className="flex flex-col gap-2 rounded-md border border-line p-3">
                  <div className="flex flex-wrap items-end gap-3">
                    <span className="text-sm font-medium">{fillWords(w.step, { n: i + 1 })}</span>
                    {d.tierBasis === "quantity" && (
                      <label className={`${label} w-32`}>
                        {w.fromItems}
                        <input type="number" min={1} max={TIER_QUANTITY_MAX} value={tier.quantity} onChange={(event) => setTier(i, { quantity: event.target.value })} required inputMode="numeric" className={input} />
                      </label>
                    )}
                    <label className={`${label} w-32`}>
                      {f.percentOff}
                      <input type="number" min={1} max={100} value={tier.percent} onChange={(event) => setTier(i, { percent: event.target.value })} required inputMode="numeric" className={input} />
                    </label>
                    {d.tiers.length > TIERS_MIN && (
                      <button type="button" onClick={() => set("tiers", d.tiers.filter((_, j) => j !== i))} className="min-h-10 rounded-pill px-3 text-sm underline">
                        {fillWords(w.removeStep, { n: i + 1 })}
                      </button>
                    )}
                  </div>
                  {d.tierBasis === "spend" && perMarket(tier.amounts, (next) => setTier(i, { amounts: next }), f.notOffered, fillWords(w.stepFrom, { n: i + 1 }))}
                </li>
              ))}
            </ol>
            {d.tiers.length < TIERS_MAX && (
              <button
                type="button"
                onClick={() => set("tiers", [...d.tiers, { quantity: "", amounts: {}, percent: "" }])}
                className="self-start rounded-pill border border-line px-4 py-2 text-sm"
              >
                {w.addStep}
              </button>
            )}
            <p className={hint}>{w.tiersHint}</p>
          </div>
        )}
        {d.kind === "bxgy" && (
          <div className="flex flex-col gap-3">
            <fieldset className="flex flex-wrap gap-4">
              <legend className="mb-1 text-sm font-medium">{w.theyBuy}</legend>
              <label className="flex min-h-10 items-center gap-2 text-sm">
                <input type="radio" name="buyBasis" checked={d.buyBasis === "items"} onChange={() => set("buyBasis", "items")} className="size-4" />
                {w.numberOfItems}
              </label>
              <label className="flex min-h-10 items-center gap-2 text-sm">
                <input type="radio" name="buyBasis" checked={d.buyBasis === "spend"} onChange={() => set("buyBasis", "spend")} className="size-4" />
                {w.forAnAmount}
              </label>
            </fieldset>
            {d.buyBasis === "items" ? (
              <label className={`${label} w-32`}>
                {w.items}
                <input type="number" min={1} max={BUY_MIN_MAX} value={d.buyMinQuantity} onChange={(event) => set("buyMinQuantity", event.target.value)} required inputMode="numeric" className={input} />
              </label>
            ) : (
              perMarket(d.buyMinAmounts, (next) => set("buyMinAmounts", next), f.notOffered, w.theySpend)
            )}
            <div className="flex flex-wrap items-end gap-3">
              <label className={`${label} w-32`}>
                {w.theyGet}
                <input type="number" min={1} max={GET_QUANTITY_MAX} value={d.getQuantity} onChange={(event) => set("getQuantity", event.target.value)} required inputMode="numeric" className={input} />
              </label>
              <label className={`${label} w-56`}>
                {w.at}
                <select value={d.getKind} onChange={(event) => set("getKind", event.target.value as GetKind)} className={input}>
                  <option value="free">{w.getKinds.free}</option>
                  <option value="percent">{w.getKinds.percent}</option>
                  <option value="amount">{w.getKinds.amount}</option>
                </select>
              </label>
              {d.getKind === "percent" && (
                <label className={`${label} w-32`}>
                  {f.percentOff}
                  <input type="number" min={1} max={100} value={d.getPercent} onChange={(event) => set("getPercent", event.target.value)} required inputMode="numeric" className={input} />
                </label>
              )}
            </div>
            {d.getKind === "amount" && perMarket(d.getAmounts, (next) => set("getAmounts", next), f.notOffered, w.offEach)}
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">{w.whatTheyGet}</legend>
              <label className="flex min-h-10 items-center gap-3 text-sm">
                <input type="radio" name="getScope" checked={d.getScope === "same"} onChange={() => set("getScope", "same")} className="size-4" />
                {w.getSame}
              </label>
              <label className="flex min-h-10 items-center gap-3 text-sm">
                <input type="radio" name="getScope" checked={d.getScope === "some"} onChange={() => set("getScope", "some")} className="size-4" />
                {w.getOther}
              </label>
            </fieldset>
            {d.getScope === "some" && (
              <ul className="grid max-h-72 gap-1 overflow-y-auto rounded-md border border-line p-2 sm:grid-cols-2" aria-label={w.whatTheyGet}>
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
              {w.usesPerOrder}
              <input type="number" min={1} max={USES_PER_ORDER_MAX} value={d.usesPerOrder} onChange={(event) => set("usesPerOrder", event.target.value)} placeholder={w.asOften} inputMode="numeric" className={input} />
            </label>
            <p className={hint}>{w.bxgyHint}</p>
          </div>
        )}
        {STACKING.includes(d.kind) && (
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" checked={d.stacks} onChange={(event) => set("stacks", event.target.checked)} className="mt-0.5 size-4" />
            <span>
              {w.stacks}
              <span className={`block ${hint}`}>{fillWords(w.stacksHint, { how: d.kind === "multi_buy" ? w.stacksMulti : w.stacksPercent })}</span>
            </span>
          </label>
        )}
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={d.combinesWithCodes} onChange={(event) => set("combinesWithCodes", event.target.checked)} className="mt-0.5 size-4" />
          <span>
            {w.withCodes}
            <span className={`block ${hint}`}>{w.withCodesHint}</span>
          </span>
        </label>

        {d.kind === "multi_buy" && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-end gap-3">
              <label className={`${label} w-32`}>
                {w.buys}
                <input type="number" min={2} max={MULTI_BUY_MAX} value={d.buyQuantity} onChange={(event) => set("buyQuantity", event.target.value)} required inputMode="numeric" className={input} />
              </label>
              <label className={`${label} w-32`}>
                {w.paysFor}
                <input type="number" min={1} max={MULTI_BUY_MAX} value={d.payQuantity} onChange={(event) => set("payQuantity", event.target.value)} required inputMode="numeric" className={input} />
              </label>
            </div>
            <p className={hint}>
              {fillWords(w.multiHint, {
                buy: d.buyQuantity || "N",
                free: countWords(Number(d.buyQuantity) - Number(d.payQuantity) > 1 ? Number(d.buyQuantity) - Number(d.payQuantity) : 1, w.multiFree),
              })}
            </p>
          </div>
        )}

        {d.kind === "gift" && (
          <>
            <label className={label}>
              {w.giftProduct}
              <select value={d.giftVariantId} onChange={(event) => set("giftVariantId", event.target.value)} required className={input}>
                <option value="">{w.chooseProduct}</option>
                {gifts.map((gift) => (
                  <option key={gift.variantId} value={gift.variantId}>
                    {gift.label}
                  </option>
                ))}
              </select>
              <span className={hint}>{w.giftHint}</span>
            </label>
            <label className={`${label} w-40`}>
              {w.howMany}
              <input type="number" min={1} max={GIFT_QUANTITY_MAX} value={d.giftQuantity} onChange={(event) => set("giftQuantity", event.target.value)} required inputMode="numeric" className={input} />
            </label>
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">{w.giftThreshold}</p>
              <div className="grid gap-3 sm:grid-cols-3">
                {markets.map((market) => (
                  <label key={market.code} className={label}>
                    {fillWords(f.market, { name: market.name, currency: market.currency })}
                    <input
                      value={d.thresholds[market.code] ?? ""}
                      onChange={(event) => set("thresholds", { ...d.thresholds, [market.code]: event.target.value })}
                      inputMode="decimal"
                      placeholder={f.notOffered}
                      className={input}
                    />
                  </label>
                ))}
              </div>
              <p className={hint}>{w.giftThresholdHint}</p>
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
            {f.everything}
          </label>
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input type="radio" name="scope" checked={d.scope === "some"} onChange={() => set("scope", "some")} className="size-4" />
            {f.some}
          </label>
        </fieldset>
        {d.scope === "some" && (
          <div className="flex flex-col gap-4">
            {categories.length + tags.length > 0 && (
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium">{f.categoriesAndTags}</legend>
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
                <p className={hint}>{f.subcategories}</p>
              </fieldset>
            )}
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">{f.products}</legend>
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
          <p className={hint}>{w.goodsHint}</p>
        )}
      </section>

      <section aria-labelledby="when-heading" className={card}>
        <h2 id="when-heading" className="text-title text-ink">
          {w.when}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={label}>
            {f.starts}
            <input type="datetime-local" value={d.startsAt} onChange={(event) => set("startsAt", event.target.value)} className={input} />
          </label>
          <label className={label}>
            {f.ends}
            <input type="datetime-local" value={d.endsAt} onChange={(event) => set("endsAt", event.target.value)} className={input} />
          </label>
        </div>
        <p className={hint}>{w.dateHint}</p>
        <label className={`${label} max-w-56`}>
          {w.usageLimit}
          <input type="number" min={1} value={d.usageLimit} onChange={(event) => set("usageLimit", event.target.value)} placeholder={f.noLimit} inputMode="numeric" className={input} />
          <span className={hint}>{w.usageLimitHint}</span>
        </label>
        <label className={`${label} max-w-56`}>
          {w.perCustomer}
          <input type="number" min={1} value={d.perCustomerLimit} onChange={(event) => set("perCustomerLimit", event.target.value)} placeholder={f.noLimit} inputMode="numeric" className={input} />
          <span className={hint}>{w.perCustomerHint}</span>
        </label>
        <label className="flex items-center gap-3 text-sm font-medium">
          <input type="checkbox" checked={d.active} onChange={(event) => set("active", event.target.checked)} className="size-4" />
          {f.switchedOn}
        </label>
      </section>

      {markets.length > 1 && (
        <section aria-labelledby="where-heading" className={card}>
          <h2 id="where-heading" className="text-title text-ink">
            {w.where}
          </h2>
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">{w.countries}</legend>
            <label className="flex min-h-10 items-center gap-3 text-sm">
              <input type="radio" name="where" checked={d.markets.length === 0} onChange={() => set("markets", [])} className="size-4" />
              {w.everyCountry}
            </label>
            <label className="flex min-h-10 items-center gap-3 text-sm">
              <input type="radio" name="where" checked={d.markets.length > 0} onChange={() => d.markets.length === 0 && set("markets", [markets[0].code])} className="size-4" />
              {w.someCountries}
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
          <p className={hint}>{w.whereHint}</p>
        </section>
      )}

      <section aria-labelledby="who-heading" className={card}>
        <h2 id="who-heading" className="text-title text-ink">
          {w.who}
        </h2>
        {tiers.length === 0 && segments.length === 0 ? (
          <p className="text-sm text-muted">{w.noGroups}</p>
        ) : (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">{w.whoFor}</legend>
              <label className="flex min-h-10 items-center gap-3 text-sm">
                <input type="radio" name="who" checked={who === "everyone"} onChange={() => setWho("everyone")} className="size-4" />
                {w.everyShopper}
              </label>
              {tiers.length > 0 && (
                <label className="flex min-h-10 items-center gap-3 text-sm">
                  <input
                    type="radio"
                    name="who"
                    checked={who === "groups"}
                    onChange={() => {
                      setWho("groups");
                      if (d.tierIds.length === 0) set("tierIds", [tiers[0].id]);
                    }}
                    className="size-4"
                  />
                  {f.groupsOnly}
                </label>
              )}
              {segments.length > 0 && (
                <label className="flex min-h-10 items-center gap-3 text-sm">
                  <input type="radio" name="who" checked={who === "segment"} onChange={() => setWho("segment")} className="size-4" />
                  {t.editor.segmentOnly}
                </label>
              )}
            </fieldset>
            {who === "groups" && (
              <ul className="grid gap-1 rounded-md border border-line p-2 sm:grid-cols-2">
                {tiers.map((tier) => (
                  <li key={tier.id}>
                    <label className="flex min-h-10 items-center gap-3 rounded px-2 text-sm hover:bg-sunken">
                      <input type="checkbox" checked={d.tierIds.includes(tier.id)} onChange={(event) => toggle("tierIds", tier.id, event.target.checked)} className="size-4" />
                      {tier.name}
                      {!tier.active && <span className={hint}>{f.switchedOffTag}</span>}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {who === "segment" && (
              <label className="flex flex-col gap-1 text-sm">
                {t.editor.segment}
                <select value={d.segmentId ?? ""} onChange={(event) => set("segmentId", event.target.value || null)} className="min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm">
                  <option value="">{t.editor.chooseSegment}</option>
                  {segments.map((segment) => (
                    <option key={segment.id} value={segment.id}>
                      {segment.name}
                    </option>
                  ))}
                </select>
                <span className={hint}>{t.editor.segmentHint}</span>
              </label>
            )}
            {who === "groups" && <p className={hint}>{w.groupsHint}</p>}
          </>
        )}
      </section>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving} className="min-h-11 rounded-pill bg-brand px-5 font-medium text-brand-ink disabled:opacity-50">
          {saving ? f.saving : w.save}
        </button>
        <a href={back} className="text-sm underline">
          {f.cancel}
        </a>
      </div>
    </form>
  );
}
