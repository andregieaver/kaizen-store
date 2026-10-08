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
  const choose = (next: DisplayKind) => {
    if (next === kind) return;
    if (next === "rules") onChange({ rules: [[newCondition(setup.facts[0] ?? "signedIn")]] });
    else onChange(next === "always" ? undefined : next);
  };
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={`${id}-display`} className="text-sm font-medium">
        Display
      </label>
      <select
        id={`${id}-display`}
        value={kind}
        disabled={Boolean(locked) && kind === "always"}
        onChange={(event) => choose(event.target.value as DisplayKind)}
        aria-describedby={`${id}-hint`}
        className="min-h-10 rounded-md border border-border bg-background px-3 text-sm"
      >
        {DISPLAYS.map((d) => (
          <option key={d} value={d}>
            {DISPLAY_LABELS[d]}
          </option>
        ))}
      </select>
      <p id={`${id}-hint`} className="text-xs text-muted">
        {locked ??
          (setup.kaizen
            ? "Signed in is a person signed in to Kaizen's admin. Hidden parts are left out of the page by the server, not just hidden."
            : "Signed in is a shopper signed in to their customer account. Hidden parts are left out of the page by the server, not just hidden; search engines see what a signed-out visitor sees.")}
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
  const setGroup = (index: number, group: ConditionGroup) => onChange(rules.flatMap((g, i) => (i !== index ? [g] : group.length > 0 ? [group] : [])));
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3" data-rule-builder="">
      <p className="text-xs text-muted">
        Shown when every condition of a group holds, in any group.
        {choices && choices.timeZone && <> Times are in {setup.kaizen ? "Kaizen's" : "the store's"} time zone, {choices.timeZone}.</>}
      </p>
      {rules.map((group, groupIndex) => (
        <div key={groupIndex} className="flex flex-col gap-2">
          {groupIndex > 0 && (
            <p className="text-center text-xs font-semibold tracking-wide text-muted uppercase" aria-hidden>
              Or
            </p>
          )}
          <fieldset className="flex flex-col gap-2 rounded-md bg-surface p-2">
            <legend className="sr-only">Group {groupIndex + 1}</legend>
            {group.map((condition, index) => (
              <div key={index} className="flex flex-col gap-1">
                {index > 0 && (
                  <p className="text-xs font-semibold text-muted" aria-hidden>
                    And
                  </p>
                )}
                <ConditionRow
                  condition={condition}
                  facts={setup.facts}
                  choices={choices}
                  currency={currency}
                  label={`Group ${groupIndex + 1}, condition ${index + 1}`}
                  onChange={(next) => setGroup(groupIndex, group.map((c, i) => (i === index ? next : c)))}
                  onRemove={() => setGroup(groupIndex, group.filter((_, i) => i !== index))}
                />
              </div>
            ))}
            <button
              type="button"
              onClick={() => setGroup(groupIndex, [...group, newCondition(first, currency)])}
              className="flex min-h-9 items-center gap-1 self-start rounded-md border border-border px-2 text-sm"
            >
              <Plus aria-hidden className="size-4" /> And
            </button>
          </fieldset>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...rules, [newCondition(first, currency)]])}
        className="flex min-h-9 items-center gap-1 self-start rounded-md border border-border px-2 text-sm"
      >
        <Plus aria-hidden className="size-4" /> Or
      </button>
    </div>
  );
}

