"use client";

import { useId, useState, type CSSProperties, type ReactNode } from "react";

import {
  FIELD_POSITIONS,
  fieldShows,
  isEmptyValue,
  localized,
  newRowId,
  readField,
  rowFieldsOf,
  subFieldsOf,
  valuesFor,
  writeField,
  type FieldData,
  type FieldDef,
  type FieldFile,
  type FieldGroup,
  type FieldImage,
  type FieldLayout,
  type FieldLink,
  type FieldLookups,
  type FieldMeasurement,
  type FieldMoney,
  type FieldValue,
  type FieldVideo,
  type Values,
} from "@/lib/custom-fields";
import { moveItem } from "@/lib/field-group-editor";
import { amountText, isMoney, parseAmount } from "@/lib/field-money";
import { EMPTY_DOC, type RichTextDoc } from "@/lib/page-content";
import { shrinkImage } from "@/lib/image-resize";

import { FileField, LinkField, RelationField } from "./field-pickers";
import { editableSubs, ownView, rowLimits, rowsNeeded, withCell, type FieldFileUploader } from "./fields-form-helpers";
import { RichTextEditor } from "./rich-text-editor";

export type { FieldFileUploader };

const input = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm";
const hint = "font-normal text-muted";
const button = "min-h-10 rounded-md border border-border px-3 text-sm";
const small = "min-h-9 min-w-9 rounded border border-border px-2 text-sm disabled:opacity-40";

/** Uploads a picture chosen on the owner's computer (shrunk here first); the host says where it goes. */
export type PictureUpload = (file: File) => Promise<{ url: string; thumbnailUrl: string | null } | { problem: string }>;

/** Shrinks a picture (1600 px and a 480 px copy) and hands both to `send`. */
export async function shrinkAndUpload(
  file: File,
  send: (
    image: File,
    thumbnail: File,
  ) => Promise<{ ok: true; url: string; thumbnailUrl: string | null } | { ok: false; problem: string }>,
): Promise<{ url: string; thumbnailUrl: string | null } | { problem: string }> {
  try {
    const [image, thumbnail] = await Promise.all([shrinkImage(file, 1600), shrinkImage(file, 480)]);
    const ext = image.type === "image/webp" ? "webp" : "jpg";
    const outcome = await send(
      new File([image], `image.${ext}`, { type: image.type }),
      new File([thumbnail], `thumb.${ext}`, { type: thumbnail.type }),
    );
    return outcome.ok ? { url: outcome.url, thumbnailUrl: outcome.thumbnailUrl } : { problem: outcome.problem };
  } catch {
    return { problem: `${file.name} could not be read as a picture. Use a JPEG, PNG, WebP or AVIF.` };
  }
}

/** What every input in the form needs to know: the language, the uploads, and what the store has to choose from. */
type Ctx = {
  locale: string;
  main: string;
  /** The main language's name while another is written (for hints); undefined in the main language. */
  from: string | undefined;
  upload: PictureUpload | null;
  fileUpload: FieldFileUploader | null;
  lookups: FieldLookups;
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const asCells = (v: FieldValue | undefined): Values | undefined => (isRecord(v) ? (v as Values) : undefined);
const asRows = (v: FieldValue | undefined): Values[] => (Array.isArray(v) ? (v as Values[]).filter(isRecord) : []);
const asLink = (v: FieldValue | undefined): FieldLink | undefined => {
  const r: Record<string, unknown> | undefined = isRecord(v) ? v : undefined;
  return r && typeof r.kind === "string" && typeof r.ref === "string" ? (v as FieldLink) : undefined;
};
const asFile = (v: FieldValue | undefined): FieldFile | undefined => {
  const r: Record<string, unknown> | undefined = isRecord(v) ? v : undefined;
  return r && typeof r.url === "string" && typeof r.name === "string" ? (v as FieldFile) : undefined;
};

/**
 * The fields of the groups that apply to a thing (D118), one form for every
 * type of field: used in the product editor, the page editor and the
 * generator's preview. It holds nothing: `data` comes in and every change goes
 * out through `onChange`. Every value is read and written through
 * `readField()`/`writeField()`, which hide how it is kept by language: a text
 * is edited in one language at a time (`locale`), the rest are the same in all;
 * a group's or repeater's own texts are per language, but its rows and other
 * fields are changed in the main language only. A field its logic hides is not
 * drawn (its value is kept).
 */
export function FieldsForm({
  groups,
  data,
  onChange,
  locale,
  main,
  upload,
  fileUpload,
  lookups,
  languageName,
}: {
  /** The groups that apply, in order. */
  groups: FieldGroup[];
  data: FieldData;
  onChange: (next: FieldData) => void;
  /** The language being written, and the store's main one. */
  locale: string;
  main: string;
  upload: PictureUpload | null;
  /** Uploads a file for a file field; null where uploads are not set up. */
  fileUpload: FieldFileUploader | null;
  /** The store's products, pages, categories and tags, for the fields that point at them. */
  lookups: FieldLookups;
  /** A language's name, for the hint on a text left empty. */
  languageName?: (locale: string) => string;
}) {
  if (groups.length === 0) return null;
  const ctx: Ctx = {
    locale,
    main,
    from: locale !== main ? (languageName?.(main) ?? main) : undefined,
    upload,
    fileUpload,
    lookups,
  };
  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <GroupForm key={group.id} group={group} data={data} onChange={onChange} ctx={ctx} />
      ))}
    </div>
  );
}

