"use client";

import { Eye, EyeOff, Plus, X } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { minorUnitDigits } from "@/lib/money";
import {
  DISPLAY_LABELS,
  DISPLAYS,
  FACT_INFO,
  KAIZEN_CHOICES,
  OP_LABELS,
  WEEKDAY_LABELS,
  WEEKDAYS,
  conditionProblem,
  displayKind,
  newCondition,
  type Condition,
  type ConditionGroup,
  type DisplayKind,
  type Fact,
  type Op,
  type Show,
  type VisibilityChoices,
} from "@/lib/visibility";
import { fillWords } from "@/lib/admin-fill";
import type { BlocksMessages } from "@/lib/admin-messages/blocks.en";

import { useAdminText } from "./admin-text";

type DisplayWords = BlocksMessages["display"];

/**
 * Beaver Builder's **Display** (D179 phase 4, `docs/responsive-editing.md` 6), under Breakpoint in the Advanced tab's
 * Visibility: Always, Never, Signed-out visitors, Signed-in visitors or Conditional logic. Conditional logic opens a rule
 * builder: groups of conditions, every condition in a group must hold ("And"), any group will do ("Or"). Facts, operators
 * and values come from `src/lib/visibility.ts`; the store's own groups, companies, products, categories, countries,
 * languages and currencies are loaded when the rule builder opens. An id that is no longer the store's shows as removed.
 */

/** A part's visibility with its display changed: Always is nothing set. */
export function showPatch<V extends { hideAt?: unknown; show?: Show }>(visibility: V | undefined, show: Show | undefined): { visibility: V | undefined } {
  const next = { ...visibility, show } as V;
  if (show === undefined || show === "always") delete next.show;
  return { visibility: Object.keys(next).length > 0 ? next : undefined };
}

export type DisplaySetup = {
  /** The facts this page offers (`factsOffered()`). */
  facts: readonly Fact[];
  /** The store's choices, loaded when needed; absent on Kaizen's pages and a design profile's workspace. */
  choices?: () => Promise<VisibilityChoices>;
  kaizen: boolean;
};

const choicesCache = new WeakMap<() => Promise<VisibilityChoices>, Promise<VisibilityChoices>>();
/** The choices once per builder (the same bound action), shared by every dialog. */
function useChoices(setup: DisplaySetup, wanted: boolean): VisibilityChoices | null {
  const [choices, setChoices] = useState<VisibilityChoices | null>(setup.choices ? null : setup.kaizen ? KAIZEN_CHOICES : { ...KAIZEN_CHOICES, owner: "store", languages: [] });
  useEffect(() => {
    if (!wanted || !setup.choices) return;
    let known = choicesCache.get(setup.choices);
    if (!known) {
      known = setup.choices();
      choicesCache.set(setup.choices, known);
    }
    let live = true;
    known.then((found) => live && setChoices(found)).catch(() => live && setChoices({ ...KAIZEN_CHOICES, owner: "store", languages: [] }));
    return () => {
      live = false;
    };
  }, [setup, wanted]);
  return choices;
}

export function DisplayFields({
  show,
  onChange,
  setup,
  locked,
}: {
  show: Show | undefined;
  onChange: (show: Show | undefined) => void;
  setup: DisplaySetup;
  locked?: string;
}) {
  const id = useId();
  const kind = displayKind(show);
  const choices = useChoices(setup, kind === "rules");
  const w = useAdminText("blocks").display;
  const choose = (next: DisplayKind) => {
    if (next === kind) return;
    if (next === "rules") onChange({ rules: [[newCondition(setup.facts[0] ?? "signedIn")]] });
    else onChange(next === "always" ? undefined : next);
  };
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={`${id}-display`} className="text-sm font-medium">
        {w.display}
      </label>
      <select
        id={`${id}-display`}
        value={kind}
        disabled={Boolean(locked) && kind === "always"}
        onChange={(event) => choose(event.target.value as DisplayKind)}
        aria-describedby={`${id}-hint`}
        className="min-h-10 rounded-md border border-line bg-card px-3 text-sm"
      >
        {DISPLAYS.map((d) => (
          <option key={d} value={d}>
            {w.kinds[d] ?? DISPLAY_LABELS[d]}
          </option>
        ))}
      </select>
      <p id={`${id}-hint`} className="text-xs text-muted">
        {locked ??
          (setup.kaizen ? w.kaizenHint : w.storeHint)}
      </p>
      {typeof show === "object" && <RuleBuilder rules={show.rules} onChange={(rules) => onChange(rules.length > 0 ? { rules } : undefined)} setup={setup} choices={choices} />}
    </div>
  );
}

