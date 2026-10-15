"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { CARD_CLASS } from "@/components/admin/ui";
import { formatMoney, minorUnitDigits } from "@/lib/money";
import {
  ACTION_KINDS,
  CONDITION_KINDS,
  describeRule,
  RULE_DELIVERIES,
  RULE_LIMITS,
  RULE_SOURCES,
  type ActionKind,
  type ConditionKind,
  type OrderRule,
  type RuleDelivery,
  type RuleSource,
} from "@/lib/order-rules";
import { orderRuleInput } from "@/lib/order-rules-schema";

import { CONDITION_LABELS } from "./rule-labels";

/** A condition as the editor holds it: every input a kind may need, as typed. */
export type ConditionDraft = {
  kind: ConditionKind;
  amount: string;
  countries: string[];
  buyer: "business" | "consumer";
  firstOrder: boolean;
  productIds: string[];
  deliveries: RuleDelivery[];
  sources: RuleSource[];
  tag: string;
  seller: "store" | "host";
};
export type ActionDraft = { kind: ActionKind; text: string };

const ACTION_LABELS: Record<ActionKind, string> = { tag: "Add tag", notify: "Notify staff", hold: "Hold fulfilment" };
const DELIVERY_LABELS: Record<RuleDelivery, string> = { shipping: "Shipped", pickup: "Collected", local: "Your own driver", none: "Nothing to deliver" };
const SOURCE_LABELS: Record<RuleSource, string> = { checkout: "The checkout", draft: "A draft order", subscription: "A subscription renewal", delivery: "A subscription box delivery" };

const blankCondition = (kind: ConditionKind): ConditionDraft => ({
  kind,
  amount: "",
  countries: [],
  buyer: "business",
  firstOrder: true,
  productIds: [],
  deliveries: [],
  sources: [],
  tag: "",
  seller: "host",
});

/** A saved rule's conditions and actions as the editor holds them; an amount in the main currency's major units. */
export function draftOfRule(rule: Pick<OrderRule, "conditions" | "actions"> | null, currency: string): { conditions: ConditionDraft[]; actions: ActionDraft[] } {
  const digits = minorUnitDigits(currency);
  const conditions = (rule?.conditions ?? []).map((c): ConditionDraft => {
    const d = blankCondition(c.kind);
    switch (c.kind) {
      case "total_at_least":
      case "total_below":
        return { ...d, amount: (c.amountMinor / 10 ** digits).toFixed(digits) };
      case "country_in":
        return { ...d, countries: c.countries };
      case "buyer_is":
        return { ...d, buyer: c.buyer };
      case "first_order":
        return { ...d, firstOrder: c.value };
      case "has_product":
        return { ...d, productIds: c.productIds };
      case "delivery_is":
        return { ...d, deliveries: c.deliveries };
      case "source_is":
        return { ...d, sources: c.sources };
      case "has_tag":
        return { ...d, tag: c.label };
      case "seller_is":
        return { ...d, seller: c.seller };
      default:
        return d;
    }
  });
  const actions = (rule?.actions ?? []).map((a): ActionDraft => ({ kind: a.kind, text: a.kind === "tag" ? a.label : a.kind === "notify" ? a.note : a.reason }));
  return { conditions, actions: actions.length > 0 ? actions : [{ kind: "tag", text: "" }] };
}

