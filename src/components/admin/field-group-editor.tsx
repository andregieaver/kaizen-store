"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";

import {
  EMPTY_DATA,
  EMPTY_LOOKUPS,
  FIELD_ENTITIES,
  FIELD_ENTITY_KEYS,
  FIELD_POSITIONS,
  FIELD_TYPES,
  LOCATION_CHOICES,
  MAX_GROUP_FIELDS,
  MAX_RULES,
  isStructural,
  newField,
  slugOf,
  type FieldData,
  type FieldDef,
  type FieldEntity,
  type FieldGroup,
  type FieldGroupInput,
  type FieldType,
  type LocationRule,
} from "@/lib/custom-fields";
import {
  duplicateField,
  entitiesText,
  fieldsWithBrokenLogic,
  draftProblems,
  locationParamsFor,
  moveItem,
  newLocationRule,
  pruneConditions,
  ruleFits,
  startValue,
  subFieldsSummary,
} from "@/lib/field-group-editor";

import { FieldEditorDialog, type FieldLanguage } from "./field-editor-dialog";
import { FieldTypePicker } from "./field-type-picker";
import { FieldsForm } from "./fields-form";

type Save = (input: FieldGroupInput) => Promise<{ ok: true; id?: string } | { ok: false; problems: string[] }>;

/** The group as the editor holds it: `fieldGroupInput`'s width is inferred as any number, the fields' own type is the five widths. */
type Draft = Omit<FieldGroupInput, "fields"> & { fields: FieldDef[] };

/** A category or tag of a kind of content, for the location rules. */
export type EditorTerm = {
  id: string;
  name: string;
  kind: "category" | "tag";
  parentId: string | null;
  entity: FieldEntity;
};

const input = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm font-normal";
const label = "flex flex-col gap-1 text-sm font-medium";
const hint = "text-xs font-normal text-muted";
const card = "flex flex-col gap-4 rounded-lg border border-border bg-background p-5";
const small = "min-h-9 rounded-md border border-border px-3 text-sm hover:bg-surface disabled:opacity-40";

/**
 * A group of custom fields (D118): its name, where it applies, its fields in
 * order, and a live preview of the form staff will get. The whole group is
 * held here until Save and sent as one JSON; nothing changes on the site
 * before then, and leaving with unsaved changes asks first.
 */
