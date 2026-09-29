"use client";

import { useId, useState, type KeyboardEvent, type ReactNode } from "react";

import {
  FIELD_ACCESS,
  FILTER_TYPES,
  SEARCH_TYPES,
  FIELD_TYPES,
  FIELD_WIDTHS,
  MAX_CHOICES,
  MAX_GALLERY,
  MAX_REPEATER_ROWS,
  MAX_SUB_FIELDS,
  TEXTAREA_MAX,
  TEXT_MAX,
  hasChoices,
  isStructural,
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
  NAME_PATTERN,
  SUB_FIELD_TYPES,
  addSubField,
  choiceKey,
  duplicateSubField,
  fieldProblems,
  hasTypeSettings,
  moveItem,
  moveSubField,
  newCondition,
  parseUnits,
  removeSubField,
  replaceSubField,
  settleCondition,
  subFieldsSummary,
  valueKindFor,
  withLabel,
} from "@/lib/field-group-editor";

import { FieldTypePicker } from "./field-type-picker";
import { Modal } from "./modal";

export type FieldLanguage = { locale: string; name: string };

const input = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm font-normal";
const label = "flex flex-col gap-1 text-sm font-medium";
const hint = "text-xs font-normal text-muted";
const small = "min-h-9 rounded-md border border-border px-3 text-sm hover:bg-surface disabled:opacity-40";

const PLACEHOLDER_TYPES: readonly FieldType[] = ["text", "textarea", "email", "url", "phone", "number", "measurement"];

const TABS = [
  { id: "general", label: "General" },
  { id: "fields", label: "Fields" },
  { id: "presentation", label: "Presentation" },
  { id: "logic", label: "Logic" },
  { id: "storefront", label: "Storefront" },
] as const;
type Tab = (typeof TABS)[number]["id"];

/** The tabs a field has: "Fields" only for a group or repeater, "Storefront" not for a field inside one (it follows its parent). */
const tabsFor = (type: FieldType, sub: boolean) =>
  TABS.filter((tab) => (tab.id !== "fields" || isStructural(type)) && (tab.id !== "storefront" || !sub));

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
  freshIds,
  onFresh,
  sub = false,
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
  /** The fields made since the group was last saved (a group's or repeater's own too), and a way to add to them. */
  freshIds?: ReadonlySet<string>;
  onFresh?: (ids: string[]) => void;
  /** A field inside a group or repeater: no access of its own (it follows its parent's). */
  sub?: boolean;
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
  const tabs = tabsFor(draft?.type ?? "text", sub);
  const shownTab = tabs.some((item) => item.id === tab) ? tab : "general";

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
    const next = tabs[(index + step + tabs.length) % tabs.length];
    setTab(next.id);
    document.getElementById(`${tabsId}-tab-${next.id}`)?.focus();
  };

  return (
    <Modal
      open={field !== null}
      onClose={onClose}
      wide
      title={
        draft
          ? `${fresh ? "New" : "Edit"} ${sub ? "field inside" : "field"}: ${draft.label || FIELD_TYPES[draft.type].label}`
          : "Field"
      }
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
                {problems.map((problem, index) => (
                  <li key={`${index}:${problem}`}>{problem}</li>
                ))}
              </ul>
            </div>
          )}
          <div role="tablist" aria-label="Field settings" className="flex flex-wrap gap-1 border-b border-border">
            {tabs.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`${tabsId}-tab-${item.id}`}
                aria-selected={shownTab === item.id}
                aria-controls={`${tabsId}-panel-${item.id}`}
                tabIndex={shownTab === item.id ? 0 : -1}
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
            id={`${tabsId}-panel-${shownTab}`}
            aria-labelledby={`${tabsId}-tab-${shownTab}`}
            className="flex flex-col gap-4"
          >
            {shownTab === "general" && (
              <General
                draft={draft}
                update={update}
                fresh={fresh}
                otherNames={otherNames}
                languages={languages}
                attempted={attempted}
              />
            )}
            {shownTab === "fields" && (
              <SubFieldsEditor
                draft={draft}
                update={update}
                languages={languages}
                freshIds={freshIds ?? new Set()}
                onFresh={onFresh ?? (() => {})}
              />
            )}
            {shownTab === "presentation" && (
              <Presentation draft={draft} update={update} languages={languages} savedKeys={savedKeys} fresh={fresh} />
            )}
            {shownTab === "logic" && <Logic draft={draft} update={update} above={above} sub={sub} />}
            {shownTab === "storefront" && <Storefront draft={draft} update={update} />}
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
          <span className="text-xs font-normal text-red-700">Another field next to this one has that name.</span>
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
      {(type === "product" || type === "page" || type === "term") && (
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={draft.multiple === true}
            onChange={(event) => update({ multiple: event.target.checked || undefined })}
            className="mt-0.5 size-4"
          />
          <span>
            <span className="font-medium">Allow several</span>
            <span className={`block ${hint}`}>
              {draft.multiple
                ? "Staff choose any number, in the order they like, up to 50."
                : "Staff choose one. Turn this on to choose several."}
            </span>
          </span>
        </label>
      )}
      {type === "term" && <TermKinds draft={draft} update={update} />}
      {type === "repeater" && <RepeaterSettings draft={draft} update={update} />}
      {!hasTypeSettings(type) && (
        <p className={hint}>
          {type === "group"
            ? "A group has no settings of its own besides its fields, which are on the Fields tab."
            : "This type has no other settings."}
        </p>
      )}
    </>
  );
}