/** Groups of conditions: "And" within a group, "Or" between groups (Beaver's Conditional logic). */
export function RuleBuilder({
  rules,
  onChange,
  setup,
  choices,
}: {
  rules: ConditionGroup[];
  onChange: (rules: ConditionGroup[]) => void;
  setup: DisplaySetup;
  choices: VisibilityChoices | null;
}) {
  const first = setup.facts[0] ?? "signedIn";
  const currency = choices?.currency ?? "EUR";
  const w = useAdminText("blocks").display;
  const setGroup = (index: number, group: ConditionGroup) => onChange(rules.flatMap((g, i) => (i !== index ? [g] : group.length > 0 ? [group] : [])));
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line p-3" data-rule-builder="">
      <p className="text-xs text-muted">
        {w.when}
        {choices && choices.timeZone && fillWords(setup.kaizen ? w.timesKaizen : w.timesStore, { zone: choices.timeZone })}
      </p>
      {rules.map((group, groupIndex) => (
        <div key={groupIndex} className="flex flex-col gap-2">
          {groupIndex > 0 && (
            <p className="text-center text-eyebrow text-muted uppercase" aria-hidden>
              {w.or}
            </p>
          )}
          <fieldset className="flex flex-col gap-2 rounded-md bg-sunken p-2">
            <legend className="sr-only">{fillWords(w.group, { n: groupIndex + 1 })}</legend>
            {group.map((condition, index) => (
              <div key={index} className="flex flex-col gap-1">
                {index > 0 && (
                  <p className="text-xs font-medium text-muted" aria-hidden>
                    {w.and}
                  </p>
                )}
                <ConditionRow
                  condition={condition}
                  facts={setup.facts}
                  choices={choices}
                  currency={currency}
                  label={fillWords(w.condition, { g: groupIndex + 1, n: index + 1 })}
                  onChange={(next) => setGroup(groupIndex, group.map((c, i) => (i === index ? next : c)))}
                  onRemove={() => setGroup(groupIndex, group.filter((_, i) => i !== index))}
                />
              </div>
            ))}
            <button
              type="button"
              onClick={() => setGroup(groupIndex, [...group, newCondition(first, currency)])}
              className="flex min-h-9 items-center gap-1 self-start rounded-pill border border-edge px-2 text-sm"
            >
              <Plus aria-hidden className="size-4" /> {w.and}
            </button>
          </fieldset>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...rules, [newCondition(first, currency)]])}
        className="flex min-h-9 items-center gap-1 self-start rounded-pill border border-edge px-2 text-sm"
      >
        <Plus aria-hidden className="size-4" /> {w.or}
      </button>
    </div>
  );
}

const GROUP_ORDER = ["Visitor", "Place and language", "Time", "Cart and address"] as const;
const fieldClass = "min-h-9 rounded-md border border-line bg-card px-2 text-sm";