/** A field's place in its line: as wide as its width says, and the whole line on phones. */
function FieldBox({ width, children }: { width: number | undefined; children: ReactNode }) {
  return (
    <div
      className="w-full min-w-0 md:w-(--field-width)"
      style={{ "--field-width": `calc(${width ?? 100}% - ${width && width < 100 ? "1rem" : "0px"})` } as CSSProperties}
    >
      {children}
    </div>
  );
}

function GroupForm({
  group,
  data,
  onChange,
  ctx,
}: {
  group: FieldGroup;
  data: FieldData;
  onChange: (next: FieldData) => void;
  ctx: Ctx;
}) {
  const { locale, main } = ctx;
  const values = valuesFor(group.fields, data, locale, main);
  const shown = group.fields.filter((def) => fieldShows(def, values));
  // What the language being written holds itself: a text left empty shows empty, with the main language's words as the hint.
  const own = ownView(data, locale, main);

  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-border p-4">
      <legend className="px-1 text-sm font-medium">{group.name}</legend>
      {shown.length === 0 ? (
        <p className="text-sm text-muted">This group has no fields yet.</p>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-4">
          {shown.map((def) => (
            <FieldBox key={def.id} width={def.width}>
              <FieldInput
                def={def}
                value={readField(def, own, locale, main)}
                inherited={locale !== main ? readField(def, data, main, main) : undefined}
                ctx={ctx}
                onChange={(value) => onChange(writeField(def, data, locale, main, value))}
              />
            </FieldBox>
          ))}
        </div>
      )}
      {group.position === "side" && (
        <p className="text-xs text-muted">Shown in the {FIELD_POSITIONS.side.toLowerCase()} on the edit page.</p>
      )}
    </fieldset>
  );
}

/**
 * One field: its label, help and input. `sub` marks a field inside a group or
 * repeater (whose access is its parent's); `row` a cell of a repeater's table,
 * whose label is only for screen readers (the column has it).
 */
