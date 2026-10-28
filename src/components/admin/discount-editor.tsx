"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { countWords, fillWords } from "@/lib/admin-fill";
import type { StoreDiscountInput } from "@/lib/discounts";

import { useAdminText } from "./admin-text";

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
  /** The classes of other codes it may be used with (D299 E2). */
  combinesWith: ("products" | "order" | "shipping")[];
  /** Whether it may be used beside the store's campaigns (D367). */
  combinesWithCampaigns: boolean;
  /** A segment whose people may use it (D380). */
  segmentId: string | null;
};

type Who = "everyone" | "groups" | "customers" | "segment";

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
  segments = [],
}: {
  /** The store's segments (D380), to limit the code to one's people. */
  segments?: { id: string; name: string }[];
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
  const t = useAdminText("discounts");
  const f = t.form;
  const w = t.editor;
  const router = useRouter();
  const [d, setD] = useState(initial);
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, startSaving] = useTransition();
  const set = <K extends keyof DiscountDraft>(key: K, value: DiscountDraft[K]) => setD((current) => ({ ...current, [key]: value }));
  const [some, setSome] = useState(initial.productIds !== null || initial.termIds.length > 0);
  const [who, setWho] = useState<Who>(
    initial.segmentId ? "segment" : initial.customerEmails.trim() ? "customers" : initial.tierIds.length > 0 ? "groups" : "everyone",
  );
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
        segmentId: who === "segment" ? d.segmentId : null,
        uniqueCodes: d.uniqueCodes,
        combinesWith: d.combinesWith,
        combinesWithCampaigns: d.combinesWithCampaigns,
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
          <p className="font-medium">{f.fix}</p>
          <ul className="mt-2 list-disc pl-5">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      <section aria-labelledby="code-heading" className={card}>
        <h2 id="code-heading" className="text-title text-ink">
          {w.theCode}
        </h2>
        <label className={label}>
          {w.codeLabel}
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
            {w.codeHint}
            {used > 0 && countWords(used, w.usedHint)}
          </span>
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">{f.whatItGives}</legend>
          {(["percent", "fixed", "free_shipping"] as const).map((value) => (
            <label key={value} className="flex min-h-10 items-center gap-3 text-sm">
              <input type="radio" name="kind" checked={d.kind === value} onChange={() => set("kind", value)} className="size-4" />
              {w.kinds[value]}
            </label>
          ))}
        </fieldset>
        {d.kind === "percent" && (
          <>
            <label className={`${label} max-w-40`}>
              {f.percentOff}
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
                {w.recurring}
                <span className={`block ${hint}`}>{w.recurringHint}</span>
              </span>
            </label>
            )}
          </>
        )}
        {d.kind === "fixed" && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">{f.amountPerCountry}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {markets.map((market) => (
                <label key={market.code} className={label}>
                  {fillWords(f.market, { name: market.name, currency: market.currency })}
                  <input
                    value={d.amounts[market.code] ?? ""}
                    onChange={(event) => set("amounts", { ...d.amounts, [market.code]: event.target.value })}
                    inputMode="decimal"
                    placeholder={f.notOffered}
                    className={input}
                  />
                </label>
              ))}
            </div>
            <p className={hint}>{w.amountHint}</p>
          </div>
        )}
        {d.kind === "free_shipping" && (
          <p className="text-sm text-muted">{w.freeShippingHint}</p>
        )}
      </section>

      <section aria-labelledby="applies-heading" className={card}>
        <h2 id="applies-heading" className="text-title text-ink">
          {f.whatItAppliesTo}
        </h2>
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">{f.products}</legend>
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input type="radio" name="scope" checked={!some} onChange={() => setSome(false)} className="size-4" />
            {f.everything}
          </label>
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input type="radio" name="scope" checked={some} onChange={() => setSome(true)} className="size-4" />
            {f.some}
          </label>
        </fieldset>
        {some && (
          <div className="flex flex-col gap-4">
            {categories.length + tags.length > 0 && (
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium">{f.categoriesAndTags}</legend>
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
                <p className={hint}>{f.subcategories}</p>
              </fieldset>
            )}
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">{f.products}</legend>
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
          {w.minQuantity}
          <input
            type="number"
            min={1}
            max={1000}
            value={d.minQuantity}
            onChange={(event) => set("minQuantity", event.target.value)}
            placeholder={w.none}
            inputMode="numeric"
            className={input}
          />
          <span className={hint}>{w.minQuantityHint}</span>
        </label>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">{w.minOrder}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {markets.map((market) => (
              <label key={market.code} className={label}>
                {fillWords(f.market, { name: market.name, currency: market.currency })}
                <input
                  value={d.minSubtotals[market.code] ?? ""}
                  onChange={(event) => set("minSubtotals", { ...d.minSubtotals, [market.code]: event.target.value })}
                  inputMode="decimal"
                  placeholder={w.none}
                  className={input}
                />
              </label>
            ))}
          </div>
          <p className={hint}>{w.minOrderHint}</p>
        </div>
      </section>

      <section aria-labelledby="who-heading" className={card}>
        <h2 id="who-heading" className="text-title text-ink">
          {w.who}
        </h2>
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">{w.who}</legend>
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input type="radio" name="who" checked={who === "everyone"} onChange={() => setWho("everyone")} className="size-4" />
            {w.everyone}
          </label>
          {tiers.length > 0 && (
            <label className="flex min-h-10 items-center gap-3 text-sm">
              <input type="radio" name="who" checked={who === "groups"} onChange={() => setWho("groups")} className="size-4" />
              {f.groupsOnly}
            </label>
          )}
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input type="radio" name="who" checked={who === "customers"} onChange={() => setWho("customers")} className="size-4" />
            {w.customers}
          </label>
          {segments.length > 0 && (
            <label className="flex min-h-10 items-center gap-3 text-sm">
              <input type="radio" name="who" checked={who === "segment"} onChange={() => setWho("segment")} className="size-4" />
              {w.segmentOnly}
            </label>
          )}
        </fieldset>
        {who === "segment" && (
          <label className={label}>
            {w.segment}
            <select value={d.segmentId ?? ""} onChange={(event) => set("segmentId", event.target.value || null)} className={input}>
              <option value="">{w.chooseSegment}</option>
              {segments.map((segment) => (
                <option key={segment.id} value={segment.id}>
                  {segment.name}
                </option>
              ))}
            </select>
            <span className={hint}>{w.segmentHint}</span>
          </label>
        )}
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
                  {!tier.active && <span className={hint}>{f.switchedOffTag}</span>}
                </label>
              </li>
            ))}
          </ul>
        )}
        {who === "customers" && (
          <label className={label}>
            {w.emails}
            <textarea
              value={d.customerEmails}
              onChange={(event) => set("customerEmails", event.target.value)}
              rows={4}
              placeholder="kari@example.com"
              className="w-full rounded-md border border-line bg-card px-3 py-2 text-sm font-normal"
            />
            <span className={hint}>{w.emailsHint}</span>
          </label>
        )}
        {who !== "everyone" && <p className={hint}>{w.signedInHint}</p>}
      </section>

      <section aria-labelledby="limits-heading" className={card}>
        <h2 id="limits-heading" className="text-title text-ink">
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
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={d.uniqueCodes} onChange={(event) => set("uniqueCodes", event.target.checked)} className="mt-0.5 size-4" />
          <span>
            {w.unique}
            <span className={`block ${hint}`}>{w.uniqueHint}</span>
          </span>
        </label>
        {!d.uniqueCodes && (
        <>
        <label className={`${label} max-w-56`}>
          {w.usageLimit}
          <input
            type="number"
            min={1}
            value={d.usageLimit}
            onChange={(event) => set("usageLimit", event.target.value)}
            placeholder={f.noLimit}
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
            {w.oncePerCustomer}
            <span className={`block ${hint}`}>{w.oncePerCustomerHint}</span>
          </span>
        </label>
        </>
        )}
        <label className="flex items-center gap-3 text-sm font-medium">
          <input type="checkbox" checked={d.active} onChange={(event) => set("active", event.target.checked)} className="size-4" />
          {f.switchedOn}
        </label>
      </section>

      <section aria-labelledby="combine-heading" className={card}>
        <h2 id="combine-heading" className="text-title text-ink">
          {w.combine}
        </h2>
        <p className={hint}>{w.combineHint}</p>
        {(["products", "order", "shipping"] as const).map((kind) => (
          <label key={kind} className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={d.combinesWith.includes(kind)}
              onChange={(event) =>
                set("combinesWith", event.target.checked ? [...d.combinesWith, kind] : d.combinesWith.filter((k) => k !== kind))
              }
              className="size-4"
            />
            {w.combines[kind]}
          </label>
        ))}
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={d.combinesWithCampaigns} onChange={(event) => set("combinesWithCampaigns", event.target.checked)} className="mt-0.5 size-4" />
          <span>
            {w.withCampaigns}
            <span className={`block ${hint}`}>{w.withCampaignsHint}</span>
          </span>
        </label>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="min-h-11 rounded-pill bg-brand px-5 font-medium text-brand-ink disabled:opacity-50"
        >
          {saving ? f.saving : w.save}
        </button>
        <a href={back} className="text-sm underline">
          {f.cancel}
        </a>
      </div>
    </form>
  );
}
