"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { StoreDiscountInput } from "@/lib/discounts";

type Save = (input: StoreDiscountInput) => Promise<{ ok: true; id?: string } | { ok: false; problems: string[] }>;
type Market = { code: string; name: string; currency: string };

export type DiscountDraft = {
  code: string;
  kind: "percent" | "fixed" | "free_shipping";
  percent: string;
  amounts: Record<string, string>;
  minSubtotals: Record<string, string>;
  productIds: string[] | null;
  recurring: boolean;
  startsAt: string;
  endsAt: string;
  usageLimit: string;
  oncePerCustomer: boolean;
  active: boolean;
  /** Categories and tags it reaches (D299 E1). */
  termIds: string[];
  minQuantity: string;
  tierIds: string[];
  /** The named customers' emails, one per line. */
  customerEmails: string;
  uniqueCodes: boolean;
};

type Who = "everyone" | "groups" | "customers";

const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm font-normal";
const label = "flex flex-col gap-1 text-sm font-medium";
const hint = "text-xs font-normal text-muted";
const card = "flex flex-col gap-4 rounded-lg border border-line bg-card p-5";

/**
 * A store's discount code (D31): what it gives, on what, when and how
 * often. Saved as a whole; nothing changes for shoppers until then.
 */
export function DiscountEditor({
  initial,
  markets,
  products,
  used,
  save,
  back,
  subscriptions = true,
  terms = [],
  tiers = [],
}: {
  terms?: { id: string; name: string; kind: "category" | "tag"; parentId: string | null }[];
  tiers?: { id: string; name: string; active: boolean }[];
  /** Subscriptions is on (D178): only then is "keep it on every renewal" offered (a code that already has it keeps the tick). */
  subscriptions?: boolean;
  initial: DiscountDraft;
  markets: Market[];
  products: { id: string; title: string }[];
  /** Orders that have used the code; they keep what they got whatever changes. */
  used: number;
  save: Save;
  back: string;
}) {
  const router = useRouter();
  const [d, setD] = useState(initial);
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, startSaving] = useTransition();
  const set = <K extends keyof DiscountDraft>(key: K, value: DiscountDraft[K]) => setD((current) => ({ ...current, [key]: value }));
  const [some, setSome] = useState(initial.productIds !== null || initial.termIds.length > 0);
  const [who, setWho] = useState<Who>(initial.customerEmails.trim() ? "customers" : initial.tierIds.length > 0 ? "groups" : "everyone");
  const chosen = d.productIds ?? [];
  const categories = terms.filter((term) => term.kind === "category");
  const tags = terms.filter((term) => term.kind === "tag");
  // A subcategory is shown under its parent's name, so "Shoes › Sneakers" reads as it is.
  const path = (term: { name: string; parentId: string | null }): string => {
    const parent = term.parentId ? terms.find((t) => t.id === term.parentId) : null;
    return parent ? `${path(parent)} › ${term.name}` : term.name;
  };

  const submit = () =>
    startSaving(async () => {
      const result = await save({
        code: d.code,
        kind: d.kind,
        percent: d.percent,
        amounts: d.amounts,
        minSubtotals: d.minSubtotals,
        // Some: the chosen products, or none (null) when only categories and tags are chosen.
        productIds: some ? (chosen.length > 0 || d.termIds.length === 0 ? chosen : null) : null,
        termIds: some ? d.termIds : [],
        minQuantity: d.minQuantity || null,
        tierIds: who === "groups" ? d.tierIds : [],
        customerEmails: who === "customers" ? d.customerEmails : "",
        uniqueCodes: d.uniqueCodes,
        recurring: d.kind === "percent" && d.recurring,
        startsAt: d.startsAt || null,
        endsAt: d.endsAt || null,
        usageLimit: d.uniqueCodes ? null : d.usageLimit || null,
        oncePerCustomer: !d.uniqueCodes && d.oncePerCustomer,
        active: d.active,
      } as StoreDiscountInput);
      if (result.ok) {
        router.push(back);
        router.refresh();
      } else {
        setProblems(result.problems);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });

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

      <section aria-labelledby="code-heading" className={card}>
        <h2 id="code-heading" className="text-title text-ink">
          The code
        </h2>
        <label className={label}>
          Code shoppers type
          <input
            value={d.code}
            onChange={(event) => set("code", event.target.value.toUpperCase())}
            required
            maxLength={40}
            autoCapitalize="characters"
            spellCheck={false}
            className={`${input} font-mono uppercase`}
            aria-describedby="code-hint"
          />
          <span id="code-hint" className={hint}>
            3–40 letters, digits, - or _. Shoppers can type it in any case.
            {used > 0 &&
              ` Used by ${used} ${used === 1 ? "order" : "orders"}: they keep what they got, whatever you change here.`}
          </span>
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">What it gives</legend>
          {(
            [
              ["percent", "A percentage off"],
              ["fixed", "An amount off"],
              ["free_shipping", "Free shipping"],
            ] as const
          ).map(([value, text]) => (
            <label key={value} className="flex min-h-10 items-center gap-3 text-sm">
              <input type="radio" name="kind" checked={d.kind === value} onChange={() => set("kind", value)} className="size-4" />
              {text}
            </label>
          ))}
        </fieldset>
        {d.kind === "percent" && (
          <>
            <label className={`${label} max-w-40`}>
              Percent off
              <input
                type="number"
                min={1}
                max={100}
                value={d.percent}
                onChange={(event) => set("percent", event.target.value)}
                required
                inputMode="numeric"
                className={input}
              />
            </label>
            {(subscriptions || initial.recurring) && (
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={d.recurring}
                onChange={(event) => set("recurring", event.target.checked)}
                className="mt-0.5 size-4"
              />
              <span>
                Keep the discount on every renewal of a subscription
                <span className={`block ${hint}`}>Otherwise it only lowers the first payment.</span>
              </span>
            </label>
            )}
          </>
        )}
        {d.kind === "fixed" && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Amount off, in each country&apos;s currency</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {markets.map((market) => (
                <label key={market.code} className={label}>
                  {market.name} ({market.currency})
                  <input
                    value={d.amounts[market.code] ?? ""}
                    onChange={(event) => set("amounts", { ...d.amounts, [market.code]: event.target.value })}
                    inputMode="decimal"
                    placeholder="Not offered"
                    className={input}
                  />
                </label>
              ))}
            </div>
            <p className={hint}>Leave a country empty and the code does not work there. It never takes more off than the items cost.</p>
          </div>
        )}
        {d.kind === "free_shipping" && (
          <p className="text-sm text-muted">Shipping is free on the order the code is used on (for a subscription, its first delivery).</p>
        )}
      </section>

      <section aria-labelledby="applies-heading" className={card}>
        <h2 id="applies-heading" className="text-title text-ink">
          What it applies to
        </h2>
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Products</legend>
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input type="radio" name="scope" checked={!some} onChange={() => setSome(false)} className="size-4" />
            Everything in the store
          </label>
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input type="radio" name="scope" checked={some} onChange={() => setSome(true)} className="size-4" />
            Only some products, categories or tags
          </label>
        </fieldset>
        {some && (
          <div className="flex flex-col gap-4">
            {categories.length + tags.length > 0 && (
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium">Categories and tags</legend>
                <ul className="grid max-h-56 gap-1 overflow-y-auto rounded-md border border-line p-2 sm:grid-cols-2">
                  {[...categories, ...tags].map((term) => (
                    <li key={term.id}>
                      <label className="flex min-h-10 items-center gap-3 rounded px-2 text-sm hover:bg-sunken">
                        <input
                          type="checkbox"
                          checked={d.termIds.includes(term.id)}
                          onChange={(event) => set("termIds", event.target.checked ? [...d.termIds, term.id] : d.termIds.filter((id) => id !== term.id))}
                          className="size-4"
                        />
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
                      <input
                        type="checkbox"
                        checked={chosen.includes(product.id)}
                        onChange={(event) => set("productIds", event.target.checked ? [...chosen, product.id] : chosen.filter((id) => id !== product.id))}
                        className="size-4"
                      />
                      {product.title}
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          </div>
        )}
        <label className={`${label} max-w-56`}>
          Minimum number of items (optional)
          <input
            type="number"
            min={1}
            max={1000}
            value={d.minQuantity}
            onChange={(event) => set("minQuantity", event.target.value)}
            placeholder="None"
            inputMode="numeric"
            className={input}
          />
          <span className={hint}>Of what it applies to, bought once (not subscriptions).</span>
        </label>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Minimum order (optional)</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {markets.map((market) => (
              <label key={market.code} className={label}>
                {market.name} ({market.currency})
                <input
                  value={d.minSubtotals[market.code] ?? ""}
                  onChange={(event) => set("minSubtotals", { ...d.minSubtotals, [market.code]: event.target.value })}
                  inputMode="decimal"
                  placeholder="None"
                  className={input}
                />
              </label>
            ))}
          </div>
          <p className={hint}>What the items must come to before shipping.</p>
        </div>
      </section>

      <section aria-labelledby="who-heading" className={card}>
        <h2 id="who-heading" className="text-title text-ink">
          Who can use it
        </h2>
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Who can use it</legend>
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input type="radio" name="who" checked={who === "everyone"} onChange={() => setWho("everyone")} className="size-4" />
            Every shopper who has the code
          </label>
          {tiers.length > 0 && (
            <label className="flex min-h-10 items-center gap-3 text-sm">
              <input type="radio" name="who" checked={who === "groups"} onChange={() => setWho("groups")} className="size-4" />
              Only customers in these groups
            </label>
          )}
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input type="radio" name="who" checked={who === "customers"} onChange={() => setWho("customers")} className="size-4" />
            Only these customers
          </label>
        </fieldset>
        {who === "groups" && (
          <ul className="grid gap-1 rounded-md border border-line p-2 sm:grid-cols-2">
            {tiers.map((tier) => (
              <li key={tier.id}>
                <label className="flex min-h-10 items-center gap-3 rounded px-2 text-sm hover:bg-sunken">
                  <input
                    type="checkbox"
                    checked={d.tierIds.includes(tier.id)}
                    onChange={(event) => set("tierIds", event.target.checked ? [...d.tierIds, tier.id] : d.tierIds.filter((id) => id !== tier.id))}
                    className="size-4"
                  />
                  {tier.name}
                  {!tier.active && <span className={hint}> (switched off)</span>}
                </label>
              </li>
            ))}
          </ul>
        )}
        {who === "customers" && (
          <label className={label}>
            Their emails
            <textarea
              value={d.customerEmails}
              onChange={(event) => set("customerEmails", event.target.value)}
              rows={4}
              placeholder="kari@example.com"
              className="w-full rounded-md border border-line bg-card px-3 py-2 text-sm font-normal"
            />
            <span className={hint}>One per line, at most 100. Each must be a customer of the store.</span>
          </label>
        )}
        {who !== "everyone" && <p className={hint}>Shoppers must be signed in to My account. A company&apos;s employees are in its group.</p>}
      </section>

      <section aria-labelledby="limits-heading" className={card}>
        <h2 id="limits-heading" className="text-title text-ink">
          When and how often
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
        <p className={hint}>Norwegian time. Without dates, the code works while it is switched on.</p>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={d.uniqueCodes} onChange={(event) => set("uniqueCodes", event.target.checked)} className="mt-0.5 size-4" />
          <span>
            Hand out single-use codes instead
            <span className={`block ${hint}`}>Shoppers use codes you make on the next page, each once. The code above is then its name only.</span>
          </span>
        </label>
        {!d.uniqueCodes && (
        <>
        <label className={`${label} max-w-56`}>
          Uses in all (optional)
          <input
            type="number"
            min={1}
            value={d.usageLimit}
            onChange={(event) => set("usageLimit", event.target.value)}
            placeholder="No limit"
            inputMode="numeric"
            className={input}
          />
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={d.oncePerCustomer}
            onChange={(event) => set("oncePerCustomer", event.target.checked)}
            className="mt-0.5 size-4"
          />
          <span>
            Once per customer
            <span className={`block ${hint}`}>Shoppers must sign in to My account to use it, so Kaizena Flow knows who they are.</span>
          </span>
        </label>
        </>
        )}
        <label className="flex items-center gap-3 text-sm font-medium">
          <input type="checkbox" checked={d.active} onChange={(event) => set("active", event.target.checked)} className="size-4" />
          Switched on
        </label>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="min-h-11 rounded-pill bg-brand px-5 font-medium text-brand-ink disabled:opacity-50"
        >
          {saving ? "Saving …" : "Save code"}
        </button>
        <a href={back} className="text-sm underline">
          Cancel
        </a>
      </div>
    </form>
  );
}
