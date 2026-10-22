"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import type { MarketingMessages } from "@/lib/admin-messages/marketing.en";
import { RFM_SEGMENTS, type RfmSegment } from "@/lib/analytics-customers";
import {
  CONDITION_KIND_WORDS,
  CONDITIONS_MAX,
  CONSENTS,
  newCondition,
  type Condition,
  type ConditionKind,
  type Consent,
  type SegmentRules,
} from "@/lib/segments";

import type { PreviewResult } from "@/app/admin/(gated)/[store]/segments/actions";

import { useAdminLang, useAdminText } from "./admin-text";
import { CARD_CLASS } from "./ui";

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
  rfmReady: boolean;
  preview: (storeSlug: string, rules: unknown) => Promise<PreviewResult>;
  save: (storeSlug: string, id: string | null, input: unknown) => Promise<{ ok: false; problem: string } | void>;
  starters?: { key: string; name: string; line: string; rules: SegmentRules }[];
};

const KINDS = Object.keys(CONDITION_KIND_WORDS) as ConditionKind[];

const field = "min-h-10 rounded-md border border-line bg-card px-3";

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
          <h2 id="starters" className="text-title text-ink">{w.editor.startFrom}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {props.starters.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => {
                  setName(s.name);
                  setRules(s.rules);
                }}
                className={`${CARD_CLASS} p-4 text-left hover:bg-sunken`}
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
              {KINDS.filter((k) => k !== "rfm" || props.rfmReady).map((k) => (
                <option key={k} value={k}>
                  {w.kinds[k]}
                </option>
              ))}
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
}: { condition: Condition; onChange: (next: Condition) => void; words: MarketingMessages } & Props) {
  const ed = w.editor;
  const number = (value: number, set: (n: number) => void, label: string) => (
    <input type="number" min={0} aria-label={label} value={value} onChange={(e) => set(Math.max(0, Math.floor(Number(e.target.value) || 0)))} className={`${field} w-24`} />
  );
  switch (c.kind) {
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