/** Which of the categories and tags a category-or-tag field offers: at least one of the two. */
function TermKinds({ draft, update }: PanelProps) {
  const kinds = draft.termKinds && draft.termKinds.length > 0 ? draft.termKinds : (["category", "tag"] as const);
  const set = (kind: "category" | "tag", on: boolean) => {
    const next = (["category", "tag"] as const).filter((k) => (k === kind ? on : kinds.includes(k)));
    if (next.length > 0) update({ termKinds: [...next] });
  };
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-sm font-medium">Which to choose from</legend>
      {(["category", "tag"] as const).map((kind) => (
        <label key={kind} className="flex min-h-10 items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={kinds.includes(kind)}
            disabled={kinds.length === 1 && kinds.includes(kind)}
            onChange={(event) => set(kind, event.target.checked)}
            className="size-4"
          />
          {kind === "category" ? "Categories" : "Tags"}
        </label>
      ))}
      <p className={hint}>At least one. Staff choose among the ones the store has made, of any kind of content.</p>
    </fieldset>
  );
}

/** A repeater's fewest and most rows, the words on its add button, and how its rows are laid out in the form. */
function RepeaterSettings({ draft, update }: PanelProps) {
  const layout = draft.rowLayout ?? "block";
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <OptionalNumber
          label="Fewest rows (optional)"
          value={draft.minRows}
          min={0}
          max={MAX_REPEATER_ROWS}
          integer
          onChange={(minRows) => update({ minRows })}
          hintText="Staff must add at least this many before saving."
        />
        <OptionalNumber
          label="Most rows (optional)"
          value={draft.maxRows}
          min={1}
          max={MAX_REPEATER_ROWS}
          integer
          onChange={(maxRows) => update({ maxRows })}
          hintText={`At most ${MAX_REPEATER_ROWS}.`}
        />
      </div>
      <label className={`${label} max-w-72`}>
        Words on the add button
        <input
          value={draft.buttonLabel ?? ""}
          maxLength={40}
          placeholder="Add row"
          onChange={(event) => update({ buttonLabel: event.target.value || undefined })}
          className={input}
        />
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">How rows are laid out in the form</legend>
        {(
          [
            ["block", "Blocks", "Each row is a box with its fields, laid out by their widths."],
            ["table", "Table", "Each row is a line with a column for each field. Best for short fields."],
          ] as const
        ).map(([value, name, text]) => (
          <label
            key={value}
            className="flex items-start gap-3 rounded-md border border-border p-3 text-sm has-[:checked]:border-foreground"
          >
            <input
              type="radio"
              name="row-layout"
              checked={layout === value}
              onChange={() => update({ rowLayout: value })}
              className="mt-0.5 size-4"
            />
            <span>
              <span className="font-medium">{name}</span>
              <span className={`block ${hint}`}>{text}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </>
  );
}

/**
 * The fields inside a group or repeater: added, edited (in a dialog of their
 * own, with the same settings as any field but access, which follows the
 * group's), duplicated, reordered with buttons and deleted. A field can only be
 * shown by the ones above it here.
 */
function SubFieldsEditor({
  draft,
  update,
  languages,
  freshIds,
  onFresh,
}: PanelProps & { languages: FieldLanguage[]; freshIds: ReadonlySet<string>; onFresh: (ids: string[]) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const subs = draft.subFields ?? [];
  const set = (fields: FieldDef[], message?: string) => {
    update({ subFields: fields[0]?.subFields ?? [] });
    if (message) setAnnouncement(message);
  };
  const wrapped = [draft];
  const editingIndex = editing ? subs.findIndex((f) => f.id === editing) : -1;
  const editingField = editingIndex >= 0 ? subs[editingIndex] : null;

  const add = (type: FieldType) => {
    const result = addSubField(wrapped, draft.id, type);
    setPicking(false);
    if (!result.added) return;
    onFresh([result.added.id]);
    set(result.fields, `${FIELD_TYPES[type].label} field added.`);
    setEditing(result.added.id);
  };
  const copy = (id: string) => {
    const result = duplicateSubField(wrapped, draft.id, id);
    if (!result) return;
    onFresh([result.copy.id]);
    set(result.fields, `${result.copy.label} added below.`);
    setEditing(result.copy.id);
  };
  const remove = (sub: FieldDef) => {
    if (
      !freshIds.has(sub.id) &&
      !window.confirm(`Delete the field ${sub.label}? What was entered in it is deleted when you save the group.`)
    )
      return;
    const result = removeSubField(wrapped, draft.id, sub.id);
    set(
      result.fields,
      `${sub.label} deleted.${result.changed.length > 0 ? ` The logic of ${result.changed.join(", ")} that looked at it was taken away.` : ""}`,
    );
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= subs.length) return;
    set(moveSubField(wrapped, draft.id, from, to), `${subs[from].label} moved to place ${to + 1} of ${subs.length}.`);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          Fields inside <span className="font-normal text-muted">({subs.length})</span>
        </p>
        <button
          type="button"
          className={small}
          onClick={() => setPicking(true)}
          disabled={subs.length >= MAX_SUB_FIELDS}
        >
          Add a field inside
        </button>
      </div>
      {subs.length === 0 ? (
        <p role="alert" className="rounded-md border border-dashed border-red-700 p-4 text-center text-sm">
          A {draft.type === "group" ? "group" : "repeater"} needs at least one field. Add one to start.
        </p>
      ) : (
        <ol aria-label={`Fields inside ${draft.label || "the field"}`} className="flex flex-col gap-2">
          {subs.map((sub, index) => {
            const name = sub.label || sub.name;
            return (
              <li
                key={sub.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface p-2"
              >
                <div className="min-w-0 flex-1 basis-40">
                  <p className="truncate text-sm font-medium">{sub.label || "Untitled field"}</p>
                  <p className="truncate font-mono text-xs text-muted">{sub.name}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1 text-xs">
                  <span className="rounded-full border border-border px-2 py-0.5">{FIELD_TYPES[sub.type].label}</span>
                  {sub.required && (
                    <span className="rounded-full bg-foreground px-2 py-0.5 text-background">Required</span>
                  )}
                  {sub.when && sub.when.length > 0 && (
                    <span className="rounded-full border border-border px-2 py-0.5">Has logic</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    className={small}
                    disabled={index === 0}
                    aria-label={`Move ${name} up`}
                    onClick={() => move(index, index - 1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={small}
                    disabled={index === subs.length - 1}
                    aria-label={`Move ${name} down`}
                    onClick={() => move(index, index + 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className={small}
                    aria-label={`Edit ${name}`}
                    onClick={() => setEditing(sub.id)}
                  >
                    Edit
                  </button>
                  <button type="button" className={small} aria-label={`Duplicate ${name}`} onClick={() => copy(sub.id)}>
                    Duplicate
                  </button>
                  <button
                    type="button"
                    className={`${small} text-red-700`}
                    aria-label={`Delete ${name}`}
                    onClick={() => remove(sub)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <p className={hint}>
        {subFieldsSummary(draft)}. A field can only be shown by the fields above it here. What is entered in them
        follows the {draft.type === "group" ? "group" : "repeater"}&apos;s own access.
      </p>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <FieldTypePicker
        open={picking}
        onClose={() => setPicking(false)}
        onPick={add}
        types={SUB_FIELD_TYPES}
        title="Add a field inside"
      />
      <FieldEditorDialog
        sub
        field={editingField}
        above={editingIndex > 0 ? subs.slice(0, editingIndex) : []}
        otherNames={subs.filter((_, i) => i !== editingIndex).map((f) => f.name)}
        fresh={editingField ? freshIds.has(editingField.id) : false}
        languages={languages}
        onApply={(next) => {
          set(replaceSubField(wrapped, draft.id, next), `${next.label} updated.`);
          setEditing(null);
        }}
        onClose={() => setEditing(null)}
      />
    </div>
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

function Logic({ draft, update, above, sub }: PanelProps & { above: FieldDef[]; sub: boolean }) {
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
        A field can be shown by the value of a field above it in the {sub ? "group or repeater" : "group"}. There are
        none above this one yet: move it down, or add a field above it first.
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
      {isStructural(draft.type) && <p className={hint}>What is entered in the fields inside follows this choice.</p>}
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
      {draft.access === "public" && !isStructural(draft.type) && <Uses draft={draft} update={update} />}
    </fieldset>
  );
}

/** Where else a public field is used besides templates (D118, phase 2): the listing's filters, keyword search and the chat assistant. */
function Uses({ draft, update }: PanelProps) {
  const uses: { key: "filter" | "search" | "chat"; label: string; hint: string; allowed: boolean }[] = [
    {
      key: "filter",
      label: "Offer as a filter in product lists",
      hint: "Shoppers can narrow product lists by this field's choices. Only for products.",
      allowed: FILTER_TYPES.includes(draft.type),
    },
    {
      key: "search",
      label: "Include in the store's search",
      hint: "Products are found by the words written in this field. Only for products.",
      allowed: SEARCH_TYPES.includes(draft.type),
    },
    {
      key: "chat",
      label: "Let the chat assistant say it",
      hint: "The assistant may tell shoppers what is written here about a product, worded as it is.",
      allowed: true,
    },
  ];
  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-border pt-3">
      <p className="text-sm font-medium">Also use it for</p>
      {uses
        .filter((use) => use.allowed)
        .map((use) => (
          <label key={use.key} className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={Boolean(draft[use.key])}
              onChange={(event) => update({ [use.key]: event.target.checked })}
              className="mt-0.5 size-4"
            />
            <span>
              <span className="font-medium">{use.label}</span>
              <span className={`block ${hint}`}>{use.hint}</span>
            </span>
          </label>
        ))}
    </div>
  );
}
