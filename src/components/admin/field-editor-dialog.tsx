"use client";

import { useId, useState, type KeyboardEvent, type ReactNode } from "react";

import { useAdminText } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";

import {
  FIELD_ACCESS,
  FILTER_TYPES,
  SEARCH_TYPES,
  FIELD_WIDTHS,
  MAX_CHOICES,
  MAX_GALLERY,
  MAX_LAYOUTS,
  MAX_REPEATER_ROWS,
  MAX_SUB_FIELDS,
  TEXTAREA_MAX,
  TEXT_MAX,
  hasChoices,
  isStructural,
  nameOf,
  operatorsFor,
  uniqueName,
  type Choice,
  type Condition,
  type FieldDef,
  type FieldLayout,
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
  addLayout,
  duplicateLayout,
  layoutHolder,
  layoutKey,
  layoutsSummary,
  moveItem,
  moveSubField,
  newCondition,
  operatorLabel,
  parseUnits,
  removeLayout,
  removeSubField,
  replaceLayout,
  replaceSubField,
  settleCondition,
  subFieldsSummary,
  valueKindFor,
  withHeldFields,
  withLabel,
} from "@/lib/field-group-editor";

import { useContentTypeChoices } from "./content-type-choices";
import { FieldTypePicker } from "./field-type-picker";
import { Modal } from "./modal";

export type FieldLanguage = { locale: string; name: string };

const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm font-normal";
const label = "flex flex-col gap-1 text-sm font-medium";
const hint = "text-xs font-normal text-muted";
const small = "min-h-9 rounded-pill border border-edge px-3 text-sm hover:bg-sunken disabled:opacity-40";

const PLACEHOLDER_TYPES: readonly FieldType[] = ["text", "textarea", "email", "url", "phone", "number", "measurement", "money"];

const TABS = [
  { id: "general", label: "General" },
  { id: "fields", label: "Fields" },
  { id: "layouts", label: "Layouts" },
  { id: "presentation", label: "Presentation" },
  { id: "logic", label: "Logic" },
  { id: "storefront", label: "Storefront" },
] as const;
type Tab = (typeof TABS)[number]["id"];

