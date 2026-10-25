"use client";

import { useEffect, useId, useState } from "react";

import { useAdminText } from "@/components/admin/admin-text";
import { countWords, fillWords } from "@/lib/admin-fill";
import { minorUnitDigits } from "@/lib/money";
import { PRODUCT_KINDS } from "@/lib/product-input";
import { RULE_KINDS, RULES_MAX, newCondition, termRulesSchema, type RuleCondition, type RuleKind, type TermRules } from "@/lib/term-rules";
import type { RuleChoices } from "@/server/term-rules";

import type { TermPageSetup } from "./term-page-fields";

/**
 * A store's product category or tag filled by rules, in its panel (wave 6 unit A2, D319, `docs/wave-6-catalogue.md` 3.3): one switch for Homer,
 * then the conditions, each with how many products it holds alone, and the whole rule's count, counted by the server as the shop lists. Nothing is
 * saved here: the term's own Save sends the rules.
 */
export type TermRulesDraft = { rules: TermRules | null; keepMatches: boolean };

const input = "min-h-10 rounded-md border border-line bg-card px-3 text-sm";
const button = "min-h-10 rounded-pill border border-edge px-3 text-sm disabled:opacity-50";

export function TermRulesFields({
  setup,
  termId,
  before,
  value,
  onChange,
}: {
  setup: TermPageSetup;
  termId: string;
  /** The rules as saved: turning them on or off says what happens to the products placed by hand. */
  before: TermRules | null;
  value: TermRulesDraft;
  onChange: (value: TermRulesDraft) => void;
}) {
  const w = useAdminText("products").termRules;
  const id = useId();
  const [choices, setChoices] = useState<RuleChoices | null>(null);
  // The last count, kept with the rules it was counted for: shown only while the rules are still those.
  const [counted, setCounted] = useState<{ key: string; total: number; each: number[]; problems: string[] } | null>(null);
  const on = value.rules !== null;
  const { ruleChoices, countRules } = setup;

  useEffect(() => {
    if (!on || choices || !ruleChoices) return;
    let live = true;
    void ruleChoices(termId).then((found) => live && setChoices(found));
    return () => {
      live = false;
    };
  }, [on, choices, ruleChoices, termId]);

  // A live count, a moment after the last change, of rules complete enough to be checked.
  const key = JSON.stringify(value.rules);
  const ready = Boolean(value.rules && countRules && termRulesSchema.safeParse(value.rules).success);
  useEffect(() => {
    if (!ready || !countRules) return;
    let live = true;
    const rules = JSON.parse(key) as TermRules;
    const timer = setTimeout(() => {
      void countRules(termId, rules).then((result) => {
        if (!live) return;
        setCounted(result.ok ? { key, total: result.total, each: result.each, problems: [] } : { key, total: 0, each: [], problems: result.problems });
      });
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, ready, countRules, termId]);
  const current = ready && counted?.key === key ? counted : null;
  const count = current && current.problems.length === 0 ? current : null;
  const problems = current?.problems ?? [];
  const counting = ready && !current;

  if (!ruleChoices || !countRules) return null;
  const rules = value.rules;
  const setRules = (next: TermRules) => onChange({ ...value, rules: next });
  const setCondition = (index: number, next: RuleCondition) =>
    rules && setRules({ ...rules, conditions: rules.conditions.map((c, i) => (i === index ? next : c)) });

  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-line bg-sunken p-3">
      <legend className="px-1 text-xs font-medium">{w.turnOn}</legend>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4"
          checked={on}
          onChange={(event) =>
            onChange({
              rules: event.target.checked ? (before ?? { match: "all", conditions: [newCondition("term")] }) : null,
              keepMatches: false,
            })
          }
        />
        <span className="flex flex-col">
          <span>{w.turnOn}</span>
          <span className="text-xs text-muted">{w.turnOnHint}</span>
        </span>
      </label>
      {on && !before && <p className="text-xs text-warning-text">{w.takesOut}</p>}
      {!on && before && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={value.keepMatches} onChange={(event) => onChange({ ...value, keepMatches: event.target.checked })} />
          {w.keepMatches}
        </label>
      )}
      {rules && (
        <>
          <label className="flex flex-wrap items-center gap-2 text-sm">
            {w.match}
            <select value={rules.match} onChange={(event) => setRules({ ...rules, match: event.target.value === "any" ? "any" : "all" })} className={input}>
              <option value="all">{w.all}</option>
              <option value="any">{w.any}</option>
            </select>
          </label>
          <ol className="flex flex-col gap-2">
            {rules.conditions.map((condition, index) => (
              <li key={index} className="flex flex-col gap-2 rounded-panel border border-line bg-card p-2">
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1 text-xs font-medium">
                    {w.kindLabel}
                    <select
                      value={condition.kind}
                      onChange={(event) => setCondition(index, newCondition(event.target.value as RuleKind))}
                      className={input}
                    >
                      {RULE_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {w.kinds[kind]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <ConditionFields id={`${id}-${index}`} condition={condition} choices={choices} onChange={(next) => setCondition(index, next)} />
                  <button
                    type="button"
                    onClick={() => setRules({ ...rules, conditions: rules.conditions.filter((_, i) => i !== index) })}
                    disabled={rules.conditions.length === 1}
                    className={button}
                    aria-label={w.remove}
                  >
                    ×
                  </button>
                </div>
                {count && count.each[index] !== undefined && rules.conditions.length > 1 && (
                  <span className="text-xs text-muted">{countWords(count.each[index], w.each)}</span>
                )}
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center gap-3">
            {rules.conditions.length < RULES_MAX && (
              <button type="button" onClick={() => setRules({ ...rules, conditions: [...rules.conditions, newCondition("term")] })} className={button}>
                {w.add}
              </button>
            )}
            <span role="status" className="text-sm font-medium">
              {counting ? w.counting : count ? countWords(count.total, w.matching) : ""}
            </span>
          </div>
          {problems.length > 0 && <p className="text-xs text-danger-text">{problems.join(" ")}</p>}
        </>
      )}
    </fieldset>
  );
}

/** The fields of one condition, by its kind. */
function ConditionFields({ id, condition, choices, onChange }: { id: string; condition: RuleCondition; choices: RuleChoices | null; onChange: (next: RuleCondition) => void }) {
  const w = useAdminText("products").termRules;
  const none = <span className="pb-2 text-xs text-muted">{w.noneHere}</span>;
  switch (condition.kind) {
    case "term":
      if (choices && choices.terms.length === 0) return none;
      return (
        <>
          <select aria-label={w.kinds.term} value={condition.not ? "not" : "in"} onChange={(e) => onChange({ ...condition, not: e.target.value === "not" })} className={input}>
            <option value="in">{w.isIn}</option>
            <option value="not">{w.notIn}</option>
          </select>
          <select aria-label={w.kinds.term} value={condition.termId} onChange={(e) => onChange({ ...condition, termId: e.target.value })} className={input}>
            <option value="">{w.choose}</option>
            {(choices?.terms ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </>
      );
    case "price": {
      const currency = choices?.currency ?? "EUR";
      const digits = minorUnitDigits(currency);
      const toMajor = (minor: number | null) => (minor === null ? "" : String(minor / 10 ** digits));
      const toMinor = (text: string) => {
        const n = Number(text.replace(",", "."));
        return text.trim() === "" || !Number.isFinite(n) || n < 0 ? null : Math.round(n * 10 ** digits);
      };
      return (
        <>
          <label className="flex flex-col gap-1 text-xs font-medium">
            {w.from}
            <input inputMode="decimal" defaultValue={toMajor(condition.min)} onChange={(e) => onChange({ ...condition, min: toMinor(e.target.value) })} className={`${input} w-28`} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            {w.to}
            <input inputMode="decimal" defaultValue={toMajor(condition.max)} onChange={(e) => onChange({ ...condition, max: toMinor(e.target.value) })} className={`${input} w-28`} />
          </label>
          <span className="pb-2 text-xs text-muted">{fillWords(w.priceNote, { currency })}</span>
        </>
      );
    }
    case "inStock":
      return <span className="pb-2 text-xs text-muted">{w.inStockNote}</span>;
    case "manufacturer":
      if (choices && choices.manufacturers.length === 0) return none;
      return (
        <select
          aria-label={w.kinds.manufacturer}
          value={condition.ids[0] ?? ""}
          onChange={(e) => onChange({ ...condition, ids: e.target.value ? [e.target.value] : [] })}
          className={input}
        >
          <option value="">{w.choose}</option>
          {(choices?.manufacturers ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      );
    case "option":
      return (
        <>
          <label className="flex flex-col gap-1 text-xs font-medium">
            {w.optionName}
            <input value={condition.name} maxLength={60} onChange={(e) => onChange({ ...condition, name: e.target.value })} className={`${input} w-32`} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            {w.optionValue}
            <input value={condition.value} maxLength={120} onChange={(e) => onChange({ ...condition, value: e.target.value })} className={`${input} w-32`} />
          </label>
        </>
      );
    case "field": {
      if (choices && choices.fields.length === 0) return none;
      const field = choices?.fields.find((f) => f.id === condition.fieldId);
      const number = (text: string) => (text.trim() === "" || !Number.isFinite(Number(text)) ? null : Number(text));
      return (
        <>
          <label className="flex flex-col gap-1 text-xs font-medium">
            {w.field}
            <select
              value={condition.fieldId}
              onChange={(e) => onChange({ kind: "field", fieldId: e.target.value, value: null, min: null, max: null, unit: null })}
              className={input}
            >
              <option value="">{w.choose}</option>
              {(choices?.fields ?? []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          {field?.range ? (
            <>
              <label className="flex flex-col gap-1 text-xs font-medium">
                {w.from}
                <input id={`${id}-min`} inputMode="decimal" defaultValue={condition.min ?? ""} onChange={(e) => onChange({ ...condition, min: number(e.target.value) })} className={`${input} w-24`} />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium">
                {w.to}
                <input inputMode="decimal" defaultValue={condition.max ?? ""} onChange={(e) => onChange({ ...condition, max: number(e.target.value) })} className={`${input} w-24`} />
              </label>
              {field.unit && <span className="pb-2 text-xs text-muted">{field.unit}</span>}
            </>
          ) : field ? (
            <label className="flex flex-col gap-1 text-xs font-medium">
              {w.value}
              <select value={condition.value ?? ""} onChange={(e) => onChange({ ...condition, value: e.target.value || null })} className={input}>
                <option value="">{w.choose}</option>
                {field.type === "boolean" ? (
                  <>
                    <option value="true">{w.yes}</option>
                    <option value="false">{w.no}</option>
                  </>
                ) : (
                  field.choices.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))
                )}
              </select>
            </label>
          ) : null}
        </>
      );
    }
    case "kind":
      return (
        <select
          aria-label={w.kinds.kind}
          value={condition.values[0] ?? "goods"}
          onChange={(e) => onChange({ ...condition, values: [e.target.value as (typeof PRODUCT_KINDS)[number]] })}
          className={input}
        >
          {PRODUCT_KINDS.map((k) => (
            <option key={k} value={k}>
              {w.productKinds[k]}
            </option>
          ))}
        </select>
      );
    case "newWithin":
      return (
        <label className="flex flex-col gap-1 text-xs font-medium">
          {w.days}
          <input
            type="number"
            min={1}
            max={365}
            value={condition.days}
            onChange={(e) => onChange({ ...condition, days: Math.min(365, Math.max(1, Math.round(Number(e.target.value) || 1))) })}
            className={`${input} w-24`}
          />
        </label>
      );
  }
}