function ConditionRow({
  condition,
  facts,
  choices,
  currency,
  label,
  onChange,
  onRemove,
}: {
  condition: Condition;
  facts: readonly Fact[];
  choices: VisibilityChoices | null;
  currency: string;
  label: string;
  onChange: (c: Condition) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const info = FACT_INFO[condition.fact];
  const w = useAdminText("blocks").display;
  const own = conditionProblem(condition);
  const problem = own ? ((w.problems as Record<string, string>)[own] ?? own) : null;
  const changeOp = (op: Op) => {
    // A company's "is" takes yes or no, its "is one of" companies: the value changes kind with the operator.
    if (condition.fact === "company" && (op === "is") !== (condition.op === "is")) {
      onChange({ fact: "company", op: op as "is", value: op === "is" ? true : [] } as Condition);
    } else onChange({ ...condition, op } as Condition);
  };
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-card p-2" role="group" aria-label={label}>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={fillWords(w.asks, { label })}
          value={condition.fact}
          onChange={(event) => onChange(newCondition(event.target.value as Fact, currency))}
          className={fieldClass}
        >
          {GROUP_ORDER.map((group) => {
            const inGroup = facts.filter((fact) => FACT_INFO[fact].group === group);
            return inGroup.length === 0 ? null : (
              <optgroup key={group} label={w.groups[group] ?? group}>
                {inGroup.map((fact) => (
                  <option key={fact} value={fact}>
                    {w.facts[fact] ?? FACT_INFO[fact].label}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
        <select aria-label={fillWords(w.compares, { label })} value={condition.op} onChange={(event) => changeOp(event.target.value as Op)} className={fieldClass}>
          {info.ops.map((op) => (
            <option key={op} value={op}>
              {w.ops[op] ?? OP_LABELS[op]}
            </option>
          ))}
        </select>
        <button type="button" onClick={onRemove} aria-label={fillWords(w.remove, { label: label.toLowerCase() })} className="ml-auto flex size-9 items-center justify-center rounded-pill hover:bg-sunken">
          <X aria-hidden className="size-4" />
        </button>
      </div>
      <ValueField condition={condition} choices={choices} label={label} id={id} onChange={onChange} />
      {problem && <p className="text-xs text-(--danger)">{problem}</p>}
    </div>
  );
}

function ValueField({
  condition: c,
  choices,
  label,
  id,
  onChange,
}: {
  condition: Condition;
  choices: VisibilityChoices | null;
  label: string;
  id: string;
  onChange: (c: Condition) => void;
}) {
  const set = (value: unknown) => onChange({ ...c, value } as Condition);
  const w = useAdminText("blocks").display;
  const loading = <p className="text-xs text-muted">{w.loading}</p>;
  switch (c.fact) {
    case "signedIn":
    case "boughtBefore":
      return <YesNo label={label} value={c.value} onChange={set} />;
    case "company":
      if (c.op === "is") return <YesNo label={label} value={c.value === true} onChange={set} />;
      if (!choices) return loading;
      if (choices.companies === null) return <p className="text-xs text-muted">{w.noCompanies}</p>;
      return <IdChoice label={label} options={choices.companies} value={c.value as string[]} onChange={set} empty={w.emptyCompanies} />;
    case "customerGroup":
      return choices ? <IdChoice label={label} options={choices.groups} value={c.value} onChange={set} empty={w.emptyGroups} /> : loading;
    case "cartProduct":
      return choices ? <IdChoice label={label} options={choices.products} value={c.value} onChange={set} empty={w.emptyProducts} search /> : loading;
    case "cartCategory":
      return choices ? <IdChoice label={label} options={choices.categories} value={c.value} onChange={set} empty={w.emptyCategories} /> : loading;
    case "buyer":
      return (
        <select aria-label={fillWords(w.buyer, { label })} value={c.value} onChange={(event) => set(event.target.value)} className={fieldClass}>
          <option value="business">{w.business}</option>
          <option value="private">{w.private}</option>
        </select>
      );
    case "country":
      return choices ? <IdChoice label={label} options={choices.countries.map((x) => ({ id: x.code, name: x.name }))} value={c.value} onChange={set} empty={w.emptyCountries} /> : loading;
    case "language":
      return choices ? <IdChoice label={label} options={choices.languages.map((x) => ({ id: x.code, name: x.name }))} value={c.value} onChange={set} empty={w.emptyLanguages} /> : loading;
    case "currency":
      return choices ? <IdChoice label={label} options={choices.currencies.map((x) => ({ id: x, name: x }))} value={c.value} onChange={set} empty={w.emptyCurrencies} /> : loading;
    case "date":
      return (
        <div className="flex flex-wrap gap-2">
          <label className="flex flex-col gap-1 text-xs">
            {w.from}
            <input type="datetime-local" value={c.value.from ?? ""} onChange={(event) => set({ ...c.value, from: event.target.value || undefined })} className={fieldClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            {w.until}
            <input type="datetime-local" value={c.value.to ?? ""} onChange={(event) => set({ ...c.value, to: event.target.value || undefined })} className={fieldClass} />
          </label>
        </div>
      );
    case "weekday":
      return (
        <div role="group" aria-label={fillWords(w.daysLabel, { label })} className="flex flex-wrap gap-1">
          {WEEKDAYS.map((day) => {
            const on = c.value.includes(day);
            return (
              <button
                key={day}
                type="button"
                aria-pressed={on}
                onClick={() => set(on ? c.value.filter((d) => d !== day) : [...c.value, day].sort())}
                className="min-h-9 rounded-pill border border-edge px-2 text-sm aria-pressed:border-brand aria-pressed:bg-inverse aria-pressed:text-inverse-ink"
              >
                {((w.days as Record<string, string>)[String(day)] ?? WEEKDAY_LABELS[day]).slice(0, 3)}
              </button>
            );
          })}
        </div>
      );
    case "hour":
      return (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs">
            {w.from}
            <input type="time" value={c.value.from} onChange={(event) => set({ ...c.value, from: event.target.value })} className={fieldClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            {w.until}
            <input type="time" value={c.value.to} onChange={(event) => set({ ...c.value, to: event.target.value })} className={fieldClass} />
          </label>
          <p className="pb-2 text-xs text-muted">{w.midnight}</p>
        </div>
      );
    case "cartValue": {
      const digits = digitsOf(c.value.currency);
      const major = (minor: number | undefined) => (minor === undefined ? "" : String(minor / 10 ** digits));
      const minor = (text: string) => (text.trim() === "" || !Number.isFinite(Number(text)) ? undefined : Math.max(0, Math.round(Number(text) * 10 ** digits)));
      const currencies = choices?.currencies.length ? choices.currencies : [c.value.currency];
      return (
        <div className="flex flex-wrap items-end gap-2">
          {c.op !== "lte" && (
            <label className="flex flex-col gap-1 text-xs">
              {c.op === "between" ? w.from : w.amount}
              <input type="number" min={0} step="any" inputMode="decimal" value={major(c.value.min)} onChange={(event) => set({ ...c.value, min: minor(event.target.value) })} className={`${fieldClass} w-28`} />
            </label>
          )}
          {c.op !== "gte" && (
            <label className="flex flex-col gap-1 text-xs">
              {c.op === "between" ? w.to : w.amount}
              <input type="number" min={0} step="any" inputMode="decimal" value={major(c.value.max)} onChange={(event) => set({ ...c.value, max: minor(event.target.value) })} className={`${fieldClass} w-28`} />
            </label>
          )}
          <label className="flex flex-col gap-1 text-xs">
            {w.currency}
            <select value={c.value.currency} onChange={(event) => set({ ...c.value, currency: event.target.value })} className={fieldClass}>
              {currencies.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
          <p className="w-full text-xs text-muted">{w.cartHint}</p>
        </div>
      );
    }
    case "query": {
      const needsText = c.op === "is" || c.op === "isNot" || c.op === "contains";
      return (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs" htmlFor={`${id}-name`}>
            {w.parameter}
            <input id={`${id}-name`} value={c.value.name} placeholder="utm_campaign" onChange={(event) => set({ ...c.value, name: event.target.value })} className={fieldClass} />
          </label>
          {needsText && (
            <label className="flex flex-col gap-1 text-xs" htmlFor={`${id}-text`}>
              {w.value}
              <input id={`${id}-text`} value={c.value.text ?? ""} onChange={(event) => set({ ...c.value, text: event.target.value })} className={fieldClass} />
            </label>
          )}
          <p className="w-full text-xs text-muted">{w.queryHint}</p>
        </div>
      );
    }
  }
}

const digitsOf = (currency: string) => {
  try {
    return minorUnitDigits(currency);
  } catch {
    return 2;
  }
};

function YesNo({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  const w = useAdminText("blocks").display;
  return (
    <select aria-label={fillWords(w.yesNo, { label })} value={value ? "yes" : "no"} onChange={(event) => onChange(event.target.value === "yes")} className={fieldClass}>
      <option value="yes">{w.yes}</option>
      <option value="no">{w.no}</option>
    </select>
  );
}

/** A choice of several of the store's things; one chosen that is no longer the store's is shown as removed. */
export function IdChoice({
  label,
  options,
  value,
  onChange,
  empty,
  search = false,
}: {
  label: string;
  options: { id: string; name: string }[];
  value: string[];
  onChange: (value: string[]) => void;
  empty: string;
  search?: boolean;
}) {
  const [filter, setFilter] = useState("");
  const w = useAdminText("blocks").display;
  const known = new Set(options.map((o) => o.id));
  const removed = value.filter((id) => !known.has(id));
  const shown = filter.trim() ? options.filter((o) => o.name.toLowerCase().includes(filter.trim().toLowerCase())) : options;
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <div className="flex flex-col gap-1">
      {removed.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label={fillWords(w.removedList, { label })}>
          {removed.map((id) => (
            <li key={id} className="flex items-center gap-1 rounded border border-(--danger) px-2 py-0.5 text-xs text-(--danger)">
              {w.removed}
              <button type="button" onClick={() => toggle(id)} aria-label={w.takeOut} className="rounded hover:bg-sunken">
                <X aria-hidden className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {options.length === 0 ? (
        <p className="text-xs text-muted">{empty}</p>
      ) : (
        <>
          {search && options.length > 8 && (
            <input type="search" aria-label={fillWords(w.find, { label })} placeholder={w.findPlaceholder} value={filter} onChange={(event) => setFilter(event.target.value)} className={fieldClass} />
          )}
          <div role="group" aria-label={fillWords(w.choices, { label })} className="flex max-h-40 flex-col gap-1 overflow-y-auto">
            {shown.map((option) => (
              <label key={option.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={value.includes(option.id)} onChange={() => toggle(option.id)} />
                {option.name || w.noName}
              </label>
            ))}
          </div>
        </>
      )}
      {value.length === 0 && options.length > 0 && <p className="text-xs text-muted">{w.nothingChosen}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The canvas's eyes
// ---------------------------------------------------------------------------

/** What an eye says, and its colour: blue for Never, signed in or out; red for conditions (Beaver's colours). */
export function displayMark(show: Show | undefined, w?: DisplayWords): { tone: "plain" | "rules"; text: string } | null {
  const kind = displayKind(show);
  if (kind === "always") return null;
  const text = kind === "never" ? (w?.neverShown ?? "Never shown") : kind === "rules" ? (w?.byConditions ?? "Shown by conditions") : (w?.kinds[kind] ?? DISPLAY_LABELS[kind]);
  return { tone: kind === "rules" ? "rules" : "plain", text };
}

/** The eye on a part of the canvas whose display is not Always: always there, whatever the size shown. */
export function DisplayBadge({ show }: { show: Show | undefined }) {
  const mark = displayMark(show, useAdminText("blocks").display);
  if (!mark) return null;
  const Icon = show === "never" ? EyeOff : Eye;
  return (
    <span
      data-builder-display={mark.tone}
      title={mark.text}
      className={`pointer-events-none absolute right-1 bottom-1 z-20 inline-flex items-center gap-1 rounded border bg-sunken px-1.5 py-0.5 text-[11px] shadow-sm ${
        mark.tone === "rules" ? "border-(--danger) text-(--danger)" : "border-(--chart-1) text-(--chart-1)"
      }`}
    >
      <Icon aria-hidden className="size-3.5" />
      <span>{mark.text}</span>
    </span>
  );
}

/** The legend over the canvas: what the eyes mean, and the parts that carry one, each opening its settings. */
export function DisplayLegend({ parts, onOpen }: { parts: { id: string; name: string; show: Show }[]; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const w = useAdminText("blocks").display;
  if (parts.length === 0) return null;
  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="flex min-h-9 items-center gap-2 rounded-pill border border-edge px-3 text-sm"
      >
        <Eye aria-hidden className="size-4 text-(--chart-1)" strokeWidth={1.75} />
        {fillWords(w.whoSees, { n: parts.length })}
      </button>
      {open && (
        <div id={id} className="absolute right-0 z-40 mt-1 flex w-80 flex-col gap-2 rounded-md border border-line bg-card p-3 text-sm shadow-md">
          <p className="flex items-center gap-2 text-xs">
            <Eye aria-hidden className="size-3.5 text-(--chart-1)" /> {w.blue}
          </p>
          <p className="flex items-center gap-2 text-xs">
            <Eye aria-hidden className="size-3.5 text-(--danger)" /> {w.red}
          </p>
          <p className="flex items-center gap-2 text-xs text-muted">
            <Eye aria-hidden className="size-3.5" /> {w.grey}
          </p>
          <ul className="flex flex-col gap-1 border-t border-line pt-2">
            {parts.map((part) => {
              const mark = displayMark(part.show, w)!;
              return (
                <li key={part.id}>
                  <button type="button" onClick={() => onOpen(part.id)} className="flex w-full items-center justify-between gap-2 rounded px-1 py-1 text-left hover:bg-sunken">
                    <span>{part.name}</span>
                    <span className={`text-xs ${mark.tone === "rules" ? "text-(--danger)" : "text-(--chart-1)"}`}>{mark.text}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
