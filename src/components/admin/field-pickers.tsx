"use client";

import { useId, useState } from "react";

import { useAdminText } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";

import {
  LINK_KINDS,
  MAX_RELATED,
  type FieldDef,
  type FieldFile,
  type FieldLink,
  type FieldLookups,
  type FieldValue,
  type LinkKind,
} from "@/lib/custom-fields";
import { fileSize } from "@/lib/file-size";
import { moveItem } from "@/lib/field-group-editor";

import {
  FIELD_FILE_ACCEPT_TYPES,
  fileProblem,
  filterOptions,
  idsOf,
  linkOptions,
  relationOptions,
  relationValue,
  type FieldFileUploader,
  type PickOption,
} from "./fields-form-helpers";

/**
 * The inputs of the entry form (D118) that choose something the store has,
 * or hold something uploaded: links, products, pages, categories and tags,
 * and files.
 */

const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";
const hint = "font-normal text-muted";
const small = "min-h-9 min-w-9 rounded border border-line px-2 text-sm disabled:opacity-40";

/** One of a list, with a search box above it to narrow the list down. */
function SingleSelect({
  label,
  options,
  value,
  onChange,
}: {
  /** What the field is called, for the search box's and the list's names. */
  label: string;
  options: readonly PickOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  const w = useAdminText("fields").pickers;
  const [query, setQuery] = useState("");
  const matches = filterOptions(options, query);
  const missing = value !== "" && !options.some((option) => option.id === value);
  const shown = value !== "" ? [...matches, ...options.filter((o) => o.id === value && !matches.includes(o))] : matches;
  if (options.length === 0 && value === "") return <p className={`${hint} text-xs`}>{w.nothing}</p>;
  return (
    <div className="flex flex-col gap-1">
      {options.length > 8 && (
        <input
          type="search"
          aria-label={fillWords(w.searchLabel, { label })}
          placeholder={w.search}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className={input}
        />
      )}
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className={input}>
        <option value="">{w.none}</option>
        {missing && <option value={value}>{w.removedOne}</option>}
        {shown.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      {query.trim() !== "" && matches.length === 0 && <p className={`${hint} text-xs`}>{w.noMatch}</p>}
    </div>
  );
}

/** Several of a list, kept in the order chosen: the chosen ones with buttons to order and remove them, and a search and list to add more. */
function MultiSelect({
  label,
  options,
  ids,
  onChange,
}: {
  label: string;
  options: readonly PickOption[];
  ids: string[];
  onChange: (ids: string[]) => void;
}) {
  const w = useAdminText("fields").pickers;
  const [query, setQuery] = useState("");
  const [pick, setPick] = useState("");
  const [status, setStatus] = useState("");
  const names = new Map(options.map((option) => [option.id, option.label]));
  const free = options.filter((option) => !ids.includes(option.id));
  const matches = filterOptions(free, query);
  const full = ids.length >= MAX_RELATED;
  const add = () => {
    if (pick === "" || full) return;
    onChange([...ids, pick]);
    setStatus(fillWords(w.added, { name: names.get(pick) ?? w.anItem }));
    setPick("");
  };
  const move = (from: number, to: number) => {
    onChange(moveItem(ids, from, to));
    setStatus(fillWords(w.moved, { name: names.get(ids[from]) ?? w.anItem, to: to + 1, total: ids.length }));
  };
  return (
    <div className="flex flex-col gap-2">
      {ids.length > 0 && (
        <ol aria-label={fillWords(w.chosen, { label })} className="flex flex-col gap-1">
          {ids.map((chosen, index) => {
            const name = names.get(chosen) ?? w.removedOne;
            return (
              <li key={chosen} className="flex items-center gap-2 rounded-md border border-line px-2 py-1 text-sm">
                <span className="min-w-0 flex-1 truncate">{name}</span>
                <button
                  type="button"
                  aria-label={fillWords(w.moveUp, { name })}
                  disabled={index === 0}
                  onClick={() => move(index, index - 1)}
                  className={small}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={fillWords(w.moveDown, { name })}
                  disabled={index === ids.length - 1}
                  onClick={() => move(index, index + 1)}
                  className={small}
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label={fillWords(w.removeName, { name })}
                  onClick={() => {
                    onChange(ids.filter((_, i) => i !== index));
                    setStatus(fillWords(w.removed, { name }));
                  }}
                  className={`${small} px-3 text-xs`}
                >
                  {w.remove}
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {options.length === 0 && ids.length === 0 ? (
        <p className={`${hint} text-xs`}>{w.nothing}</p>
      ) : full ? (
        <p className={`${hint} text-xs`}>{fillWords(w.most, { n: MAX_RELATED })}</p>
      ) : (
        <div className="flex flex-wrap items-start gap-2">
          {free.length > 8 && (
            <input
              type="search"
              aria-label={fillWords(w.searchToAdd, { label })}
              placeholder={w.search}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className={`${input} min-w-32 flex-1`}
            />
          )}
          <select
            aria-label={fillWords(w.chooseToAdd, { label })}
            value={pick}
            onChange={(event) => setPick(event.target.value)}
            className={`${input} min-w-40 flex-1`}
          >
            <option value="">{free.length === 0 ? w.allChosen : w.chooseOne}</option>
            {matches.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={add}
            disabled={pick === ""}
            className="min-h-10 rounded-pill border border-edge px-3 text-sm disabled:opacity-40"
          >
            {w.add}
          </button>
        </div>
      )}
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
    </div>
  );
}

/** A product, page or category-or-tag field: one of the store's, or several with `multiple`. */
export function RelationField({
  def,
  value,
  lookups,
  onChange,
}: {
  def: FieldDef;
  value: FieldValue | undefined;
  lookups: FieldLookups;
  onChange: (value: FieldValue | undefined) => void;
}) {
  const options = relationOptions(def, lookups);
  const ids = idsOf(value);
  if (def.multiple) {
    return (
      <MultiSelect
        label={def.label}
        options={options}
        ids={ids}
        onChange={(next) => onChange(relationValue(next, true))}
      />
    );
  }
  return (
    <SingleSelect
      label={def.label}
      options={options}
      value={ids[0] ?? ""}
      onChange={(next) => onChange(relationValue(next === "" ? [] : [next], false))}
    />
  );
}

/** A link: what kind of thing, which one (or a web address), the words, and whether it opens in a new tab. */
export function LinkField({
  def,
  value,
  inherited,
  inheritedFrom,
  lookups,
  onChange,
}: {
  def: FieldDef;
  value: FieldLink | undefined;
  /** The main language's link, shown as the hint while this language's is empty. */
  inherited: FieldLink | undefined;
  inheritedFrom: string | undefined;
  lookups: FieldLookups;
  onChange: (value: FieldLink | undefined) => void;
}) {
  const w = useAdminText("fields");
  const p = w.pickers;
  const words = useId();
  const tab = useId();
  const kind: LinkKind | "" = value?.kind ?? "";
  const set = (patch: Partial<FieldLink>) => value && onChange({ ...value, ...patch });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start gap-2">
        <select
          aria-label={fillWords(p.linkTo, { label: def.label })}
          value={kind}
          onChange={(event) => {
            const next = event.target.value as LinkKind | "";
            if (next === "") return onChange(undefined);
            // A target of one kind is nothing for another; the words and the tab choice stay.
            onChange({ kind: next, ref: "", label: value?.label ?? "", ...(value?.newTab && { newTab: true }) });
          }}
          className={`${input} w-auto min-w-44`}
        >
          <option value="">{p.chooseLink}</option>
          {(Object.keys(LINK_KINDS) as LinkKind[]).map((k) => (
            <option key={k} value={k}>
              {w.linkKinds[k]}
            </option>
          ))}
        </select>
        {value && (
          <div className="min-w-48 flex-1">
            {value.kind === "url" ? (
              <input
                aria-label={fillWords(p.address, { label: def.label })}
                type="text"
                inputMode="url"
                value={value.ref}
                maxLength={1000}
                placeholder={p.addressExample}
                onChange={(event) => set({ ref: event.target.value })}
                className={input}
              />
            ) : (
              <SingleSelect
                label={`${def.label}: ${w.linkKinds[value.kind].toLowerCase()}`}
                options={linkOptions(value.kind, lookups)}
                value={value.ref}
                onChange={(ref) => set({ ref })}
              />
            )}
          </div>
        )}
      </div>
      {value && (
        <>
          <div className="flex flex-col gap-1">
            <label htmlFor={words} className="text-xs font-medium">
              {p.linkText}
            </label>
            <input
              id={words}
              type="text"
              maxLength={100}
              value={value.label}
              placeholder={inherited ? `${inheritedFrom ?? ""}: ${inherited.label}`.replace(/^: /, "") : undefined}
              onChange={(event) => set({ label: event.target.value })}
              className={input}
            />
          </div>
          <label htmlFor={tab} className="flex items-center gap-2 text-sm">
            <input
              id={tab}
              type="checkbox"
              checked={value.newTab === true}
              onChange={(event) =>
                onChange({
                  kind: value.kind,
                  ref: value.ref,
                  label: value.label,
                  ...(event.target.checked && { newTab: true }),
                })
              }
            />
            {p.newTab}
          </label>
        </>
      )}
      {!value && inherited && inheritedFrom && (
        <p className={`${hint} text-xs`}>
          {inherited.label
            ? fillWords(p.emptyLinkLabel, { language: inheritedFrom, label: inherited.label })
            : fillWords(p.emptyLink, { language: inheritedFrom })}
        </p>
      )}
    </div>
  );
}

/** A file to download: chosen on the computer and uploaded at once, shown by name and size. */
export function FileField({
  def,
  value,
  onChange,
  upload,
}: {
  def: FieldDef;
  value: FieldFile | undefined;
  onChange: (value: FieldFile | undefined) => void;
  upload: FieldFileUploader | null;
}) {
  const w = useAdminText("fields").pickers;
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const choose = async (file: File | undefined) => {
    if (!file || !upload) return;
    const tooBig = fileProblem(file, w);
    if (tooBig) return setProblem(tooBig);
    setBusy(true);
    setProblem(null);
    try {
      const outcome = await upload(file);
      if ("problem" in outcome) setProblem(outcome.problem);
      else onChange(outcome);
    } catch {
      setProblem(fillWords(w.uploadFailed, { name: file.name }));
    }
    setBusy(false);
  };
  return (
    <div className="flex flex-col gap-2">
      {value && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-line px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 truncate" title={value.name}>
            {value.name} <span className={hint}>({fileSize(value.size)})</span>
          </span>
          <button
            type="button"
            aria-label={fillWords(w.removeFile, { label: def.label })}
            onClick={() => onChange(undefined)}
            className="text-xs underline"
          >
            {w.remove}
          </button>
        </div>
      )}
      {upload ? (
        <div>
          <label
            className={`inline-block w-fit cursor-pointer rounded-md border border-line px-3 py-2 text-sm focus-within:outline-2 ${busy ? "opacity-50" : ""}`}
          >
            {busy ? w.uploading : value ? w.replaceFile : w.chooseFile}
            <input
              type="file"
              accept={FIELD_FILE_ACCEPT_TYPES}
              disabled={busy}
              className="sr-only"
              onChange={(event) => {
                void choose(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
          <p className={`${hint} mt-1 text-xs`}>{w.fileKinds}</p>
        </div>
      ) : (
        <p className={`${hint} text-xs`}>{w.noUploads}</p>
      )}
      {problem && (
        <p role="alert" className="text-sm text-danger-text">
          {problem}
        </p>
      )}
    </div>
  );
}
