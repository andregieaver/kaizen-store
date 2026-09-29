"use client";

import { useId, useState, type KeyboardEvent, type ReactNode } from "react";

import {
  FIELD_ACCESS,
  FIELD_TYPES,
  FIELD_WIDTHS,
  MAX_CHOICES,
  MAX_GALLERY,
  TEXTAREA_MAX,
  TEXT_MAX,
  hasChoices,
  nameOf,
  operatorsFor,
  uniqueName,
  CONDITION_OPERATORS,
  type Choice,
  type Condition,
  type FieldDef,
  type FieldType,
} from "@/lib/custom-fields";
import {
  choiceKey,
  moveItem,
  newCondition,
  parseUnits,
  settleCondition,
  valueKindFor,
  withLabel,
} from "@/lib/field-group-editor";

import { Modal } from "./modal";

export type FieldLanguage = { locale: string; name: string };

const input = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm font-normal";
const label = "flex flex-col gap-1 text-sm font-medium";
const hint = "text-xs font-normal text-muted";
const small = "min-h-9 rounded-md border border-border px-3 text-sm hover:bg-surface disabled:opacity-40";

const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const PLACEHOLDER_TYPES: readonly FieldType[] = ["text", "textarea", "email", "url", "phone", "number", "measurement"];

const TABS = [
  { id: "general", label: "General" },
  { id: "presentation", label: "Presentation" },
  { id: "logic", label: "Logic" },
  { id: "storefront", label: "Storefront" },
] as const;
type Tab = (typeof TABS)[number]["id"];

/** What is wrong with a field, in words, for the dialog to say before it lets the field go back into the group. */
function fieldProblems(field: FieldDef, otherNames: readonly string[], above: readonly FieldDef[]): string[] {
  const problems: string[] = [];
  if (field.label.trim() === "") problems.push("Give the field a label.");
  if (!NAME_PATTERN.test(field.name) || field.name.length > 40) {
    problems.push("The name starts with a lowercase letter and uses lowercase letters, digits and underscores.");
  } else if (otherNames.includes(field.name)) problems.push(`Another field is already named ${field.name}.`);
  if (hasChoices(field.type)) {
    const choices = field.choices ?? [];
    if (choices.length === 0) problems.push("Add at least one choice.");
    if (choices.some((c) => c.label.trim() === "")) problems.push("Give each choice a label.");
    if (choices.some((c) => !KEY_PATTERN.test(c.key) || c.key.length > 40)) {
      problems.push("A choice's key uses lowercase letters, digits, hyphens and underscores.");
    }
    if (new Set(choices.map((c) => c.key)).size !== choices.length) problems.push("Two choices have the same key.");
  }
  if (field.type === "measurement" && (field.units ?? []).length === 0) problems.push("Add at least one unit.");
  if (field.min !== undefined && field.max !== undefined && field.min > field.max)
    problems.push("The least is more than the most.");
  const known = new Set(above.map((f) => f.id));
  if ((field.when ?? []).flat().some((c) => !known.has(c.field)))
    problems.push("The logic looks at a field that is no longer above this one.");
  return problems;
}

/**
 * One field of a group, edited in a dialog with its own copy: nothing changes
 * in the group until Apply (D118). A field's type is fixed once it is made;
 * to use another, add a new field and take this one out.
 */
