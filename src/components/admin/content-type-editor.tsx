"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";

import { useAdminText } from "@/components/admin/admin-text";
import { CARD_CLASS } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import {
  PICTURE_TYPES,
  SUMMARY_TYPES,
  TITLE_TYPES,
  typeSlugOf,
  typeAsGroup,
  type ContentAction,
  type ContentTypeInput,
} from "@/lib/content-types";
import {
  EMPTY_DATA,
  EMPTY_LOOKUPS,
  MAX_GROUP_FIELDS,
  newField,
  subFieldsOf,
  type FieldData,
  type FieldDef,
  type FieldType,
} from "@/lib/custom-fields";
import {
  duplicateField,
  fieldsWithBrokenLogic,
  moveItem,
  pruneConditions,
} from "@/lib/field-group-editor";

import { FieldEditorDialog, type FieldLanguage } from "./field-editor-dialog";
import { FieldList } from "./field-group-editor";
import { FieldTypePicker } from "./field-type-picker";
import { FieldsForm } from "./fields-form";

const input =
  "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm font-normal";
const label = "flex flex-col gap-1 text-sm";
const hint = "text-xs font-normal text-muted";
const card = `flex flex-col gap-4 p-5 ${CARD_CLASS}`;

/**
 * A content type (D326): its name and web name, its fields (the field group editor's list, picker and dialog, D118), which fields are
 * its title, summary and picture, and whether its entries have pages; with a live preview of the form an entry gets. The whole type is
 * held here until Save and sent as one JSON, checked again by the server.
 */