function FieldInput({
  def,
  value,
  inherited,
  ctx,
  onChange,
  sub = false,
  row,
}: {
  def: FieldDef;
  value: FieldValue | undefined;
  /** The main language's value while another language is written: a text's is shown as the hint while the language's own is empty. */
  inherited: FieldValue | undefined;
  ctx: Ctx;
  onChange: (value: FieldValue | undefined) => void;
  sub?: boolean;
  row?: number;
}) {
  const id = useId();
  const { locale, upload, fileUpload, lookups } = ctx;
  const inheritedFrom = ctx.from;
  const compact = row !== undefined;
  const label = compact ? (
    <span className="sr-only">
      {def.label}, row {row}
    </span>
  ) : (
    <>
      {def.label}
      {def.required && <span aria-hidden="true"> *</span>}
      {sub || def.access === "public" ? null : <span className={`${hint} ml-1 text-xs`}>(only staff)</span>}
    </>
  );
  const help = def.instructions && !compact ? <span className={`${hint} text-xs`}>{def.instructions}</span> : null;
  const kept =
    inheritedFrom && inherited !== undefined && typeof inherited === "string"
      ? `${inheritedFrom}: ${inherited}`
      : undefined;

  const wrap = (control: ReactNode, forId: string | null = id) => (
    <div className="flex flex-col gap-1 text-sm">
      {forId ? (
        <label htmlFor={forId} className="font-medium">
          {label}
        </label>
      ) : (
        <span className="font-medium">{label}</span>
      )}
      {help}
      {control}
    </div>
  );
  const groupOf = (control: ReactNode) => (
    <fieldset className="flex flex-col gap-1 text-sm">
      <legend className={compact ? "sr-only" : "mb-1 font-medium"}>{label}</legend>
      {help}
      {control}
    </fieldset>
  );

  switch (def.type) {
    case "text":
    case "email":
    case "url":
    case "phone":
      return wrap(
        <input
          id={id}
          type={def.type === "text" ? "text" : def.type === "phone" ? "tel" : def.type}
          lang={def.type === "text" ? locale : undefined}
          maxLength={def.maxLength}
          value={typeof value === "string" ? value : ""}
          placeholder={kept ?? def.placeholder}
          onChange={(event) => onChange(event.target.value)}
          className={input}
        />,
      );
    case "textarea":
      return wrap(
        <textarea
          id={id}
          rows={4}
          lang={locale}
          maxLength={def.maxLength}
          value={typeof value === "string" ? value : ""}
          placeholder={kept ?? def.placeholder}
          onChange={(event) => onChange(event.target.value)}
          className={`${input} py-2`}
        />,
      );
    case "number":
      return wrap(
        <div className="flex items-center gap-2">
          <NumberInput
            id={id}
            value={typeof value === "number" ? value : undefined}
            min={def.min}
            max={def.max}
            placeholder={def.placeholder}
            onChange={onChange}
          />
          {def.unit && <span className="text-muted">{def.unit}</span>}
        </div>,
      );
    case "measurement": {
      const measured = value && typeof value === "object" && "unit" in value ? (value as FieldMeasurement) : undefined;
      const units = def.units ?? [];
      const unit = measured?.unit ?? units[0] ?? "";
      return wrap(
        <div className="flex items-center gap-2">
          <NumberInput
            id={id}
            value={measured?.value}
            min={def.min}
            max={def.max}
            placeholder={def.placeholder}
            onChange={(number) => onChange(typeof number === "number" ? { value: number, unit } : undefined)}
          />
          <select
            aria-label={`${def.label}: unit`}
            value={unit}
            onChange={(event) => measured && onChange({ value: measured.value, unit: event.target.value })}
            className="min-h-10 rounded-md border border-border bg-background px-2 text-sm"
          >
            {units.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>,
      );
    }
    case "money":
      return wrap(
        <MoneyInput
          id={id}
          label={def.label}
          value={isMoney(value) ? value : undefined}
          currencies={lookups.currencies ?? []}
          placeholder={def.placeholder}
          onChange={onChange}
        />,
      );
    case "select":
      return wrap(
        <select
          id={id}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value || undefined)}
          className={input}
        >
          <option value="">Choose …</option>
          {(def.choices ?? []).map((choice) => (
            <option key={choice.key} value={choice.key}>
              {localized(choice.label, choice.labels, locale)}
            </option>
          ))}
        </select>,
      );
    case "radio":
      return groupOf(
        <div className="flex flex-col gap-1">
          {(def.choices ?? []).map((choice) => (
            <label key={choice.key} className="flex items-center gap-2">
              <input type="radio" name={id} checked={value === choice.key} onChange={() => onChange(choice.key)} />
              {localized(choice.label, choice.labels, locale)}
            </label>
          ))}
          {!def.required && value !== undefined && (
            <button type="button" onClick={() => onChange(undefined)} className="w-fit text-xs underline">
              Clear
            </button>
          )}
        </div>,
      );
    case "buttons":
      return groupOf(
        <div role="radiogroup" aria-label={def.label} className="flex flex-wrap gap-2">
          {(def.choices ?? []).map((choice) => (
            <button
              key={choice.key}
              type="button"
              role="radio"
              aria-checked={value === choice.key}
              onClick={() => onChange(value === choice.key && !def.required ? undefined : choice.key)}
              className={`${button} aria-checked:border-foreground aria-checked:bg-foreground aria-checked:text-background`}
            >
              {localized(choice.label, choice.labels, locale)}
            </button>
          ))}
        </div>,
      );
    case "checkbox": {
      const chosen = Array.isArray(value) ? (value as string[]) : [];
      return groupOf(
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {(def.choices ?? []).map((choice) => (
            <label key={choice.key} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={chosen.includes(choice.key)}
                onChange={(event) =>
                  onChange(event.target.checked ? [...chosen, choice.key] : chosen.filter((key) => key !== choice.key))
                }
              />
              {localized(choice.label, choice.labels, locale)}
            </label>
          ))}
        </div>,
      );
    }
    case "boolean":
      return (
        <div className="flex flex-col gap-1 text-sm">
          <label className="flex items-center gap-2 font-medium">
            <input
              type="checkbox"
              checked={value === true}
              onChange={(event) => onChange(event.target.checked ? true : false)}
            />
            {label}
          </label>
          {help}
        </div>
      );
    case "richText":
      return (
        <div className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{label}</span>
          {help}
          {inheritedFrom && inherited !== undefined && value === undefined && (
            <span className={`${hint} text-xs`}>Empty: shoppers see the {inheritedFrom} text.</span>
          )}
          <RichTextEditor
            key={`${def.id}:${locale}`}
            label={def.label}
            value={value && typeof value === "object" && "type" in value ? (value as RichTextDoc) : EMPTY_DOC}
            onChange={(doc) => onChange(doc)}
          />
        </div>
      );
    case "image":
      return groupOf(
        <PictureField def={def} value={value as FieldImage | undefined} onChange={onChange} upload={upload} />,
      );
    case "gallery":
      return groupOf(
        <GalleryField
          def={def}
          value={Array.isArray(value) ? (value as FieldImage[]) : []}
          onChange={onChange}
          upload={upload}
        />,
      );
    case "video": {
      const video = value && typeof value === "object" && "source" in value ? (value as FieldVideo) : undefined;
      return wrap(
        <div className="flex flex-wrap gap-2">
          <select
            aria-label={`${def.label}: service`}
            value={video?.source ?? "youtube"}
            onChange={(event) =>
              onChange({ source: event.target.value as "youtube" | "vimeo", link: video?.link ?? "" })
            }
            className="min-h-10 rounded-md border border-border bg-background px-2 text-sm"
          >
            <option value="youtube">YouTube</option>
            <option value="vimeo">Vimeo</option>
          </select>
          <input
            id={id}
            type="url"
            value={video?.link ?? ""}
            placeholder="Paste the video's address"
            onChange={(event) =>
              onChange(
                event.target.value ? { source: video?.source ?? "youtube", link: event.target.value } : undefined,
              )
            }
            className={`${input} min-w-0 flex-1`}
          />
        </div>,
      );
    }
    case "date":
      return wrap(
        <input
          id={id}
          type="date"
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          className={input}
        />,
      );
    case "time":
      return wrap(
        <input
          id={id}
          type="time"
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          className={input}
        />,
      );
    case "datetime":
      return wrap(
        <input
          id={id}
          type="datetime-local"
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          className={input}
        />,
      );
    case "color":
      return wrap(
        <div className="flex items-center gap-2">
          <input
            id={id}
            type="color"
            value={typeof value === "string" ? value : "#000000"}
            onChange={(event) => onChange(event.target.value)}
            className="h-10 w-14 rounded-md border border-border bg-background p-1"
          />
          <span className="text-muted">{typeof value === "string" ? value : "Not chosen"}</span>
          {typeof value === "string" && (
            <button type="button" onClick={() => onChange(undefined)} className="text-xs underline">
              Clear
            </button>
          )}
        </div>,
      );
    case "link":
      return groupOf(
        <LinkField
          def={def}
          value={asLink(value)}
          inherited={asLink(inherited)}
          inheritedFrom={inheritedFrom}
          lookups={lookups}
          onChange={onChange}
        />,
      );
    case "product":
    case "page":
    case "term":
      return groupOf(<RelationField def={def} value={value} lookups={lookups} onChange={onChange} />);
    case "file":
      return groupOf(<FileField def={def} value={asFile(value)} upload={fileUpload} onChange={onChange} />);
    case "group":
      return (
        <GroupField
          def={def}
          value={asCells(value)}
          inherited={asCells(inherited)}
          ctx={ctx}
          onChange={onChange}
          legend={label}
          help={help}
        />
      );
    case "repeater":
      return (
        <RepeaterField
          def={def}
          rows={asRows(value)}
          inheritedRows={asRows(inherited)}
          ctx={ctx}
          onChange={onChange}
          legend={label}
          help={help}
        />
      );
    case "flexible":
      return (
        <FlexibleField
          def={def}
          rows={asRows(value)}
          inheritedRows={asRows(inherited)}
          ctx={ctx}
          onChange={onChange}
          legend={label}
          help={help}
        />
      );
  }
}