export function FieldEditorDialog({
  field,
  above,
  otherNames,
  fresh,
  languages,
  onApply,
  onClose,
}: {
  /** The field being edited; null while the dialog is closed. */
  field: FieldDef | null;
  /** The fields above it in the group: the only ones its logic can look at. */
  above: FieldDef[];
  /** The other fields' names, which its own may not repeat. */
  otherNames: string[];
  /** Not saved yet: its name follows its label, and its choices' keys are free to change. */
  fresh: boolean;
  /** The store's languages, the main one first. */
  languages: FieldLanguage[];
  onApply: (field: FieldDef) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<FieldDef | null>(field);
  const [tab, setTab] = useState<Tab>("general");
  const [attempted, setAttempted] = useState(false);
  // Opening the dialog on a field starts from that field (state reset while rendering, as React describes).
  const [seen, setSeen] = useState<FieldDef | null>(field);
  // The keys already saved can be told from new ones, as values are kept under them.
  const [savedKeys, setSavedKeys] = useState<string[]>(fresh ? [] : (field?.choices ?? []).map((c) => c.key));
  if (field !== seen) {
    setSeen(field);
    setDraft(field);
    setTab("general");
    setAttempted(false);
    setSavedKeys(fresh ? [] : (field?.choices ?? []).map((c) => c.key));
  }
  const tabsId = useId();

  const update = (patch: Partial<FieldDef>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const problems = draft ? fieldProblems(draft, otherNames, above) : [];
  const apply = () => {
    if (!draft) return;
    if (problems.length > 0) {
      setAttempted(true);
      return;
    }
    onApply(draft);
  };

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = TABS[(index + step + TABS.length) % TABS.length];
    setTab(next.id);
    document.getElementById(`${tabsId}-tab-${next.id}`)?.focus();
  };

  return (
    <Modal
      open={field !== null}
      onClose={onClose}
      wide
      title={draft ? `${fresh ? "New" : "Edit"} field: ${draft.label || FIELD_TYPES[draft.type].label}` : "Field"}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="min-h-10 rounded-md border border-border px-4 text-sm hover:bg-surface"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background"
          >
            Apply
          </button>
        </>
      }
    >
      {draft && (
        <div className="flex flex-col gap-4">
          {attempted && problems.length > 0 && (
            <div role="alert" className="rounded-md border border-red-700 p-3 text-sm">
              <p className="font-medium">The field cannot be used yet. Please fix:</p>
              <ul className="mt-1 list-disc pl-5">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </div>
          )}
          <div role="tablist" aria-label="Field settings" className="flex flex-wrap gap-1 border-b border-border">
            {TABS.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`${tabsId}-tab-${item.id}`}
                aria-selected={tab === item.id}
                aria-controls={`${tabsId}-panel-${item.id}`}
                tabIndex={tab === item.id ? 0 : -1}
                onClick={() => setTab(item.id)}
                onKeyDown={(event) => onTabKey(event, index)}
                className="-mb-px min-h-10 border-b-2 border-transparent px-3 text-sm aria-selected:border-foreground aria-selected:font-medium"
              >
                {item.label}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id={`${tabsId}-panel-${tab}`}
            aria-labelledby={`${tabsId}-tab-${tab}`}
            className="flex flex-col gap-4"
          >
            {tab === "general" && (
              <General
                draft={draft}
                update={update}
                fresh={fresh}
                otherNames={otherNames}
                languages={languages}
                attempted={attempted}
              />
            )}
            {tab === "presentation" && (
              <Presentation draft={draft} update={update} languages={languages} savedKeys={savedKeys} fresh={fresh} />
            )}
            {tab === "logic" && <Logic draft={draft} update={update} above={above} />}
            {tab === "storefront" && <Storefront draft={draft} update={update} />}
          </div>
        </div>
      )}
    </Modal>
  );
}

type PanelProps = { draft: FieldDef; update: (patch: Partial<FieldDef>) => void };