export function ContentTypeEditor({
  initial,
  languages,
  currencies,
  fixedSlug,
  save,
  base,
  actions,
}: {
  initial: ContentTypeInput;
  /** The site's languages, the main one first. */
  languages: FieldLanguage[];
  /** The currencies the store offers, for a money field in the preview. */
  currencies?: string[];
  /** The web name can no longer change (an entry has been published). */
  fixedSlug: boolean;
  save: ContentAction<ContentTypeInput>;
  /** Content's address (`/admin/{store}/content`). */
  base: string;
  actions?: ReactNode;
}) {
  const all = useAdminText("content");
  const fw = useAdminText("fields");
  const w = all.type;
  const router = useRouter();
  const [draft, setDraft] = useState<ContentTypeInput>(initial);
  const [dirty, setDirty] = useState(false);
  const [slugFollows, setSlugFollows] = useState(initial.id === null);
  const [problems, setProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [saving, startSaving] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(
    new Set(initial.id === null ? initial.fields.map((f) => f.id) : []),
  );
  const [announcement, setAnnouncement] = useState("");
  const [preview, setPreview] = useState<FieldData>(EMPTY_DATA);
  const problemsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const fields = draft.fields as FieldDef[];
  const names = fields.map((f) => f.name);
  const change = (next: (type: ContentTypeInput) => ContentTypeInput) => {
    setDraft(next);
    setDirty(true);
    setSaved(false);
  };
  const setFields = (next: FieldDef[], message?: string) => {
    change((t) => ({ ...t, fields: next }));
    if (message) setAnnouncement(message);
  };
  const markFresh = (ids: string[]) =>
    setFresh((current) => new Set([...current, ...ids]));

  const addField = (type: FieldType) => {
    // An entry's fields are its content: shown on the site unless the owner says otherwise.
    const created: FieldDef = { ...newField(type, names), access: "public" };
    markFresh([created.id, ...subFieldsOf(created).map((sub) => sub.id)]);
    setFields(
      [...fields, created],
      fillWords(w.added, { type: fw.types[type].label }),
    );
    setPicking(false);
    setEditing(created.id);
  };
  const removeField = (id: string) => {
    const field = fields.find((f) => f.id === id);
    if (!field) return;
    if (
      !fresh.has(id) &&
      !window.confirm(fillWords(w.confirmRemove, { label: field.label }))
    )
      return;
    const pruned = pruneConditions(fields.filter((f) => f.id !== id));
    change((t) => ({
      ...t,
      fields: pruned.fields,
      summaryField: t.summaryField === id ? null : t.summaryField,
      pictureField: t.pictureField === id ? null : t.pictureField,
    }));
    setAnnouncement(fillWords(w.removed, { label: field.label }));
  };
  const copyField = (id: string) => {
    const result = duplicateField(fields, id);
    if (!result) return;
    markFresh([
      result.copy.id,
      ...subFieldsOf(result.copy).map((sub) => sub.id),
    ]);
    setFields(result.fields);
    setEditing(result.copy.id);
  };
  const moveField = (from: number, to: number) => {
    if (to < 0 || to >= fields.length || from === to) return;
    setFields(
      moveItem(fields, from, to),
      fillWords(w.moved, {
        label: fields[from].label,
        to: to + 1,
        total: fields.length,
      }),
    );
  };

  const submit = () => {
    setSaved(false);
    startSaving(async () => {
      const result = await save(draft);
      if (result.ok) {
        setProblems([]);
        setDirty(false);
        setFresh(new Set());
        if (draft.id === null && result.id)
          router.replace(`${base}/${result.id}`);
        else {
          setSaved(true);
          router.refresh();
        }
      } else {
        setProblems(result.problems);
        problemsRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      }
    });
  };

  const editingIndex = editing ? fields.findIndex((f) => f.id === editing) : -1;
  const editingField = editingIndex >= 0 ? fields[editingIndex] : null;
  const ofTypes = (types: readonly FieldType[]) =>
    fields.filter((f) => types.includes(f.type));
  const main = languages[0]?.locale ?? "en";
  const previewGroup = typeAsGroup({
    id: draft.id ?? "preview",
    name: draft.name || w.untitled,
    slug: draft.slug,
    fields,
  });

  const roleSelect = (
    key: "titleField" | "summaryField" | "pictureField",
    text: string,
    help: string,
    types: readonly FieldType[],
    optional: boolean,
  ) => (
    <div className={label}>
      <label htmlFor={`type-${key}`}>{text}</label>
      <select
        id={`type-${key}`}
        aria-describedby={`type-${key}-hint`}
        value={draft[key] ?? ""}
        onChange={(event) =>
          change((t) => ({ ...t, [key]: event.target.value || null }))
        }
        className={input}
      >
        {optional && <option value="">{w.none}</option>}
        {!optional && !ofTypes(types).some((f) => f.id === draft[key]) && (
          <option value="">—</option>
        )}
        {ofTypes(types).map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>
      <span id={`type-${key}-hint`} className={hint}>
        {help}
      </span>
    </div>
  );

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
            <div
              role="alert"
              className="rounded-lg border border-danger-line bg-danger-soft p-4 text-sm text-danger-text"
            >
              <p>{w.fixFirst}</p>
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

        <section aria-labelledby="type-heading" className={card}>
          <h2 id="type-heading" className="text-title text-ink">
            {w.theType}
          </h2>
          <div className={label}>
            <label htmlFor="type-name">{w.name}</label>
            <input
              id="type-name"
              aria-describedby="type-name-hint"
              value={draft.name}
              onChange={(event) => {
                const name = event.target.value;
                change((t) => ({
                  ...t,
                  name,
                  ...(slugFollows && !fixedSlug && { slug: typeSlugOf(name) }),
                }));
              }}
              required
              maxLength={80}
              className={input}
            />
            <span id="type-name-hint" className={hint}>
              {w.nameHint}
            </span>
          </div>
          <div className={label}>
            <label htmlFor="type-slug">{w.webName}</label>
            <input
              id="type-slug"
              aria-describedby="type-slug-hint"
              value={draft.slug}
              onChange={(event) => {
                setSlugFollows(false);
                change((t) => ({ ...t, slug: event.target.value }));
              }}
              readOnly={fixedSlug}
              required
              maxLength={60}
              className={`${input} font-mono`}
            />
            <span id="type-slug-hint" className={hint}>
              {fixedSlug
                ? w.webNameFixed
                : fillWords(w.webNameHint, { slug: draft.slug || "…" })}
            </span>
          </div>
          <div className="flex items-start gap-3 text-sm">
            <input
              id="type-pages"
              aria-describedby="type-pages-hint"
              type="checkbox"
              checked={draft.hasPages}
              onChange={(event) =>
                change((t) => ({ ...t, hasPages: event.target.checked }))
              }
              className="mt-0.5 size-4"
            />
            <span>
              <label htmlFor="type-pages" className="text-body-strong">
                {w.pages}
              </label>
              <span id="type-pages-hint" className={`block ${hint}`}>
                {fillWords(w.pagesHint, { slug: draft.slug || "…" })}
              </span>
            </span>
          </div>
        </section>

        <section aria-labelledby="fields-heading" className={card}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="fields-heading" className="text-title text-ink">
              {w.fields} <span className="text-muted">({fields.length})</span>
            </h2>
            <button
              type="button"
              onClick={() => setPicking(true)}
              disabled={fields.length >= MAX_GROUP_FIELDS}
              className="min-h-10 rounded-pill bg-brand px-4 text-sm text-brand-ink disabled:opacity-50"
            >
              {w.addField}
            </button>
          </div>
          {fields.length === 0 ? (
            <p className="rounded-panel border border-dashed border-line p-6 text-center text-sm text-muted">
              {w.noFields}
            </p>
          ) : (
            <FieldList
              fields={fields}
              broken={fieldsWithBrokenLogic(fields)}
              onReorder={moveField}
              onEdit={(id) => setEditing(id)}
              onCopy={copyField}
              onRemove={removeField}
            />
          )}
          <p className={hint}>{w.orderHint}</p>
        </section>

        <section aria-labelledby="roles-heading" className={card}>
          <h2 id="roles-heading" className="text-title text-ink">
            {w.roles}
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            {roleSelect(
              "titleField",
              w.titleField,
              w.titleHint,
              TITLE_TYPES,
              false,
            )}
            {roleSelect(
              "summaryField",
              w.summaryField,
              w.summaryHint,
              SUMMARY_TYPES,
              true,
            )}
            {roleSelect(
              "pictureField",
              w.pictureField,
              w.pictureHint,
              PICTURE_TYPES,
              true,
            )}
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="min-h-11 rounded-pill bg-brand px-5 text-brand-ink disabled:opacity-50"
          >
            {saving ? w.saving : w.save}
          </button>
          <span role="status" className="text-sm text-muted">
            {saved && !dirty ? w.saved : dirty ? w.unsaved : ""}
          </span>
        </div>
        {actions}
      </form>

      <aside
        aria-labelledby="preview-heading"
        className="min-w-0 xl:sticky xl:top-4 xl:self-start"
      >
        <div className={card}>
          <div>
            <h2 id="preview-heading" className="text-title text-ink">
              {w.preview}
            </h2>
            <p className={hint}>{w.previewHint}</p>
          </div>
          <FieldsForm
            groups={[previewGroup]}
            data={preview}
            onChange={setPreview}
            locale={main}
            main={main}
            upload={null}
            fileUpload={null}
            lookups={
              currencies ? { ...EMPTY_LOOKUPS, currencies } : EMPTY_LOOKUPS
            }
          />
        </div>
      </aside>

      <FieldTypePicker
        open={picking}
        onClose={() => setPicking(false)}
        onPick={addField}
      />
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
            fillWords(w.updated, { label: next.label }),
          );
          setEditing(null);
        }}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}
