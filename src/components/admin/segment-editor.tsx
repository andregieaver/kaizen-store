"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import type { MarketingMessages } from "@/lib/admin-messages/marketing.en";
import { RFM_SEGMENTS, type RfmSegment } from "@/lib/rfm-segments";
import {
  CONDITION_GROUPS,
  conditionOffered,
  CONDITIONS_MAX,
  CONSENTS,
  newCondition,
  SMS_CONSENTS,
  type Condition,
  type ConditionKind,
  type ConditionOffer,
  type SegmentField,
  type Consent,
  type SegmentRules,
} from "@/lib/segments";

import type { PreviewResult } from "@/app/admin/(gated)/[store]/segments/actions";

import { useAdminLang, useAdminText } from "./admin-text";
import { CARD_CLASS } from "./ui/card";

type Props = {
  storeSlug: string;
  segmentId: string | null;
  initial: { name: string; rules: SegmentRules };
  /** The main currency and its minor-unit digits, for the money condition. */
  currency: string;
  digits: number;
  groups: { id: string; name: string }[];
  tags: { key: string; label: string }[];
  countries: { code: string; name: string }[];
  languages: { code: string; name: string }[];
  /** The store's products and product categories, by name, for the conditions on what people bought (ecosystem plan E3.6, D718). */
  products: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  /** The customer fields marked for marketing (M2.4). */
  fields?: SegmentField[];
  rfmReady: boolean;
  /** Which conditions behind a feature or a setting are offered now. */
  offer: ConditionOffer;
  preview: (storeSlug: string, rules: unknown) => Promise<PreviewResult>;
  save: (storeSlug: string, id: string | null, input: unknown) => Promise<{ ok: false; problem: string } | void>;
  starters?: { key: string; name: string; line: string; rules: SegmentRules }[];
};

const field = "min-h-10 rounded-md border border-line bg-card px-3";

/** Options shown at once in a list a search narrows. */
const SHOWN_AT_ONCE = 30;

/**
 * The rule builder of a segment (D296): a name, *all* or *any*, and conditions from the closed list, counted as they change (a short pause, then
 * `previewSegmentAction`, numbers only). Saving sends the whole rule set to the server, which checks it again.
 */
