"use client";

import { useState, useTransition } from "react";

import { fillWords } from "@/lib/admin-fill";
import { CONDITION_KINDS, EFFECT_KINDS, type CheckoutFieldKind, type RuleCondition, type RuleEffect, type Words } from "@/lib/checkout-rules";

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

export type FieldView = { id: string; kind: CheckoutFieldKind; required: boolean; label: Words; help: Words | null; enabled: boolean };

export type RuleInputView = { name: string; conditions: RuleCondition[]; effect: RuleEffect };
export type FieldInputView = { kind: CheckoutFieldKind; required: boolean; label: Words; help: Words | null };

export type CheckoutRuleActions = {
  saveRule: (id: string | null, input: RuleInputView) => AsyncSaved;
  switchRule: (id: string, on: boolean) => AsyncDone;
  moveRule: (id: string, by: -1 | 1) => AsyncDone;
  removeRule: (id: string) => AsyncDone;
  saveField: (id: string | null, input: FieldInputView) => AsyncSaved;
  switchField: (id: string, on: boolean) => AsyncDone;
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
  const setCondition = (i: number, next: RuleCondition) => setConditions(conditions.map((c, j) => (j === i ? next : c)));
  const pools: Record<"product" | "category" | "tag" | "group", Choice[]> = {
    product: choices.products,
    category: choices.categories,
    tag: choices.tags,
    group: choices.groups,
  };

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
      <fieldset className="flex flex-col gap-2">
        <legend className="text-body-strong text-ink">{w.when}</legend>
        {conditions.length === 0 && <p className="text-sm text-muted">{w.always}</p>}
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

/** The rules in the order they are read, each with its switch, place and what kept it out lately. */
export function RuleList({ rules, choices, canWrite, actions }: { rules: RuleView[]; choices: RuleChoices; canWrite: boolean; actions: CheckoutRuleActions }) {
  const w = useAdminText("shipping").checkoutRules;
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, run] = useTransition();
  return (
    <Card title={w.rules} aside={canWrite && editing !== "new" ? <Button kind="strong" onClick={() => setEditing("new")}>{w.newRule}</Button> : undefined}>
      {editing === "new" && (
        <div className="mb-4 flex flex-col gap-2">
          <RuleEditor start={null} choices={choices} save={actions.saveRule} onDone={() => setEditing(null)} />
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
                    <Button kind="quiet" disabled={pending} onClick={() => run(() => actions.removeRule(rule.id))}>
                      {w.remove}
                    </Button>
                  </div>
                )}
              </ListRow>
            ),
          )}
        </List>
      )}
    </Card>
  );
}

function FieldEditor({ start, locales, save, onDone }: { start: FieldView | null; locales: Choice[]; save: CheckoutRuleActions["saveField"]; onDone: () => void }) {
  const w = useAdminText("shipping").checkoutRules;
  const [pending, run] = useTransition();
  const [problems, setProblems] = useState<string[]>([]);
  const [kind, setKind] = useState<CheckoutFieldKind>(start?.kind ?? "text");
  const [required, setRequired] = useState(start?.required ?? false);
  const [label, setLabel] = useState<Words>(start?.label ?? EMPTY_WORDS);
  const [help, setHelp] = useState<Words>(start?.help ?? EMPTY_WORDS);
  return (
    <form
      aria-busy={pending}
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const saved = await save(start?.id ?? null, { kind, required, label, help: help.text.trim() ? help : null });
          if (saved.ok) {
            setProblems([]);
            onDone();
          } else setProblems(saved.problems);
        });
      }}
    >
      <div className="flex flex-wrap gap-3">
        <select value={kind} onChange={(e) => setKind(e.target.value as CheckoutFieldKind)} className={FIELD} aria-label={w.question}>
          <option value="text">{w.fieldKinds.text}</option>
          <option value="checkbox">{w.fieldKinds.checkbox}</option>
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="size-4" />
          {w.required}
        </label>
      </div>
      <WordsField value={label} onChange={setLabel} label={w.question} locales={locales} max={80} />
      <WordsField value={help} onChange={setHelp} label={w.help} locales={locales} max={200} />
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

/** The questions the checkout asks, in order. */
export function FieldList({ fields, locales, canWrite, actions }: { fields: FieldView[]; locales: Choice[]; canWrite: boolean; actions: CheckoutRuleActions }) {
  const w = useAdminText("shipping").checkoutRules;
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, run] = useTransition();
  return (
    <Card title={w.fields} description={w.fieldsHint} aside={canWrite && editing !== "new" ? <Button kind="strong" onClick={() => setEditing("new")}>{w.newField}</Button> : undefined}>
      {editing === "new" && (
        <div className="mb-4">
          <FieldEditor start={null} locales={locales} save={actions.saveField} onDone={() => setEditing(null)} />
        </div>
      )}
      {fields.length === 0 ? (
        <p className="text-sm text-muted">{w.noFields}</p>
      ) : (
        <List>
          {fields.map((f) =>
            editing === f.id ? (
              <li key={f.id} className="py-3">
                <FieldEditor start={f} locales={locales} save={actions.saveField} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <ListRow key={f.id}>
                <RowLead title={f.label.text} sub={`${w.fieldKinds[f.kind]} · ${f.required ? w.required : w.optional}`} />
                <Chip signal={f.enabled ? "positive" : "neutral"} dot>
                  {f.enabled ? w.on : w.off}
                </Chip>
                {canWrite && (
                  <div className="flex flex-wrap gap-1" aria-busy={pending}>
                    <Button kind="quiet" disabled={pending} onClick={() => run(() => actions.switchField(f.id, !f.enabled))}>
                      {f.enabled ? w.switchOff : w.switchOn}
                    </Button>
                    <Button kind="quiet" onClick={() => setEditing(f.id)}>
                      {w.edit}
                    </Button>
                    <Button kind="quiet" disabled={pending} onClick={() => run(() => actions.removeField(f.id))}>
                      {w.remove}
                    </Button>
                  </div>
                )}
              </ListRow>
            ),
          )}
        </List>
      )}
    </Card>
  );
}