function General({
  draft,
  update,
  fresh,
  otherNames,
  languages,
  attempted,
}: PanelProps & { fresh: boolean; otherNames: string[]; languages: FieldLanguage[]; attempted: boolean }) {
  const nameProblem =
    !NAME_PATTERN.test(draft.name) || draft.name.length > 40
      ? "invalid"
      : otherNames.includes(draft.name)
        ? "taken"
        : null;
  const others = languages.slice(1);
  return (
    <>
      <p className="text-sm">
        <span className="font-medium">Type:</span> {FIELD_TYPES[draft.type].label}
        <span className={`block ${hint}`}>
          The type cannot be changed once the field is made. To use another type, add a new field and delete this one.
        </span>
      </p>
      <label className={label}>
        Label
        <input
          value={draft.label}
          maxLength={80}
          required
          aria-invalid={attempted && draft.label.trim() === ""}
          onChange={(event) => {
            const next = event.target.value;
            // A new field's name follows its label until the name is changed by hand.
            const follows = fresh && draft.name === uniqueName(nameOf(draft.label), otherNames);
            update({ label: next, ...(follows && { name: uniqueName(nameOf(next), otherNames) }) });
          }}
          className={input}
          aria-describedby="field-label-hint"
        />
        <span id="field-label-hint" className={hint}>
          What staff see above the input{languages.length > 1 ? ` in ${languages[0].name}, the main language` : ""}.
        </span>
      </label>
      {others.length > 0 && (
        <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-medium">Label in other languages</legend>
          {others.map((language) => (
            <label key={language.locale} className={label}>
              {language.name}
              <input
                value={draft.labels?.[language.locale] ?? ""}
                maxLength={80}
                lang={language.locale}
                placeholder={draft.label}
                onChange={(event) => update(withLabel(draft, language.locale, event.target.value))}
                className={input}
              />
            </label>
          ))}
          <p className={hint}>Left empty, the label above is used.</p>
        </fieldset>
      )}
      <label className={label}>
        Name
        <input
          value={draft.name}
          maxLength={40}
          required
          aria-invalid={nameProblem !== null}
          aria-describedby="field-name-hint"
          onChange={(event) => update({ name: event.target.value })}
          className={`${input} font-mono`}
        />
        <span id="field-name-hint" className={hint}>
          What templates and files call the field. Renaming it is safe: what has been entered is kept under the
          field&apos;s own id, not its name.
        </span>
        {nameProblem === "invalid" && (
          <span className="text-xs font-normal text-red-700">
            Use lowercase letters, digits and underscores, starting with a letter.
          </span>
        )}
        {nameProblem === "taken" && (
          <span className="text-xs font-normal text-red-700">Another field in this group has that name.</span>
        )}
      </label>
      <label className={label}>
        Instructions for staff (optional)
        <textarea
          value={draft.instructions ?? ""}
          maxLength={300}
          rows={2}
          onChange={(event) => update({ instructions: event.target.value || undefined })}
          className={`${input} py-2`}
        />
        <span className={hint}>Shown under the label when filling in the field. Shoppers never see it.</span>
      </label>
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={draft.required === true}
          onChange={(event) => update({ required: event.target.checked || undefined })}
          className="mt-0.5 size-4"
        />
        <span>
          <span className="font-medium">Required</span>
          <span className={`block ${hint}`}>
            Staff must fill it in before saving. A field hidden by its logic is never required.
          </span>
        </span>
      </label>
    </>
  );
}

function Presentation({
  draft,
  update,
  languages,
  savedKeys,
  fresh,
}: PanelProps & { languages: FieldLanguage[]; savedKeys: string[]; fresh: boolean }) {
  const type = draft.type;
  return (
    <>
      <label className={`${label} max-w-56`}>
        Width in the form
        <select
          value={draft.width ?? 100}
          onChange={(event) => update({ width: Number(event.target.value) as (typeof FIELD_WIDTHS)[number] })}
          className={input}
        >
          {FIELD_WIDTHS.map((width) => (
            <option key={width} value={width}>
              {width} %
            </option>
          ))}
        </select>
        <span className={hint}>On wide screens; fields always fill the line on phones.</span>
      </label>
      {PLACEHOLDER_TYPES.includes(type) && (
        <label className={label}>
          Placeholder (optional)
          <input
            value={draft.placeholder ?? ""}
            maxLength={100}
            onChange={(event) => update({ placeholder: event.target.value || undefined })}
            className={input}
          />
          <span className={hint}>Grey example text shown in the empty input.</span>
        </label>
      )}
      {(type === "text" || type === "textarea") && (
        <OptionalNumber
          label="Most characters (optional)"
          value={draft.maxLength}
          min={1}
          max={type === "text" ? TEXT_MAX : TEXTAREA_MAX}
          integer
          onChange={(maxLength) => update({ maxLength })}
          hintText={`At most ${type === "text" ? TEXT_MAX : TEXTAREA_MAX}.`}
        />
      )}
      {type === "number" && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <OptionalNumber label="Least (optional)" value={draft.min} onChange={(min) => update({ min })} />
            <OptionalNumber label="Most (optional)" value={draft.max} onChange={(max) => update({ max })} />
            <OptionalNumber
              label="Step (optional)"
              value={draft.step}
              min={0}
              onChange={(step) => update({ step: step && step > 0 ? step : undefined })}
            />
          </div>
          <label className={`${label} max-w-56`}>
            Unit (optional)
            <input
              value={draft.unit ?? ""}
              maxLength={12}
              placeholder="e.g. months"
              onChange={(event) => update({ unit: event.target.value || undefined })}
              className={input}
            />
            <span className={hint}>Shown after the number.</span>
          </label>
        </>
      )}
      {type === "measurement" && (
        <>
          <UnitsInput units={draft.units ?? []} onChange={(units) => update({ units })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <OptionalNumber label="Least (optional)" value={draft.min} onChange={(min) => update({ min })} />
            <OptionalNumber label="Most (optional)" value={draft.max} onChange={(max) => update({ max })} />
          </div>
        </>
      )}
      {hasChoices(type) && (
        <ChoicesEditor
          choices={draft.choices ?? []}
          onChange={(choices) => update({ choices })}
          languages={languages}
          savedKeys={savedKeys}
          fresh={fresh}
        />
      )}
      {type === "gallery" && (
        <OptionalNumber
          label="Most pictures (optional)"
          value={draft.maxItems}
          min={1}
          max={MAX_GALLERY}
          integer
          onChange={(maxItems) => update({ maxItems })}
          hintText={`At most ${MAX_GALLERY}.`}
        />
      )}
      {!PLACEHOLDER_TYPES.includes(type) && !hasChoices(type) && type !== "gallery" && (
        <p className={hint}>This type has no other settings.</p>
      )}
    </>
  );
}

