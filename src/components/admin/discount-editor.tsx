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
};

const input = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm font-normal";
const label = "flex flex-col gap-1 text-sm font-medium";
const hint = "text-xs font-normal text-muted";
const card = "flex flex-col gap-4 rounded-lg border border-border bg-background p-5";

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
}: {
  initial: DiscountDraft;
  markets: Market[];
  products: { id: string; title: string }[];
  /** Orders that have used the code: its text and kind are then fixed. */
  used: number;
  save: Save;
  back: string;
}) {
  const router = useRouter();
  const [d, setD] = useState(initial);
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, startSaving] = useTransition();
  const set = <K extends keyof DiscountDraft>(key: K, value: DiscountDraft[K]) => setD((current) => ({ ...current, [key]: value }));
  const locked = used > 0;

  const submit = () =>
    startSaving(async () => {
      const result = await save({
        code: d.code,
        kind: d.kind,
        percent: d.percent,
        amounts: d.amounts,
        minSubtotals: d.minSubtotals,
        productIds: d.productIds,
        recurring: d.kind === "percent" && d.recurring,
        startsAt: d.startsAt || null,
        endsAt: d.endsAt || null,
        usageLimit: d.usageLimit || null,
        oncePerCustomer: d.oncePerCustomer,
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
        <div role="alert" className="rounded-lg border border-red-700 p-4 text-sm">
          <p className="font-medium">Nothing was saved yet. Please fix:</p>
          <ul className="mt-2 list-disc pl-5">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      <section aria-labelledby="code-heading" className={card}>
        <h2 id="code-heading" className="font-medium">
          The code
        </h2>
        <label className={label}>
          Code shoppers type
          <input
            value={d.code}
            onChange={(event) => set("code", event.target.value.toUpperCase())}
            disabled={locked}
            required
            maxLength={40}
            autoCapitalize="characters"
            spellCheck={false}
            className={`${input} font-mono uppercase`}
            aria-describedby="code-hint"
          />
          <span id="code-hint" className={hint}>
            {locked
              ? `Used by ${used} ${used === 1 ? "order" : "orders"}, so the code and its kind stay as they are.`
              : "3–40 letters, digits, - or _. Shoppers can type it in any case."}
          </span>
        </label>
        <fieldset className="flex flex-col gap-2" disabled={locked}>
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
        <h2 id="applies-heading" className="font-medium">
          What it applies to
        </h2>
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Products</legend>
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input type="radio" name="scope" checked={d.productIds === null} onChange={() => set("productIds", null)} className="size-4" />
            Everything in the store
          </label>
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input
              type="radio"
              name="scope"
              checked={d.productIds !== null}
              onChange={() => set("productIds", d.productIds ?? [])}
              className="size-4"
            />
            Only some products
          </label>
        </fieldset>
        {d.productIds !== null && (
          <ul className="grid max-h-72 gap-1 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-2">
            {products.map((product) => (
              <li key={product.id}>
                <label className="flex min-h-10 items-center gap-3 rounded px-2 text-sm hover:bg-surface">
                  <input
                    type="checkbox"
                    checked={d.productIds!.includes(product.id)}
                    onChange={(event) =>
                      set(
                        "productIds",
                        event.target.checked
                          ? [...d.productIds!, product.id]
                          : d.productIds!.filter((id) => id !== product.id),
                      )
                    }
                    className="size-4"
                  />
                  {product.title}
                </label>
              </li>
            ))}
          </ul>
        )}
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

      <section aria-labelledby="limits-heading" className={card}>
        <h2 id="limits-heading" className="font-medium">
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
            <span className={`block ${hint}`}>Shoppers must sign in to My account to use it, so Kaizen knows who they are.</span>
          </span>
        </label>
        <label className="flex items-center gap-3 text-sm font-medium">
          <input type="checkbox" checked={d.active} onChange={(event) => set("active", event.target.checked)} className="size-4" />
          Switched on
        </label>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="min-h-11 rounded-md bg-foreground px-5 font-medium text-background disabled:opacity-50"
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