/** An amount typed in major units ("2 000,50") as minor units; null when it is not one. */
export function typedMinor(text: string, currency: string): number | null {
  const digits = minorUnitDigits(currency);
  const clean = text.replace(/[\s ']/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  const [whole, fraction = ""] = clean.split(".");
  if (fraction.length > digits) return null;
  return Number(whole) * 10 ** digits + Number((fraction + "0".repeat(digits)).slice(0, digits) || "0");
}

/** What the editor sends: the shape `orderRuleInput` reads (the server parses it again). */
export function ruleBody(input: { name: string; match: "all" | "any"; enabled: boolean; conditions: ConditionDraft[]; actions: ActionDraft[] }, currency: string): unknown {
  return {
    name: input.name,
    match: input.match,
    enabled: input.enabled,
    conditions: input.conditions.map((c) => {
      switch (c.kind) {
        case "total_at_least":
        case "total_below":
          return { kind: c.kind, amountMinor: typedMinor(c.amount, currency) ?? Number.NaN };
        case "country_in":
          return { kind: c.kind, countries: c.countries };
        case "buyer_is":
          return { kind: c.kind, buyer: c.buyer };
        case "first_order":
          return { kind: c.kind, value: c.firstOrder };
        case "has_product":
          return { kind: c.kind, productIds: c.productIds };
        case "delivery_is":
          return { kind: c.kind, deliveries: c.deliveries };
        case "source_is":
          return { kind: c.kind, sources: c.sources };
        case "has_tag":
          return { kind: c.kind, tag: c.tag };
        case "seller_is":
          return { kind: c.kind, seller: c.seller };
        default:
          return { kind: c.kind };
      }
    }),
    actions: input.actions.map((a) => (a.kind === "tag" ? { kind: "tag", label: a.text } : a.kind === "notify" ? { kind: "notify", note: a.text } : { kind: "hold", reason: a.text })),
  };
}

type Saved = { ok: true; id: string; message: string } | { ok: false; message: string };

const field = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm font-normal";
const select = "min-h-10 rounded-md border border-line bg-card px-3 text-sm";
const pill = "min-h-10 rounded-pill border border-edge bg-card px-4 text-sm disabled:opacity-45";
const quiet = "min-h-9 rounded-pill px-3 text-sm text-ink-2 hover:bg-sunken disabled:opacity-45";
const mainPill = "min-h-10 rounded-pill bg-brand px-5 text-sm font-medium text-brand-ink disabled:opacity-45";

const flip = <T,>(list: T[], value: T, on: boolean): T[] => (on ? [...new Set([...list, value])] : list.filter((v) => v !== value));

/**
 * An automation rule's editor (wave 3, D238, `docs/wave-3-notifications.md` 2.5 point 2): its name, *all* or *any*, up to ten conditions from the closed
 * list with the inputs each needs (an amount in the store's main currency, countries of its markets, products of its catalogue, …) and up to five actions
 * (*Add tag*, *Notify staff*, *Hold fulfilment*). The sentence under it is written by code from what is typed (`describeRule()`), and the rule is checked by
 * the same schema the server uses (`orderRuleInput`) before it is sent; the server checks again and keeps products and countries to the store's own.
 */
export function RuleEditor({
  rule,
  currency,
  countries,
  products,
  tags,
  save,
  back,
  canWrite,
}: {
  rule: OrderRule | null;
  /** The store's main currency: amounts are compared in it. */
  currency: string;
  countries: { code: string; name: string }[];
  products: { id: string; title: string }[];
  tags: string[];
  save: ((input: unknown) => Promise<Saved>) | null;
  back: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const uid = useId();
  const start0 = draftOfRule(rule, currency);
  const [name, setName] = useState(rule?.name ?? "");
  const [match, setMatch] = useState<"all" | "any">(rule?.match ?? "all");
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [conditions, setConditions] = useState<ConditionDraft[]>(start0.conditions);
  const [actions, setActions] = useState<ActionDraft[]>(start0.actions);
  const [productFilter, setProductFilter] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, start] = useTransition();

  const body = ruleBody({ name, match, enabled, conditions, actions }, currency);
  const parsed = orderRuleInput.safeParse(body);
  const productNames = new Map(products.map((p) => [p.id, p.title]));
  const countryNames = new Map(countries.map((c) => [c.code, c.name]));
  const sentence = parsed.success
    ? describeRule(parsed.data, { money: (minor) => formatMoney(minor, currency, "en-GB"), countryName: (c) => countryNames.get(c) ?? c, productName: (id) => productNames.get(id) ?? "a product no longer sold" })
    : null;
  const problem = parsed.success ? null : (parsed.error.issues[0]?.message ?? "Check the rule.");

  const patch = (i: number, change: Partial<ConditionDraft>) => setConditions((list) => list.map((c, j) => (j === i ? { ...c, ...change } : c)));
  const patchAction = (i: number, change: Partial<ActionDraft>) => setActions((list) => list.map((a, j) => (j === i ? { ...a, ...change } : a)));

  const submit = () =>
    start(async () => {
      if (!save) return;
      const answer = await save(body);
      setMessage(answer);
      if (answer.ok) {
        router.push(back);
        router.refresh();
      }
    });

  const shownProducts = products.filter((p) => p.title.toLowerCase().includes(productFilter.trim().toLowerCase())).slice(0, 50);

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <fieldset disabled={!canWrite} className="contents">
        <section className={`flex flex-col gap-4 p-5 ${CARD_CLASS}`} aria-labelledby={`${uid}-name`}>
          <h2 id={`${uid}-name`} className="text-title text-ink">
            The rule
          </h2>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Name
            <input name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={RULE_LIMITS.name} required className={field} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="size-4" />
            On: run it for every paid order
          </label>
        </section>

        <section className={`flex flex-col gap-4 p-5 ${CARD_CLASS}`} aria-labelledby={`${uid}-when`}>
          <h2 id={`${uid}-when`} className="text-title text-ink">
            When an order is paid and
          </h2>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Conditions that must hold
            <select value={match} onChange={(e) => setMatch(e.target.value as "all" | "any")} className={select}>
              <option value="all">All of them</option>
              <option value="any">Any of them</option>
            </select>
          </label>
          {conditions.length === 0 && <p className="text-sm text-muted">No condition: the rule runs for every paid order.</p>}
          <ol className="flex flex-col gap-4">
            {conditions.map((c, i) => (
              <li key={i} className="flex flex-col gap-2 rounded-panel border border-line p-4">
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-1 text-sm font-medium">
                    Condition {i + 1}
                    <select value={c.kind} onChange={(e) => setConditions((list) => list.map((x, j) => (j === i ? blankCondition(e.target.value as ConditionKind) : x)))} className={select}>
                      {CONDITION_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {CONDITION_LABELS[k]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" onClick={() => setConditions((list) => list.filter((_, j) => j !== i))} className={quiet}>
                    Remove<span className="sr-only"> condition {i + 1}</span>
                  </button>
                </div>
                {(c.kind === "total_at_least" || c.kind === "total_below") && (
                  <label className="flex flex-col gap-1 text-sm font-medium">
                    Amount in {currency}, VAT included, as charged
                    <input inputMode="decimal" value={c.amount} onChange={(e) => patch(i, { amount: e.target.value })} className={`${field} max-w-48`} />
                    <span className="text-xs font-normal text-muted">An order in another currency is compared at the store&apos;s exchange rates; one without a rate never matches.</span>
                  </label>
                )}
                {c.kind === "country_in" && (
                  <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
                    <legend className="sr-only">Countries</legend>
                    {countries.map((country) => (
                      <label key={country.code} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" className="size-4" checked={c.countries.includes(country.code)} onChange={(e) => patch(i, { countries: flip(c.countries, country.code, e.target.checked) })} />
                        {country.name}
                      </label>
                    ))}
                  </fieldset>
                )}
                {c.kind === "buyer_is" && (
                  <select value={c.buyer} onChange={(e) => patch(i, { buyer: e.target.value as "business" | "consumer" })} className={select} aria-label="Buyer">
                    <option value="business">A business</option>
                    <option value="consumer">A consumer</option>
                  </select>
                )}
                {c.kind === "first_order" && (
                  <select value={c.firstOrder ? "yes" : "no"} onChange={(e) => patch(i, { firstOrder: e.target.value === "yes" })} className={select} aria-label="First order">
                    <option value="yes">It is their first order</option>
                    <option value="no">They have ordered before</option>
                  </select>
                )}
                {c.kind === "has_product" && (
                  <div className="flex flex-col gap-2">
                    <input type="search" value={productFilter} onChange={(e) => setProductFilter(e.target.value)} placeholder="Find a product" aria-label="Find a product" className={`${field} max-w-80`} />
                    <fieldset className="flex max-h-56 flex-col gap-1 overflow-y-auto">
                      <legend className="sr-only">Products</legend>
                      {[...new Set([...c.productIds.filter((id) => !shownProducts.some((p) => p.id === id)), ...shownProducts.map((p) => p.id)])].map((id) => (
                        <label key={id} className="flex items-center gap-2 text-sm">
                          <input type="checkbox" className="size-4" checked={c.productIds.includes(id)} onChange={(e) => patch(i, { productIds: flip(c.productIds, id, e.target.checked) })} />
                          {productNames.get(id) ?? "A product no longer sold"}
                        </label>
                      ))}
                    </fieldset>
                  </div>
                )}
                {c.kind === "delivery_is" && (
                  <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
                    <legend className="sr-only">Delivery</legend>
                    {RULE_DELIVERIES.map((d) => (
                      <label key={d} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" className="size-4" checked={c.deliveries.includes(d)} onChange={(e) => patch(i, { deliveries: flip(c.deliveries, d, e.target.checked) })} />
                        {DELIVERY_LABELS[d]}
                      </label>
                    ))}
                  </fieldset>
                )}
                {c.kind === "source_is" && (
                  <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
                    <legend className="sr-only">Where it comes from</legend>
                    {RULE_SOURCES.map((s) => (
                      <label key={s} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" className="size-4" checked={c.sources.includes(s)} onChange={(e) => patch(i, { sources: flip(c.sources, s, e.target.checked) })} />
                        {SOURCE_LABELS[s]}
                      </label>
                    ))}
                  </fieldset>
                )}
                {c.kind === "has_tag" && (
                  <label className="flex flex-col gap-1 text-sm font-medium">
                    Tag (as it was when the order was paid)
                    <input list={`${uid}-tags`} value={c.tag} onChange={(e) => patch(i, { tag: e.target.value })} className={`${field} max-w-80`} />
                  </label>
                )}
                {c.kind === "seller_is" && (
                  <select value={c.seller} onChange={(e) => patch(i, { seller: e.target.value as "store" | "host" })} className={select} aria-label="Seller">
                    <option value="host">A host&apos;s listing</option>
                    <option value="store">The store itself</option>
                  </select>
                )}
              </li>
            ))}
          </ol>
          {conditions.length < RULE_LIMITS.conditions && (
            <div>
              <button type="button" onClick={() => setConditions((list) => [...list, blankCondition("total_at_least")])} className={pill}>
                Add a condition
              </button>
            </div>
          )}
        </section>

        <section className={`flex flex-col gap-4 p-5 ${CARD_CLASS}`} aria-labelledby={`${uid}-then`}>
          <h2 id={`${uid}-then`} className="text-title text-ink">
            Then
          </h2>
          <ol className="flex flex-col gap-4">
            {actions.map((a, i) => (
              <li key={i} className="flex flex-wrap items-end gap-3 rounded-panel border border-line p-4">
                <label className="flex flex-col gap-1 text-sm font-medium">
                  Action {i + 1}
                  <select value={a.kind} onChange={(e) => patchAction(i, { kind: e.target.value as ActionKind })} className={select}>
                    {ACTION_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {ACTION_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-60 flex-1 flex-col gap-1 text-sm font-medium">
                  {a.kind === "tag" ? "Tag" : a.kind === "notify" ? "What staff should know" : "Why it is held"}
                  <input
                    value={a.text}
                    list={a.kind === "tag" ? `${uid}-tags` : undefined}
                    onChange={(e) => patchAction(i, { text: e.target.value })}
                    maxLength={a.kind === "tag" ? 40 : RULE_LIMITS.note}
                    className={field}
                  />
                </label>
                {actions.length > 1 && (
                  <button type="button" onClick={() => setActions((list) => list.filter((_, j) => j !== i))} className={quiet}>
                    Remove<span className="sr-only"> action {i + 1}</span>
                  </button>
                )}
              </li>
            ))}
          </ol>
          {actions.length < RULE_LIMITS.actions && (
            <div>
              <button type="button" onClick={() => setActions((list) => [...list, { kind: "notify", text: "" }])} className={pill}>
                Add an action
              </button>
            </div>
          )}
          <p className="text-xs text-muted">
            <em>Notify staff</em> emails the people chosen for Automation under Staff alerts. <em>Hold fulfilment</em> stops the order being sent or handed
            over until someone releases it on its page. A rule runs once for each paid order, and rules do not trigger each other.
          </p>
        </section>
      </fieldset>

      <datalist id={`${uid}-tags`}>
        {tags.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>

      <section aria-live="polite" className="flex flex-col gap-1">
        {sentence ? <p className="text-body text-ink">{sentence}</p> : <p className="text-sm text-danger-text">{problem}</p>}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        {canWrite && save && (
          <button type="submit" disabled={busy || !parsed.success} className={mainPill}>
            {busy ? "Working …" : "Save rule"}
          </button>
        )}
        <a href={back} className="text-sm underline">
          Cancel
        </a>
        <p role="status" className={`text-sm empty:hidden ${message && !message.ok ? "text-danger-text" : ""}`}>
          {message?.message}
        </p>
      </div>
    </form>
  );
}