/** A number typed as the person likes; it is passed on once it is a number, and kept as typed until then. */
function OptionalNumber({
  label: text,
  value,
  onChange,
  min,
  max,
  integer,
  hintText,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  integer?: boolean;
  hintText?: string;
}) {
  const [typed, setTyped] = useState(value === undefined ? "" : String(value));
  return (
    <label className={`${label} max-w-56`}>
      {text}
      <input
        type="text"
        inputMode="decimal"
        value={typed}
        onChange={(event) => {
          const next = event.target.value;
          setTyped(next);
          const number = Number(next.trim().replace(",", "."));
          if (next.trim() === "") onChange(undefined);
          else if (
            Number.isFinite(number) &&
            (!integer || Number.isInteger(number)) &&
            (min === undefined || number >= min) &&
            (max === undefined || number <= max)
          ) {
            onChange(number);
          }
        }}
        className={input}
      />
      {hintText && <span className={hint}>{hintText}</span>}
    </label>
  );
}

/** Units as a comma list, kept as typed (a trailing comma is allowed while typing). */
function UnitsInput({ units, onChange }: { units: string[]; onChange: (units: string[]) => void }) {
  const [typed, setTyped] = useState(units.join(", "));
  return (
    <label className={label}>
      Units to choose from
      <input
        value={typed}
        onChange={(event) => {
          setTyped(event.target.value);
          onChange(parseUnits(event.target.value).map((unit) => unit.slice(0, 12)));
        }}
        placeholder="g, kg"
        className={input}
        aria-describedby="units-hint"
      />
      <span id="units-hint" className={hint}>
        Separate with commas. The first is the one staff start with.
      </span>
    </label>
  );
}