/** The tabs a field has: "Fields" only for a group or repeater, "Layouts" only for flexible content, "Storefront" not for a field inside one (it follows its parent). */
const tabsFor = (type: FieldType, sub: boolean, staffOnly = false) =>
  TABS.filter(
    (tab) =>
      (tab.id !== "fields" || (isStructural(type) && type !== "flexible")) &&
      (tab.id !== "layouts" || type === "flexible") &&
      (tab.id !== "storefront" || !(sub || staffOnly)),
  );

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
  staffOnly = false,
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
  /** A group for customers or orders (D120): staff only, so no Storefront tab (nothing is ever public). */
  staffOnly?: boolean;
  /** The store's languages, the main one first. */
  languages: FieldLanguage[];
  onApply: (field: FieldDef) => void;
  onClose: () => void;
}) {
  const fw = useAdminText("fields");
  const w = fw.dialog;
  const [draft, setDraft] = useState<FieldDef | null>(field);
  const [tab, setTab] = useState<Tab>("general");
  const [attempted, setAttempted] = useState(false);
  // Opening the dialog on a field starts from that field (state reset while rendering, as React describes).
  const [seen, setSeen] = useState<FieldDef | null>(field);
  // The keys already saved can be told from new ones, as values are kept under them.
  const [savedKeys, setSavedKeys] = useState<string[]>(fresh ? [] : (field?.choices ?? []).map((c) => c.key));
  // The same for flexible content's layouts: rows are kept under a layout's key.
  const [savedLayoutKeys, setSavedLayoutKeys] = useState<string[]>(fresh ? [] : (field?.layouts ?? []).map((l) => l.key));
  if (field !== seen) {
    setSeen(field);
    setDraft(field);
    setTab("general");
    setAttempted(false);
    setSavedKeys(fresh ? [] : (field?.choices ?? []).map((c) => c.key));
    setSavedLayoutKeys(fresh ? [] : (field?.layouts ?? []).map((l) => l.key));
  }
  const tabsId = useId();
  const tabs = tabsFor(draft?.type ?? "text", sub, staffOnly);
  const shownTab = tabs.some((item) => item.id === tab) ? tab : "general";

  const update = (patch: Partial<FieldDef>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const problems = draft ? fieldProblems(draft, otherNames, above, fw) : [];
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
          ? fillWords(sub ? (fresh ? w.titleNewSub : w.titleEditSub) : fresh ? w.titleNew : w.titleEdit, {
              label: draft.label || fw.types[draft.type].label,
            })
          : w.titleClosed
      }
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="min-h-10 rounded-pill border border-edge px-4 text-sm hover:bg-sunken"
          >
            {w.cancel}
          </button>
          <button
            type="button"
            onClick={apply}
            className="min-h-10 rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink"
          >
            {w.apply}
          </button>
        </>
      }
    >
      {draft && (
        <div className="flex flex-col gap-4">
          {attempted && problems.length > 0 && (
            <div role="alert" className="rounded-md border border-danger-text p-3 text-sm">
              <p className="font-medium">{w.fixFirst}</p>
              <ul className="mt-1 list-disc pl-5">
                {problems.map((problem, index) => (
                  <li key={`${index}:${problem}`}>{problem}</li>
                ))}
              </ul>
            </div>
          )}
          <div role="tablist" aria-label={w.settings} className="flex flex-wrap gap-1 border-b border-line">
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
                className="-mb-px min-h-10 border-b-2 border-transparent px-3 text-sm aria-selected:border-brand aria-selected:font-medium"
              >
                {w.tabs[item.id]}
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
            {shownTab === "layouts" && (
              <LayoutsEditor
                draft={draft}
                update={update}
                languages={languages}
                freshIds={freshIds ?? new Set()}
                onFresh={onFresh ?? (() => {})}
                savedLayoutKeys={savedLayoutKeys}
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
  const fw = useAdminText("fields");
  const w = fw.dialog;
  return (
    <>
      <p className="text-sm">
        <span className="font-medium">{w.type}</span> {fw.types[draft.type].label}
        <span className={`block ${hint}`}>{w.typeFixed}</span>
      </p>
      <label className={label}>
        {w.label}
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
          {languages.length > 1 ? fillWords(w.labelHintMain, { language: languages[0].name }) : w.labelHint}
        </span>
      </label>
      {others.length > 0 && (
        <fieldset className="flex flex-col gap-2 rounded-md border border-line p-3">
          <legend className="px-1 text-sm font-medium">{w.otherLabels}</legend>
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
          <p className={hint}>{w.otherLabelsHint}</p>
        </fieldset>
      )}
      <label className={label}>
        {w.name}
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
          {w.nameHint}
        </span>
        {nameProblem === "invalid" && (
          <span className="text-xs font-normal text-danger-text">
            {w.nameInvalid}
          </span>
        )}
        {nameProblem === "taken" && (
          <span className="text-xs font-normal text-danger-text">{w.nameTaken}</span>
        )}
      </label>
      <label className={label}>
        {w.instructions}
        <textarea
          value={draft.instructions ?? ""}
          maxLength={300}
          rows={2}
          onChange={(event) => update({ instructions: event.target.value || undefined })}
          className={`${input} py-2`}
        />
        <span className={hint}>{w.instructionsHint}</span>
      </label>
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={draft.required === true}
          onChange={(event) => update({ required: event.target.checked || undefined })}
          className="mt-0.5 size-4"
        />
        <span>
          <span className="font-medium">{w.required}</span>
          <span className={`block ${hint}`}>{w.requiredHint}</span>
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
  const w = useAdminText("fields").dialog;
  return (
    <>
      <label className={`${label} max-w-56`}>
        {w.width}
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
        <span className={hint}>{w.widthHint}</span>
      </label>
      {PLACEHOLDER_TYPES.includes(type) && (
        <label className={label}>
          {w.placeholder}
          <input
            value={draft.placeholder ?? ""}
            maxLength={100}
            onChange={(event) => update({ placeholder: event.target.value || undefined })}
            className={input}
          />
          <span className={hint}>{w.placeholderHint}</span>
        </label>
      )}
      {(type === "text" || type === "textarea") && (
        <OptionalNumber
          label={w.mostCharacters}
          value={draft.maxLength}
          min={1}
          max={type === "text" ? TEXT_MAX : TEXTAREA_MAX}
          integer
          onChange={(maxLength) => update({ maxLength })}
          hintText={fillWords(w.atMost, { n: type === "text" ? TEXT_MAX : TEXTAREA_MAX })}
        />
      )}
      {type === "number" && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <OptionalNumber label={w.least} value={draft.min} onChange={(min) => update({ min })} />
            <OptionalNumber label={w.most} value={draft.max} onChange={(max) => update({ max })} />
            <OptionalNumber
              label={w.step}
              value={draft.step}
              min={0}
              onChange={(step) => update({ step: step && step > 0 ? step : undefined })}
            />
          </div>
          <label className={`${label} max-w-56`}>
            {w.unit}
            <input
              value={draft.unit ?? ""}
              maxLength={12}
              placeholder={w.unitExample}
              onChange={(event) => update({ unit: event.target.value || undefined })}
              className={input}
            />
            <span className={hint}>{w.unitHint}</span>
          </label>
        </>
      )}
      {type === "measurement" && (
        <>
          <UnitsInput units={draft.units ?? []} onChange={(units) => update({ units })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <OptionalNumber label={w.least} value={draft.min} onChange={(min) => update({ min })} />
            <OptionalNumber label={w.most} value={draft.max} onChange={(max) => update({ max })} />
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
          label={w.mostPictures}
          value={draft.maxItems}
          min={1}
          max={MAX_GALLERY}
          integer
          onChange={(maxItems) => update({ maxItems })}
          hintText={fillWords(w.atMost, { n: MAX_GALLERY })}
        />
      )}
      {type === "entry" && <EntryTypeChoice draft={draft} update={update} />}
      {(type === "product" || type === "page" || type === "term" || type === "entry") && (
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={draft.multiple === true}
            onChange={(event) => update({ multiple: event.target.checked || undefined })}
            className="mt-0.5 size-4"
          />
          <span>
            <span className="font-medium">{w.several}</span>
            <span className={`block ${hint}`}>{draft.multiple ? w.severalOn : w.severalOff}</span>
          </span>
        </label>
      )}
      {type === "term" && <TermKinds draft={draft} update={update} />}
      {(type === "repeater" || type === "flexible") && <RepeaterSettings draft={draft} update={update} />}
      {type === "money" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <OptionalNumber
              label={w.least}
              value={draft.min}
              min={0}
              onChange={(min) => update({ min })}
              hintText={w.moneyLeast}
            />
            <OptionalNumber label={w.most} value={draft.max} min={0} onChange={(max) => update({ max })} />
          </div>
          <p className={hint}>{w.moneyHint}</p>
        </>
      )}
      {!hasTypeSettings(type) && (
        <p className={hint}>
          {type === "group" ? w.groupNoSettings : w.noSettings}
        </p>
      )}
    </>
  );
}

/** The content type whose entries an entry field takes (D326): one of the owner's, required. */
function EntryTypeChoice({ draft, update }: PanelProps) {
  const w = useAdminText("fields").dialog;
  const types = useContentTypeChoices();
  const id = useId();
  if (types.length === 0) return <p className={hint}>{w.noContentTypes}</p>;
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id} className="font-medium">
        {w.contentType}
      </label>
      <select
        id={id}
        aria-describedby={`${id}-hint`}
        value={draft.contentType ?? ""}
        onChange={(event) => update({ contentType: event.target.value || undefined })}
        className="min-h-10 rounded-md border border-line bg-card px-3"
      >
        <option value="">{w.chooseContentType}</option>
        {types.map((type) => (
          <option key={type.key} value={type.key}>
            {type.name}
          </option>
        ))}
      </select>
      <span id={`${id}-hint`} className={hint}>
        {w.contentTypeHint}
      </span>
    </div>
  );
}

/** Which of the categories and tags a category-or-tag field offers: at least one of the two. */
function TermKinds({ draft, update }: PanelProps) {
  const w = useAdminText("fields").dialog;
  const kinds = draft.termKinds && draft.termKinds.length > 0 ? draft.termKinds : (["category", "tag"] as const);
  const set = (kind: "category" | "tag", on: boolean) => {
    const next = (["category", "tag"] as const).filter((k) => (k === kind ? on : kinds.includes(k)));
    if (next.length > 0) update({ termKinds: [...next] });
  };
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-sm font-medium">{w.whichTerms}</legend>
      {(["category", "tag"] as const).map((kind) => (
        <label key={kind} className="flex min-h-10 items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={kinds.includes(kind)}
            disabled={kinds.length === 1 && kinds.includes(kind)}
            onChange={(event) => set(kind, event.target.checked)}
            className="size-4"
          />
          {kind === "category" ? w.categories : w.tags}
        </label>
      ))}
      <p className={hint}>{w.termsHint}</p>
    </fieldset>
  );
}

