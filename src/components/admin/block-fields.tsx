"use client";

import { useId, useState, type ReactNode } from "react";

import {
  SEPARATOR_LINES,
  SEPARATOR_POSITIONS,
  SEPARATOR_THICKNESS_MAX,
  type BlockType,
  type PageBlock,
  type SeparatorBlock,
} from "@/lib/page-content";

import type { Upload } from "./image-upload";
import type { StartVideo } from "./video-upload";

/**
 * The page builder's settings for the newer kinds of component, one entry
 * each: its dialog's title, its General tab and, if it has one, its Style
 * tab's own fields. The builder's generic dialog adds the font, spacing,
 * frame and Advanced tab every component shares, and translating lists the
 * component's texts from `mapBlockTexts()`, so a new kind needs no more of
 * the builder than its entry here.
 */

export type BlockEditorContext = { upload: Upload | null; startVideo: StartVideo | null };

export type BlockEditorProps<T extends PageBlock> = {
  block: T;
  onChange: (patch: Partial<T>) => void;
  context: BlockEditorContext;
};

export type BlockEditor<T extends PageBlock> = {
  title: string;
  /** The label of its font picker, and what no font means; without one, it has no font of its own. */
  font?: { label: string; fallback: string };
  General: (props: BlockEditorProps<T>) => ReactNode;
  Style?: (props: BlockEditorProps<T>) => ReactNode;
};

type Editors = { [K in BlockType]?: BlockEditor<Extract<PageBlock, { type: K }>> };

/** The components edited through the generic dialog. */
export const BLOCK_EDITORS: Editors = {
  separator: { title: "Separator line", General: SeparatorFields },
};

/** The editor for a block, if its kind has one here. */
export function editorFor(block: PageBlock): BlockEditor<PageBlock> | undefined {
  return BLOCK_EDITORS[block.type] as BlockEditor<PageBlock> | undefined;
}

// ---------------------------------------------------------------------------
// Shared fields
// ---------------------------------------------------------------------------

export const fieldClass = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm";
export const smallButton = "min-h-9 rounded-md border border-border px-3 text-sm disabled:opacity-40";