function ChoicesEditor({
  choices,
  onChange,
  languages,
  savedKeys,
  fresh,
}: {
  choices: Choice[];
  onChange: (choices: Choice[]) => void;
  languages: FieldLanguage[];
  savedKeys: string[];
  fresh: boolean;
}) {
  const others = languages.slice(1);
  const change = (index: number, next: Choice) => onChange(choices.map((c, i) => (i === index ? next : c)));
  const add = () => {
    const text = `Option ${choices.length + 1}`;
    onChange([
      ...choices,
      {
        key: choiceKey(
          text,
          choices.map((c) => c.key),
        ),
        label: text,
      },
    ]);
  };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">Choices</legend>
      <ol className="flex flex-col gap-2">
        {choices.map((choice, index) => {
          const locked = savedKeys.includes(choice.key);
          const taken = choices.filter((_, i) => i !== index).map((c) => c.key);
          return (
            <li key={index} className="flex flex-col gap-2 rounded-md border border-border p-3">
              <div className="flex flex-wrap items-end gap-2">
                <label className={`${label} min-w-40 flex-1`}>
                  Label
                  <input
                    value={choice.label}
                    maxLength={80}
                    onChange={(event) => {
                      const next = event.target.value;
                      // A new choice's key follows its label until the key is changed by hand.
                      const follows = !locked && choice.key === choiceKey(choice.label, taken);
                      change(index, { ...choice, label: next, ...(follows && { key: choiceKey(next, taken) }) });
                    }}
                    className={input}
                  />
                </label>
                <label className={`${label} w-40`}>
                  Key
                  <input
                    value={choice.key}
                    maxLength={40}
                    readOnly={locked}
                    aria-describedby={locked ? "key-locked-hint" : undefined}
                    onChange={(event) => change(index, { ...choice, key: event.target.value })}
                    className={`${input} font-mono ${locked ? "bg-surface" : ""}`}
                  />
                </label>
                <div className="flex gap-1">
                  <button
                    type="button"
                    className={small}
                    disabled={index === 0}
                    aria-label={`Move choice ${choice.label || index + 1} up`}
                    onClick={() => onChange(moveItem(choices, index, index - 1))}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={small}
                    disabled={index === choices.length - 1}
                    aria-label={`Move choice ${choice.label || index + 1} down`}
                    onClick={() => onChange(moveItem(choices, index, index + 1))}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className={`${small} text-red-700`}
                    aria-label={`Remove choice ${choice.label || index + 1}`}
                    onClick={() => onChange(choices.filter((_, i) => i !== index))}
                  >
                    Remove
                  </button>
                </div>
              </div>
              {others.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-sm">Label in other languages</summary>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {others.map((language) => (
                      <label key={language.locale} className={label}>
                        {language.name}
                        <input
                          value={choice.labels?.[language.locale] ?? ""}
                          maxLength={80}
                          lang={language.locale}
                          placeholder={choice.label}
                          onChange={(event) => change(index, withLabel(choice, language.locale, event.target.value))}
                          className={input}
                        />
                      </label>
                    ))}
                  </div>
                </details>
              )}
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={small} onClick={add} disabled={choices.length >= MAX_CHOICES}>
          Add a choice
        </button>
        {!fresh && savedKeys.length > 0 && (
          <span id="key-locked-hint" className={hint}>
            Keys already saved cannot change: what has been entered is kept under them. Remove the choice and add a new
            one instead.
          </span>
        )}
      </div>
    </fieldset>
  );
}