const GROUP_ORDER = ["Visitor", "Place and language", "Time", "Cart and address"] as const;
const fieldClass = "min-h-9 rounded-md border border-border bg-background px-2 text-sm";

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
  const problem = conditionProblem(condition);
  const changeOp = (op: Op) => {
    // A company's "is" takes yes or no, its "is one of" companies: the value changes kind with the operator.
    if (condition.fact === "company" && (op === "is") !== (condition.op === "is")) {
      onChange({ fact: "company", op: op as "is", value: op === "is" ? true : [] } as Condition);
    } else onChange({ ...condition, op } as Condition);
  };
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-background p-2" role="group" aria-label={label}>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={`${label}: what it asks`}
          value={condition.fact}
          onChange={(event) => onChange(newCondition(event.target.value as Fact, currency))}
          className={fieldClass}
        >
          {GROUP_ORDER.map((group) => {
            const inGroup = facts.filter((fact) => FACT_INFO[fact].group === group);
            return inGroup.length === 0 ? null : (
              <optgroup key={group} label={group}>
                {inGroup.map((fact) => (
                  <option key={fact} value={fact}>
                    {FACT_INFO[fact].label}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
        <select aria-label={`${label}: how it compares`} value={condition.op} onChange={(event) => changeOp(event.target.value as Op)} className={fieldClass}>
          {info.ops.map((op) => (
            <option key={op} value={op}>
              {OP_LABELS[op]}
            </option>
          ))}
        </select>
        <button type="button" onClick={onRemove} aria-label={`Remove ${label.toLowerCase()}`} className="ml-auto flex size-9 items-center justify-center rounded-md hover:bg-surface">
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
  const loading = <p className="text-xs text-muted">Loading the store’s choices…</p>;
  switch (c.fact) {
    case "signedIn":
    case "boughtBefore":
      return <YesNo label={label} value={c.value} onChange={set} />;
    case "company":
      if (c.op === "is") return <YesNo label={label} value={c.value === true} onChange={set} />;
      if (!choices) return loading;
      if (choices.companies === null) return <p className="text-xs text-muted">Only staff who may see customers can choose companies; choose “is” to ask whether the visitor has a company account.</p>;
      return <IdChoice label={label} options={choices.companies} value={c.value as string[]} onChange={set} empty="The store has no company accounts yet." />;
    case "customerGroup":
      return choices ? <IdChoice label={label} options={choices.groups} value={c.value} onChange={set} empty="The store has no customer groups yet." /> : loading;
    case "cartProduct":
      return choices ? <IdChoice label={label} options={choices.products} value={c.value} onChange={set} empty="The store has no products yet." search /> : loading;
    case "cartCategory":
      return choices ? <IdChoice label={label} options={choices.categories} value={c.value} onChange={set} empty="The store has no product categories yet." /> : loading;
    case "buyer":
      return (
        <select aria-label={`${label}: buyer`} value={c.value} onChange={(event) => set(event.target.value)} className={fieldClass}>
          <option value="business">A business</option>
          <option value="private">A private person</option>
        </select>
      );
    case "country":
      return choices ? <IdChoice label={label} options={choices.countries.map((x) => ({ id: x.code, name: x.name }))} value={c.value} onChange={set} empty="The store sells to no country yet." /> : loading;
    case "language":
      return choices ? <IdChoice label={label} options={choices.languages.map((x) => ({ id: x.code, name: x.name }))} value={c.value} onChange={set} empty="No languages." /> : loading;
    case "currency":
      return choices ? <IdChoice label={label} options={choices.currencies.map((x) => ({ id: x, name: x }))} value={c.value} onChange={set} empty="No currencies." /> : loading;
    case "date":
      return (
        <div className="flex flex-wrap gap-2">
          <label className="flex flex-col gap-1 text-xs">
            From
            <input type="datetime-local" value={c.value.from ?? ""} onChange={(event) => set({ ...c.value, from: event.target.value || undefined })} className={fieldClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Until
            <input type="datetime-local" value={c.value.to ?? ""} onChange={(event) => set({ ...c.value, to: event.target.value || undefined })} className={fieldClass} />
          </label>
        </div>
      );
    case "weekday":
      return (
        <div role="group" aria-label={`${label}: days`} className="flex flex-wrap gap-1">
          {WEEKDAYS.map((day) => {
            const on = c.value.includes(day);
            return (
              <button
                key={day}
                type="button"
                aria-pressed={on}
                onClick={() => set(on ? c.value.filter((d) => d !== day) : [...c.value, day].sort())}
                className="min-h-9 rounded-md border border-border px-2 text-sm aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background"
              >
                {WEEKDAY_LABELS[day].slice(0, 3)}
              </button>
            );
          })}
        </div>
      );
    case "hour":
      return (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs">
            From
            <input type="time" value={c.value.from} onChange={(event) => set({ ...c.value, from: event.target.value })} className={fieldClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Until
            <input type="time" value={c.value.to} onChange={(event) => set({ ...c.value, to: event.target.value })} className={fieldClass} />
          </label>
          <p className="pb-2 text-xs text-muted">A start after the end runs over midnight.</p>
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
              {c.op === "between" ? "From" : "Amount"}
              <input type="number" min={0} step="any" inputMode="decimal" value={major(c.value.min)} onChange={(event) => set({ ...c.value, min: minor(event.target.value) })} className={`${fieldClass} w-28`} />
            </label>
          )}
          {c.op !== "gte" && (
            <label className="flex flex-col gap-1 text-xs">
              {c.op === "between" ? "To" : "Amount"}
              <input type="number" min={0} step="any" inputMode="decimal" value={major(c.value.max)} onChange={(event) => set({ ...c.value, max: minor(event.target.value) })} className={`${fieldClass} w-28`} />
            </label>
          )}
          <label className="flex flex-col gap-1 text-xs">
            Currency
            <select value={c.value.currency} onChange={(event) => set({ ...c.value, currency: event.target.value })} className={fieldClass}>
              {currencies.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
          <p className="w-full text-xs text-muted">The cart’s items as the shopper sees them (without VAT for businesses), before shipping and discounts; in another currency, converted at the store’s rates.</p>
        </div>
      );
    }
    case "query": {
      const needsText = c.op === "is" || c.op === "isNot" || c.op === "contains";
      return (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs" htmlFor={`${id}-name`}>
            Parameter
            <input id={`${id}-name`} value={c.value.name} placeholder="utm_campaign" onChange={(event) => set({ ...c.value, name: event.target.value })} className={fieldClass} />
          </label>
          {needsText && (
            <label className="flex flex-col gap-1 text-xs" htmlFor={`${id}-text`}>
              Value
              <input id={`${id}-text`} value={c.value.text ?? ""} onChange={(event) => set({ ...c.value, text: event.target.value })} className={fieldClass} />
            </label>
          )}
          <p className="w-full text-xs text-muted">From the page’s address, such as ?utm_campaign=spring. Nothing is kept.</p>
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
  return (
    <select aria-label={`${label}: yes or no`} value={value ? "yes" : "no"} onChange={(event) => onChange(event.target.value === "yes")} className={fieldClass}>
      <option value="yes">Yes</option>
      <option value="no">No</option>
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
  const known = new Set(options.map((o) => o.id));
  const removed = value.filter((id) => !known.has(id));
  const shown = filter.trim() ? options.filter((o) => o.name.toLowerCase().includes(filter.trim().toLowerCase())) : options;
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <div className="flex flex-col gap-1">
      {removed.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label={`${label}: removed`}>
          {removed.map((id) => (
            <li key={id} className="flex items-center gap-1 rounded border border-(--danger) px-2 py-0.5 text-xs text-(--danger)">
              Removed
              <button type="button" onClick={() => toggle(id)} aria-label="Take the removed one out" className="rounded hover:bg-surface">
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
            <input type="search" aria-label={`${label}: find`} placeholder="Find…" value={filter} onChange={(event) => setFilter(event.target.value)} className={fieldClass} />
          )}
          <div role="group" aria-label={`${label}: choices`} className="flex max-h-40 flex-col gap-1 overflow-y-auto">
            {shown.map((option) => (
              <label key={option.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={value.includes(option.id)} onChange={() => toggle(option.id)} />
                {option.name || "(no name)"}
              </label>
            ))}
          </div>
        </>
      )}
      {value.length === 0 && options.length > 0 && <p className="text-xs text-muted">Nothing chosen: “is one of” holds for nobody, “is none of” for everybody.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The canvas's eyes
// ---------------------------------------------------------------------------

/** What an eye says, and its colour: blue for Never, signed in or out; red for conditions (Beaver's colours). */
export function displayMark(show: Show | undefined): { tone: "plain" | "rules"; text: string } | null {
  const kind = displayKind(show);
  if (kind === "always") return null;
  return { tone: kind === "rules" ? "rules" : "plain", text: kind === "never" ? "Never shown" : kind === "rules" ? "Shown by conditions" : DISPLAY_LABELS[kind] };
}

/** The eye on a part of the canvas whose display is not Always: always there, whatever the size shown. */
export function DisplayBadge({ show }: { show: Show | undefined }) {
  const mark = displayMark(show);
  if (!mark) return null;
  const Icon = show === "never" ? EyeOff : Eye;
  return (
    <span
      data-builder-display={mark.tone}
      title={mark.text}
      className={`pointer-events-none absolute right-1 bottom-1 z-20 inline-flex items-center gap-1 rounded border bg-surface px-1.5 py-0.5 text-[11px] shadow-sm ${
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
  if (parts.length === 0) return null;
  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="flex min-h-9 items-center gap-2 rounded-md border border-border px-3 text-sm"
      >
        <Eye aria-hidden className="size-4 text-(--chart-1)" strokeWidth={1.75} />
        Who sees what ({parts.length})
      </button>
      {open && (
        <div id={id} className="absolute right-0 z-40 mt-1 flex w-80 flex-col gap-2 rounded-md border border-border bg-background p-3 text-sm shadow-md">
          <p className="flex items-center gap-2 text-xs">
            <Eye aria-hidden className="size-3.5 text-(--chart-1)" /> Blue: never shown, or only to signed-in or signed-out visitors.
          </p>
          <p className="flex items-center gap-2 text-xs">
            <Eye aria-hidden className="size-3.5 text-(--danger)" /> Red: shown by conditions.
          </p>
          <p className="flex items-center gap-2 text-xs text-muted">
            <Eye aria-hidden className="size-3.5" /> Grey: hidden at the screen size shown.
          </p>
          <ul className="flex flex-col gap-1 border-t border-border pt-2">
            {parts.map((part) => {
              const mark = displayMark(part.show)!;
              return (
                <li key={part.id}>
                  <button type="button" onClick={() => onOpen(part.id)} className="flex w-full items-center justify-between gap-2 rounded px-1 py-1 text-left hover:bg-surface">
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
