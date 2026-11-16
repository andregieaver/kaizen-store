"use client";

import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type UniqueIdentifier } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { useEffect, useId, useOptimistic, useRef, useState, useTransition, type ReactNode } from "react";

import { fillWords } from "@/lib/admin-fill";
import { allergenQuestion } from "@/lib/checkout-presets";
import { CHECKOUT_FIELD_KINDS, CONDITION_KINDS, EFFECT_KINDS, hasBounds, hasOptions, movedTo, type ChecklistOption, type CheckoutFieldKind, type FieldWidth, type RuleCondition, type RuleEffect, type Words } from "@/lib/checkout-rules";

import { useAdminText } from "./admin-text";
import { Button, Card, Chip, List, ListRow, RowLead } from "./ui";

type Saved = { ok: true } | { ok: false; problems: string[] };
type AsyncSaved = Promise<Saved>;
type AsyncDone = Promise<void>;

type Choice = { id: string; label: string };

/** What the store has to choose from: delivery options by key, products, categories and tags, groups, countries, methods, currencies, languages. */
export type RuleChoices = {
  options: Choice[];
  products: Choice[];
  categories: Choice[];
  tags: Choice[];
  groups: Choice[];
  countries: Choice[];
  methods: Choice[];
  currencies: string[];
  /** The store's languages after its main one, for words in other languages. */
  locales: Choice[];
};

export type RuleView = {
  id: string;
  name: string;
  enabled: boolean;
  conditions: RuleCondition[];
  effect: RuleEffect;
  skips: { reason: string; count: number; since: string }[];
};

export type FieldView = {
  id: string;
  kind: CheckoutFieldKind;
  required: boolean;
  label: Words;
  help: Words | null;
  enabled: boolean;
  width: FieldWidth;
  options?: ChecklistOption[];
  sensitive: boolean;
  bounds?: { min?: number; max?: number };
  conditions?: RuleCondition[];
};

export type RuleInputView = { name: string; conditions: RuleCondition[]; effect: RuleEffect };
export type FieldInputView = {
  kind: CheckoutFieldKind;
  required: boolean;
  label: Words;
  help: Words | null;
  width: FieldWidth;
  options?: { id?: string; label: Words; none?: boolean }[];
  sensitive?: boolean;
  bounds?: { min?: number; max?: number };
  conditions?: RuleCondition[];
};

export type CheckoutRuleActions = {
  saveRule: (id: string | null, input: RuleInputView) => AsyncSaved;
  switchRule: (id: string, on: boolean) => AsyncDone;
  moveRule: (id: string, by: -1 | 1) => AsyncDone;
  removeRule: (id: string) => AsyncDone;
  saveField: (id: string | null, input: FieldInputView) => AsyncSaved;
  switchField: (id: string, on: boolean) => AsyncDone;
  /** Moves a question to place `to` (0 is first). */
  moveField: (id: string, to: number) => AsyncDone;
  removeField: (id: string) => AsyncDone;
};

const FIELD = "min-h-10 rounded-md border border-line bg-card px-3 text-sm";
const EMPTY_WORDS: Words = { text: "", byLocale: {} };

function blankCondition(kind: RuleCondition["kind"], choices: RuleChoices): RuleCondition {
  switch (kind) {
    case "country":
      return { kind, op: "is", countries: choices.countries[0] ? [choices.countries[0].id] : [] };
    case "total":
      return { kind, op: "at_least", amountMinor: 0, currency: choices.currencies[0] ?? "EUR" };
    case "weight":
      return { kind, op: "at_least", grams: 0 };
    case "group":
      return { kind, op: "is", ids: [] };
    default:
      return { kind, op: "has", ids: [] };
  }
}

function blankEffect(kind: RuleEffect["kind"]): RuleEffect {
  switch (kind) {
    case "hide_shipping":
      return { kind, options: [] };
    case "rename_shipping":
      return { kind, option: "", label: EMPTY_WORDS };
    case "hide_payment_method":
      return { kind, methods: [] };
    case "refuse":
      return { kind, message: EMPTY_WORDS };
    case "order_delivery":
      return { kind, options: [] };
    case "delivery_price":
      return { kind, options: [], price: { kind: "free" } };
  }
}

/** Several of a list: a box per choice. */
function Many({ choices, chosen, onChange, label }: { choices: Choice[]; chosen: string[]; onChange: (next: string[]) => void; label: string }) {
  return (
    <fieldset className="flex max-h-48 min-w-0 flex-col gap-1 overflow-y-auto rounded-panel border border-line p-2 text-sm">
      <legend className="sr-only">{label}</legend>
      {choices.map((c) => (
        <label key={c.id} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={chosen.includes(c.id)}
            onChange={(e) => onChange(e.target.checked ? [...chosen, c.id] : chosen.filter((id) => id !== c.id))}
            className="size-4"
          />
          {c.label}
        </label>
      ))}
    </fieldset>
  );
}