function Logic({ draft, update, above }: PanelProps & { above: FieldDef[] }) {
  const groups: Condition[][] = draft.when ?? [];
  const set = (next: Condition[][]) => update({ when: next.length > 0 ? next : undefined });
  const start = () => {
    const first = newCondition(above);
    if (first) set([[first]]);
  };
  const editRule = (g: number, r: number, next: Condition) =>
    set(groups.map((all, i) => (i === g ? all.map((c, j) => (j === r ? next : c)) : all)));
  const removeRule = (g: number, r: number) =>
    set(groups.map((all, i) => (i === g ? all.filter((_, j) => j !== r) : all)).filter((all) => all.length > 0));

  if (above.length === 0) {
    return (
      <p className="text-sm text-muted">
        A field can be shown by the value of a field above it in the group. There are none above this one yet: move it
        down, or add a field above it first.
      </p>
    );
  }
  return (
    <>
      <p className={hint}>
        Show this field only when other fields above it have certain values. A field that is hidden is left out of the
        form and never required; what was entered in it is kept.
      </p>
      {groups.length === 0 ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm">Always shown.</p>
          <button type="button" className={small} onClick={start}>
            Show this field only if …
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium">Show this field if</p>
          {groups.map((all, g) => (
            <div key={g} className="flex flex-col gap-2">
              {g > 0 && <p className="text-sm font-medium text-muted">or</p>}
              <ul className="flex flex-col gap-2 rounded-md border border-border p-3">
                {all.map((condition, r) => (
                  <li key={r} className="flex flex-col gap-1">
                    {r > 0 && <span className="text-xs font-medium text-muted">and</span>}
                    <ConditionRow
                      condition={condition}
                      above={above}
                      name={`Rule ${g + 1}.${r + 1}`}
                      onChange={(next) => editRule(g, r, next)}
                      onRemove={() => removeRule(g, r)}
                    />
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    className={small}
                    onClick={() => {
                      const next = newCondition(above);
                      if (next) set(groups.map((c, i) => (i === g ? [...c, next] : c)));
                    }}
                  >
                    Add an “and” rule
                  </button>
                </li>
              </ul>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={small}
              onClick={() => {
                const next = newCondition(above);
                if (next) set([...groups, [next]]);
              }}
            >
              Add an “or” group
            </button>
            <button type="button" className={small} onClick={() => update({ when: undefined })}>
              Always show this field
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function ConditionRow({
  condition,
  above,
  name,
  onChange,
  onRemove,
}: {
  condition: Condition;
  above: FieldDef[];
  name: string;
  onChange: (condition: Condition) => void;
  onRemove: () => void;
}) {
  const trigger = above.find((f) => f.id === condition.field);
  const operators = trigger ? operatorsFor(trigger.type) : [];
  const kind = valueKindFor(trigger?.type, condition.operator);
  const value = condition.value ?? "";
  const valueLabel = `${name} value`;
  let control: ReactNode = null;
  if (kind === "choice") {
    control = (
      <select
        aria-label={valueLabel}
        value={value}
        onChange={(event) => onChange({ ...condition, value: event.target.value })}
        className={`${input} min-w-32 flex-1`}
      >
        {(trigger?.choices ?? []).map((choice) => (
          <option key={choice.key} value={choice.key}>
            {choice.label}
          </option>
        ))}
      </select>
    );
  } else if (kind === "boolean") {
    control = (
      <select
        aria-label={valueLabel}
        value={value}
        onChange={(event) => onChange({ ...condition, value: event.target.value })}
        className={`${input} min-w-32 flex-1`}
      >
        <option value="1">Yes</option>
        <option value="0">No</option>
      </select>
    );
  } else if (kind !== "none") {
    const type =
      kind === "number"
        ? "number"
        : kind === "date"
          ? "date"
          : kind === "time"
            ? "time"
            : kind === "datetime"
              ? "datetime-local"
              : "text";
    control = (
      <input
        aria-label={valueLabel}
        type={type}
        step={kind === "number" ? "any" : undefined}
        value={value}
        maxLength={200}
        placeholder={condition.operator === "matches" ? "A pattern, e.g. ^EU" : undefined}
        onChange={(event) => onChange({ ...condition, value: event.target.value })}
        className={`${input} min-w-32 flex-1`}
      />
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label={`${name} field`}
        value={condition.field}
        onChange={(event) => {
          const next = above.find((f) => f.id === event.target.value);
          onChange(settleCondition({ ...condition, field: event.target.value }, next));
        }}
        className={`${input} min-w-32 flex-1`}
      >
        {!trigger && <option value={condition.field}>A field that is gone</option>}
        {above.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label || f.name}
          </option>
        ))}
      </select>
      <select
        aria-label={`${name} operator`}
        value={condition.operator}
        onChange={(event) =>
          onChange(settleCondition({ ...condition, operator: event.target.value as Condition["operator"] }, trigger))
        }
        className={`${input} min-w-32 flex-1`}
      >
        {operators.map((operator) => (
          <option key={operator} value={operator}>
            {CONDITION_OPERATORS[operator]}
          </option>
        ))}
      </select>
      {control}
      <button type="button" className={`${small} text-red-700`} onClick={onRemove} aria-label={`Remove ${name}`}>
        Remove
      </button>
    </div>
  );
}

function Storefront({ draft, update }: PanelProps) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">Who can see what is entered</legend>
      {(Object.keys(FIELD_ACCESS) as (keyof typeof FIELD_ACCESS)[]).map((access) => (
        <label
          key={access}
          className="flex items-start gap-3 rounded-md border border-border p-3 text-sm has-[:checked]:border-foreground"
        >
          <input
            type="radio"
            name="access"
            checked={draft.access === access}
            onChange={() => update({ access })}
            className="mt-0.5 size-4"
          />
          <span>
            <span className="font-medium">
              {access === "private" ? "Private: only staff" : "Public: may be shown on the site"}
            </span>
            <span className={`block ${hint}`}>
              {access === "private"
                ? "Only staff see it, in the editor. It is never drawn on the site. New fields start here."
                : "Templates and product pages may show it to shoppers. Only make a field public when what is written in it is meant for them."}
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
