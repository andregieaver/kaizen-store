"use client";

import { useId, useState, type CSSProperties, type ReactNode } from "react";

import {
  FIELD_POSITIONS,
  fieldShows,
  isEmptyValue,
  isTranslatable,
  localized,
  valuesFor,
  type FieldData,
  type FieldDef,
  type FieldGroup,
  type FieldImage,
  type FieldMeasurement,
  type FieldValue,
} from "@/lib/custom-fields";
import { EMPTY_DOC, type RichTextDoc } from "@/lib/page-content";
import { shrinkImage } from "@/lib/image-resize";

import { RichTextEditor } from "./rich-text-editor";

const input = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm";
const hint = "font-normal text-muted";
const button = "min-h-10 rounded-md border border-border px-3 text-sm";

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

/**
 * The fields of the groups that apply to a thing (D118), one form for every
 * type of field: used in the product editor, the page editor and the
 * generator's preview. It holds nothing: `data` comes in and every change goes
 * out through `onChange`. A text is edited in one language at a time
 * (`locale`), the rest are the same in all; a field its logic hides is not
 * drawn (its value is kept).
 */
export function FieldsForm({
  groups,
  data,
  onChange,
  locale,
  main,
  upload,
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
  /** A language's name, for the hint on a text left empty. */
  languageName?: (locale: string) => string;
}) {
  if (groups.length === 0) return null;
  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <GroupForm
          key={group.id}
          group={group}
          data={data}
          onChange={onChange}
          locale={locale}
          main={main}
          upload={upload}
          languageName={languageName}
        />
      ))}
    </div>
  );
}

function GroupForm({
  group,
  data,
  onChange,
  locale,
  main,
  upload,
  languageName,
}: {
  group: FieldGroup;
  data: FieldData;
  onChange: (next: FieldData) => void;
  locale: string;
  main: string;
  upload: PictureUpload | null;
  languageName?: (locale: string) => string;
}) {
  const values = valuesFor(group.fields, data, locale, main);
  const shown = group.fields.filter((def) => fieldShows(def, values));

  const set = (def: FieldDef, value: FieldValue | undefined) => {
    const empty = value === undefined || isEmptyValue(value);
    if (isTranslatable(def.type)) {
      const own = { ...(data.translations[locale] ?? {}) };
      if (empty) delete own[def.id];
      else own[def.id] = value;
      onChange({ ...data, translations: { ...data.translations, [locale]: own } });
    } else {
      const next = { ...data.values };
      if (empty) delete next[def.id];
      else next[def.id] = value;
      onChange({ ...data, values: next });
    }
  };

  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-border p-4">
      <legend className="px-1 text-sm font-medium">{group.name}</legend>
      {shown.length === 0 ? (
        <p className="text-sm text-muted">This group has no fields yet.</p>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-4">
          {shown.map((def) => {
            const own = isTranslatable(def.type) ? data.translations[locale]?.[def.id] : data.values[def.id];
            const inherited =
              isTranslatable(def.type) && locale !== main ? data.translations[main]?.[def.id] : undefined;
            return (
              <div
                key={def.id}
                className="w-full min-w-0 md:w-(--field-width)"
                style={
                  {
                    "--field-width": `calc(${def.width ?? 100}% - ${def.width && def.width < 100 ? "1rem" : "0px"})`,
                  } as CSSProperties
                }
              >
                <FieldInput
                  def={def}
                  value={own}
                  inherited={inherited}
                  inheritedFrom={locale !== main ? (languageName?.(main) ?? main) : undefined}
                  locale={locale}
                  onChange={(value) => set(def, value)}
                  upload={upload}
                />
              </div>
            );
          })}
        </div>
      )}
      {group.position === "side" && (
        <p className="text-xs text-muted">Shown in the {FIELD_POSITIONS.side.toLowerCase()} on the edit page.</p>
      )}
    </fieldset>
  );
}

/** One field: its label, help and input. */
function FieldInput({
  def,
  value,
  inherited,
  inheritedFrom,
  locale,
  onChange,
  upload,
}: {
  def: FieldDef;
  value: FieldValue | undefined;
  /** A text's value in the main language, shown as the hint while the language's own is empty. */
  inherited: FieldValue | undefined;
  inheritedFrom: string | undefined;
  locale: string;
  onChange: (value: FieldValue | undefined) => void;
  upload: PictureUpload | null;
}) {
  const id = useId();
  const label = (
    <>
      {def.label}
      {def.required && <span aria-hidden="true"> *</span>}
      {def.access === "public" ? null : <span className={`${hint} ml-1 text-xs`}>(only staff)</span>}
    </>
  );
  const help = def.instructions ? <span className={`${hint} text-xs`}>{def.instructions}</span> : null;
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
      <legend className="mb-1 font-medium">{label}</legend>
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
      const video = value && typeof value === "object" && "source" in value ? value : undefined;
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
  }
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