/**
 * The sub fields of a group or one row of a repeater, laid out by their widths.
 * `own` holds what is entered in the language being written, `eff` what a
 * condition sees (the language's own words over the main language's).
 */
function CellFields({
  subs,
  own,
  eff,
  inherited,
  onChange,
  ctx,
}: {
  subs: FieldDef[];
  own: Values;
  eff: Values;
  inherited: Values | undefined;
  onChange: (cells: Values) => void;
  ctx: Ctx;
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-4">
      {subs
        .filter((sub) => fieldShows(sub, eff))
        .map((sub) => (
          <FieldBox key={sub.id} width={sub.width}>
            <FieldInput
              def={sub}
              sub
              value={own[sub.id]}
              inherited={inherited?.[sub.id]}
              ctx={ctx}
              onChange={(value) => onChange(withCell(own, sub.id, value, value === undefined || isEmptyValue(value)))}
            />
          </FieldBox>
        ))}
    </div>
  );
}

/** A group: its sub fields together under its name. Another language writes its texts only. */
function GroupField({
  def,
  value,
  inherited,
  ctx,
  onChange,
  legend,
  help,
}: {
  def: FieldDef;
  value: Values | undefined;
  inherited: Values | undefined;
  ctx: Ctx;
  onChange: (value: FieldValue | undefined) => void;
  legend: ReactNode;
  help: ReactNode;
}) {
  const subs = editableSubs(subFieldsOf(def), ctx.locale, ctx.main);
  const own = value ?? {};
  const eff = ctx.from ? { ...inherited, ...own } : own;
  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3 text-sm">
      <legend className="px-1 font-medium">{legend}</legend>
      {help}
      {ctx.from && (
        <p className={`${hint} text-xs`}>
          {subs.length === 0
            ? `Nothing in it is translated. Change it in ${ctx.from}.`
            : `Only its texts are written per language. The rest is changed in ${ctx.from}.`}
        </p>
      )}
      {subs.length > 0 && (
        <CellFields subs={subs} own={own} eff={eff} inherited={inherited} ctx={ctx} onChange={onChange} />
      )}
    </fieldset>
  );
}