/** A repeater's or flexible content's fewest and most rows, the words on its add button, and (repeater only) how its rows are laid out in the form. */
function RepeaterSettings({ draft, update }: PanelProps) {
  const w = useAdminText("fields").dialog;
  const layout = draft.rowLayout ?? "block";
  const flexible = draft.type === "flexible";
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <OptionalNumber
          label={w.fewestRows}
          value={draft.minRows}
          min={0}
          max={MAX_REPEATER_ROWS}
          integer
          onChange={(minRows) => update({ minRows })}
          hintText={w.fewestRowsHint}
        />
        <OptionalNumber
          label={w.mostRows}
          value={draft.maxRows}
          min={1}
          max={MAX_REPEATER_ROWS}
          integer
          onChange={(maxRows) => update({ maxRows })}
          hintText={fillWords(w.atMost, { n: MAX_REPEATER_ROWS })}
        />
      </div>
      <label className={`${label} max-w-72`}>
        {w.buttonWords}
        <input
          value={draft.buttonLabel ?? ""}
          maxLength={40}
          placeholder={w.addRow}
          onChange={(event) => update({ buttonLabel: event.target.value || undefined })}
          className={input}
        />
      </label>
      {!flexible && (
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{w.rowLayout}</legend>
        {(
          [
            ["block", w.blocks, w.blocksHint],
            ["table", w.table, w.tableHint],
          ] as const
        ).map(([value, name, text]) => (
          <label
            key={value}
            className="flex items-start gap-3 rounded-md border border-line p-3 text-sm has-[:checked]:border-brand"
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
      )}
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
  noun,
}: PanelProps & {
  languages: FieldLanguage[];
  freshIds: ReadonlySet<string>;
  onFresh: (ids: string[]) => void;
  /** What holds the fields, in words ("layout" for one layout of flexible content); a group's or repeater's by default. */
  noun?: string;
}) {
  const fw = useAdminText("fields");
  const w = fw.dialog;
  const holderKey = noun === "layout" ? "layout" : draft.type === "group" ? "group" : "repeater";
  const holder = w.holders[holderKey];
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
    set(result.fields, fillWords(fw.group.added, { type: fw.types[type].label }));
    setEditing(result.added.id);
  };
  const copy = (id: string) => {
    const result = duplicateSubField(wrapped, draft.id, id);
    if (!result) return;
    onFresh([result.copy.id]);
    set(result.fields, fillWords(fw.group.addedBelow, { label: result.copy.label }));
    setEditing(result.copy.id);
  };
  const remove = (sub: FieldDef) => {
    if (
      !freshIds.has(sub.id) &&
      !window.confirm(fillWords(fw.group.confirmDelete, { label: sub.label }))
    )
      return;
    const result = removeSubField(wrapped, draft.id, sub.id);
    set(
      result.fields,
      `${fillWords(fw.group.deleted, { label: sub.label })}${result.changed.length > 0 ? fillWords(fw.group.logicRemoved, { names: result.changed.join(", ") }) : ""}`,
    );
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= subs.length) return;
    set(
      moveSubField(wrapped, draft.id, from, to),
      fillWords(fw.group.moved, { label: subs[from].label, to: to + 1, total: subs.length }),
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {w.fieldsInside} <span className="font-normal text-muted">({subs.length})</span>
        </p>
        <button
          type="button"
          className={small}
          onClick={() => setPicking(true)}
          disabled={subs.length >= MAX_SUB_FIELDS}
        >
          {w.addInside}
        </button>
      </div>
      {subs.length === 0 ? (
        <p role="alert" className="rounded-md border border-dashed border-danger-text p-4 text-center text-sm">
          {fillWords(w.needsField, { holder })}
        </p>
      ) : (
        <ol aria-label={fillWords(w.insideOf, { label: draft.label || w.theField })} className="flex flex-col gap-2">
          {subs.map((sub, index) => {
            const name = sub.label || sub.name;
            return (
              <li
                key={sub.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-sunken p-2"
              >
                <div className="min-w-0 flex-1 basis-40">
                  <p className="truncate text-sm font-medium">{sub.label || fw.group.untitledField}</p>
                  <p className="truncate font-mono text-xs text-muted">{sub.name}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1 text-xs">
                  <span className="rounded-full border border-line px-2 py-0.5">{fw.types[sub.type].label}</span>
                  {sub.required && (
                    <span className="rounded-full bg-brand px-2 py-0.5 text-brand-ink">{fw.group.required}</span>
                  )}
                  {sub.when && sub.when.length > 0 && (
                    <span className="rounded-full border border-line px-2 py-0.5">{fw.group.hasLogic}</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    className={small}
                    disabled={index === 0}
                    aria-label={fillWords(fw.group.moveUp, { name })}
                    onClick={() => move(index, index - 1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={small}
                    disabled={index === subs.length - 1}
                    aria-label={fillWords(fw.group.moveDown, { name })}
                    onClick={() => move(index, index + 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className={small}
                    aria-label={fillWords(fw.group.editName, { name })}
                    onClick={() => setEditing(sub.id)}
                  >
                    {fw.group.edit}
                  </button>
                  <button
                    type="button"
                    className={small}
                    aria-label={fillWords(fw.group.duplicateName, { name })}
                    onClick={() => copy(sub.id)}
                  >
                    {fw.group.duplicate}
                  </button>
                  <button
                    type="button"
                    className={`${small} text-danger-text`}
                    aria-label={fillWords(fw.group.deleteName, { name })}
                    onClick={() => remove(sub)}
                  >
                    {fw.group.delete}
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <p className={hint}>
        {fillWords(w.insideHint, { summary: subFieldsSummary(draft, fw), holder: noun ? w.holders.flexible : holder })}
      </p>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <FieldTypePicker
        open={picking}
        onClose={() => setPicking(false)}
        onPick={add}
        types={SUB_FIELD_TYPES}
        title={w.addInside}
      />
      <FieldEditorDialog
        sub
        field={editingField}
        above={editingIndex > 0 ? subs.slice(0, editingIndex) : []}
        otherNames={subs.filter((_, i) => i !== editingIndex).map((f) => f.name)}
        fresh={editingField ? freshIds.has(editingField.id) : false}
        languages={languages}
        onApply={(next) => {
          set(replaceSubField(wrapped, draft.id, next), fillWords(fw.group.updated, { label: next.label }));
          setEditing(null);
        }}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

/**
 * The layouts of flexible content: named sets of fields a row can take. One is
 * open at a time: its label (and its words in other languages), its key (fixed
 * once saved, as rows are kept under it) and the fields inside it, edited with
 * the same list and dialog as a group's.
 */
function LayoutsEditor({
  draft,
  update,
  languages,
  freshIds,
  onFresh,
  savedLayoutKeys,
}: PanelProps & {
  languages: FieldLanguage[];
  freshIds: ReadonlySet<string>;
  onFresh: (ids: string[]) => void;
  savedLayoutKeys: string[];
}) {
  const fw = useAdminText("fields");
  const w = fw.dialog;
  const layouts = draft.layouts ?? [];
  const [open, setOpen] = useState<string | null>(layouts[0]?.key ?? null);
  const [announcement, setAnnouncement] = useState("");
  const others = languages.slice(1);
  const wrapped = [draft];
  const set = (fields: FieldDef[], message?: string) => {
    update({ layouts: fields[0]?.layouts ?? [] });
    if (message) setAnnouncement(message);
  };
  const change = (key: string, next: FieldLayout) => set(replaceLayout(wrapped, draft.id, key, next));
  const add = () => {
    const result = addLayout(wrapped, draft.id, fw.text.newLayout);
    if (!result.added) return;
    onFresh(result.added.subFields.map((f) => f.id));
    set(result.fields, fillWords(w.layoutAdded, { label: result.added.label }));
    setOpen(result.added.key);
  };
  const copy = (key: string) => {
    const result = duplicateLayout(wrapped, draft.id, key, fw.text.copyOf);
    if (!result) return;
    onFresh(result.copy.subFields.map((f) => f.id));
    set(result.fields, fillWords(fw.group.addedBelow, { label: result.copy.label }));
    setOpen(result.copy.key);
  };
  const remove = (layout: FieldLayout) => {
    if (
      savedLayoutKeys.includes(layout.key) &&
      !window.confirm(fillWords(w.confirmLayout, { label: layout.label }))
    )
      return;
    set(removeLayout(wrapped, draft.id, layout.key), fillWords(w.layoutDeleted, { label: layout.label }));
    if (open === layout.key) setOpen(null);
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= layouts.length) return;
    set(
      [{ ...draft, layouts: moveItem(layouts, from, to) }],
      fillWords(fw.group.moved, { label: layouts[from].label, to: to + 1, total: layouts.length }),
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {w.layouts} <span className="font-normal text-muted">({layouts.length})</span>
        </p>
        <button type="button" className={small} onClick={add} disabled={layouts.length >= MAX_LAYOUTS}>
          {w.addLayout}
        </button>
      </div>
      {layouts.length === 0 ? (
        <p role="alert" className="rounded-md border border-dashed border-danger-text p-4 text-center text-sm">
          {w.needsLayout}
        </p>
      ) : (
        <ol aria-label={fillWords(w.layoutsOf, { label: draft.label || w.theField })} className="flex flex-col gap-2">
          {layouts.map((layout, index) => {
            const name = layout.label || layout.key;
            const locked = savedLayoutKeys.includes(layout.key);
            const taken = layouts.filter((_, i) => i !== index).map((l) => l.key);
            const isOpen = open === layout.key;
            return (
              <li key={index} className="rounded-md border border-line bg-sunken">
                <div className="flex flex-wrap items-center gap-2 p-2">
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="truncate text-sm font-medium">{layout.label || w.untitledLayout}</p>
                    <p className="truncate text-xs text-muted">{subFieldsSummary({ type: "group", subFields: layout.subFields }, fw)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <button
                      type="button"
                      className={small}
                      disabled={index === 0}
                      aria-label={fillWords(w.moveLayoutUp, { name })}
                      onClick={() => move(index, index - 1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className={small}
                      disabled={index === layouts.length - 1}
                      aria-label={fillWords(w.moveLayoutDown, { name })}
                      onClick={() => move(index, index + 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className={small}
                      aria-expanded={isOpen}
                      aria-label={fillWords(isOpen ? w.closeLayout : w.editLayout, { name })}
                      onClick={() => setOpen(isOpen ? null : layout.key)}
                    >
                      {isOpen ? w.close : fw.group.edit}
                    </button>
                    <button
                      type="button"
                      className={small}
                      aria-label={fillWords(w.duplicateLayout, { name })}
                      onClick={() => copy(layout.key)}
                    >
                      {fw.group.duplicate}
                    </button>
                    <button
                      type="button"
                      className={`${small} text-danger-text`}
                      aria-label={fillWords(w.deleteLayout, { name })}
                      onClick={() => remove(layout)}
                    >
                      {fw.group.delete}
                    </button>
                  </div>
                </div>
                {isOpen && (
                  <div className="flex flex-col gap-3 border-t border-line p-3">
                    <div className="flex flex-wrap items-end gap-2">
                      <label className={`${label} min-w-40 flex-1`}>
                        {w.layoutLabel}
                        <input
                          value={layout.label}
                          maxLength={80}
                          onChange={(event) => {
                            const next = event.target.value;
                            // A new layout's key follows its label until the key is changed by hand; a saved key never changes.
                            const follows = !locked && layout.key === layoutKey(layout.label, taken);
                            const key = follows ? layoutKey(next, taken) : layout.key;
                            change(layout.key, { ...layout, label: next, key });
                            if (key !== layout.key) setOpen(key);
                          }}
                          className={input}
                        />
                      </label>
                      <label className={`${label} w-44`}>
                        {w.key}
                        <input
                          value={layout.key}
                          maxLength={40}
                          readOnly={locked}
                          onChange={(event) => {
                            change(layout.key, { ...layout, key: event.target.value });
                            setOpen(event.target.value);
                          }}
                          className={`${input} font-mono ${locked ? "bg-sunken" : ""}`}
                        />
                      </label>
                    </div>
                    {locked && <p className={hint}>{w.layoutKeyLocked}</p>}
                    {others.length > 0 && (
                      <details>
                        <summary className="cursor-pointer text-sm">{w.otherLabels}</summary>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          {others.map((language) => (
                            <label key={language.locale} className={label}>
                              {language.name}
                              <input
                                value={layout.labels?.[language.locale] ?? ""}
                                maxLength={80}
                                lang={language.locale}
                                placeholder={layout.label}
                                onChange={(event) => change(layout.key, withLabel(layout, language.locale, event.target.value))}
                                className={input}
                              />
                            </label>
                          ))}
                        </div>
                      </details>
                    )}
                    <SubFieldsEditor
                      noun="layout"
                      draft={layoutHolder(layout, draft)}
                      update={(patch) => change(layout.key, withHeldFields(layout, { subFields: patch.subFields }))}
                      languages={languages}
                      freshIds={freshIds}
                      onFresh={onFresh}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <p className={hint}>{fillWords(w.layoutsHint, { summary: layoutsSummary(draft, fw) })}</p>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
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
  const w = useAdminText("fields").dialog;
  const [typed, setTyped] = useState(units.join(", "));
  return (
    <label className={label}>
      {w.units}
      <input
        value={typed}
        onChange={(event) => {
          setTyped(event.target.value);
          onChange(parseUnits(event.target.value).map((unit) => unit.slice(0, 12)));
        }}
        placeholder={w.unitsExample}
        className={input}
        aria-describedby="units-hint"
      />
      <span id="units-hint" className={hint}>
        {w.unitsHint}
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
  const fw = useAdminText("fields");
  const w = fw.dialog;
  const others = languages.slice(1);
  const change = (index: number, next: Choice) => onChange(choices.map((c, i) => (i === index ? next : c)));
  const add = () => {
    const text = fillWords(w.option, { n: choices.length + 1 });
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
      <legend className="mb-1 text-sm font-medium">{w.choices}</legend>
      <ol className="flex flex-col gap-2">
        {choices.map((choice, index) => {
          const locked = savedKeys.includes(choice.key);
          const taken = choices.filter((_, i) => i !== index).map((c) => c.key);
          return (
            <li key={index} className="flex flex-col gap-2 rounded-md border border-line p-3">
              <div className="flex flex-wrap items-end gap-2">
                <label className={`${label} min-w-40 flex-1`}>
                  {w.label}
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
                  {w.key}
                  <input
                    value={choice.key}
                    maxLength={40}
                    readOnly={locked}
                    aria-describedby={locked ? "key-locked-hint" : undefined}
                    onChange={(event) => change(index, { ...choice, key: event.target.value })}
                    className={`${input} font-mono ${locked ? "bg-sunken" : ""}`}
                  />
                </label>
                <div className="flex gap-1">
                  <button
                    type="button"
                    className={small}
                    disabled={index === 0}
                    aria-label={fillWords(w.moveChoiceUp, { name: choice.label || index + 1 })}
                    onClick={() => onChange(moveItem(choices, index, index - 1))}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={small}
                    disabled={index === choices.length - 1}
                    aria-label={fillWords(w.moveChoiceDown, { name: choice.label || index + 1 })}
                    onClick={() => onChange(moveItem(choices, index, index + 1))}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className={`${small} text-danger-text`}
                    aria-label={fillWords(w.removeChoice, { name: choice.label || index + 1 })}
                    onClick={() => onChange(choices.filter((_, i) => i !== index))}
                  >
                    {fw.group.remove}
                  </button>
                </div>
              </div>
              {others.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-sm">{w.otherLabels}</summary>
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
          {w.addChoice}
        </button>
        {!fresh && savedKeys.length > 0 && (
          <span id="key-locked-hint" className={hint}>
            {w.keysLocked}
          </span>
        )}
      </div>
    </fieldset>
  );
}

function Logic({ draft, update, above, sub }: PanelProps & { above: FieldDef[]; sub: boolean }) {
  const fw = useAdminText("fields");
  const w = fw.dialog;
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
      <p className="text-sm text-muted">{sub ? w.noneAboveSub : w.noneAbove}</p>
    );
  }
  return (
    <>
      <p className={hint}>{w.logicHint}</p>
      {groups.length === 0 ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm">{w.alwaysShown}</p>
          <button type="button" className={small} onClick={start}>
            {w.showOnlyIf}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium">{w.showIf}</p>
          {groups.map((all, g) => (
            <div key={g} className="flex flex-col gap-2">
              {g > 0 && <p className="text-sm font-medium text-muted">{fw.group.or}</p>}
              <ul className="flex flex-col gap-2 rounded-md border border-line p-3">
                {all.map((condition, r) => (
                  <li key={r} className="flex flex-col gap-1">
                    {r > 0 && <span className="text-xs font-medium text-muted">{fw.group.and}</span>}
                    <ConditionRow
                      condition={condition}
                      above={above}
                      name={fillWords(fw.group.ruleName, { n: `${g + 1}.${r + 1}` })}
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
                    {fw.group.addAnd}
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
              {fw.group.addOr}
            </button>
            <button type="button" className={small} onClick={() => update({ when: undefined })}>
              {w.alwaysShow}
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
  const fw = useAdminText("fields");
  const w = fw.dialog;
  const trigger = above.find((f) => f.id === condition.field);
  const operators = trigger ? operatorsFor(trigger.type) : [];
  const kind = valueKindFor(trigger?.type, condition.operator);
  const value = condition.value ?? "";
  const valueLabel = fillWords(fw.group.value, { name });
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
        <option value="1">{w.yes}</option>
        <option value="0">{w.no}</option>
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
        placeholder={condition.operator === "matches" ? w.pattern : undefined}
        onChange={(event) => onChange({ ...condition, value: event.target.value })}
        className={`${input} min-w-32 flex-1`}
      />
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label={fillWords(w.fieldOf, { name })}
        value={condition.field}
        onChange={(event) => {
          const next = above.find((f) => f.id === event.target.value);
          onChange(settleCondition({ ...condition, field: event.target.value }, next));
        }}
        className={`${input} min-w-32 flex-1`}
      >
        {!trigger && <option value={condition.field}>{w.fieldGone}</option>}
        {above.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label || f.name}
          </option>
        ))}
      </select>
      <select
        aria-label={fillWords(fw.group.operator, { name })}
        value={condition.operator}
        onChange={(event) =>
          onChange(settleCondition({ ...condition, operator: event.target.value as Condition["operator"] }, trigger))
        }
        className={`${input} min-w-32 flex-1`}
      >
        {operators.map((operator) => (
          <option key={operator} value={operator}>
            {operatorLabel(operator, fw)}
          </option>
        ))}
      </select>
      {control}
      <button
        type="button"
        className={`${small} text-danger-text`}
        onClick={onRemove}
        aria-label={fillWords(fw.group.removeName, { name })}
      >
        {fw.group.remove}
      </button>
    </div>
  );
}

function Storefront({ draft, update }: PanelProps) {
  const w = useAdminText("fields").dialog;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{w.whoSees}</legend>
      {isStructural(draft.type) && <p className={hint}>{w.insideFollows}</p>}
      {(Object.keys(FIELD_ACCESS) as (keyof typeof FIELD_ACCESS)[]).map((access) => (
        <label
          key={access}
          className="flex items-start gap-3 rounded-md border border-line p-3 text-sm has-[:checked]:border-brand"
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
              {access === "private" ? w.private : w.public}
            </span>
            <span className={`block ${hint}`}>
              {access === "private" ? w.privateHint : w.publicHint}
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
  const w = useAdminText("fields").dialog;
  const uses: { key: "filter" | "search" | "chat"; label: string; hint: string; allowed: boolean }[] = [
    {
      key: "filter",
      label: w.filter,
      hint:
        draft.type === "number" || draft.type === "measurement"
          ? `${w.filterRange}${draft.type === "measurement" ? w.filterFirstUnit : ""}${w.onlyProducts}`
          : w.filterChoices,
      allowed: FILTER_TYPES.includes(draft.type),
    },
    {
      key: "search",
      label: w.search,
      hint: w.searchHint,
      allowed: SEARCH_TYPES.includes(draft.type),
    },
    {
      key: "chat",
      label: w.chat,
      hint: w.chatHint,
      // Never an amount: the assistant states no amount from a field.
      allowed: draft.type !== "money",
    },
  ];
  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-line pt-3">
      <p className="text-sm font-medium">{w.alsoUse}</p>
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