export function SegmentEditor(props: Props) {
  const [name, setName] = useState(props.initial.name);
  const [rules, setRules] = useState<SegmentRules>(props.initial.rules);
  const [count, setCount] = useState<PreviewResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { preview, storeSlug } = props;
  const w = useAdminText("marketing");
  const numbers = ADMIN_LANG_FACTS[useAdminLang()].locale;
  const countFailed = w.common.countFailed;

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      preview(storeSlug, rules).then(setCount, () => setCount({ ok: false, problem: countFailed }));
    }, 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [rules, preview, storeSlug, countFailed]);

  const setCondition = (index: number, next: Condition) => setRules((r) => ({ ...r, conditions: r.conditions.map((c, i) => (i === index ? next : c)) }));
  const remove = (index: number) => setRules((r) => ({ ...r, conditions: r.conditions.filter((_, i) => i !== index) }));
  const add = (kind: ConditionKind) => setRules((r) => ({ ...r, conditions: [...r.conditions, newCondition(kind)] }));

  const submit = () =>
    startSave(async () => {
      setProblem(null);
      const result = await props.save(storeSlug, props.segmentId, { name, rules });
      if (result && !result.ok) setProblem(result.problem);
    });

  return (
    <div className="flex flex-col gap-6">
      {props.starters && rules.conditions.length === 0 && (
        <section aria-labelledby="starters" className="flex flex-col gap-3">
          {/* Round 56 (D809): on a phone the starts are rows of one card, so the name and Save come into view. */}
          <h2 id="starters" className="text-title text-ink max-sm:text-sm max-sm:text-ink-2">{w.editor.startFrom}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 max-sm:gap-0 max-sm:overflow-hidden max-sm:rounded-panel max-sm:bg-card">
            {props.starters.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => {
                  setName(s.name);
                  setRules(s.rules);
                }}
                className={`${CARD_CLASS} p-4 text-left hover:bg-sunken max-sm:rounded-none max-sm:border-0 max-sm:border-b max-sm:border-line max-sm:py-3 max-sm:shadow-none max-sm:last:border-b-0`}
              >
                <span className="block text-body-strong text-ink">{s.name}</span>
                <span className="block text-caption text-muted">{s.line}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="segment-name" className="text-body-strong text-ink">
          {w.editor.name}
        </label>
        <input id="segment-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className={`${field} max-w-md`} />
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-body-strong text-ink">{w.editor.whoIsIn}</legend>
        {rules.conditions.length > 1 && (
          <label className="flex items-center gap-2 text-body text-ink-2">
            {w.editor.peopleWhoMatch}
            <select value={rules.match} onChange={(e) => setRules((r) => ({ ...r, match: e.target.value as "all" | "any" }))} className={field}>
              <option value="all">{w.editor.all}</option>
              <option value="any">{w.editor.any}</option>
            </select>
          </label>
        )}
        {rules.conditions.length === 0 && <p className="text-body text-muted">{w.editor.everyone}</p>}
        <ol className="flex flex-col gap-2">
          {rules.conditions.map((c, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 rounded-panel border border-line bg-card p-3">
              <span className="min-w-36 text-body-strong text-ink">{w.kinds[c.kind]}</span>
              <ConditionFields condition={c} onChange={(next) => setCondition(i, next)} words={w} {...props} />
              <button
                type="button"
                onClick={() => remove(i)}
                className="ml-auto rounded-pill px-3 py-1 text-ink-2 hover:bg-sunken"
                aria-label={fillWords(w.editor.removeKind, { kind: w.kinds[c.kind] })}
              >
                {w.common.remove}
              </button>
            </li>
          ))}
        </ol>
        {rules.conditions.length < CONDITIONS_MAX && (
          <label className="flex items-center gap-2 text-body text-ink-2">
            {w.editor.addCondition}
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) add(e.target.value as ConditionKind);
              }}
              className={field}
            >
              <option value="">{w.editor.choose}</option>
              {CONDITION_GROUPS.map((group) => {
                const kinds = group.kinds.filter((k) => conditionOffered(k, { ...props.offer, rfmReady: props.rfmReady }));
                return kinds.length === 0 ? null : (
                  <optgroup key={group.id} label={w.editor.groups[group.id]}>
                    {kinds.map((k) => (
                      <option key={k} value={k}>
                        {w.kinds[k]}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </label>
        )}
      </fieldset>

      <p role="status" aria-live="polite" className="text-body text-ink">
        {count === null
          ? w.common.counting
          : count.ok
            ? `${fillWords(w.editor.result, {
                people: countWords(count.people, w.common.people, { n: count.people.toLocaleString(numbers) }),
                subscribed: count.subscribed.toLocaleString(numbers),
              })}${count.moneyUnknown > 0 ? fillWords(w.editor.moneyUnknown, { n: count.moneyUnknown.toLocaleString(numbers) }) : ""}${count.capped ? w.editor.capped : ""}`
            : count.problem}
      </p>

      {problem && (
        <p role="alert" className="text-body text-danger-text">
          {problem}
        </p>
      )}
      <div>
        <button type="button" onClick={submit} disabled={saving} className="min-h-11 rounded-pill bg-brand px-5 text-brand-ink disabled:opacity-40">
          {saving ? w.common.saving : w.editor.saveSegment}
        </button>
      </div>
    </div>
  );
}

function Choices<T extends string>({ options, chosen, onChange, label }: { options: { value: T; label: string }[]; chosen: readonly T[]; onChange: (next: T[]) => void; label: string }) {
  return (
    <span role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <label key={o.value} className="inline-flex items-center gap-1 rounded-pill border border-line px-3 py-1 text-body">
          <input
            type="checkbox"
            checked={chosen.includes(o.value)}
            onChange={(e) => onChange(e.target.checked ? [...chosen, o.value] : chosen.filter((v) => v !== o.value))}
          />
          {o.label}
        </label>
      ))}
    </span>
  );
}

/**
 * Many to choose from (a store's products): what is chosen first, then a search's matches, at most `SHOWN_AT_ONCE` at a time. A short list
 * needs no search. A chosen id no longer in the list (a product deleted) stays chosen.
 */
function SearchChoices({
  options,
  chosen,
  onChange,
  label,
  words,
}: {
  options: { value: string; label: string }[];
  chosen: readonly string[];
  onChange: (next: string[]) => void;
  label: string;
  words: { search: string; none: string; noMatch: string; more: string };
}) {
  const [query, setQuery] = useState("");
  if (options.length === 0) return <span className="text-body text-muted">{words.none}</span>;
  const q = query.trim().toLowerCase();
  const picked = options.filter((o) => chosen.includes(o.value));
  const matching = options.filter((o) => !chosen.includes(o.value) && (q === "" || o.label.toLowerCase().includes(q)));
  const shown = [...picked, ...matching.slice(0, SHOWN_AT_ONCE)];
  return (
    <span className="flex w-full flex-col gap-2">
      {options.length > SHOWN_AT_ONCE && (
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={words.search} aria-label={words.search} className={`${field} max-w-md`} />
      )}
      <Choices label={label} options={shown} chosen={chosen} onChange={onChange} />
      {q !== "" && matching.length === 0 && <span className="text-caption text-muted">{words.noMatch}</span>}
      {matching.length > SHOWN_AT_ONCE && <span className="text-caption text-muted">{fillWords(words.more, { n: matching.length - SHOWN_AT_ONCE })}</span>}
    </span>
  );
}

function ConditionFields({
  condition: c,
  onChange,
  words: w,
  currency,
  digits,
  groups,
  tags,
  countries,
  languages,
  products,
  categories,
  fields = [],
}: { condition: Condition; onChange: (next: Condition) => void; words: MarketingMessages } & Props) {
  const ed = w.editor;
  const number = (value: number, set: (n: number) => void, label: string) => (
    <input type="number" min={0} aria-label={label} value={value} onChange={(e) => set(Math.max(0, Math.floor(Number(e.target.value) || 0)))} className={`${field} w-24`} />
  );
  // Ever, or in the last days (ecosystem plan E3.6, D718): `days` absent is ever.
  const since = (value: number | undefined, set: (days: number | undefined) => void) => (
    <>
      <select aria-label={ed.when} value={value === undefined ? "ever" : "within"} onChange={(e) => set(e.target.value === "ever" ? undefined : (value ?? 30))} className={field}>
        <option value="ever">{ed.ever}</option>
        <option value="within">{ed.inTheLast}</option>
      </select>
      {value !== undefined && (
        <>
          {number(value, (days) => set(Math.max(1, days)), ed.days)}
          <span className="text-body text-ink-2">{ed.daysWord}</span>
        </>
      )}
    </>
  );
  const boughtOrNot = (has: boolean, set: (has: boolean) => void) => (
    <select aria-label={w.kinds.bought} value={has ? "yes" : "no"} onChange={(e) => set(e.target.value === "yes")} className={field}>
      <option value="yes">{ed.hasBought}</option>
      <option value="no">{ed.hasNotBought}</option>
    </select>
  );
  switch (c.kind) {
    case "bought":
      return (
        <>
          {boughtOrNot(c.has, (has) => onChange({ ...c, has }))}
          {since(c.days, (days) => onChange({ ...c, days }))}
          <SearchChoices
            label={ed.products}
            options={products.map((p) => ({ value: p.id, label: p.name }))}
            chosen={c.products}
            onChange={(next) => onChange({ ...c, products: next })}
            words={{ search: ed.searchProducts, none: ed.noProducts, noMatch: ed.noProductMatch, more: ed.moreProducts }}
          />
        </>
      );
    case "viewed":
      return (
        <>
          <select aria-label={w.kinds.viewed} value={c.has ? "yes" : "no"} onChange={(e) => onChange({ ...c, has: e.target.value === "yes" })} className={field}>
            <option value="yes">{ed.hasViewed}</option>
            <option value="no">{ed.hasNotViewed}</option>
          </select>
          {since(c.days, (days) => onChange({ ...c, days }))}
          <SearchChoices
            label={ed.products}
            options={products.map((p) => ({ value: p.id, label: p.name }))}
            chosen={c.products}
            onChange={(next) => onChange({ ...c, products: next })}
            words={{ search: ed.searchProducts, none: ed.noProducts, noMatch: ed.noProductMatch, more: ed.moreProducts }}
          />
        </>
      );
    case "boughtCategory":
      return (
        <>
          {boughtOrNot(c.has, (has) => onChange({ ...c, has }))}
          {since(c.days, (days) => onChange({ ...c, days }))}
          {categories.length === 0 ? (
            <span className="text-body text-muted">{ed.noCategories}</span>
          ) : (
            <Choices label={ed.categories} options={categories.map((x) => ({ value: x.id, label: x.name }))} chosen={c.categories} onChange={(next) => onChange({ ...c, categories: next })} />
          )}
        </>
      );
    case "deal":
      return (
        <select aria-label={w.kinds.deal} value={c.status} onChange={(e) => onChange({ ...c, status: e.target.value as typeof c.status })} className={field}>
          <option value="open">{ed.dealOpen}</option>
          <option value="won">{ed.dealWon}</option>
        </select>
      );
    case "support":
      return (
        <>
          <select
            aria-label={w.kinds.support}
            value={c.op}
            onChange={(e) => onChange({ ...c, op: e.target.value as typeof c.op, days: e.target.value === "within" ? (c.days ?? 30) : undefined })}
            className={field}
          >
            <option value="within">{ed.supportWithin}</option>
            <option value="ratedBad">{ed.supportBad}</option>
          </select>
          {c.op === "within" && (
            <>
              {number(c.days ?? 30, (days) => onChange({ ...c, days: Math.max(1, days) }), ed.days)}
              <span className="text-body text-ink-2">{ed.daysWord}</span>
            </>
          )}
        </>
      );
    case "field": {
      const chosen = fields.find((f) => f.id === c.field);
      const askValue = c.op === "is" || c.op === "isNot";
      const choices = chosen?.type === "boolean" ? [{ key: "yes", label: ed.yes }, { key: "no", label: ed.no }] : (chosen?.choices ?? []);
      return (
        <>
          <select aria-label={ed.chooseField} value={c.field} onChange={(e) => onChange({ ...c, field: e.target.value, value: undefined })} className={field}>
            <option value="">{ed.choose}</option>
            {fields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
          <select
            aria-label={w.kinds.field}
            value={c.op}
            onChange={(e) => onChange({ ...c, op: e.target.value as typeof c.op, value: e.target.value === "is" || e.target.value === "isNot" ? c.value : undefined })}
            className={field}
          >
            <option value="is">{ed.fieldIs}</option>
            <option value="isNot">{ed.fieldIsNot}</option>
            <option value="filled">{ed.fieldFilled}</option>
            <option value="empty">{ed.fieldEmpty}</option>
          </select>
          {askValue &&
            (choices.length > 0 ? (
              <select aria-label={ed.fieldValue} value={c.value ?? ""} onChange={(e) => onChange({ ...c, value: e.target.value || undefined })} className={field}>
                <option value="">{ed.choose}</option>
                {choices.map((choice) => (
                  <option key={choice.key} value={choice.key}>
                    {choice.label}
                  </option>
                ))}
              </select>
            ) : (
              <input aria-label={ed.fieldValue} value={c.value ?? ""} maxLength={200} onChange={(e) => onChange({ ...c, value: e.target.value || undefined })} className={field} />
            ))}
        </>
      );
    }
    case "clicked":
      return (
        <>
          <select
            aria-label={w.kinds.clicked}
            value={c.op}
            onChange={(e) => onChange({ ...c, op: e.target.value as typeof c.op, days: e.target.value === "within" ? (c.days ?? 90) : undefined })}
            className={field}
          >
            <option value="within">{ed.clickedWithin}</option>
            <option value="never">{ed.clickedNever}</option>
          </select>
          {c.op === "within" && (
            <>
              {number(c.days ?? 90, (days) => onChange({ ...c, days: Math.max(1, days) }), ed.days)}
              <span className="text-body text-ink-2">{ed.daysWord}</span>
            </>
          )}
        </>
      );
    case "leadScore":
      return (
        <>
          <span className="text-body text-ink-2">{ed.leadScoreAtLeast}</span>
          {number(c.min, (min) => onChange({ ...c, min: Math.min(100, Math.max(1, min)) }), w.kinds.leadScore)}
          <span className="text-body text-ink-2">{ed.leadScoreOf}</span>
        </>
      );
    case "review":
      return (
        <>
          <select
            aria-label={w.kinds.review}
            value={c.maxStars === undefined ? "any" : "atMost"}
            onChange={(e) => onChange({ ...c, maxStars: e.target.value === "any" ? undefined : (c.maxStars ?? 2) })}
            className={field}
          >
            <option value="any">{ed.reviewAny}</option>
            <option value="atMost">{ed.reviewAtMost}</option>
          </select>
          {c.maxStars !== undefined && (
            <>
              <select aria-label={ed.starsWord} value={c.maxStars} onChange={(e) => onChange({ ...c, maxStars: Number(e.target.value) })} className={field}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <span className="text-body text-ink-2">{ed.starsWord}</span>
            </>
          )}
        </>
      );
    case "subscription":
      return (
        <select aria-label={w.kinds.subscription} value={c.has ? "yes" : "no"} onChange={(e) => onChange({ ...c, has: e.target.value === "yes" })} className={field}>
          <option value="yes">{ed.hasSubscription}</option>
          <option value="no">{ed.noSubscription}</option>
        </select>
      );
    case "sms":
      return <Choices label={ed.sms.label} options={SMS_CONSENTS.map((v) => ({ value: v, label: ed.sms[v] }))} chosen={c.statuses} onChange={(statuses) => onChange({ ...c, statuses })} />;
    case "consent":
      return <Choices label={ed.consent.label} options={CONSENTS.map((v: Consent) => ({ value: v, label: ed.consent[v] }))} chosen={c.statuses} onChange={(statuses) => onChange({ ...c, statuses })} />;
    case "orders":
      return (
        <>
          <select aria-label={ed.howMany} value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as typeof c.op })} className={field}>
            <option value="atLeast">{ed.atLeast}</option>
            <option value="atMost">{ed.atMost}</option>
            <option value="exactly">{ed.exactly}</option>
          </select>
          {number(c.value, (value) => onChange({ ...c, value }), w.kinds.orders)}
          <span className="text-body text-ink-2">{ed.orders}</span>
        </>
      );
    case "spent": {
      const scale = 10 ** digits;
      return (
        <>
          <select aria-label={ed.howMuch} value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as typeof c.op })} className={field}>
            <option value="atLeast">{ed.atLeast}</option>
            <option value="atMost">{ed.atMost}</option>
          </select>
          {number(Math.round(c.minor / scale), (n) => onChange({ ...c, minor: n * scale }), fillWords(ed.amountIn, { currency }))}
          <span className="text-body text-ink-2">{fillWords(ed.withoutVat, { currency })}</span>
        </>
      );
    }
    case "lastOrder":
      return (
        <>
          <select
            aria-label={ed.when}
            value={c.op}
            onChange={(e) => onChange({ ...c, op: e.target.value as typeof c.op, days: e.target.value === "never" ? undefined : (c.days ?? 30) })}
            className={field}
          >
            <option value="within">{ed.inTheLast}</option>
            <option value="before">{ed.moreThan}</option>
            <option value="never">{ed.neverOrdered}</option>
          </select>
          {c.op !== "never" && (
            <>
              {number(c.days ?? 30, (days) => onChange({ ...c, days: Math.max(1, days) }), ed.days)}
              <span className="text-body text-ink-2">{c.op === "before" ? ed.daysAgo : ed.daysWord}</span>
            </>
          )}
        </>
      );
    case "firstOrder":
      return (
        <>
          <select aria-label={ed.when} value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as typeof c.op })} className={field}>
            <option value="within">{ed.inTheLast}</option>
            <option value="before">{ed.moreThan}</option>
          </select>
          {number(c.days, (days) => onChange({ ...c, days: Math.max(1, days) }), ed.days)}
          <span className="text-body text-ink-2">{c.op === "before" ? ed.daysAgo : ed.daysWord}</span>
        </>
      );
    case "rfm":
      return <Choices label={ed.customerType} options={RFM_SEGMENTS.map((g) => ({ value: g, label: g }))} chosen={c.groups} onChange={(groups) => onChange({ ...c, groups: groups as RfmSegment[] })} />;
    case "country":
      return <Choices label={ed.country} options={countries.map((x) => ({ value: x.code, label: x.name }))} chosen={c.codes} onChange={(codes) => onChange({ ...c, codes })} />;
    case "language":
      return <Choices label={ed.languageLabel} options={languages.map((x) => ({ value: x.code, label: x.name }))} chosen={c.codes} onChange={(codes) => onChange({ ...c, codes })} />;
    case "group":
      return groups.length === 0 ? (
        <span className="text-body text-muted">{ed.noGroups}</span>
      ) : (
        <Choices label={ed.group} options={groups.map((g) => ({ value: g.id, label: g.name }))} chosen={c.ids} onChange={(ids) => onChange({ ...c, ids })} />
      );
    case "company":
    case "account":
      return (
        <select aria-label={w.kinds[c.kind]} value={c.has ? "yes" : "no"} onChange={(e) => onChange({ ...c, has: e.target.value === "yes" })} className={field}>
          <option value="yes">{c.kind === "company" ? ed.buysForCompany : ed.hasAccount}</option>
          <option value="no">{c.kind === "company" ? ed.notForCompany : ed.noAccount}</option>
        </select>
      );
    case "tag":
      return tags.length === 0 ? (
        <span className="text-body text-muted">{ed.noTags}</span>
      ) : (
        <Choices label={ed.tags} options={tags.map((t) => ({ value: t.label, label: t.label }))} chosen={c.tags.filter((t) => t !== "")} onChange={(next) => onChange({ ...c, tags: next })} />
      );
  }
}
