"use client";

import { useId, useState, type ReactNode } from "react";

import type { ButtonLook } from "@/components/page-block";
import { RichTextEditor } from "./rich-text-editor";

import {
  ACCORDION_LOOKS,
  TABS_ALIGNS,
  TABS_LOOKS,
  EMPTY_DOC,
  HEADING_SIZES,
  ITEM_TITLE_MAX,
  ITEMS_MAX,
  BUTTON_SHAPES,
  BUTTON_SIZES,
  BUTTON_LABEL_MAX,
  BUTTON_VARIANTS,
  DUAL_GAP_MAX,
  FONT_WEIGHTS,
  isLinkAddress,
  SEPARATOR_LINES,
  SEPARATOR_POSITIONS,
  SEPARATOR_THICKNESS_MAX,
  type AccordionBlock,
  type BlockType,
  type HeadingSize,
  type PanelItem,
  type TabsBlock,
  type ButtonShape,
  type ButtonSize,
  type ButtonVariant,
  type DualButtonBlock,
  type DualButtonSide,
  type FontWeight,
  type PageBlock,
  type SeparatorBlock,
  type TextAlign,
  type TextAlignments,
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
  accordion: {
    title: "Accordion",
    font: { label: "Font", fallback: "The site's body font" },
    General: AccordionFields,
    Style: AccordionStyleFields,
  },
  tabs: {
    title: "Tabs",
    font: { label: "Font", fallback: "The site's body font" },
    General: TabsFields,
    Style: TabsStyleFields,
  },
  dualButton: {
    title: "Dual button",
    font: { label: "Font", fallback: "The site's body font" },
    General: DualButtonFields,
    Style: DualButtonStyleFields,
  },
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



/** One of a few choices, as a row of buttons (radio buttons underneath). */
export function Choices<T extends string>({
  legend,
  hint,
  options,
  value,
  onChange,
  disabled = false,
}: {
  legend: string;
  hint?: string;
  options: readonly { value: T; label: string; picture?: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const name = useId();
  return (
    <fieldset disabled={disabled} className="flex flex-col gap-2 disabled:opacity-50">
      <legend className="float-left mb-2 w-full text-sm font-medium">
        {legend}
        {hint && <span className="font-normal text-muted"> ({hint})</span>}
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label
            key={option.value}
            // `relative` keeps the hidden radio inside its button, not at the dialog's edge, where it would make the dialog scroll.
            className="relative flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm has-checked:border-foreground has-checked:bg-surface has-checked:font-medium has-focus-visible:outline-2 has-disabled:cursor-default"
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.picture}
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}


export function Check({
  label,
  hint,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`flex items-start gap-3 text-sm ${disabled ? "opacity-50" : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 shrink-0"
      />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{label}</span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}


/** A colour that is the site's own until one is chosen. */
export function OptionalColor({
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
      <Check
        label={`Own ${label.toLowerCase()}`}
        hint={hint}
        checked={value !== undefined}
        onChange={(on) => onChange(on ? fallback : undefined)}
      />
      {value !== undefined && (
        <div className="pl-7">
          <ColorField label={label} value={value} onChange={onChange} />
        </div>
      )}
    </div>
  );
}


const ALIGN_OPTIONS = [
  { value: "left", label: "Left" },
  { value: "center", label: "Centre" },
  { value: "right", label: "Right" },
] as const;


/** A rich text's alignment on phones, tablets and computers (D48); each larger screen follows the smaller unless set. */
export function TextAlignFields({
  what = "Text alignment",
  value,
  onChange,
}: {
  what?: string;
  value: TextAlignments | undefined;
  onChange: (value: TextAlignments | undefined) => void;
}) {
  const set = (screen: keyof TextAlignments, align: TextAlign | "same") => {
    const next: TextAlignments = { ...value };
    if (align === "same" || (screen === "mobile" && align === "left")) delete next[screen];
    else next[screen] = align;
    onChange(Object.keys(next).length > 0 ? next : undefined);
  };
  return (
    <div className="flex flex-col gap-4">
      <Choices legend={`${what} on phones`} options={ALIGN_OPTIONS} value={value?.mobile ?? "left"} onChange={(a) => set("mobile", a)} />
      <Choices
        legend="On tablets"
        hint="768 pixels and wider"
        options={[{ value: "same", label: "As on phones" }, ...ALIGN_OPTIONS]}
        value={value?.tablet ?? "same"}
        onChange={(a) => set("tablet", a)}
      />
      <Choices
        legend="On computers"
        hint="1024 pixels and wider"
        options={[{ value: "same", label: "As on tablets" }, ...ALIGN_OPTIONS]}
        value={value?.desktop ?? "same"}
        onChange={(a) => set("desktop", a)}
      />
    </div>
  );
}


/** A button's kind, size, corners and colours (D49): a button's, or a content grid's tile buttons (D51). */
export function ButtonLookFields({ look, onChange }: { look: ButtonLook; onChange: (patch: Partial<ButtonLook>) => void }) {
  const variant = look.variant ?? "filled";
  return (
    <>
      <Choices
        legend="Style"
        options={(Object.keys(BUTTON_VARIANTS) as ButtonVariant[]).map((v) => ({ value: v, label: BUTTON_VARIANTS[v] }))}
        value={variant}
        onChange={(v) => onChange({ variant: v === "filled" ? undefined : v })}
      />
      <Choices
        legend="Size"
        options={(Object.keys(BUTTON_SIZES) as ButtonSize[]).map((size) => ({ value: size, label: BUTTON_SIZES[size] }))}
        value={look.size ?? "md"}
        onChange={(size) => onChange({ size: size === "md" ? undefined : size })}
      />
      <Choices
        legend="Corners"
        disabled={variant === "text"}
        options={(Object.keys(BUTTON_SHAPES) as ButtonShape[]).map((shape) => ({ value: shape, label: BUTTON_SHAPES[shape] }))}
        value={look.shape ?? "rounded"}
        onChange={(shape) => onChange({ shape: shape === "rounded" ? undefined : shape })}
      />
      <OptionalColor
        label="Button colour"
        hint={
          variant === "filled"
            ? "Fills the button; otherwise the site's text colour."
            : "Colours the outline and text; otherwise the site's text colour."
        }
        value={look.fill}
        fallback="#1d4ed8"
        onChange={(fill) => onChange({ fill })}
      />
      <OptionalColor
        label="Text colour"
        hint={variant === "filled" ? "Otherwise the site's background colour." : "Otherwise the button colour."}
        value={look.textColor}
        fallback="#ffffff"
        onChange={(textColor) => onChange({ textColor })}
      />
    </>
  );
}

/** A link's text, address (checked as the site takes it) and whether it opens a new tab. */
export function LinkFields({
  label,
  href,
  newTab,
  placeholder = "Start your store",
  onChange,
}: {
  label: string;
  href: string;
  newTab: boolean | undefined;
  placeholder?: string;
  onChange: (patch: { label?: string; href?: string; newTab?: boolean }) => void;
}) {
  const id = useId();
  const address = href.trim();
  const problem = address === "" ? "It shows on the site once it has an address." : isLinkAddress(address) ? null : "Use a web address (https://…), a page on the site (/about), mailto: or tel:.";
  return (
    <div className="flex flex-col gap-4">
      <TextField label="Text" value={label} max={BUTTON_LABEL_MAX} placeholder={placeholder} onChange={(value) => onChange({ label: value })} />
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-href`} className="text-sm font-medium">
          Address
        </label>
        <input
          id={`${id}-href`}
          value={href}
          maxLength={2000}
          spellCheck={false}
          placeholder="https://… or /about"
          aria-invalid={Boolean(problem && address)}
          aria-describedby={`${id}-hint`}
          onChange={(event) => onChange({ href: event.target.value })}
          className={`${fieldClass} aria-invalid:border-red-700`}
        />
        <span id={`${id}-hint`} className={`text-xs ${problem && address ? "text-red-700 dark:text-red-400" : "text-muted"}`}>
          {problem ?? "A page on this site, another site, an email or a phone number."}
        </span>
      </div>
      <Check
        label="Open in a new tab"
        hint="Screen readers are told it opens a new tab."
        checked={Boolean(newTab)}
        onChange={(on) => onChange({ newTab: on || undefined })}
      />
    </div>
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

/** Options for `Choices` from a record of labels. */
const optionsOf = <T extends string>(labels: Record<T, string>) =>
  (Object.entries(labels) as [T, string][]).map(([value, label]) => ({ value, label }));

/** A separator line (D91): its style, thickness, colour, width and place. */
function SeparatorFields({ block, onChange }: BlockEditorProps<SeparatorBlock>) {
  return (
    <>
      <Choices legend="Line" options={optionsOf(SEPARATOR_LINES)} value={block.line ?? "solid"} onChange={(line) => onChange({ line })} />
      <NumberField label="Thickness" value={block.thickness ?? 1} min={1} max={SEPARATOR_THICKNESS_MAX} unit="pixels" onChange={(thickness) => onChange({ thickness })} />
      <OptionalColor
        label="Colour"
        hint="The site's border colour unless you choose one."
        value={block.color}
        fallback="#d4d4d8"
        onChange={(color) => onChange({ color })}
      />
      <NumberField label="Width" value={block.width ?? 100} min={10} max={100} unit="% of the column" onChange={(width) => onChange({ width })} />
      {(block.width ?? 100) < 100 && (
        <Choices legend="Position" options={optionsOf(SEPARATOR_POSITIONS)} value={block.position ?? "center"} onChange={(position) => onChange({ position })} />
      )}
    </>
  );
}

/** A dual button's two buttons (D91): each one's text, address and new tab. */
function DualButtonFields({ block, onChange }: BlockEditorProps<DualButtonBlock>) {
  const side = (which: "first" | "second", title: string, placeholder: string) => (
    <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-medium">{title}</legend>
      <LinkFields
        label={block[which].label}
        href={block[which].href}
        newTab={block[which].newTab}
        placeholder={placeholder}
        onChange={(patch) => onChange({ [which]: { ...block[which], ...patch } })}
      />
    </fieldset>
  );
  return (
    <>
      {side("first", "First button", "Shop now")}
      {side("second", "Second button", "Read more")}
    </>
  );
}

/** A dual button's look (D91): each button's style and colours, then their shared size, corners, weight, spacing and place. */
function DualButtonStyleFields({ block, onChange }: BlockEditorProps<DualButtonBlock>) {
  const look = (which: "first" | "second", title: string, fallback: ButtonVariant) => {
    const side: DualButtonSide = block[which];
    const variant = side.variant ?? fallback;
    const set = (patch: Partial<DualButtonSide>) => onChange({ [which]: { ...side, ...patch } });
    return (
      <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
        <legend className="px-1 text-sm font-medium">{title}</legend>
        <Choices legend="Style" options={optionsOf(BUTTON_VARIANTS)} value={variant} onChange={(v) => set({ variant: v })} />
        <OptionalColor
          label="Button colour"
          hint={variant === "filled" ? "Fills the button; otherwise the site's accent colour." : "Colours the outline and text; otherwise the site's text colour."}
          value={side.fill}
          fallback="#1d4ed8"
          onChange={(fill) => set({ fill })}
        />
        <OptionalColor
          label="Text colour"
          hint={variant === "filled" ? "Otherwise the accent's own text colour." : "Otherwise the button colour."}
          value={side.textColor}
          fallback="#ffffff"
          onChange={(textColor) => set({ textColor })}
        />
      </fieldset>
    );
  };
  return (
    <>
      {look("first", "First button", "filled")}
      {look("second", "Second button", "filled")}
      <Choices legend="Size" options={optionsOf(BUTTON_SIZES)} value={block.size ?? "md"} onChange={(size: ButtonSize) => onChange({ size: size === "md" ? undefined : size })} />
      <Choices legend="Corners" options={optionsOf(BUTTON_SHAPES)} value={block.shape ?? "rounded"} onChange={(shape: ButtonShape) => onChange({ shape: shape === "rounded" ? undefined : shape })} />
      <Choices legend="Weight" options={optionsOf(FONT_WEIGHTS)} value={block.weight ?? "medium"} onChange={(weight: FontWeight) => onChange({ weight: weight === "medium" ? undefined : weight })} />
      <NumberField label="Space between" value={block.gap ?? 12} min={0} max={DUAL_GAP_MAX} unit="pixels" onChange={(gap) => onChange({ gap })} />
      <Check
        label="One under another on phones"
        hint="Each as wide as the column on screens under 768 pixels."
        checked={Boolean(block.stackOnPhones)}
        onChange={(stackOnPhones) => onChange({ stackOnPhones: stackOnPhones || undefined })}
      />
      <TextAlignFields what="Position" value={block.align} onChange={(align) => onChange({ align })} />
    </>
  );
}

/** A new item's id, as the builder makes ids. */
const newItemId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `id${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** Titled pieces of rich text (D91): an accordion's sections, or tabs. */
function PanelItemsFields({
  items,
  noun,
  onChange,
}: {
  items: PanelItem[];
  /** What one is called: "Section", "Tab". */
  noun: string;
  onChange: (items: PanelItem[]) => void;
}) {
  return (
    <ItemsEditor
      label={`${noun}s`}
      items={items}
      max={ITEMS_MAX}
      addLabel={`Add a ${noun.toLowerCase()}`}
      nameOf={(item, index) => item.title.trim() || `${noun} ${index + 1} (no title yet)`}
      newItem={() => ({ id: newItemId(), title: "", body: EMPTY_DOC })}
      onChange={onChange}
    >
      {(item, change) => (
        <>
          <TextField label="Title" value={item.title} max={ITEM_TITLE_MAX} onChange={(title) => change({ title })} />
          <RichTextEditor key={item.id} value={item.body} onChange={(body) => change({ body })} label="Text" />
        </>
      )}
    </ItemsEditor>
  );
}

/** An accordion's sections (D91). */
function AccordionFields({ block, onChange }: BlockEditorProps<AccordionBlock>) {
  return (
    <>
      <PanelItemsFields items={block.items} noun="Section" onChange={(items) => onChange({ items })} />
      <p className="text-xs text-muted">A section without a title is left out on the site.</p>
    </>
  );
}

/** How an accordion opens and looks (D91). */
function AccordionStyleFields({ block, onChange }: BlockEditorProps<AccordionBlock>) {
  return (
    <>
      <Check label="First section open" hint="Shown open when the page loads." checked={Boolean(block.openFirst)} onChange={(openFirst) => onChange({ openFirst: openFirst || undefined })} />
      <Check label="One open at a time" hint="Opening a section closes the one that was open." checked={Boolean(block.single)} onChange={(single) => onChange({ single: single || undefined })} />
      <Choices legend="Look" options={optionsOf(ACCORDION_LOOKS)} value={block.look ?? "lines"} onChange={(look) => onChange({ look: look === "lines" ? undefined : look })} />
      <Choices
        legend="Title size"
        options={optionsOf(HEADING_SIZES)}
        value={block.titleSize ?? "sm"}
        onChange={(titleSize: HeadingSize) => onChange({ titleSize: titleSize === "sm" ? undefined : titleSize })}
      />
    </>
  );
}

/** Tabs' titles and texts (D91). */
function TabsFields({ block, onChange }: BlockEditorProps<TabsBlock>) {
  return (
    <>
      <PanelItemsFields items={block.items} noun="Tab" onChange={(items) => onChange({ items })} />
      <p className="text-xs text-muted">A tab without a title is left out on the site. The first tab shows when the page loads.</p>
    </>
  );
}

/** How tabs look (D91). */
function TabsStyleFields({ block, onChange }: BlockEditorProps<TabsBlock>) {
  return (
    <>
      <Choices legend="Look" options={optionsOf(TABS_LOOKS)} value={block.look ?? "underline"} onChange={(look) => onChange({ look: look === "underline" ? undefined : look })} />
      <Choices
        legend="Tabs"
        options={optionsOf(TABS_ALIGNS)}
        value={block.tabsAlign ?? "start"}
        onChange={(tabsAlign) => onChange({ tabsAlign: tabsAlign === "start" ? undefined : tabsAlign })}
      />
    </>
  );
}