/** Words in the main language, with the store's other languages one step away. */
function WordsField({ value, onChange, label, locales, max }: { value: Words; onChange: (next: Words) => void; label: string; locales: Choice[]; max: number }) {
  const w = useAdminText("shipping").checkoutRules;
  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1 text-sm">
        {label}
        <input value={value.text} onChange={(e) => onChange({ ...value, text: e.target.value })} maxLength={max} className={FIELD} />
      </label>
      {locales.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">{w.otherLanguages}</summary>
          <div className="mt-2 flex flex-col gap-2">
            {locales.map((l) => (
              <label key={l.id} className="flex flex-col gap-1">
                {l.label}
                <input
                  value={value.byLocale[l.id] ?? ""}
                  onChange={(e) => onChange({ ...value, byLocale: { ...value.byLocale, [l.id]: e.target.value } })}
                  maxLength={max}
                  className={FIELD}
                />
              </label>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/**
 * Conditions that must all hold (D357): a checkout rule's, and a question's (task 4). Each names a country, the basket's value or weight,
 * products, categories, tags or customer groups; none means always.
 */
function ConditionsEditor({
  conditions,
  onChange,
  choices,
  legend,
  none,
}: {
  conditions: RuleCondition[];
  onChange: (next: RuleCondition[]) => void;
  choices: RuleChoices;
  legend: string;
  none: string;
}) {
  const w = useAdminText("shipping").checkoutRules;
  const setConditions = onChange;
  const setCondition = (i: number, next: RuleCondition) => setConditions(conditions.map((c, j) => (j === i ? next : c)));
  const pools: Record<"product" | "category" | "tag" | "group", Choice[]> = {
    product: choices.products,
    category: choices.categories,
    tag: choices.tags,
    group: choices.groups,
  };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-body-strong text-ink">{legend}</legend>
      {conditions.length === 0 && <p className="text-sm text-muted">{none}</p>}
      {conditions.map((c, i) => (
        <div key={i} className="flex flex-wrap items-start gap-2 rounded-panel border border-line p-2">
          <span className="min-h-10 content-center text-sm">{w.conditionKinds[c.kind]}</span>
          {c.kind === "country" && (
            <>
              <select value={c.op} onChange={(e) => setCondition(i, { ...c, op: e.target.value as "is" | "is_not" })} className={FIELD}>
                <option value="is">{w.ops.is}</option>
                <option value="is_not">{w.ops.is_not}</option>
              </select>
              <Many choices={choices.countries} chosen={c.countries} onChange={(countries) => setCondition(i, { ...c, countries })} label={w.conditionKinds.country} />
            </>
          )}
          {c.kind === "total" && (
            <>
              <select value={c.op} onChange={(e) => setCondition(i, { ...c, op: e.target.value as "at_least" | "below" })} className={FIELD}>
                <option value="at_least">{w.ops.at_least}</option>
                <option value="below">{w.ops.below}</option>
              </select>
              <input
                type="number"
                min={0}
                step="0.01"
                value={c.amountMinor / 100}
                onChange={(e) => setCondition(i, { ...c, amountMinor: Math.max(0, Math.round(Number(e.target.value) * 100)) })}
                className={`${FIELD} w-32`}
                aria-label={w.conditionKinds.total}
              />
              <select value={c.currency} onChange={(e) => setCondition(i, { ...c, currency: e.target.value })} className={FIELD} aria-label={w.conditionKinds.total}>
                {choices.currencies.map((cur) => (
                  <option key={cur} value={cur}>
                    {cur}
                  </option>
                ))}
              </select>
            </>
          )}
          {c.kind === "weight" && (
            <>
              <select value={c.op} onChange={(e) => setCondition(i, { ...c, op: e.target.value as "at_least" | "below" })} className={FIELD}>
                <option value="at_least">{w.ops.at_least}</option>
                <option value="below">{w.ops.below}</option>
              </select>
              <input
                type="number"
                min={0}
                value={c.grams}
                onChange={(e) => setCondition(i, { ...c, grams: Math.max(0, Math.round(Number(e.target.value))) })}
                className={`${FIELD} w-32`}
                aria-label={w.conditionKinds.weight}
              />
              <span className="min-h-10 content-center text-sm">{w.grams}</span>
            </>
          )}
          {(c.kind === "product" || c.kind === "category" || c.kind === "tag" || c.kind === "group") && (
            <>
              <select
                value={c.op}
                onChange={(e) => setCondition(i, { ...c, op: e.target.value } as RuleCondition)}
                className={FIELD}
              >
                {(c.kind === "group" ? (["is", "is_not"] as const) : (["has", "has_not"] as const)).map((op) => (
                  <option key={op} value={op}>
                    {w.ops[op]}
                  </option>
                ))}
              </select>
              <Many choices={pools[c.kind]} chosen={c.ids} onChange={(ids) => setCondition(i, { ...c, ids } as RuleCondition)} label={w.conditionKinds[c.kind]} />
            </>
          )}
          <Button type="button" kind="quiet" onClick={() => setConditions(conditions.filter((_, j) => j !== i))}>
            {w.remove}
          </Button>
        </div>
      ))}
      {conditions.length < 10 && (
        <select
          value=""
          onChange={(e) => e.target.value && setConditions([...conditions, blankCondition(e.target.value as RuleCondition["kind"], choices)])}
          className={`${FIELD} self-start`}
          aria-label={w.addCondition}
        >
          <option value="">{w.addCondition}</option>
          {CONDITION_KINDS.map((k) => (
            <option key={k} value={k}>
              {w.conditionKinds[k]}
            </option>
          ))}
        </select>
      )}
    </fieldset>
  );
}

/** Makes or changes a rule: when (all conditions), then (one effect). Saved off. */
export function RuleEditor({
  start,
  choices,
  save,
  onDone,
}: {
  start: (RuleInputView & { id: string | null }) | null;
  choices: RuleChoices;
  save: CheckoutRuleActions["saveRule"];
  onDone: () => void;
}) {
  const w = useAdminText("shipping").checkoutRules;
  const [pending, run] = useTransition();
  const [problems, setProblems] = useState<string[]>([]);
  const [name, setName] = useState(start?.name ?? "");
  const [conditions, setConditions] = useState<RuleCondition[]>(start?.conditions ?? []);
  const [effect, setEffect] = useState<RuleEffect>(start?.effect ?? blankEffect("hide_shipping"));

  return (
    <form
      aria-busy={pending}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const saved = await save(start?.id ?? null, { name, conditions, effect });
          if (saved.ok) {
            setProblems([]);
            onDone();
          } else setProblems(saved.problems);
        });
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        {w.name}
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required className={FIELD} />
      </label>
      <ConditionsEditor conditions={conditions} onChange={setConditions} choices={choices} legend={w.when} none={w.always} />
      <fieldset className="flex flex-col gap-2">
        <legend className="text-body-strong text-ink">{w.then}</legend>
        <select value={effect.kind} onChange={(e) => setEffect(blankEffect(e.target.value as RuleEffect["kind"]))} className={`${FIELD} self-start`} aria-label={w.then}>
          {EFFECT_KINDS.map((k) => (
            <option key={k} value={k}>
              {w.effectKinds[k]}
            </option>
          ))}
        </select>
        {effect.kind === "hide_shipping" && (
          <Many choices={choices.options} chosen={effect.options} onChange={(options) => setEffect({ ...effect, options })} label={w.effectKinds.hide_shipping} />
        )}
        {effect.kind === "rename_shipping" && (
          <>
            <select value={effect.option} onChange={(e) => setEffect({ ...effect, option: e.target.value })} className={`${FIELD} self-start`} aria-label={w.effectKinds.rename_shipping}>
              <option value="">{w.choose}</option>
              {choices.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <WordsField value={effect.label} onChange={(label) => setEffect({ ...effect, label })} label={w.newName} locales={choices.locales} max={80} />
          </>
        )}
        {effect.kind === "order_delivery" && (
          <>
            <Many choices={choices.options} chosen={effect.options} onChange={(options) => setEffect({ ...effect, options })} label={w.effectKinds.order_delivery} />
            <p className="text-sm text-muted">
              {effect.options.length > 0
                ? `${w.shownFirst} ${effect.options.map((o) => choices.options.find((c) => c.id === o)?.label ?? o).join(", ")}`
                : w.orderHint}
            </p>
          </>
        )}
        {effect.kind === "delivery_price" && (
          <>
            <Many choices={choices.options} chosen={effect.options} onChange={(options) => setEffect({ ...effect, options })} label={w.effectKinds.delivery_price} />
            <select
              value={effect.price.kind}
              onChange={(e) => {
                const kind = e.target.value as "free" | "percent" | "amount";
                setEffect({ ...effect, price: kind === "free" ? { kind } : kind === "percent" ? { kind, percent: -10 } : { kind, amounts: {} } });
              }}
              className={`${FIELD} self-start`}
              aria-label={w.priceKind}
            >
              <option value="free">{w.priceKinds.free}</option>
              <option value="percent">{w.priceKinds.percent}</option>
              <option value="amount">{w.priceKinds.amount}</option>
            </select>
            {effect.price.kind === "percent" && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="number"
                  min={-100}
                  max={300}
                  step={1}
                  value={effect.price.percent}
                  onChange={(e) => setEffect({ ...effect, price: { kind: "percent", percent: Math.round(Number(e.target.value)) } })}
                  className={`${FIELD} w-24`}
                />
                %
              </label>
            )}
            {effect.price.kind === "amount" &&
              choices.currencies.map((currency) => {
                const amounts = effect.price.kind === "amount" ? effect.price.amounts : {};
                return (
                  <label key={currency} className="flex items-center gap-2 text-sm">
                    <input
                      type="number"
                      step="0.01"
                      value={amounts[currency] === undefined ? "" : amounts[currency] / 100}
                      onChange={(e) => {
                        const next = { ...amounts };
                        if (e.target.value === "") delete next[currency];
                        else next[currency] = Math.round(Number(e.target.value) * 100);
                        setEffect({ ...effect, price: { kind: "amount", amounts: next } });
                      }}
                      className={`${FIELD} w-32`}
                    />
                    {currency}
                  </label>
                );
              })}
            <p className="text-sm text-muted">{w.priceHint}</p>
          </>
        )}
        {effect.kind === "hide_payment_method" && (
          <>
            <Many choices={choices.methods} chosen={effect.methods} onChange={(methods) => setEffect({ ...effect, methods })} label={w.effectKinds.hide_payment_method} />
            <p className="text-sm text-muted">{w.cardsAlways}</p>
          </>
        )}
        {effect.kind === "refuse" && <WordsField value={effect.message} onChange={(message) => setEffect({ ...effect, message })} label={w.message} locales={choices.locales} max={300} />}
      </fieldset>
      {problems.length > 0 && (
        <ul className="text-sm text-danger-text" role="alert">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Button type="submit" kind="strong" disabled={pending}>
          {pending ? w.saving : w.save}
        </Button>
        <Button type="button" kind="quiet" onClick={onDone}>
          {w.cancel}
        </Button>
      </div>
    </form>
  );
}

/** Delete behind one more press: a line under the row asks in words, then Delete or Keep it (a slip of the finger never deletes). */
function DeleteAsk({ ask, pending, onDelete, onKeep }: { ask: string; pending: boolean; onDelete: () => void; onKeep: () => void }) {
  const w = useAdminText("shipping").checkoutRules;
  return (
    <div role="group" aria-label={ask} className="flex basis-full flex-wrap items-center gap-2 rounded-panel bg-sunken px-3 py-2 text-sm">
      <span className="min-w-0 flex-1">{ask}</span>
      <Button kind="danger" size="dense" disabled={pending} onClick={onDelete}>
        {w.remove}
      </Button>
      <Button kind="quiet" size="dense" onClick={onKeep}>
        {w.keepIt}
      </Button>
    </div>
  );
}

/** The rules in the order they are read, each with its switch, place and what kept it out lately. */
export function RuleList({
  rules,
  choices,
  canWrite,
  actions,
  examples = [],
}: {
  rules: RuleView[];
  choices: RuleChoices;
  canWrite: boolean;
  actions: CheckoutRuleActions;
  /** Rules a shop really writes, offered while it has none (round 7, D624): each opens the editor filled in, saved off as any rule. */
  examples?: { label: string; start: RuleInputView }[];
}) {
  const w = useAdminText("shipping").checkoutRules;
  const [editing, setEditing] = useState<string | null>(null);
  const [preset, setPreset] = useState<RuleInputView | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [pending, run] = useTransition();
  return (
    <Card
      title={w.rules}
      aside={
        canWrite && editing !== "new" ? (
          <Button kind="strong" onClick={() => { setPreset(null); setEditing("new"); }}>
            {w.newRule}
          </Button>
        ) : undefined
      }
    >
      {/* Round 24 (D692): the examples to start from open with Add, above a blank rule, rather than before anyone wants one. */}
      {canWrite && rules.length === 0 && editing === "new" && preset === null && examples.length > 0 && (
        <>
          <p className="mb-2 text-sm text-muted">{w.examplesStart}</p>
          <ul aria-label={w.examplesLabel} className="mb-3 flex flex-wrap gap-2">
            {examples.map((example) => (
              <li key={example.label}>
                <button type="button" onClick={() => { setPreset(example.start); setEditing("new"); }} className="inline-flex min-h-10 items-center rounded-pill border border-edge bg-card px-3.5 text-caption text-ink hover:bg-sunken">
                  {example.label}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {editing === "new" && (
        <div className="mb-4 flex flex-col gap-2">
          <RuleEditor key={preset?.name ?? "blank"} start={preset ? { ...preset, id: null } : null} choices={choices} save={actions.saveRule} onDone={() => { setEditing(null); setPreset(null); }} />
          <p className="text-sm text-muted">{w.savedOff}</p>
        </div>
      )}
      {rules.length === 0 ? (
        <p className="text-sm text-muted">{w.noRules}</p>
      ) : (
        <List>
          {rules.map((rule, i) =>
            editing === rule.id ? (
              <li key={rule.id} className="py-3">
                <RuleEditor start={rule} choices={choices} save={actions.saveRule} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <ListRow key={rule.id}>
                <RowLead
                  title={rule.name}
                  sub={[
                    w.effectKinds[rule.effect.kind],
                    rule.conditions.length === 0 ? w.always : rule.conditions.map((c) => w.conditionKinds[c.kind]).join(", "),
                    ...rule.skips.map((s) => fillWords(w.skipped, { count: String(s.count), when: s.since, reason: w.reasons[s.reason as "gone" | "unreadable"] ?? s.reason })),
                  ].join(" · ")}
                />
                <Chip signal={rule.skips.length > 0 ? "warning" : rule.enabled ? "positive" : "neutral"} dot>
                  {rule.enabled ? w.on : w.off}
                </Chip>
                {canWrite && (
                  <div className="flex flex-wrap gap-1" aria-busy={pending}>
                    <Button kind="quiet" disabled={pending} onClick={() => run(() => actions.switchRule(rule.id, !rule.enabled))}>
                      {rule.enabled ? w.switchOff : w.switchOn}
                    </Button>
                    <Button kind="quiet" onClick={() => setEditing(rule.id)}>
                      {w.edit}
                    </Button>
                    {i > 0 && (
                      <Button kind="quiet" disabled={pending} onClick={() => run(() => actions.moveRule(rule.id, -1))}>
                        {w.up}
                      </Button>
                    )}
                    {i < rules.length - 1 && (
                      <Button kind="quiet" disabled={pending} onClick={() => run(() => actions.moveRule(rule.id, 1))}>
                        {w.down}
                      </Button>
                    )}
                    <Button kind="quiet" disabled={pending || asking === rule.id} onClick={() => setAsking(rule.id)}>
                      {w.remove}
                    </Button>
                  </div>
                )}
                {asking === rule.id && (
                  <DeleteAsk
                    ask={fillWords(w.deleteRuleAsk, { name: rule.name })}
                    pending={pending}
                    onDelete={() => run(() => actions.removeRule(rule.id))}
                    onKeep={() => setAsking(null)}
                  />
                )}
              </ListRow>
            ),
          )}
        </List>
      )}
    </Card>
  );
}

function FieldEditor({
  start,
  choices,
  locales,
  mainLocale,
  save,
  onDone,
}: {
  start: FieldView | null;
  /** What a question's conditions may name (task 4): the rule editor's own choices. */
  choices: RuleChoices;
  locales: Choice[];
  mainLocale: string;
  save: CheckoutRuleActions["saveField"];
  onDone: () => void;
}) {
  const w = useAdminText("shipping").checkoutRules;
  const [pending, run] = useTransition();
  const [problems, setProblems] = useState<string[]>([]);
  const [kind, setKind] = useState<CheckoutFieldKind>(start?.kind ?? "text");
  const [required, setRequired] = useState(start?.required ?? false);
  const [label, setLabel] = useState<Words>(start?.label ?? EMPTY_WORDS);
  const [help, setHelp] = useState<Words>(start?.help ?? EMPTY_WORDS);
  // How wide the cart draws it (task 2): Lisa's step away, open from the start only when the question is already half width.
  const [width, setWidth] = useState<FieldWidth>(start?.width ?? "full");
  // When it is asked (task 4): the checkout rules' conditions, under Customise with the width; open from the start when it has some.
  const [conditions, setConditions] = useState<RuleCondition[]>(start?.conditions ?? []);
  const [customise, setCustomise] = useState(start?.width === "half" || (start?.conditions?.length ?? 0) > 0);
  // A tick list's options and whether it asks the shopper's explicit consent (task 3).
  const [options, setOptions] = useState<{ id?: string; label: Words; none?: boolean }[]>(start?.options ?? []);
  const [sensitive, setSensitive] = useState(start?.sensitive ?? false);
  // A number's lowest and highest value, or a date's earliest and latest day from today (task 4), as typed ("" is no limit).
  const [bounds, setBounds] = useState({ min: start?.bounds?.min?.toString() ?? "", max: start?.bounds?.max?.toString() ?? "" });
  const useAllergens = () => {
    const preset = allergenQuestion([mainLocale, ...locales.map((l) => l.id)]);
    setKind("checklist");
    if (!label.text.trim()) setLabel(preset.label);
    if (!help.text.trim()) setHelp(preset.help);
    setOptions(preset.options);
    setSensitive(true);
  };
  return (
    <form
      aria-busy={pending}
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          // A dropdown or a choice of one has no None of these: a tick list's turned into one loses that mark (task 4).
          const kept = options.filter((o) => o.label.text.trim()).map((o) => (kind === "checklist" ? o : { ...o, none: undefined }));
          const list = hasOptions(kind) ? { options: kept, sensitive } : { sensitive: false };
          const whole = (s: string) => (s.trim() === "" ? undefined : Number(s));
          const limits = hasBounds(kind) ? { bounds: { min: whole(bounds.min), max: whole(bounds.max) } } : {};
          const saved = await save(start?.id || null, { kind, required, label, help: help.text.trim() ? help : null, width, ...list, ...limits, conditions });
          if (saved.ok) {
            setProblems([]);
            onDone();
          } else setProblems(saved.problems);
        });
      }}
    >
      <div className="flex flex-wrap gap-3">
        <select value={kind} onChange={(e) => setKind(e.target.value as CheckoutFieldKind)} className={FIELD} aria-label={w.question}>
          {CHECKOUT_FIELD_KINDS.map((k) => (
            <option key={k} value={k}>
              {w.fieldKinds[k]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="size-4" />
          {w.required}
        </label>
      </div>
      <WordsField value={label} onChange={setLabel} label={w.question} locales={locales} max={80} />
      <WordsField value={help} onChange={setHelp} label={w.help} locales={locales} max={200} />
      {hasOptions(kind) && (
        <fieldset className="flex flex-col gap-3 rounded-panel bg-sunken p-3 text-sm">
          <legend className="sr-only">{kind === "checklist" ? w.options : w.choices}</legend>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{kind === "checklist" ? w.options : w.choices}</span>
            {kind === "checklist" && (
              <Button type="button" kind="secondary" size="dense" onClick={useAllergens}>
                {w.useAllergens}
              </Button>
            )}
          </div>
          {options.length === 0 && <p className="text-muted">{kind === "checklist" ? w.noOptions : w.noChoices}</p>}
          <ol className="flex flex-col gap-3">
            {options.map((o, i) => (
              <li key={o.id ?? `new-${i}`} className="flex flex-col gap-1">
                <WordsField
                  value={o.label}
                  onChange={(next) => setOptions(options.map((x, j) => (j === i ? { ...x, label: next } : x)))}
                  label={fillWords(w.optionN, { n: String(i + 1) })}
                  locales={locales}
                  max={80}
                />
                <div className="flex flex-wrap items-center gap-3">
                  {kind === "checklist" && (
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={o.none === true}
                        onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, none: e.target.checked } : e.target.checked ? { ...x, none: false } : x)))}
                        className="size-4"
                      />
                      {w.optionNone}
                    </label>
                  )}
                  <Button type="button" kind="quiet" size="dense" onClick={() => setOptions(options.filter((_, j) => j !== i))}>
                    {w.removeOption}
                  </Button>
                </div>
              </li>
            ))}
          </ol>
          <div>
            <Button type="button" kind="link" onClick={() => setOptions([...options, { label: { text: "", byLocale: {} } }])}>
              {w.addOption}
            </Button>
          </div>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={sensitive} onChange={(e) => setSensitive(e.target.checked)} className="mt-0.5 size-4" />
            <span>
              {w.sensitive}
              <span className="block text-muted">{w.sensitiveHint}</span>
            </span>
          </label>
        </fieldset>
      )}
      {hasBounds(kind) && (
        <fieldset className="flex flex-col gap-2 text-sm">
          <div className="flex flex-wrap gap-3">
            {(["min", "max"] as const).map((end) => (
              <label key={end} className="flex flex-col gap-1">
                {kind === "date" ? (end === "min" ? w.earliest : w.latest) : end === "min" ? w.lowest : w.highest}
                <input
                  type="number"
                  inputMode="numeric"
                  step={1}
                  min={kind === "date" ? 0 : undefined}
                  max={kind === "date" ? 730 : undefined}
                  value={bounds[end]}
                  onChange={(e) => setBounds({ ...bounds, [end]: e.target.value })}
                  className={`${FIELD} w-40`}
                />
              </label>
            ))}
          </div>
          <p className="text-muted">{kind === "date" ? w.dateHint : w.numberHint}</p>
        </fieldset>
      )}
      {customise && (
        <div className="flex flex-col gap-1">
          <ConditionsEditor conditions={conditions} onChange={setConditions} choices={choices} legend={w.askedWhen} none={w.askedAlways} />
          <p className="text-sm text-muted">{w.askedWhenHint}</p>
        </div>
      )}
      {customise ? (
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1 font-medium">{w.width}</legend>
          {(["full", "half"] as const).map((choice) => (
            <label key={choice} className="flex items-start gap-2">
              <input type="radio" name="width" value={choice} checked={width === choice} onChange={() => setWidth(choice)} className="mt-0.5 size-4" />
              <span>
                {w.widths[choice]}
                <span className="block text-muted">{w.widthHints[choice]}</span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : (
        <div>
          <Button type="button" kind="link" onClick={() => setCustomise(true)}>
            {w.customise}
          </Button>
        </div>
      )}
      {problems.length > 0 && (
        <ul className="text-sm text-danger-text" role="alert">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Button type="submit" kind="strong" disabled={pending}>
          {pending ? w.saving : w.save}
        </Button>
        <Button type="button" kind="quiet" onClick={onDone}>
          {w.cancel}
        </Button>
      </div>
    </form>
  );
}

/** Where the questions are on the page, for the checkout's preview to bring them into view. */
export const QUESTIONS_ID = "checkout-questions";
const OPEN_QUESTION = "kaizen:open-checkout-question";

/** Opens a question in the list below, or a new one (`"new"`): the preview's links ask this, so a second press works too. */
export function openCheckoutQuestion(target: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_QUESTION, { detail: target }));
}

/**
 * The questions the checkout asks, in the order the cart asks them: each dragged by its handle (or moved with the keyboard on it, or with its
 * up and down buttons), shown in its new place at once and saved as it is dropped.
 */
export function FieldList({
  fields,
  choices,
  locales,
  mainLocale,
  canWrite,
  actions,
  examples = [],
}: {
  /** Questions a shop really asks, offered while it asks none (round 7, D624): each opens the editor filled in. */
  examples?: { label: string; start: FieldInputView }[];
  fields: FieldView[];
  /** What a question's conditions may name (task 4). */
  choices: RuleChoices;
  locales: Choice[];
  /** The store's main locale, for ready-made words (the allergen list). */
  mainLocale: string;
  canWrite: boolean;
  actions: CheckoutRuleActions;
}) {
  const w = useAdminText("shipping").checkoutRules;
  const [preset, setPreset] = useState<FieldInputView | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  // The checkout's preview opens a question here (`openCheckoutQuestion()`), or a new one; so does a link to #question-{id} or #question-new.
  // The latest list, read by the listeners below, so they are added once and a refreshed list (after a save) never reopens a question.
  const known = useRef({ canWrite, ids: fields.map((f) => f.id) });
  useEffect(() => {
    known.current = { canWrite, ids: fields.map((f) => f.id) };
  }, [canWrite, fields]);
  useEffect(() => {
    const open = (target: string) => {
      const { canWrite: may, ids } = known.current;
      if (may && target === "new") {
        setPreset(null);
        setEditing("new");
      } else if (may && ids.includes(target)) setEditing(target);
      requestAnimationFrame(() => document.getElementById(QUESTIONS_ID)?.scrollIntoView({ behavior: "smooth", block: "start" }));
    };
    const fromHash = () => {
      if (window.location.hash.startsWith("#question-")) open(window.location.hash.slice("#question-".length));
    };
    const fromPreview = (e: Event) => open(String((e as CustomEvent<string>).detail));
    fromHash();
    window.addEventListener("hashchange", fromHash);
    window.addEventListener(OPEN_QUESTION, fromPreview);
    return () => {
      window.removeEventListener("hashchange", fromHash);
      window.removeEventListener(OPEN_QUESTION, fromPreview);
    };
  }, []);
  const [pending, run] = useTransition();
  const [shown, moveShown] = useOptimistic(fields, (now: FieldView[], { id, to }: { id: string; to: number }) => {
    const order = movedTo(
      now.map((f) => f.id),
      id,
      to,
    );
    return order ? order.flatMap((fid) => now.filter((f) => f.id === fid)) : now;
  });
  const dndId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const move = (id: string, to: number) =>
    run(async () => {
      moveShown({ id, to });
      await actions.moveField(id, to);
    });
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    move(String(active.id), shown.findIndex((f) => f.id === over.id));
  };
  // What a screen reader hears while a question is moved: its words and place, never its id.
  const nameOf = (id: UniqueIdentifier) => shown.find((f) => f.id === id)?.label.text ?? "";
  const placeOf = (id: UniqueIdentifier) => String(shown.findIndex((f) => f.id === id) + 1);
  const count = String(shown.length);
  const sortable = canWrite && shown.length > 1 && editing === null;
  const rows = shown.map((f, i) =>
    editing === f.id ? (
      <li key={f.id} className="py-3">
        <FieldEditor start={f} choices={choices} locales={locales} mainLocale={mainLocale} save={actions.saveField} onDone={() => setEditing(null)} />
      </li>
    ) : (
      <FieldRowView
        key={f.id}
        field={f}
        sortable={sortable}
        after={
          asking === f.id ? (
            <DeleteAsk
              ask={fillWords(w.deleteFieldAsk, { name: f.label.text })}
              pending={pending}
              onDelete={() => run(() => actions.removeField(f.id))}
              onKeep={() => setAsking(null)}
            />
          ) : null
        }
      >
        {sortable && (
          <>
            <Button kind="icon" size="dense" disabled={i === 0} onClick={() => move(f.id, i - 1)} aria-label={fillWords(w.fieldUp, { name: f.label.text })} icon={<ArrowUp aria-hidden />} />
            <Button
              kind="icon"
              size="dense"
              disabled={i === shown.length - 1}
              onClick={() => move(f.id, i + 1)}
              aria-label={fillWords(w.fieldDown, { name: f.label.text })}
              icon={<ArrowDown aria-hidden />}
            />
          </>
        )}
        {canWrite && (
          <>
            <Button kind="quiet" disabled={pending} onClick={() => run(() => actions.switchField(f.id, !f.enabled))}>
              {f.enabled ? w.switchOff : w.switchOn}
            </Button>
            <Button kind="quiet" onClick={() => setEditing(f.id)}>
              {w.edit}
            </Button>
            <Button kind="quiet" disabled={pending || asking === f.id} onClick={() => setAsking(f.id)}>
              {w.remove}
            </Button>
          </>
        )}
      </FieldRowView>
    ),
  );
  return (
    <div id={QUESTIONS_ID} className="scroll-mt-4">
    <Card
      title={w.fields}
      description={shown.length === 0 && examples.length > 0 && editing !== "new" ? undefined : w.fieldsHint}
      aside={
        canWrite && editing !== "new" ? (
          <Button kind="strong" onClick={() => { setPreset(null); setEditing("new"); }}>
            {w.newField}
          </Button>
        ) : undefined
      }
    >
      {canWrite && shown.length === 0 && editing === "new" && preset === null && examples.length > 0 && (
        <>
          <p className="mb-2 text-sm text-muted">{w.examplesStart}</p>
          <ul aria-label={w.examplesLabel} className="mb-3 flex flex-wrap gap-2">
            {examples.map((example) => (
              <li key={example.label}>
                <button type="button" onClick={() => { setPreset(example.start); setEditing("new"); }} className="inline-flex min-h-10 items-center rounded-pill border border-edge bg-card px-3.5 text-caption text-ink hover:bg-sunken">
                  {example.label}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {editing === "new" && (
        <div className="mb-4 flex flex-col gap-2">
          {/* The rule on sensitive questions (GDPR article 9) is said where a question is written (round 7). */}
          {examples.length > 0 && <p className="text-sm text-muted">{w.fieldsHint}</p>}
          <FieldEditor
            key={preset?.label.text ?? "blank"}
            start={preset ? { id: "", enabled: true, sensitive: false, ...preset, options: undefined } : null}
            choices={choices}
            locales={locales}
            mainLocale={mainLocale}
            save={actions.saveField}
            onDone={() => { setEditing(null); setPreset(null); }}
          />
        </div>
      )}
      {shown.length === 0 ? (
        <p className="text-sm text-muted">{w.noFields}</p>
      ) : (
        <DndContext
          id={dndId}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
          accessibility={{
            announcements: {
              onDragStart: ({ active }) => fillWords(w.dragPicked, { name: nameOf(active.id), place: placeOf(active.id), count }),
              onDragOver: ({ active, over }) => (over ? fillWords(w.dragOver, { name: nameOf(active.id), place: placeOf(over.id), count }) : undefined),
              onDragEnd: ({ active, over }) => fillWords(w.dragDropped, { name: nameOf(active.id), place: placeOf(over?.id ?? active.id), count }),
              onDragCancel: ({ active }) => fillWords(w.dragCancelled, { name: nameOf(active.id) }),
            },
            screenReaderInstructions: { draggable: w.dragInstructions },
          }}
        >
          <SortableContext items={shown.map((f) => f.id)} strategy={verticalListSortingStrategy} disabled={!sortable}>
            <ol aria-label={w.fields} aria-busy={pending} className="divide-y divide-line">
              {rows}
            </ol>
          </SortableContext>
        </DndContext>
      )}
    </Card>
    </div>
  );
}

const FIELD_ROW = "flex min-h-16 flex-wrap items-center gap-x-4 gap-y-1 py-3";

/** One question in the list: a handle to drag it while the list can be sorted, its words, kind and switch, the buttons given, and what goes under it. */
function FieldRowView({ field, sortable, after, children }: { field: FieldView; sortable: boolean; after: ReactNode; children: ReactNode }) {
  const w = useAdminText("shipping").checkoutRules;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform ? { ...transform, x: 0 } : null), transition }}
      className={`${FIELD_ROW} ${isDragging ? "relative z-10 rounded-panel bg-card shadow-md" : ""}`}
      data-checkout-field={field.id}
    >
      {sortable && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={fillWords(w.dragField, { name: field.label.text })}
          className="-mr-2 flex size-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-pill text-muted hover:bg-sunken active:cursor-grabbing"
        >
          <GripVertical aria-hidden className="size-4" />
        </button>
      )}
      <RowLead
        title={field.label.text}
        sub={[
          w.fieldKinds[field.kind],
          field.required ? w.required : w.optional,
          ...(field.width === "half" ? [w.widths.half] : []),
          ...((field.conditions?.length ?? 0) > 0 ? [w.someBaskets] : []),
        ].join(" · ")}
      />
      <Chip signal={field.enabled ? "positive" : "neutral"} dot>
        {field.enabled ? w.on : w.off}
      </Chip>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
      {after}
    </li>
  );
}