/** The buttons that move and remove a row, each named for the row (reordering is never drag only). */
function RowButtons({
  name,
  index,
  count,
  canRemove,
  onMove,
  onRemove,
}: {
  name: string;
  index: number;
  count: number;
  canRemove: boolean;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label={`Move ${name} up`}
        disabled={index === 0}
        onClick={() => onMove(index - 1)}
        className={small}
      >
        ↑
      </button>
      <button
        type="button"
        aria-label={`Move ${name} down`}
        disabled={index === count - 1}
        onClick={() => onMove(index + 1)}
        className={small}
      >
        ↓
      </button>
      <button
        type="button"
        aria-label={`Remove ${name}`}
        disabled={!canRemove}
        onClick={onRemove}
        className={`${small} px-3 text-xs`}
      >
        Remove
      </button>
    </div>
  );
}

/**
 * A repeater: rows of the same fields, as a table or as blocks. Rows are added,
 * removed and moved in the main language; another language writes the texts in
 * each row, which follow the row wherever it is moved.
 */
function RepeaterField({
  def,
  rows,
  inheritedRows,
  ctx,
  onChange,
  legend,
  help,
}: {
  def: FieldDef;
  rows: Values[];
  inheritedRows: Values[];
  ctx: Ctx;
  onChange: (value: FieldValue | undefined) => void;
  legend: ReactNode;
  help: ReactNode;
}) {
  const [status, setStatus] = useState("");
  const structure = ctx.from === undefined;
  const subs = editableSubs(subFieldsOf(def), ctx.locale, ctx.main);
  const { canAdd, canRemove } = rowLimits(def, rows.length);
  const needed = rowsNeeded(def, rows.length);
  const mainRows = new Map(inheritedRows.map((row) => [String(row.id), row]));
  const table = def.rowLayout === "table";
  const most = Math.min(def.maxRows ?? 100, 100);

  const rowId = (row: Values) => String(row.id);
  const setRow = (id: string, cells: Values) =>
    onChange(rows.map((row) => (rowId(row) === id ? { ...cells, id } : row)));
  const add = () => {
    onChange([...rows, { id: newRowId() }]);
    setStatus(`Row ${rows.length + 1} added.`);
  };
  const remove = (index: number) => {
    onChange(rows.filter((_, i) => i !== index));
    setStatus(`Row ${index + 1} removed.`);
  };
  const move = (from: number, to: number) => {
    onChange(moveItem(rows, from, to));
    setStatus(`Row ${from + 1} moved to place ${to + 1} of ${rows.length}.`);
  };
  const cellsOf = (row: Values) => {
    const inherited = mainRows.get(rowId(row));
    return { own: row, inherited, eff: ctx.from ? { ...inherited, ...row } : row };
  };

  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3 text-sm">
      <legend className="px-1 font-medium">{legend}</legend>
      {help}
      {!structure && (
        <p className={`${hint} text-xs`}>
          {subs.length === 0
            ? `Nothing in its rows is translated. Change them in ${ctx.from}.`
            : `Rows are added, removed and moved in ${ctx.from}. Here you write the texts in them.`}
        </p>
      )}
      {rows.length === 0 ? (
        <p className={`${hint} text-xs`}>{structure ? "No rows yet." : `No rows yet. Add them in ${ctx.from}.`}</p>
      ) : subs.length === 0 ? null : table ? (
        <table className="block w-full border-collapse md:table">
          <thead className="hidden md:table-header-group">
            <tr>
              <th scope="col" className="w-8 p-1 text-left text-xs font-medium text-muted">
                <span className="sr-only">Row</span>
              </th>
              {subs.map((sub) => (
                <th key={sub.id} scope="col" className="p-1 text-left text-xs font-medium">
                  {sub.label}
                  {sub.required && <span aria-hidden="true"> *</span>}
                </th>
              ))}
              {structure && (
                <th scope="col" className="p-1 text-left text-xs font-medium">
                  <span className="sr-only">Row actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="block md:table-row-group">
            {rows.map((row, index) => {
              const { own, inherited, eff } = cellsOf(row);
              return (
                <tr
                  key={rowId(row)}
                  className="mb-3 block rounded-md border border-border p-2 md:mb-0 md:table-row md:rounded-none md:border-0 md:p-0"
                >
                  <td className="block p-1 text-xs text-muted md:table-cell md:align-top md:pt-3">
                    <span className="md:hidden">Row </span>
                    {index + 1}
                  </td>
                  {subs.map((sub) => {
                    const shown = fieldShows(sub, eff);
                    return (
                      <td
                        key={sub.id}
                        className={`p-1 align-top ${shown ? "block md:table-cell" : "hidden md:table-cell"}`}
                      >
                        {shown && (
                          <>
                            <span aria-hidden="true" className="mb-1 block text-xs font-medium md:hidden">
                              {sub.label}
                            </span>
                            <FieldInput
                              def={sub}
                              sub
                              row={index + 1}
                              value={own[sub.id]}
                              inherited={inherited?.[sub.id]}
                              ctx={ctx}
                              onChange={(value) =>
                                setRow(
                                  rowId(row),
                                  withCell(own, sub.id, value, value === undefined || isEmptyValue(value)),
                                )
                              }
                            />
                          </>
                        )}
                      </td>
                    );
                  })}
                  {structure && (
                    <td className="block p-1 md:table-cell md:align-top">
                      <RowButtons
                        name={`row ${index + 1} of ${def.label}`}
                        index={index}
                        count={rows.length}
                        canRemove={canRemove}
                        onMove={(to) => move(index, to)}
                        onRemove={() => remove(index)}
                      />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <ol className="flex flex-col gap-3">
          {rows.map((row, index) => {
            const { own, inherited, eff } = cellsOf(row);
            return (
              <li key={rowId(row)} className="flex flex-col gap-3 rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted">Row {index + 1}</span>
                  {structure && (
                    <RowButtons
                      name={`row ${index + 1} of ${def.label}`}
                      index={index}
                      count={rows.length}
                      canRemove={canRemove}
                      onMove={(to) => move(index, to)}
                      onRemove={() => remove(index)}
                    />
                  )}
                </div>
                <CellFields
                  subs={subs}
                  own={own}
                  eff={eff}
                  inherited={inherited}
                  ctx={ctx}
                  onChange={(cells) => setRow(rowId(row), cells)}
                />
              </li>
            );
          })}
        </ol>
      )}
      {structure && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={add} disabled={!canAdd} className={button}>
            {def.buttonLabel || "Add row"}
          </button>
          {!canAdd && (
            <span className={`${hint} text-xs`}>
              The most is {most} {most === 1 ? "row" : "rows"}.
            </span>
          )}
        </div>
      )}
      {needed && <p className="text-xs text-red-700 dark:text-red-400">{needed}</p>}
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
    </fieldset>
  );
}

/**
 * Flexible content: rows that each take one of the layouts the owner defined,
 * added by choosing a layout, moved and removed like a repeater's rows (in the
 * main language only). Another language writes the texts in each row, which
 * follow the row wherever it is moved. A row shows its layout's fields.
 */
function FlexibleField({
  def,
  rows,
  inheritedRows,
  ctx,
  onChange,
  legend,
  help,
}: {
  def: FieldDef;
  rows: Values[];
  inheritedRows: Values[];
  ctx: Ctx;
  onChange: (value: FieldValue | undefined) => void;
  legend: ReactNode;
  help: ReactNode;
}) {
  const [status, setStatus] = useState("");
  const [choosing, setChoosing] = useState(false);
  const structure = ctx.from === undefined;
  const layouts = def.layouts ?? [];
  const { canAdd, canRemove } = rowLimits(def, rows.length);
  const needed = rowsNeeded(def, rows.length);
  const mainRows = new Map(inheritedRows.map((row) => [String(row.id), row]));
  const most = Math.min(def.maxRows ?? 100, 100);
  const layoutName = (layout: FieldLayout) => localized(layout.label, layout.labels, ctx.locale);

  const rowId = (row: Values) => String(row.id);
  const setRow = (id: string, cells: Values, layout: unknown) =>
    onChange(rows.map((row) => (rowId(row) === id ? { ...cells, id, layout: String(layout) } : row)));
  const add = (layout: FieldLayout) => {
    onChange([...rows, { id: newRowId(), layout: layout.key }]);
    setChoosing(false);
    setStatus(`Row ${rows.length + 1} added, ${layoutName(layout)}.`);
  };
  const remove = (index: number) => {
    onChange(rows.filter((_, i) => i !== index));
    setStatus(`Row ${index + 1} removed.`);
  };
  const move = (from: number, to: number) => {
    onChange(moveItem(rows, from, to));
    setStatus(`Row ${from + 1} moved to place ${to + 1} of ${rows.length}.`);
  };

  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3 text-sm">
      <legend className="px-1 font-medium">{legend}</legend>
      {help}
      {!structure && (
        <p className={`${hint} text-xs`}>
          {`Rows are added, removed and moved in ${ctx.from}. Here you write the texts in them.`}
        </p>
      )}
      {rows.length === 0 ? (
        <p className={`${hint} text-xs`}>{structure ? "No rows yet." : `No rows yet. Add them in ${ctx.from}.`}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {rows.map((row, index) => {
            const layout = def.layouts?.find((l) => l.key === row.layout);
            const fields = rowFieldsOf(def, row);
            if (!layout || fields === null) return null;
            const subs = editableSubs(fields, ctx.locale, ctx.main);
            const inherited = mainRows.get(rowId(row));
            const eff = ctx.from ? { ...inherited, ...row } : row;
            return (
              <li key={rowId(row)} className="flex flex-col gap-3 rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted">
                    Row {index + 1}: {layoutName(layout)}
                  </span>
                  {structure && (
                    <RowButtons
                      name={`row ${index + 1} (${layoutName(layout)}) of ${def.label}`}
                      index={index}
                      count={rows.length}
                      canRemove={canRemove}
                      onMove={(to) => move(index, to)}
                      onRemove={() => remove(index)}
                    />
                  )}
                </div>
                {subs.length === 0 ? (
                  <p className={`${hint} text-xs`}>Nothing in this layout is translated. Change it in {ctx.from}.</p>
                ) : (
                  <CellFields
                    subs={subs}
                    own={row}
                    eff={eff}
                    inherited={inherited}
                    ctx={ctx}
                    onChange={(cells) => setRow(rowId(row), cells, row.layout)}
                  />
                )}
              </li>
            );
          })}
        </ol>
      )}
      {structure && (
        <div className="flex flex-col items-start gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => (layouts.length === 1 ? add(layouts[0]) : setChoosing((open) => !open))}
              disabled={!canAdd || layouts.length === 0}
              aria-expanded={layouts.length > 1 ? choosing : undefined}
              className={button}
            >
              {def.buttonLabel || "Add row"}
            </button>
            {!canAdd && (
              <span className={`${hint} text-xs`}>
                The most is {most} {most === 1 ? "row" : "rows"}.
              </span>
            )}
          </div>
          {choosing && canAdd && (
            <div role="group" aria-label={`Choose a layout for the new row of ${def.label}`} className="flex flex-wrap gap-2">
              {layouts.map((layout) => (
                <button key={layout.key} type="button" onClick={() => add(layout)} className={button}>
                  {layoutName(layout)}
                </button>
              ))}
              <button type="button" onClick={() => setChoosing(false)} className={`${button} text-muted`}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
      {needed && <p className="text-xs text-red-700 dark:text-red-400">{needed}</p>}
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
    </fieldset>
  );
}

/**
 * An amount of money: the amount typed with the currency's decimals (a comma
 * works too) and a currency chosen among those the store offers, its main one
 * first. Kept as whole minor units, so nothing is ever rounded in a float.
 */
function MoneyInput({
  id,
  label,
  value,
  currencies,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: FieldMoney | undefined;
  currencies: string[];
  placeholder?: string;
  onChange: (value: FieldMoney | undefined) => void;
}) {
  const key = value ? `${value.amountMinor}|${value.currency}` : "";
  const [text, setText] = useState(value ? amountText(value.amountMinor, value.currency) : "");
  const [currency, setCurrency] = useState(value?.currency ?? currencies[0] ?? "");
  // A value changed from outside (another language, an import) replaces what was typed.
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    setSeen(key);
    if (value) {
      setText(amountText(value.amountMinor, value.currency));
      setCurrency(value.currency);
    } else if (parseAmount(text, currency) !== null) {
      setText("");
    }
  }
  // A saved currency the store no longer offers stays in the list, so what was entered is still shown as it is.
  const options = currency !== "" && !currencies.includes(currency) ? [currency, ...currencies] : currencies;
  const minor = text.trim() === "" ? null : parseAmount(text, currency);
  const invalid = text.trim() !== "" && minor === null;
  const problemId = `${id}-problem`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={text}
          placeholder={placeholder ?? "0.00"}
          aria-invalid={invalid}
          aria-describedby={invalid ? problemId : undefined}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            if (next.trim() === "") onChange(undefined);
            else {
              const parsed = parseAmount(next, currency);
              if (parsed !== null && currency !== "") onChange({ amountMinor: parsed, currency });
            }
          }}
          className={input}
        />
        <select
          aria-label={`${label}: currency`}
          value={currency}
          disabled={options.length === 0}
          onChange={(event) => {
            const next = event.target.value;
            setCurrency(next);
            const parsed = parseAmount(text, next);
            if (parsed !== null) onChange({ amountMinor: parsed, currency: next });
          }}
          className="min-h-10 rounded-md border border-border bg-background px-2 text-sm"
        >
          {options.length === 0 && <option value="">No currency</option>}
          {options.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </div>
      {invalid && (
        <p id={problemId} role="alert" className="text-xs text-red-700 dark:text-red-400">
          Write an amount of zero or more with at most as many decimals as {currency || "the currency"} has.
        </p>
      )}
    </div>
  );
}

/** A number typed as the person likes (a comma too); it is passed on once it is a number, and kept as typed until then. */
function NumberInput({
  id,
  value,
  min,
  max,
  placeholder,
  onChange,
}: {
  id: string;
  value: number | undefined;
  min?: number;
  max?: number;
  placeholder?: string;
  onChange: (value: number | undefined) => void;
}) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  // A value changed from outside (another language, an import) replaces what was typed.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    if (value !== Number(text.replace(",", ".")) || (value === undefined && text !== ""))
      setText(value === undefined ? "" : String(value));
  }
  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      value={text}
      placeholder={placeholder ?? (min !== undefined || max !== undefined ? `${min ?? ""}–${max ?? ""}` : undefined)}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        const number = Number(next.trim().replace(",", "."));
        if (next.trim() === "") onChange(undefined);
        else if (Number.isFinite(number)) onChange(number);
      }}
      className={input}
    />
  );
}

function PictureField({
  def,
  value,
  onChange,
  upload,
}: {
  def: FieldDef;
  value: FieldImage | undefined;
  onChange: (value: FieldImage | undefined) => void;
  upload: PictureUpload | null;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const alt = useId();
  const choose = async (file: File | undefined) => {
    if (!file || !upload) return;
    setBusy(true);
    setProblem(null);
    const outcome = await upload(file);
    setBusy(false);
    if ("problem" in outcome) setProblem(outcome.problem);
    else onChange({ url: outcome.url, thumbnailUrl: outcome.thumbnailUrl, alt: value?.alt ?? "" });
  };
  return (
    <div className="flex flex-col gap-2">
      {def.instructions && <span className={`${hint} text-xs`}>{def.instructions}</span>}
      {value && (
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- the admin shows the owner's own upload as it is */}
          <img
            src={value.thumbnailUrl ?? value.url}
            alt=""
            className="size-20 rounded-md border border-border object-cover"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor={alt} className="text-xs font-medium">
              Description for people who cannot see it
            </label>
            <input
              id={alt}
              value={value.alt}
              onChange={(event) => onChange({ ...value, alt: event.target.value })}
              className={input}
              maxLength={300}
            />
            <button type="button" onClick={() => onChange(undefined)} className="w-fit text-xs underline">
              Remove
            </button>
          </div>
        </div>
      )}
      <PictureButton
        busy={busy}
        disabled={!upload}
        label={value ? "Change picture" : "Choose picture"}
        onFile={choose}
      />
      {!upload && <p className="text-xs text-muted">Uploads are not set up on this server.</p>}
      {problem && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {problem}
        </p>
      )}
    </div>
  );
}

function GalleryField({
  def,
  value,
  onChange,
  upload,
}: {
  def: FieldDef;
  value: FieldImage[];
  onChange: (value: FieldImage[] | undefined) => void;
  upload: PictureUpload | null;
}) {
  const [busy, setBusy] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const most = def.maxItems ?? 20;
  const add = async (files: FileList | null) => {
    if (!files || !upload) return;
    setProblem(null);
    let next = value;
    for (const file of Array.from(files).slice(0, most - value.length)) {
      setBusy((n) => n + 1);
      const outcome = await upload(file);
      setBusy((n) => n - 1);
      if ("problem" in outcome) {
        setProblem(outcome.problem);
        break;
      }
      next = [...next, { url: outcome.url, thumbnailUrl: outcome.thumbnailUrl, alt: "" }];
      onChange(next);
    }
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= value.length) return;
    const next = [...value];
    next.splice(to, 0, next.splice(from, 1)[0]);
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-2">
      {def.instructions && <span className={`${hint} text-xs`}>{def.instructions}</span>}
      {value.length > 0 && (
        <ul className="flex flex-col gap-2">
          {value.map((image, index) => (
            <li key={`${image.url}:${index}`} className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- the admin shows the owner's own upload as it is */}
              <img
                src={image.thumbnailUrl ?? image.url}
                alt=""
                className="size-14 rounded-md border border-border object-cover"
              />
              <input
                aria-label={`Description of picture ${index + 1}`}
                value={image.alt}
                maxLength={300}
                placeholder="Description"
                onChange={(event) =>
                  onChange(value.map((v, i) => (i === index ? { ...v, alt: event.target.value } : v)))
                }
                className={`${input} min-w-0 flex-1`}
              />
              <button
                type="button"
                aria-label={`Move picture ${index + 1} up`}
                disabled={index === 0}
                onClick={() => move(index, index - 1)}
                className="min-h-9 min-w-9 rounded border border-border text-sm disabled:opacity-40"
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`Move picture ${index + 1} down`}
                disabled={index === value.length - 1}
                onClick={() => move(index, index + 1)}
                className="min-h-9 min-w-9 rounded border border-border text-sm disabled:opacity-40"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => onChange(value.filter((_, i) => i !== index))}
                className="text-xs underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {value.length < most && (
        <PictureButton busy={busy > 0} disabled={!upload} label="Add pictures" multiple onFiles={add} />
      )}
      {value.length >= most && <p className="text-xs text-muted">The gallery is full ({most} pictures).</p>}
      {problem && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {problem}
        </p>
      )}
    </div>
  );
}

function PictureButton({
  label,
  busy,
  disabled,
  multiple,
  onFile,
  onFiles,
}: {
  label: string;
  busy: boolean;
  disabled: boolean;
  multiple?: boolean;
  onFile?: (file: File | undefined) => void;
  onFiles?: (files: FileList | null) => void;
}) {
  return (
    <label
      className={`w-fit cursor-pointer rounded-md border border-border px-3 py-2 text-sm focus-within:outline-2 ${disabled ? "opacity-50" : ""}`}
    >
      {busy ? "Uploading …" : label}
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp,image/avif"
        multiple={multiple}
        disabled={disabled || busy}
        className="sr-only"
        onChange={(event) => {
          if (onFiles) onFiles(event.target.files);
          else onFile?.(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </label>
  );
}