export function FieldGroupEditor({
  initial,
  terms,
  roles,
  languages,
  save,
  base,
  actions,
}: {
  initial: FieldGroupInput;
  terms: EditorTerm[];
  /** The store's special pages, for the location rules. */
  roles: { value: string; label: string }[];
  /** The store's languages, the main one first. */
  languages: FieldLanguage[];
  save: Save;
  /** The list's address (`/admin/{store}/fields`). */
  base: string;
  /** Extra controls after Save (deleting the group). */
  actions?: ReactNode;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(initial as Draft);
  const [dirty, setDirty] = useState(false);
  const [slugFollows, setSlugFollows] = useState(initial.id === null);
  const [problems, setProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [saving, startSaving] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [data, setData] = useState<FieldData>(EMPTY_DATA);
  // Fields added since the group was last saved: their names and choices' keys are still free to change.
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const problemsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const change = (next: (group: Draft) => Draft) => {
    setDraft(next);
    setDirty(true);
    setSaved(false);
  };
  const markFresh = (ids: string[]) => setFresh((current) => new Set([...current, ...ids]));
  const setFields = (fields: FieldDef[], message?: string) => {
    change((g) => ({ ...g, fields }));
    if (message) setAnnouncement(message);
  };

  const main = languages[0]?.locale ?? "en";
  const languageName = (locale: string) => languages.find((l) => l.locale === locale)?.name ?? locale;
  const fields = draft.fields;
  const broken = fieldsWithBrokenLogic(fields);
  const names = fields.map((f) => f.name);

  const submit = () => {
    setSaved(false);
    const local = draftProblems(draft);
    if (local.length > 0) {
      setProblems(local);
      problemsRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    startSaving(async () => {
      const result = await save(draft);
      if (result.ok) {
        setProblems([]);
        setDirty(false);
        setFresh(new Set());
        if (draft.id === null && result.id) router.replace(`${base}/${result.id}`);
        else {
          setSaved(true);
          router.refresh();
        }
      } else {
        setProblems(result.problems);
        problemsRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });
  };

  const addField = (type: FieldType) => {
    const created = newField(type, names);
    markFresh([created.id, ...(created.subFields ?? []).map((sub) => sub.id)]);
    setFields([...fields, created], `${FIELD_TYPES[type].label} field added.`);
    setPicking(false);
    setEditing(created.id);
  };
  const removeField = (id: string) => {
    const field = fields.find((f) => f.id === id);
    if (!field) return;
    if (
      !fresh.has(id) &&
      !window.confirm(`Delete the field ${field.label}? What was entered in it is deleted when you save the group.`)
    )
      return;
    const pruned = pruneConditions(fields.filter((f) => f.id !== id));
    setFields(
      pruned.fields,
      `${field.label} deleted.${pruned.changed.length > 0 ? ` The logic of ${pruned.changed.join(", ")} that looked at it was taken away.` : ""}`,
    );
  };
  const copyField = (id: string) => {
    const result = duplicateField(fields, id);
    if (!result) return;
    markFresh([result.copy.id, ...(result.copy.subFields ?? []).map((sub) => sub.id)]);
    setFields(result.fields, `${result.copy.label} added below.`);
    setEditing(result.copy.id);
  };
  const moveField = (from: number, to: number) => {
    if (to < 0 || to >= fields.length || from === to) return;
    setFields(moveItem(fields, from, to), `${fields[from].label} moved to place ${to + 1} of ${fields.length}.`);
  };

  const editingIndex = editing ? fields.findIndex((f) => f.id === editing) : -1;
  const editingField = editingIndex >= 0 ? fields[editingIndex] : null;
  const setEntity = (entity: FieldEntity, on: boolean) =>
    change((g) => {
      const entities = FIELD_ENTITY_KEYS.filter((e) => (e === entity ? on : g.entities.includes(e)));
      return entities.length === 0 ? g : { ...g, entities };
    });

  const previewGroup: FieldGroup = {
    ...draft,
    id: draft.id ?? "preview",
    name: draft.name || "Untitled group",
    sort: 0,
  };

  // The preview and the dialogs sit outside the form, so Enter in their inputs never saves the group.
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex min-w-0 flex-col gap-6"
      >
        <div ref={problemsRef}>
          {problems.length > 0 && (
            <div role="alert" className="rounded-lg border border-red-700 p-4 text-sm">
              <p className="font-medium">Nothing was saved yet. Please fix:</p>
              <ul className="mt-2 list-disc pl-5">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>

        <section aria-labelledby="group-heading" className={card}>
          <h2 id="group-heading" className="font-medium">
            The group
          </h2>
          <label className={label}>
            Name
            <input
              value={draft.name}
              onChange={(event) => {
                const name = event.target.value;
                change((g) => ({ ...g, name, ...(slugFollows && { slug: slugOf(name, "") }) }));
              }}
              required
              maxLength={80}
              className={input}
              aria-describedby="group-name-hint"
            />
            <span id="group-name-hint" className={hint}>
              What staff see above the fields: “Specifications”, “Size guide”.
            </span>
          </label>
          <label className={label}>
            Web name
            <input
              value={draft.slug}
              onChange={(event) => {
                setSlugFollows(false);
                change((g) => ({ ...g, slug: event.target.value }));
              }}
              required
              maxLength={60}
              className={`${input} font-mono`}
              aria-describedby="group-slug-hint"
            />
            <span id="group-slug-hint" className={hint}>
              What templates and exported files call the group. Lowercase letters, digits and hyphens; unique in the
              store.
            </span>
          </label>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">Can be used on</legend>
            {FIELD_ENTITY_KEYS.map((entity) => (
              <label key={entity} className="flex min-h-10 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={draft.entities.includes(entity)}
                  disabled={draft.entities.length === 1 && draft.entities.includes(entity)}
                  onChange={(event) => setEntity(entity, event.target.checked)}
                  className="size-4"
                />
                {FIELD_ENTITIES[entity]}
              </label>
            ))}
            <p className={hint}>At least one. Which of them the group is on is set under “Where it applies”.</p>
          </fieldset>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">Position in the editor</legend>
            {(Object.keys(FIELD_POSITIONS) as (keyof typeof FIELD_POSITIONS)[]).map((position) => (
              <label key={position} className="flex min-h-10 items-center gap-3 text-sm">
                <input
                  type="radio"
                  name="position"
                  checked={draft.position === position}
                  onChange={() => change((g) => ({ ...g, position }))}
                  className="size-4"
                />
                {FIELD_POSITIONS[position]}
              </label>
            ))}
          </fieldset>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(event) => change((g) => ({ ...g, active: event.target.checked }))}
              className="mt-0.5 size-4"
            />
            <span>
              <span className="font-medium">Switched on</span>
              <span className={`block ${hint}`}>
                A group that is off is not shown in editors. What was entered in it is kept.
              </span>
            </span>
          </label>
        </section>

        <section aria-labelledby="where-heading" className={card}>
          <h2 id="where-heading" className="font-medium">
            Where it applies
          </h2>
          <LocationBuilder
            draft={draft}
            terms={terms}
            roles={roles}
            onChange={(location) => change((g) => ({ ...g, location }))}
          />
        </section>

        <section aria-labelledby="fields-heading" className={card}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="fields-heading" className="font-medium">
              Fields <span className="font-normal text-muted">({fields.length})</span>
            </h2>
            <button
              type="button"
              onClick={() => setPicking(true)}
              disabled={fields.length >= MAX_GROUP_FIELDS}
              className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50"
            >
              Add field
            </button>
          </div>
          {fields.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted">
              No fields yet. Add one to start.
            </p>
          ) : (
            <FieldList
              fields={fields}
              broken={broken}
              onReorder={(from, to) => moveField(from, to)}
              onEdit={(id) => setEditing(id)}
              onCopy={copyField}
              onRemove={removeField}
            />
          )}
          <p className={hint}>
            Drag by the handle, or use the arrows, to put the fields in order. A field can only be shown by the fields
            above it. Values are kept under a field&apos;s id, so changing its name or label loses nothing; deleting a
            field deletes what was entered in it.
          </p>
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="min-h-11 rounded-md bg-foreground px-5 font-medium text-background disabled:opacity-50"
          >
            {saving ? "Saving …" : "Save group"}
          </button>
          <a href={base} className="text-sm underline">
            {dirty ? "Leave without saving" : "Back to the list"}
          </a>
          <span role="status" className="text-sm text-muted">
            {saved && !dirty ? "Saved." : dirty ? "Unsaved changes." : ""}
          </span>
        </div>
        {actions}
      </form>

      <aside aria-labelledby="preview-heading" className="min-w-0 xl:sticky xl:top-4 xl:self-start">
        <div className={card}>
          <div>
            <h2 id="preview-heading" className="font-medium">
              Preview (nothing is saved)
            </h2>
            <p className={hint}>
              The form staff will get. Try it, logic included: what you type here goes nowhere.{" "}
              {Object.keys(data.values).length + Object.keys(data.translations).length > 0 && (
                <button type="button" onClick={() => setData(EMPTY_DATA)} className="underline">
                  Clear the preview
                </button>
              )}
            </p>
          </div>
          {/* The preview mounts its rich text editors in the browser only. */}
          <FieldsForm
            groups={[previewGroup]}
            data={data}
            onChange={setData}
            locale={main}
            main={main}
            upload={null}
            fileUpload={null}
            lookups={EMPTY_LOOKUPS}
            languageName={languageName}
          />
        </div>
      </aside>

      <FieldTypePicker open={picking} onClose={() => setPicking(false)} onPick={addField} />
      <FieldEditorDialog
        field={editingField}
        above={editingIndex > 0 ? fields.slice(0, editingIndex) : []}
        otherNames={names.filter((_, i) => i !== editingIndex)}
        fresh={editingField ? fresh.has(editingField.id) : false}
        freshIds={fresh}
        onFresh={markFresh}
        languages={languages}
        onApply={(next) => {
          setFields(
            fields.map((f) => (f.id === next.id ? next : f)),
            `${next.label} updated.`,
          );
          setEditing(null);
        }}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

function FieldList({
  fields,
  broken,
  onReorder,
  onEdit,
  onCopy,
  onRemove,
}: {
  fields: FieldDef[];
  broken: Set<string>;
  onReorder: (from: number, to: number) => void;
  onEdit: (id: string) => void;
  onCopy: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) return;
    onReorder(
      fields.findIndex((f) => f.id === event.active.id),
      fields.findIndex((f) => f.id === event.over?.id),
    );
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
        <ol aria-label="Fields in order" className="flex flex-col gap-2">
          {fields.map((field, index) => (
            <FieldRow
              key={field.id}
              field={field}
              index={index}
              last={index === fields.length - 1}
              broken={broken.has(field.id)}
              onMove={(to) => onReorder(index, to)}
              onEdit={() => onEdit(field.id)}
              onCopy={() => onCopy(field.id)}
              onRemove={() => onRemove(field.id)}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

function FieldRow({
  field,
  index,
  last,
  broken,
  onMove,
  onEdit,
  onCopy,
  onRemove,
}: {
  field: FieldDef;
  index: number;
  last: boolean;
  broken: boolean;
  onMove: (to: number) => void;
  onEdit: () => void;
  onCopy: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id });
  const name = field.label || field.name;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`rounded-md border border-border bg-surface ${isDragging ? "relative z-10 opacity-90 shadow-lg" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-2 p-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Drag ${name}`}
          aria-roledescription="sortable field"
          className="flex size-9 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted hover:bg-background active:cursor-grabbing"
        >
          <svg viewBox="0 0 24 24" aria-hidden className="size-4" fill="currentColor">
            <circle cx="9" cy="6" r="1.5" />
            <circle cx="15" cy="6" r="1.5" />
            <circle cx="9" cy="12" r="1.5" />
            <circle cx="15" cy="12" r="1.5" />
            <circle cx="9" cy="18" r="1.5" />
            <circle cx="15" cy="18" r="1.5" />
          </svg>
        </button>
        <div className="min-w-0 flex-1 basis-40">
          <p className="truncate text-sm font-medium">{field.label || "Untitled field"}</p>
          <p className="truncate font-mono text-xs text-muted">{field.name}</p>
          {isStructural(field.type) && <p className="truncate text-xs text-muted">{subFieldsSummary(field)}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <span className="rounded-full border border-border px-2 py-0.5">{FIELD_TYPES[field.type].label}</span>
          {field.required && <span className="rounded-full bg-foreground px-2 py-0.5 text-background">Required</span>}
          {field.access === "public" && (
            <span className="rounded-full border border-foreground px-2 py-0.5">Public</span>
          )}
          {field.when && field.when.length > 0 && (
            <span className="rounded-full border border-border px-2 py-0.5">Has logic</span>
          )}
          {broken && (
            <span className="rounded-full border border-red-700 px-2 py-0.5 text-red-700">Logic needs a look</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            className={small}
            disabled={index === 0}
            aria-label={`Move ${name} up`}
            onClick={() => onMove(index - 1)}
          >
            ↑
          </button>
          <button
            type="button"
            className={small}
            disabled={last}
            aria-label={`Move ${name} down`}
            onClick={() => onMove(index + 1)}
          >
            ↓
          </button>
          <button type="button" className={small} onClick={onEdit} aria-label={`Edit ${name}`}>
            Edit
          </button>
          <button type="button" className={small} onClick={onCopy} aria-label={`Duplicate ${name}`}>
            Duplicate
          </button>
          <button type="button" className={`${small} text-red-700`} onClick={onRemove} aria-label={`Delete ${name}`}>
            Delete
          </button>
        </div>
      </div>
    </li>
  );
}

/** ACF's rule groups: rules inside a group must all hold (and), any one group is enough (or); none at all means everywhere. */
function LocationBuilder({
  draft,
  terms,
  roles,
  onChange,
}: {
  draft: Draft;
  terms: EditorTerm[];
  roles: { value: string; label: string }[];
  onChange: (location: LocationRule[][]) => void;
}) {
  const params = locationParamsFor(draft.entities);
  const location = draft.location;
  const everywhere = entitiesText(draft.entities).toLowerCase();

  const valueOptions = (param: string): { value: string; label: string }[] => {
    if (param === "role") return roles;
    if (LOCATION_CHOICES[param]) return [...LOCATION_CHOICES[param]];
    const kind = param === "tag" ? "tag" : "category";
    const many = draft.entities.length > 1;
    const inScope = terms.filter((t) => t.kind === kind && draft.entities.includes(t.entity));
    // A subcategory reads as "Shoes › Sneakers".
    const path = (term: EditorTerm): string => {
      const parent = term.parentId ? inScope.find((t) => t.id === term.parentId) : undefined;
      return parent ? `${path(parent)} › ${term.name}` : term.name;
    };
    return inScope.map((t) => ({
      value: t.id,
      label: `${kind === "tag" ? "#" : ""}${kind === "tag" ? t.name : path(t)}${many ? ` (${FIELD_ENTITIES[t.entity].toLowerCase()})` : ""}`,
    }));
  };

  const edit = (g: number, r: number, next: LocationRule) =>
    onChange(location.map((all, i) => (i === g ? all.map((rule, j) => (j === r ? next : rule)) : all)));
  const remove = (g: number, r: number) =>
    onChange(location.map((all, i) => (i === g ? all.filter((_, j) => j !== r) : all)).filter((all) => all.length > 0));
  const total = location.flat().length;

  return (
    <>
      {location.length === 0 ? (
        <p className="text-sm">No rules: the group is on every one of the {everywhere} it can be on.</p>
      ) : (
        <p className={hint}>
          The group is on a thing when all the rules in one of the groups below hold. Rules in a group are joined by
          “and”, the groups by “or”.
        </p>
      )}
      {location.map((all, g) => (
        <div key={g} className="flex flex-col gap-2">
          {g > 0 && <p className="text-sm font-medium text-muted">or</p>}
          <ul className="flex flex-col gap-2 rounded-md border border-border p-3">
            {all.map((rule, r) => {
              const fits = ruleFits(rule, draft.entities);
              const options = valueOptions(rule.param);
              const name = `Rule ${g + 1}.${r + 1}`;
              return (
                <li key={r} className="flex flex-col gap-1">
                  {r > 0 && <span className="text-xs font-medium text-muted">and</span>}
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label={`${name} asks about`}
                      value={rule.param}
                      onChange={(event) =>
                        edit(g, r, {
                          param: event.target.value,
                          operator: rule.operator,
                          value: startValue(event.target.value),
                        })
                      }
                      className={`${input} min-w-36 flex-1`}
                    >
                      {!fits && <option value={rule.param}>{rule.param}</option>}
                      {params.map((p) => (
                        <option key={p.param} value={p.param}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={`${name} operator`}
                      value={rule.operator}
                      onChange={(event) => edit(g, r, { ...rule, operator: event.target.value === "!=" ? "!=" : "==" })}
                      className={`${input} w-32`}
                    >
                      <option value="==">is</option>
                      <option value="!=">is not</option>
                    </select>
                    <select
                      aria-label={`${name} value`}
                      value={rule.value}
                      onChange={(event) => edit(g, r, { ...rule, value: event.target.value })}
                      className={`${input} min-w-36 flex-1`}
                    >
                      <option value="">{options.length === 0 ? "None to choose from yet" : "Choose …"}</option>
                      {rule.value !== "" && !options.some((o) => o.value === rule.value) && (
                        <option value={rule.value}>A removed one</option>
                      )}
                      {options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className={`${small} text-red-700`}
                      onClick={() => remove(g, r)}
                      aria-label={`Remove ${name}`}
                    >
                      Remove
                    </button>
                  </div>
                  {!fits && (
                    <p role="alert" className="text-xs text-red-700">
                      The kinds of thing chosen above do not have this. Remove the rule, or choose the kind again.
                    </p>
                  )}
                </li>
              );
            })}
            <li>
              <button
                type="button"
                className={small}
                disabled={all.length >= MAX_RULES}
                onClick={() =>
                  onChange(location.map((rules, i) => (i === g ? [...rules, newLocationRule(draft.entities)] : rules)))
                }
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
          disabled={location.length >= MAX_RULES || total >= MAX_RULES * 2}
          onClick={() => onChange([...location, [newLocationRule(draft.entities)]])}
        >
          {location.length === 0 ? "Add a rule" : "Add an “or” group"}
        </button>
        {location.length > 0 && (
          <button type="button" className={small} onClick={() => onChange([])}>
            Remove all rules
          </button>
        )}
      </div>
    </>
  );
}