/** A labelled line of text. */
export function TextField({
  label,
  value,
  max,
  placeholder,
  hint,
  multiline = false,
  onChange,
}: {
  label: string;
  value: string;
  max: number;
  placeholder?: string;
  hint?: string;
  multiline?: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {multiline ? (
        <textarea
          id={id}
          value={value}
          maxLength={max}
          rows={3}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className={`${fieldClass} py-2`}
        />
      ) : (
        <input id={id} value={value} maxLength={max} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className={fieldClass} />
      )}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** A labelled choice among a few options, as buttons. */
export function ChoiceField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Record<T, string>;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {(Object.entries(options) as [T, string][]).map(([key, text]) => (
          <button
            key={key}
            type="button"
            aria-pressed={value === key}
            onClick={() => onChange(key)}
            className="min-h-10 rounded-md border border-border px-3 text-sm aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background"
          >
            {text}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** A labelled whole number within limits. */
export function NumberField({
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={value}
          onChange={(event) => {
            const next = Number.parseInt(event.target.value, 10);
            if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
          }}
          className={`${fieldClass} w-28`}
        />
        {unit && <span className="text-sm text-muted">{unit}</span>}
      </div>
    </div>
  );
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** A colour: the browser's picker, or `#rrggbb` typed. */
export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (color: string) => void }) {
  const id = useId();
  const [text, setText] = useState(value);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label}: choose`}
          value={value}
          onChange={(event) => {
            setText(event.target.value);
            onChange(event.target.value);
          }}
          className="h-10 w-14 cursor-pointer rounded-md border border-border bg-background p-1"
        />
        <input
          id={id}
          value={text}
          maxLength={7}
          spellCheck={false}
          aria-invalid={!HEX.test(text)}
          onChange={(event) => {
            setText(event.target.value);
            if (HEX.test(event.target.value)) onChange(event.target.value.toLowerCase());
          }}
          className="min-h-10 w-28 rounded-md border border-border bg-background px-2 font-mono text-sm aria-invalid:border-red-700"
        />
      </div>
    </div>
  );
}

/** A colour that is the site's own until one is chosen. */
export function OptionalColorField({
  label,
  hint,
  value,
  fallback,
  onChange,
}: {
  label: string;
  hint: string;
  value: string | undefined;
  fallback: string;
  onChange: (color: string | undefined) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <CheckField label={`Own ${label.toLowerCase()}`} hint={hint} checked={value !== undefined} onChange={(on) => onChange(on ? fallback : undefined)} />
      {value !== undefined && (
        <div className="pl-7">
          <ColorField label={label} value={value} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

/** A labelled on/off switch. */
export function CheckField({ label, checked, hint, onChange }: { label: string; checked: boolean; hint?: string; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-0.5" />
      <span>
        {label}
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

/**
 * A component's list of items (tabs, questions, testimonials …): each shown
 * folded under its name, opened to edit; added, removed and moved up or
 * down. Items keep their ids, which their texts' translations are kept by.
 */
export function ItemsEditor<T extends { id: string }>({
  label,
  items,
  max,
  addLabel,
  nameOf,
  newItem,
  onChange,
  children,
}: {
  label: string;
  items: T[];
  max: number;
  addLabel: string;
  /** What an item is called in the list. */
  nameOf: (item: T, index: number) => string;
  newItem: () => T;
  onChange: (items: T[]) => void;
  /** An item's own fields. */
  children: (item: T, change: (patch: Partial<T>) => void) => ReactNode;
}) {
  const [open, setOpen] = useState<string | null>(items[0]?.id ?? null);
  const change = (id: string, patch: Partial<T>) => onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  const move = (index: number, by: number) => {
    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    onChange(next);
  };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      {items.length === 0 && <p className="text-sm text-muted">None yet.</p>}
      <ol className="flex flex-col gap-2">
        {items.map((item, index) => {
          const name = nameOf(item, index);
          const expanded = open === item.id;
          return (
            <li key={item.id} className="rounded-md border border-border">
              <div className="flex items-center gap-1 p-1">
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : item.id)}
                  className="min-h-9 flex-1 truncate rounded px-2 text-left text-sm font-medium hover:bg-surface"
                >
                  <span aria-hidden className="mr-2 inline-block w-3 text-muted">
                    {expanded ? "▾" : "▸"}
                  </span>
                  {name}
                </button>
                <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move ${name} up`} className={smallButton}>
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === items.length - 1}
                  aria-label={`Move ${name} down`}
                  className={smallButton}
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => onChange(items.filter((i) => i.id !== item.id))}
                  aria-label={`Remove ${name}`}
                  className={`${smallButton} text-red-700 dark:text-red-400`}
                >
                  Remove
                </button>
              </div>
              {expanded && <div className="flex flex-col gap-4 border-t border-border p-3">{children(item, (patch) => change(item.id, patch))}</div>}
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        disabled={items.length >= max}
        onClick={() => {
          const item = newItem();
          onChange([...items, item]);
          setOpen(item.id);
        }}
        className={`${smallButton} w-fit`}
      >
        {addLabel}
      </button>
      {items.length >= max && <p className="text-xs text-muted">At most {max}.</p>}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/** A separator line (D91): its style, thickness, colour, width and place. */
function SeparatorFields({ block, onChange }: BlockEditorProps<SeparatorBlock>) {
  return (
    <>
      <ChoiceField label="Line" value={block.line ?? "solid"} options={SEPARATOR_LINES} onChange={(line) => onChange({ line })} />
      <NumberField label="Thickness" value={block.thickness ?? 1} min={1} max={SEPARATOR_THICKNESS_MAX} unit="pixels" onChange={(thickness) => onChange({ thickness })} />
      <OptionalColorField
        label="Colour"
        hint="The site's border colour unless you choose one."
        value={block.color}
        fallback="#d4d4d8"
        onChange={(color) => onChange({ color })}
      />
      <NumberField label="Width" value={block.width ?? 100} min={10} max={100} unit="% of the column" onChange={(width) => onChange({ width })} />
      {(block.width ?? 100) < 100 && (
        <ChoiceField label="Position" value={block.position ?? "center"} options={SEPARATOR_POSITIONS} onChange={(position) => onChange({ position })} />
      )}
    </>
  );
}
