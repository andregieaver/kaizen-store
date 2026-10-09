"use client";

import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { createContext, useContext, useId, useState, type ReactNode } from "react";

import type { ButtonLook } from "@/components/page-block";
import { ListIcon } from "@/components/list-icon";
import { type FieldDef, type FieldEntity, type FieldGroup } from "@/lib/custom-fields";
import { bindable, canBind } from "@/lib/field-binding";
import { LOOP_SLOT_KEYS, isLoopable, slotChoices, suggestSlots, validSlots } from "@/lib/field-loop";
import { AUTOPLAY_SECONDS, CAROUSEL_SNAPS, cleanCarousel, normalizeSeconds, resolveCarousel, type CarouselSettings, type CarouselSnap } from "@/lib/carousel-settings";
import { setAt, sizeSource, valueAt } from "@/lib/responsive";
import { tileFieldOptions } from "@/lib/tile-fields";
import { isEmail } from "@/lib/forms";
import { t } from "@/lib/i18n";
import { ICONS, type IconName } from "@/lib/icons";
import { SOCIAL_NETWORKS, socialHref, socialPlaceholder, type SocialNetwork } from "@/lib/social-links";
import { embedUrl, EMBED_NAMES } from "@/lib/video-embed";

import { PixelRange } from "./pixel-range";
import { ColorField } from "./colour-field";
import { RichTextEditor } from "./rich-text-editor";
import { SizeMark, inheritedClass, useSizeEdit } from "./responsive-edit";

import {
  ACCORDION_LOOKS,
  TABS_ALIGNS,
  VIDEO_RATIOS,
  VIDEO_SOURCES,
  VIDEO_TITLE_MAX,
  HTML_HEIGHT_MAX,
  HTML_MAX,
  type HtmlBlock,
  SOCIAL_COLORS,
  SOCIAL_GAP_MAX,
  SOCIAL_LOOKS,
  SOCIAL_SHAPES,
  type SocialLink,
  type SocialLinksBlock,
  FORM_FIELD_KINDS,
  FORM_FIELDS_MAX,
  FORM_LABEL_MAX,
  FORM_OPTIONS_MAX,
  FORM_RECIPIENTS_MAX,
  FORM_TEXT_MAX,
  LABELLED_KINDS,
  NEWSLETTER_LAYOUTS,
  type EmailFormBlock,
  type FormButton,
  type FormField,
  type FormFieldKind,
  type NewsletterBlock,
  ICON_LIST_LAYOUTS,
  ICON_LIST_TEXT_MAX,
  type IconListBlock,
  type IconListItem,
  TESTIMONIAL_COLUMNS,
  TESTIMONIAL_LOOKS,
  TESTIMONIAL_NAME_MAX,
  TESTIMONIAL_QUOTE_MAX,
  type Testimonial,
  type TestimonialsBlock,
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
  FIELD_DISPLAYS,
  FONT_WEIGHTS,
  LOOP_COLUMNS,
  LOOP_LAYOUTS,
  LOOP_SLOTS,
  TILE_FIELDS_MAX,
  HEADING_MAX,
  isLinkAddress,
  SEPARATOR_LINES,
  SEPARATOR_POSITIONS,
  SEPARATOR_THICKNESS_MAX,
  type AccordionBlock,
  type BlockType,
  type CustomFieldBlock,
  type FieldBinding,
  type FieldDisplay,
  type FieldLoopBlock,
  type LoopColumns,
  type LoopConfig,
  type LoopLayout,
  type LoopSlot,
  type HeadingSize,
  type FaqBlock,
  type PanelItem,
  type TabsBlock,
  type VideoBlock,
  type ButtonShape,
  type ButtonSize,
  type ButtonVariant,
  type DualButtonBlock,
  type DualButtonSide,
  type FontWeight,
  type PageBlock,
  type SeparatorBlock,
  type TextAlign,
  type SizeOverrides,
} from "@/lib/page-content";

import { ImageUploadButton, type Upload } from "./image-upload";
import { VideoUploadButton, type StartVideo } from "./video-upload";

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
  video: { title: "Video", General: VideoFields, Style: VideoStyleFields },
  html: { title: "HTML", General: HtmlFields, Style: HtmlStyleFields },
  iconList: {
    title: "Icon list",
    font: { label: "Font", fallback: "The site's body font" },
    General: IconListFields,
    Style: IconListStyleFields,
  },
  socialLinks: {
    title: "Social media",
    font: { label: "Font of the names", fallback: "The site's body font" },
    General: SocialLinksFields,
    Style: SocialLinksStyleFields,
  },
  testimonials: {
    title: "Testimonials",
    font: { label: "Font", fallback: "The site's body font" },
    General: TestimonialsFields,
    Style: TestimonialsStyleFields,
  },
  faq: {
    title: "FAQs",
    font: { label: "Font", fallback: "The site's body font" },
    General: FaqFields,
    Style: FaqStyleFields,
  },
  emailForm: {
    title: "Email form",
    font: { label: "Font", fallback: "The site's body font" },
    General: EmailFormFields,
    Style: FormStyleFields,
  },
  newsletter: {
    title: "Newsletter",
    font: { label: "Font", fallback: "The site's body font" },
    General: NewsletterFields,
    Style: FormStyleFields,
  },
  dualButton: {
    title: "Dual button",
    font: { label: "Font", fallback: "The site's body font" },
    General: DualButtonFields,
    Style: DualButtonStyleFields,
  },
  customField: {
    title: "Custom fields",
    font: { label: "Font", fallback: "The site's body font" },
    General: CustomFieldFields,
  },
  fieldLoop: {
    title: "Field loop",
    font: { label: "Font", fallback: "The site's body font" },
    General: FieldLoopFields,
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
  mark,
  muted = "",
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  onChange: (value: number) => void;
  /** Beside the label: a setting that can differ by screen size has its device icon and where its value comes from (D179). */
  mark?: ReactNode;
  /** Classes that grey an inherited value (`inheritedClass()`). */
  muted?: string;
}) {
  const id = useId();
  return (
    <div className={`flex flex-col gap-1 ${muted}`}>
      <div className="flex flex-wrap items-center gap-1">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {mark}
      </div>
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
      {/* A field in pixels has a slider with the value over its thumb (D183). */}
      {unit && /^(px|pixels)$/.test(unit) && max > min && (
        <PixelRange value={value} min={min} max={max} step={max - min > 400 ? 4 : 1} label={`${label}, slider`} onChange={onChange} className="max-w-64" />
      )}
    </div>
  );
}

/** The one colour field (D180): its own module, here for the fields that import it from this one. */
export { ColorField };

/** One of a few choices, as a row of buttons (radio buttons underneath). */
export function Choices<T extends string>({
  legend,
  hint,
  options,
  value,
  onChange,
  disabled = false,
  mark,
  muted = "",
}: {
  legend: string;
  hint?: string;
  options: readonly { value: T; label: string; picture?: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  /** After the legend: a setting that can differ by screen size has its device icon and where its value comes from (D179). */
  mark?: ReactNode;
  /** Classes that grey an inherited value (`inheritedClass()`). */
  muted?: string;
}) {
  const name = useId();
  return (
    <fieldset disabled={disabled} className={`flex flex-col gap-2 disabled:opacity-50 ${muted}`}>
      <legend className="float-left mb-2 w-full text-sm font-medium">
        {legend}
        {hint && <span className="font-normal text-muted"> ({hint})</span>}
        {mark}
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


/**
 * A part's alignment (D48), at the screen size the builder edits (D179): at Extra large the part's own, below it an
 * override of the size (`setAt()`), the inherited one greyed with where it comes from, and a × to give it back.
 */
export function TextAlignFields({
  what = "Text alignment",
  value: part,
  onChange,
}: {
  what?: string;
  value: { align?: TextAlign; at?: SizeOverrides };
  onChange: (patch: { align?: TextAlign | undefined; at?: SizeOverrides | undefined }) => void;
}) {
  const { size } = useSizeEdit();
  const source = sizeSource(part, size, "align");
  return (
    <Choices
      legend={what}
      mark={<SizeMark part={part} field="align" label={what} onPatch={onChange} />}
      muted={inheritedClass(source, size)}
      options={ALIGN_OPTIONS}
      value={valueAt(part, "align", size) ?? "left"}
      onChange={(align) => onChange(setAt(part, size, { align: size === "xl" && align === "left" ? undefined : align }))}
    />
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
 * folded under its name, opened to edit; added, removed, duplicated and
 * moved by dragging its handle or with the arrows (the keyboard's way too).
 * Items keep their ids, which their texts' translations are kept by.
 */
export function ItemsEditor<T extends { id: string }>({
  label,
  items,
  max,
  addLabel,
  nameOf,
  newItem,
  duplicate,
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
  /** A copy of an item with an id of its own: gives each item a Duplicate button. */
  duplicate?: (item: T) => T;
  onChange: (items: T[]) => void;
  /** An item's own fields. */
  children: (item: T, change: (patch: Partial<T>) => void) => ReactNode;
}) {
  const [open, setOpen] = useState<string | null>(items[0]?.id ?? null);
  const change = (id: string, patch: Partial<T>) => onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  const move = (index: number, by: number) => onChange(arrayMove(items, index, index + by));
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const dropped = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = items.findIndex((item) => item.id === active.id);
    const to = items.findIndex((item) => item.id === over.id);
    if (from >= 0 && to >= 0) onChange(arrayMove(items, from, to));
  };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      {items.length === 0 && <p className="text-sm text-muted">None yet.</p>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dropped}>
        <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
          <ol className="flex flex-col gap-2">
            {items.map((item, index) => {
              const name = nameOf(item, index);
              const expanded = open === item.id;
              return (
                <SortableItem
                  key={item.id}
                  id={item.id}
                  name={name}
                  body={expanded ? children(item, (patch) => change(item.id, patch)) : null}
                >
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
                  {duplicate && (
                    <button
                      type="button"
                      disabled={items.length >= max}
                      onClick={() => {
                        const copy = duplicate(item);
                        const next = [...items];
                        next.splice(index + 1, 0, copy);
                        onChange(next);
                        setOpen(copy.id);
                      }}
                      aria-label={`Duplicate ${name}`}
                      className={smallButton}
                    >
                      Duplicate
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onChange(items.filter((i) => i.id !== item.id))}
                    aria-label={`Remove ${name}`}
                    className={`${smallButton} text-red-700 dark:text-red-400`}
                  >
                    Remove
                  </button>
                </SortableItem>
              );
            })}
          </ol>
        </SortableContext>
      </DndContext>
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

/**
 * One item in the list: its row of buttons (the children), with a handle to drag it by, and its fields under them while
 * it is open. The handle is a button too, so a keyboard moves it (Space to pick up, the arrows, Space to drop).
 */
function SortableItem({ id, name, body, children }: { id: string; name: string; body: ReactNode; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-md border border-border bg-background ${isDragging ? "relative z-10 shadow-lg" : ""}`}
    >
      <div className="flex items-center gap-1 p-1">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Drag ${name} to move it`}
          className="min-h-9 cursor-grab touch-none rounded px-1.5 text-muted hover:bg-surface active:cursor-grabbing"
        >
          <span aria-hidden>⠿</span>
        </button>
        {children}
      </div>
      {body && <div className="flex flex-col gap-4 border-t border-border p-3">{body}</div>}
    </li>
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
      </fieldset>
    );
  };
  return (
    <>
      {look("first", "First button", "filled")}
      {look("second", "Second button", "filled")}
      <Choices legend="Size" options={optionsOf(BUTTON_SIZES)} value={block.size ?? "md"} onChange={(size: ButtonSize) => onChange({ size: size === "md" ? undefined : size })} />
      <Choices legend="Corners" options={optionsOf(BUTTON_SHAPES)} value={block.shape ?? "rounded"} onChange={(shape: ButtonShape) => onChange({ shape: shape === "rounded" ? undefined : shape })} />
      <NumberField label="Space between" value={block.gap ?? 12} min={0} max={DUAL_GAP_MAX} unit="pixels" onChange={(gap) => onChange({ gap })} />
      <DualStackField block={block} onChange={onChange} />
      <TextAlignFields what="Position" value={block} onChange={onChange} />
    </>
  );
}

/** A dual button's two one under another, each as wide as the column, at the size edited (D179). */
function DualStackField({ block, onChange }: { block: DualButtonBlock; onChange: (patch: Partial<DualButtonBlock>) => void }) {
  const { size } = useSizeEdit();
  const source = sizeSource(block, size, "stack");
  return (
    <div className={`flex flex-wrap items-start gap-1 ${inheritedClass(source, size)}`}>
      <Check
        label="One under another"
        hint="Each as wide as the column."
        checked={valueAt(block, "stack", size) === true}
        onChange={(on) => onChange(setAt(block, size, { stack: size === "xl" ? on || undefined : on }))}
      />
      <SizeMark part={block} field="stack" label="One under another" onPatch={onChange} />
    </div>
  );
}

/** A new item's id, as the builder makes ids. */
const newItemId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `id${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** Titled pieces of rich text (D91): an accordion's sections, or tabs. */
function PanelItemsFields({
  items,
  noun,
  names = { title: "Title", body: "Text" },
  onChange,
}: {
  items: PanelItem[];
  /** What one is called: "Section", "Tab". */
  noun: string;
  /** What its title and text are called. */
  names?: { title: string; body: string };
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
          <TextField label={names.title} value={item.title} max={ITEM_TITLE_MAX} onChange={(title) => change({ title })} />
          <RichTextEditor key={item.id} value={item.body} onChange={(body) => change({ body })} label={names.body} />
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

/** How an accordion (or FAQs) opens and looks (D91). */
function AccordionStyleFields({
  block,
  onChange,
}: {
  block: AccordionBlock | FaqBlock;
  onChange: (patch: Partial<Pick<AccordionBlock, "openFirst" | "single" | "look">>) => void;
}) {
  return (
    <>
      <Check label={block.type === "faq" ? "First question open" : "First section open"} hint="Shown open when the page loads." checked={Boolean(block.openFirst)} onChange={(openFirst) => onChange({ openFirst: openFirst || undefined })} />
      <Check label="One open at a time" hint={block.type === "faq" ? "Opening a question closes the one that was open." : "Opening a section closes the one that was open."} checked={Boolean(block.single)} onChange={(single) => onChange({ single: single || undefined })} />
      <Choices legend="Look" options={optionsOf(ACCORDION_LOOKS)} value={block.look ?? "lines"} onChange={(look) => onChange({ look: look === "lines" ? undefined : look })} />
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

/** Questions and their answers (D91). */
function FaqFields({ block, onChange }: BlockEditorProps<FaqBlock>) {
  return (
    <>
      <PanelItemsFields items={block.items} noun="Question" names={{ title: "Question", body: "Answer" }} onChange={(items) => onChange({ items })} />
      <p className="text-xs text-muted">A question shows on the site once it has an answer.</p>
    </>
  );
}

/** How FAQs open and look, and whether search engines are given them as questions and answers (D91). */
function FaqStyleFields({ block, onChange }: BlockEditorProps<FaqBlock>) {
  return (
    <>
      <AccordionStyleFields block={block} onChange={onChange} />
      <Check
        label="Tell search engines these are questions and answers"
        hint="Adds schema.org's FAQPage to the page, which search engines and AI assistants read."
        checked={block.structuredData !== false}
        onChange={(on) => onChange({ structuredData: on ? undefined : false })}
      />
    </>
  );
}

/** A video (D91): where it comes from, the video, its title and the picture shown before it plays. */
function VideoFields({ block, onChange, context }: BlockEditorProps<VideoBlock>) {
  const embedded = block.source !== "upload";
  const link = block.link.trim();
  const found = embedded && link !== "" && embedUrl(block.source as "youtube" | "vimeo", link) !== null;
  return (
    <>
      <Choices legend="Video from" options={optionsOf(VIDEO_SOURCES)} value={block.source} onChange={(source) => onChange({ source })} />
      {embedded ? (
        <TextField
          label={`Address on ${EMBED_NAMES[block.source as "youtube" | "vimeo"]}`}
          value={block.link}
          max={500}
          placeholder={block.source === "youtube" ? "https://www.youtube.com/watch?v=…" : "https://vimeo.com/…"}
          hint={
            link === ""
              ? "Paste the address from the video's Share button."
              : found
                ? `Found. Nothing loads from ${EMBED_NAMES[block.source as "youtube" | "vimeo"]} until a visitor presses play.`
                : `That is not the address of a video on ${EMBED_NAMES[block.source as "youtube" | "vimeo"]}.`
          }
          onChange={(value) => onChange({ link: value })}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Video</p>
          {block.video && <p className="break-all text-sm text-muted">{block.video.url.split("/").pop()}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <VideoUploadButton
              startVideo={context.startVideo}
              upload={context.upload}
              label={block.video ? "Choose another video" : "Upload a video"}
              onUploaded={({ video, poster }) => onChange({ video, ...(poster && !block.poster ? { poster } : {}) })}
            />
            {block.video && (
              <button type="button" onClick={() => onChange({ video: null })} className={smallButton}>
                Remove
              </button>
            )}
          </div>
          <p className="text-xs text-muted">MP4 or WebM, up to 50 MB. A still from the video is kept as its picture.</p>
        </div>
      )}
      <TextField
        label="Title"
        value={block.title}
        max={VIDEO_TITLE_MAX}
        hint="What the video is, for people using screen readers and in the player."
        onChange={(title) => onChange({ title })}
      />
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Picture before it plays</p>
        {block.poster && (
          // eslint-disable-next-line @next/next/no-img-element -- the site's own picture, shown as it is
          <img src={block.poster.url} alt="" className="h-24 w-fit rounded-md border border-border object-cover" />
        )}
        <div className="flex flex-wrap items-center gap-3">
          <ImageUploadButton upload={context.upload} label={block.poster ? "Choose another picture" : "Choose a picture"} onUploaded={(poster) => onChange({ poster })} />
          {block.poster && (
            <button type="button" onClick={() => onChange({ poster: null })} className={smallButton}>
              Remove
            </button>
          )}
        </div>
        <p className="text-xs text-muted">
          {embedded
            ? "Shown with a play button; without one, a plain dark panel. YouTube's and Vimeo's own pictures are not used, as loading them would tell those sites about every visitor."
            : "Shown until the video plays."}
        </p>
      </div>
    </>
  );
}

/** A video's shape and, uploaded, how it plays (D91). */
function VideoStyleFields({ block, onChange }: BlockEditorProps<VideoBlock>) {
  return (
    <>
      <Choices legend="Shape" options={optionsOf(VIDEO_RATIOS)} value={block.ratio ?? "16:9"} onChange={(ratio) => onChange({ ratio: ratio === "16:9" ? undefined : ratio })} />
      {block.source === "upload" && (
        <>
          <Check
            label="Start by itself"
            hint="Starts muted and loops, as browsers only start videos without sound; stays still for visitors who prefer less motion."
            checked={Boolean(block.autoplay)}
            onChange={(autoplay) => onChange({ autoplay: autoplay || undefined })}
          />
          <Check label="Loop" checked={Boolean(block.loop) || Boolean(block.autoplay)} disabled={Boolean(block.autoplay)} onChange={(loop) => onChange({ loop: loop || undefined })} />
          <Check
            label="Show the player's controls"
            hint="A video that does not start by itself always has them, so it can be played."
            checked={block.controls !== false || !block.autoplay}
            disabled={!block.autoplay}
            onChange={(controls) => onChange({ controls: controls ? undefined : false })}
          />
        </>
      )}
    </>
  );
}

/** The owner's HTML and what names it (D91). */
function HtmlFields({ block, onChange }: BlockEditorProps<HtmlBlock>) {
  const id = useId();
  return (
    <>
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-sm font-medium">
          HTML
        </label>
        <textarea
          id={id}
          value={block.html}
          maxLength={HTML_MAX}
          rows={14}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder={"<div>…</div>\n<script>…</script>"}
          onChange={(event) => onChange({ html: event.target.value })}
          className={`${fieldClass} py-2 font-mono text-xs leading-relaxed`}
        />
        <p className="text-xs text-muted">
          HTML, styles and scripts, such as a form or a widget from another service. It runs in a frame of its own, so it cannot reach the
          site&apos;s cookies or sign-ins, and the site&apos;s styles do not reach it (only its font and text colour). {block.html.length.toLocaleString("en")}{" "}
          of {HTML_MAX.toLocaleString("en")} characters.
        </p>
      </div>
      <TextField
        label="Title"
        value={block.title}
        max={200}
        hint="What it is, such as “Newsletter sign-up”, for people using screen readers."
        onChange={(title) => onChange({ title })}
      />
      <Check
        label="Wait until the visitor presses Show"
        hint="For content from another service that may set cookies: nothing loads until the visitor asks for it."
        checked={Boolean(block.waitForClick)}
        onChange={(waitForClick) => onChange({ waitForClick: waitForClick || undefined })}
      />
    </>
  );
}

/** The HTML's height: its content's, or set (D91). */
function HtmlStyleFields({ block, onChange }: BlockEditorProps<HtmlBlock>) {
  return (
    <>
      <Choices
        legend="Height"
        options={[
          { value: "fit", label: "Fits its content" },
          { value: "set", label: "Set" },
        ]}
        value={block.height === undefined ? "fit" : "set"}
        onChange={(mode) => onChange({ height: mode === "fit" ? undefined : 400 })}
      />
      {block.height !== undefined && (
        <NumberField label="Height" value={block.height} min={20} max={HTML_HEIGHT_MAX} unit="px" onChange={(height) => onChange({ height })} />
      )}
    </>
  );
}

/** Testimonials written in by the owner (D91). */
function TestimonialsFields({ block, onChange, context }: BlockEditorProps<TestimonialsBlock>) {
  const source = (
    <Choices
      legend="Testimonials from"
      options={[
        { value: "custom", label: "Written here" },
        { value: "google", label: "Google reviews" },
      ]}
      value={block.source ?? "custom"}
      onChange={(value) => onChange({ source: value === "google" ? "google" : undefined })}
    />
  );
  if (block.source === "google") {
    return (
      <>
        {source}
        <p className="text-sm text-muted">
          Your business&apos;s rating and newest reviews on Google, in the page&apos;s language, with Google named as their source. Set up
          the Google key and choose your business under Integrations, Google reviews (Kaizen&apos;s under Platform, Google reviews). They
          are asked of Google each time the page is shown, as Google does not allow keeping them.
        </p>
        <Choices
          legend="Only reviews with at least"
          options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: n === 1 ? "Any stars" : `${n} stars` }))}
          value={String(block.minRating ?? 1)}
          onChange={(value) => onChange({ minRating: value === "1" ? undefined : Number(value) })}
        />
        <Choices
          legend="At most"
          hint="Google gives the five most relevant"
          options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))}
          value={String(block.limit ?? 5)}
          onChange={(value) => onChange({ limit: value === "5" ? undefined : Number(value) })}
        />
      </>
    );
  }
  return (
    <>
      {source}
      <ItemsEditor<Testimonial>
        label="Testimonials"
        items={block.items}
        max={ITEMS_MAX}
        addLabel="Add a testimonial"
        nameOf={(item, index) => item.name.trim() || `Testimonial ${index + 1}${item.quote.trim() ? "" : " (no words yet)"}`}
        newItem={() => ({ id: newItemId(), quote: "", name: "", role: "", picture: null })}
        onChange={(items) => onChange({ items })}
      >
        {(item, change) => (
          <>
            <TextField label="What they said" value={item.quote} max={TESTIMONIAL_QUOTE_MAX} multiline onChange={(quote) => change({ quote })} />
            <TextField label="Name" value={item.name} max={TESTIMONIAL_NAME_MAX} onChange={(name) => change({ name })} />
            <TextField
              label="Title, company or place"
              value={item.role}
              max={TESTIMONIAL_NAME_MAX}
              placeholder="Customer in Bergen"
              onChange={(role) => change({ role })}
            />
            <Choices
              legend="Stars"
              options={[{ value: "0", label: "None" }, ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: "★".repeat(n) }))]}
              value={String(item.rating ?? 0)}
              onChange={(value) => change({ rating: value === "0" ? undefined : Number(value) })}
            />
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Picture</p>
              <div className="flex flex-wrap items-center gap-3">
                {item.picture && (
                  // eslint-disable-next-line @next/next/no-img-element -- the site's own picture, shown as it is
                  <img src={item.picture.url} alt="" className="size-12 rounded-full object-cover" />
                )}
                <ImageUploadButton upload={context.upload} label={item.picture ? "Choose another" : "Choose a picture"} onUploaded={(picture) => change({ picture })} />
                {item.picture && (
                  <button type="button" onClick={() => change({ picture: null })} className={smallButton}>
                    Remove
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </ItemsEditor>
      <p className="text-xs text-muted">
        Use only what customers really said, with their permission to show it. A testimonial without words is left out on the site.
      </p>
    </>
  );
}

/**
 * What a carousel does besides scrolling (D155, B): the same fields for a
 * content grid and for testimonials shown as a carousel. Only what differs
 * from the default is kept (`cleanCarousel`), so a carousel left alone stays
 * a block without settings.
 */
export function CarouselFields({ value, onChange }: { value: CarouselSettings | undefined; onChange: (settings: CarouselSettings | undefined) => void }) {
  const resolved = resolveCarousel(value);
  const set = (patch: Partial<CarouselSettings>) => onChange(cleanCarousel({ ...resolved, ...patch, autoplay: "autoplay" in patch ? patch.autoplay : (resolved.autoplay ?? undefined) }));
  const seconds = resolved.autoplay?.seconds;
  const id = useId();
  // What is typed in the seconds field until it is a number in range; it settles on leaving the field.
  const [typed, setTyped] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <Check label="Arrows" hint="Previous and next buttons under the tiles." checked={resolved.arrows} onChange={(arrows) => set({ arrows })} />
      <Check label="Dots" hint="One dot for each page of tiles, each a button. Left out when everything fits on one page." checked={resolved.dots} onChange={(dots) => set({ dots })} />
      <Choices<CarouselSnap>
        legend="Where a tile rests"
        options={(Object.keys(CAROUSEL_SNAPS) as CarouselSnap[]).map((snap) => ({ value: snap, label: CAROUSEL_SNAPS[snap] }))}
        value={resolved.snap}
        onChange={(snap) => set({ snap })}
      />
      <Check
        label="Go back to the first tile"
        hint="Past the last tile, the next arrow returns to the first. The tiles are not copied, so nothing is read twice."
        checked={resolved.rewind}
        onChange={(rewind) => set({ rewind })}
      />
      <Check
        label="Move by itself"
        hint="Automatic movement is unwelcome to many visitors, so leave it off unless the page needs it."
        checked={seconds !== undefined}
        onChange={(on) => {
          setTyped(null);
          set({ autoplay: on ? { seconds: AUTOPLAY_SECONDS.fallback } : undefined });
        }}
      />
      {seconds !== undefined && (
        <div className="flex flex-col gap-2 pl-7">
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor={`${id}-seconds`} className="font-medium">
              Seconds on each page
            </label>
            <input
              id={`${id}-seconds`}
              type="number"
              inputMode="numeric"
              min={AUTOPLAY_SECONDS.min}
              max={AUTOPLAY_SECONDS.max}
              value={typed ?? String(seconds)}
              onChange={(event) => {
                setTyped(event.target.value);
                const n = Number(event.target.value);
                if (event.target.value !== "" && Number.isInteger(n) && n >= AUTOPLAY_SECONDS.min && n <= AUTOPLAY_SECONDS.max) set({ autoplay: { seconds: n } });
              }}
              onBlur={() => {
                if (typed !== null) set({ autoplay: { seconds: normalizeSeconds(typed === "" ? seconds : Number(typed)) } });
                setTyped(null);
              }}
              className="min-h-10 w-20 rounded-md border border-border bg-background px-2 text-sm"
            />
            <span className="text-muted">
              ({AUTOPLAY_SECONDS.min} to {AUTOPLAY_SECONDS.max})
            </span>
          </div>
          <p className="text-xs text-muted">
            It never moves for visitors who ask their device for less motion. It stops for good when a visitor scrolls, drags, clicks or tabs into it, waits while the
            pointer is over it or the tab is hidden, and always has a Pause button.
            {resolved.rewind ? "" : " Without going back to the first tile, it stops at the last."}
          </p>
        </div>
      )}
      <p className="text-xs text-muted">
        A carousel scrolls its tiles sideways. Not included: slides laid out freely (a hero slider with text and buttons over a picture), vertical sliders, fade or
        cube effects, thumbnails and video slides. With the arrows and dots both off, visitors scroll with touch, the wheel or the arrow keys.
      </p>
    </div>
  );
}

/** How testimonials are laid out and look (D91). */
function TestimonialsStyleFields({ block, onChange }: BlockEditorProps<TestimonialsBlock>) {
  return (
    <>
      <Choices
        legend="Show as"
        options={[
          { value: "grid", label: "Grid" },
          { value: "carousel", label: "Carousel" },
        ]}
        value={block.display ?? "grid"}
        onChange={(display) => onChange({ display: display === "carousel" ? "carousel" : undefined })}
      />
      <Choices
        legend={block.display === "carousel" ? "To a screen" : "Columns"}
        hint="one on phones"
        options={TESTIMONIAL_COLUMNS.map((n) => ({ value: String(n), label: String(n) }))}
        value={String(block.columns ?? 3)}
        onChange={(value) => onChange({ columns: value === "3" ? undefined : (Number(value) as TestimonialsBlock["columns"]) })}
      />
      {block.display === "carousel" && <CarouselFields value={block.carousel} onChange={(carousel) => onChange({ carousel })} />}
      <Choices legend="Look" options={optionsOf(TESTIMONIAL_LOOKS)} value={block.look ?? "cards"} onChange={(look) => onChange({ look: look === "cards" ? undefined : look })} />
      <Check label="Show stars" checked={block.showRating !== false} onChange={(show) => onChange({ showRating: show ? undefined : false })} />
    </>
  );
}

/** The profiles social media buttons link to (D91). */
function SocialLinksFields({ block, onChange }: BlockEditorProps<SocialLinksBlock>) {
  const networkId = useId();
  return (
    <>
      <ItemsEditor<SocialLink>
        label="Links"
        items={block.links}
        max={ITEMS_MAX}
        addLabel="Add a link"
        nameOf={(link) => `${SOCIAL_NETWORKS[link.network]}${link.href.trim() ? "" : " (no address yet)"}`}
        newItem={() => ({ id: newItemId(), network: "facebook", href: "" })}
        onChange={(links) => onChange({ links })}
      >
        {(link, change) => {
          const typed = link.href.trim();
          const works = typed === "" || socialHref(link.network, typed) !== null;
          return (
            <>
              <div className="flex flex-col gap-1">
                <label htmlFor={`${networkId}-${link.id}`} className="text-sm font-medium">
                  Network
                </label>
                <select
                  id={`${networkId}-${link.id}`}
                  value={link.network}
                  onChange={(event) => change({ network: event.target.value as SocialNetwork })}
                  className={fieldClass}
                >
                  {(Object.keys(SOCIAL_NETWORKS) as SocialNetwork[]).map((network) => (
                    <option key={network} value={network}>
                      {SOCIAL_NETWORKS[network]}
                    </option>
                  ))}
                </select>
              </div>
              <TextField
                label={link.network === "email" ? "Email address" : link.network === "phone" ? "Phone number" : "Address of the profile"}
                value={link.href}
                max={500}
                placeholder={socialPlaceholder(link.network)}
                hint={works ? undefined : "That is not an address this link can go to."}
                onChange={(href) => change({ href })}
              />
            </>
          );
        }}
      </ItemsEditor>
      <p className="text-xs text-muted">Links open in a new tab. A link without an address is left out on the site.</p>
    </>
  );
}

/** How social media buttons look (D91). */
function SocialLinksStyleFields({ block, onChange }: BlockEditorProps<SocialLinksBlock>) {
  const look = block.look ?? "plain";
  return (
    <>
      <Choices legend="Look" options={optionsOf(SOCIAL_LOOKS)} value={look} onChange={(value) => onChange({ look: value === "plain" ? undefined : value })} />
      {look !== "plain" && (
        <Choices legend="Shape" options={optionsOf(SOCIAL_SHAPES)} value={block.shape ?? "circle"} onChange={(shape) => onChange({ shape: shape === "circle" ? undefined : shape })} />
      )}
      <Choices
        legend="Colours"
        options={optionsOf(SOCIAL_COLORS)}
        value={block.colors ?? "brand"}
        onChange={(colors) => onChange({ colors: colors === "brand" ? undefined : colors, ...(colors !== "custom" && { color: undefined }) })}
      />
      {block.colors === "custom" && <ColorField label="Colour" value={block.color ?? "#111111"} onChange={(color) => onChange({ color })} />}
      <Choices legend="Size" options={optionsOf(BUTTON_SIZES)} value={block.size ?? "md"} onChange={(size) => onChange({ size: size === "md" ? undefined : size })} />
      <NumberField label="Space between" value={block.gap ?? 12} min={0} max={SOCIAL_GAP_MAX} unit="px" onChange={(gap) => onChange({ gap: gap === 12 ? undefined : gap })} />
      <Choices
        legend="Place"
        options={optionsOf(SEPARATOR_POSITIONS)}
        value={block.position ?? "left"}
        onChange={(position) => onChange({ position: position === "left" ? undefined : position })}
      />
      <Check label="Show the networks' names" checked={Boolean(block.showNames)} onChange={(showNames) => onChange({ showNames: showNames || undefined })} />
    </>
  );
}

/** Chooses one of the icon list's icons (D91). */
function IconPicker({ value, onChange }: { value: IconName; onChange: (icon: IconName) => void }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">Icon: {ICONS[value]}</legend>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))] gap-1">
        {(Object.keys(ICONS) as IconName[]).map((icon) => (
          <button
            key={icon}
            type="button"
            aria-pressed={icon === value}
            aria-label={ICONS[icon]}
            title={ICONS[icon]}
            onClick={() => onChange(icon)}
            className={`flex size-10 items-center justify-center rounded-md border ${
              icon === value ? "border-foreground bg-foreground text-background" : "border-border hover:bg-surface"
            }`}
          >
            <ListIcon name={icon} className="size-5" />
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** An icon list's lines (D91). */
function IconListFields({ block, onChange }: BlockEditorProps<IconListBlock>) {
  return (
    <>
      <ItemsEditor<IconListItem>
        label="Lines"
        items={block.items}
        max={ITEMS_MAX}
        addLabel="Add a line"
        nameOf={(item, index) => item.text.trim() || `Line ${index + 1} (no words yet)`}
        // A new line takes the icon of the one before, as lists mostly share one.
        newItem={() => ({ id: newItemId(), icon: block.items.at(-1)?.icon ?? "check", text: "", href: "" })}
        onChange={(items) => onChange({ items })}
      >
        {(item, change) => {
          const address = item.href.trim();
          return (
            <>
              <TextField label="Words" value={item.text} max={ICON_LIST_TEXT_MAX} placeholder="Free delivery over 500 kr" onChange={(text) => change({ text })} />
              <TextField
                label="Links to (optional)"
                value={item.href}
                max={2000}
                placeholder="https://… or /about"
                hint={address === "" || isLinkAddress(address) ? undefined : "Use a web address (https://…), a page on the site (/about), mailto: or tel:."}
                onChange={(href) => change({ href })}
              />
              <IconPicker value={item.icon} onChange={(icon) => change({ icon })} />
            </>
          );
        }}
      </ItemsEditor>
      <p className="text-xs text-muted">A line without words is left out on the site. The icons are for looks: the words say what each line means.</p>
    </>
  );
}

/** How an icon list is laid out and its icons look (D91). */
function IconListStyleFields({ block, onChange }: BlockEditorProps<IconListBlock>) {
  return (
    <>
      <Choices legend="Lines" options={optionsOf(ICON_LIST_LAYOUTS)} value={block.layout ?? "column"} onChange={(layout) => onChange({ layout: layout === "column" ? undefined : layout })} />
      {block.layout === "row" && (
        <Choices
          legend="Place"
          options={optionsOf(SEPARATOR_POSITIONS)}
          value={block.position ?? "left"}
          onChange={(position) => onChange({ position: position === "left" ? undefined : position })}
        />
      )}
      <Choices legend="Icon size" options={optionsOf(BUTTON_SIZES)} value={block.iconSize ?? "md"} onChange={(iconSize) => onChange({ iconSize: iconSize === "md" ? undefined : iconSize })} />
      <OptionalColor label="Icon colour" hint="The theme's accent unless chosen." value={block.iconColor} fallback="#2563eb" onChange={(iconColor) => onChange({ iconColor })} />
      <NumberField label="Space between lines" value={block.gap ?? 12} min={0} max={SOCIAL_GAP_MAX} unit="px" onChange={(gap) => onChange({ gap: gap === 12 ? undefined : gap })} />
    </>
  );
}

/** Where a form sends (D93): addresses one per line, kept as typed until they are all addresses. */
function RecipientsField({ value, onChange }: { value: string[]; onChange: (recipients: string[]) => void }) {
  const [text, setText] = useState(value.join("\n"));
  const typed = text
    .split(/[\s,;]+/)
    .map((address) => address.trim().toLowerCase())
    .filter(Boolean);
  const wrong = typed.filter((address) => !isEmail(address));
  return (
    <TextField
      label="Send to"
      value={text}
      max={1500}
      multiline
      placeholder="you@example.com"
      hint={
        wrong.length > 0
          ? `Not email addresses: ${wrong.join(", ")}`
          : typed.length > FORM_RECIPIENTS_MAX
            ? `A form sends to at most ${FORM_RECIPIENTS_MAX} addresses.`
            : `Up to ${FORM_RECIPIENTS_MAX} email addresses, one per line. They are never shown on the site; until there is one, the form does not show there.`
      }
      onChange={(next) => {
        setText(next);
        onChange([
          ...new Set(
            next
              .split(/[\s,;]+/)
              .map((address) => address.trim().toLowerCase())
              .filter(Boolean),
          ),
        ]);
      }}
    />
  );
}

/** What a form says once sent, and its button's words; empty, the page's language's usual words. */
function FormTexts({
  block,
  onChange,
  usual,
}: {
  block: Pick<EmailFormBlock, "submitLabel" | "successMessage">;
  onChange: (patch: { submitLabel?: string; successMessage?: string }) => void;
  usual: { submit: string; success: string; when?: string };
}) {
  return (
    <>
      <TextField label="Button text" value={block.submitLabel} max={BUTTON_LABEL_MAX} placeholder={usual.submit} hint="Empty, the usual words in the page's language." onChange={(submitLabel) => onChange({ submitLabel })} />
      <TextField
        label="Thank-you message"
        value={block.successMessage}
        max={FORM_TEXT_MAX}
        multiline
        placeholder={usual.success}
        hint={`${usual.when ?? "Shown in place of the form once sent."} Empty, the usual words in the page's language.`}
        onChange={(successMessage) => onChange({ successMessage })}
      />
    </>
  );
}

const LABEL_HINTS: Partial<Record<FormFieldKind, string>> = { name: "Name", email: "Email", phone: "Phone", textarea: "Message" };

/** An email form's questions and where it sends (D93). */
function EmailFormFields({ block, onChange }: BlockEditorProps<EmailFormBlock>) {
  const en = t("en").form;
  return (
    <>
      <RecipientsField value={block.recipients} onChange={(recipients) => onChange({ recipients })} />
      <TextField
        label="Email subject"
        value={block.subject}
        max={FORM_LABEL_MAX}
        placeholder={en.messageSubject("the site's name")}
        hint="What the emails you get are called. Visitors never see it."
        onChange={(subject) => onChange({ subject })}
      />
      <ItemsEditor<FormField>
        label="Questions"
        items={block.fields}
        max={FORM_FIELDS_MAX}
        addLabel="Add a question"
        nameOf={(field, index) => field.label.trim() || LABEL_HINTS[field.kind] || `Question ${index + 1} (${FORM_FIELD_KINDS[field.kind].toLowerCase()}, no words yet)`}
        newItem={() => ({ id: newItemId(), kind: "text", label: "" })}
        onChange={(fields) => onChange({ fields })}
      >
        {(field, change) => (
          <>
            <Choices
              legend="Kind"
              options={optionsOf(FORM_FIELD_KINDS)}
              value={field.kind}
              onChange={(kind) => change({ kind, ...(kind === "select" && !field.options?.length && { options: [""] }) })}
            />
            <TextField
              label={LABELLED_KINDS.includes(field.kind) ? "Question" : "Question (optional)"}
              value={field.label}
              max={FORM_LABEL_MAX}
              placeholder={LABEL_HINTS[field.kind]}
              hint={LABELLED_KINDS.includes(field.kind) ? undefined : "Empty, the usual word in the page's language."}
              onChange={(label) => change({ label })}
            />
            {field.kind === "select" && (
              <OptionsField value={field.options ?? []} onChange={(options) => change({ options })} />
            )}
            {field.kind !== "checkbox" && field.kind !== "select" && (
              <TextField label="Hint inside the field (optional)" value={field.placeholder ?? ""} max={FORM_LABEL_MAX} onChange={(placeholder) => change({ placeholder: placeholder || undefined })} />
            )}
            <Check
              label={field.kind === "checkbox" ? "Must be ticked" : "Must be answered"}
              hint={field.kind === "email" ? "The first email address asked for is the one your reply goes to." : undefined}
              checked={Boolean(field.required)}
              onChange={(required) => change({ required: required || undefined })}
            />
          </>
        )}
      </ItemsEditor>
      <Check
        label="Ask for consent"
        hint="A tick box visitors must tick to send, such as agreeing to how their message is used."
        checked={block.consent !== undefined}
        onChange={(on) => onChange({ consent: on ? "" : undefined })}
      />
      {block.consent !== undefined && (
        <div className="pl-7">
          <TextField label="The tick box's words" value={block.consent} max={FORM_TEXT_MAX} multiline placeholder="I agree that you store my message to answer it." onChange={(consent) => onChange({ consent })} />
        </div>
      )}
      <FormTexts block={block} onChange={onChange} usual={{ submit: en.send, success: en.sent }} />
    </>
  );
}

/** A choice's options, one per line. */
function OptionsField({ value, onChange }: { value: string[]; onChange: (options: string[]) => void }) {
  const [text, setText] = useState(value.join("\n"));
  return (
    <TextField
      label="Choices"
      value={text}
      max={FORM_OPTIONS_MAX * (FORM_LABEL_MAX + 1)}
      multiline
      hint={`One per line, up to ${FORM_OPTIONS_MAX}.`}
      onChange={(next) => {
        setText(next);
        onChange(
          next
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .slice(0, FORM_OPTIONS_MAX),
        );
      }}
    />
  );
}

/** A form's button (D93). */
function FormStyleFields({ block, onChange }: BlockEditorProps<EmailFormBlock> | BlockEditorProps<NewsletterBlock>) {
  const look = block.button ?? {};
  const set = (patch: Partial<FormButton>) => {
    const next = { ...look, ...patch };
    const kept = Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined)) as FormButton;
    (onChange as (patch: { button?: FormButton }) => void)({ button: Object.keys(kept).length ? kept : undefined });
  };
  return (
    <>
      {block.type === "newsletter" && (
        <Choices
          legend="Field and button"
          options={optionsOf(NEWSLETTER_LAYOUTS)}
          value={block.layout ?? "inline"}
          onChange={(layout) => (onChange as (patch: Partial<NewsletterBlock>) => void)({ layout: layout === "inline" ? undefined : layout })}
        />
      )}
      <ButtonLookFields look={look} onChange={set} />
      <Check label="Button as wide as the form" checked={Boolean(look.fullWidth)} onChange={(fullWidth) => set({ fullWidth: fullWidth || undefined })} />
    </>
  );
}

/** A newsletter sign-up (D93). */
function NewsletterFields({ block, onChange }: BlockEditorProps<NewsletterBlock>) {
  const en = t("en").form;
  return (
    <>
      <RecipientsField value={block.recipients} onChange={(recipients) => onChange({ recipients })} />
      <Check
        label="Confirm the address first (double opt-in)"
        hint="The visitor gets an email with a link, and the sign-up is sent to you only once they open it. Recommended: it proves the consent and keeps out addresses typed by others."
        checked={block.confirm !== false}
        onChange={(confirm) => onChange({ confirm: confirm ? undefined : false })}
      />
      <Check label="Ask for a name too" hint="Never required." checked={Boolean(block.askName)} onChange={(askName) => onChange({ askName: askName || undefined })} />
      <TextField label="Hint inside the email field" value={block.placeholder} max={FORM_LABEL_MAX} placeholder={en.emailPlaceholder} onChange={(placeholder) => onChange({ placeholder })} />
      <TextField
        label="Consent"
        value={block.consent}
        max={FORM_TEXT_MAX}
        multiline
        placeholder={en.newsletterConsent}
        hint="The words visitors tick to sign up; sent to you with each sign-up. Empty, the usual words in the page's language."
        onChange={(consent) => onChange({ consent })}
      />
      <FormTexts block={block} onChange={onChange} usual={{
          submit: en.subscribe,
          success: block.confirm === false ? en.subscribed : en.confirmed,
          when:
            block.confirm === false
              ? "Shown in place of the form once signed up."
              : "Shown when the visitor comes back from the link in their email; right after signing up, they are asked to check their email.",
        }} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Custom fields (D118)
// ---------------------------------------------------------------------------

/**
 * The store's active field groups (D118), from the page builder, for the
 * components that show them (a product layout's Custom fields parts and a
 * page's Custom fields component); null where the owner has none (Kaizen's).
 */
export const FieldGroupsContext = createContext<FieldGroup[] | null>(null);

/** What the two components that show fields have in common. */
export type FieldsSettings = Partial<Pick<CustomFieldBlock, "groupId" | "fieldId" | "display" | "showLabel" | "showHeading" | "heading" | "source">>;

/** The groups that can be on the kinds of thing a component shows fields of. */
export function useFieldGroups(entities: readonly FieldEntity[]): FieldGroup[] {
  const groups = useContext(FieldGroupsContext);
  return (groups ?? []).filter((group) => group.entities.some((entity) => entities.includes(entity)));
}

const ENTITY_WORDS: Record<FieldEntity, string> = {
  product: "products",
  variant: "variants",
  page: "pages",
  article: "articles",
  term: "categories and tags",
  store: "the store",
  customer: "customers",
  order: "orders",
};
const FIELD_ENTITY_NOUN: Record<FieldEntity, string> = {
  product: "product",
  variant: "variant",
  page: "page",
  article: "article",
  term: "category or tag",
  store: "store",
  customer: "customer",
  order: "order",
};
/** What the fields are on, for a sentence: "the product", "the page or article". */
const thing = (entities: readonly FieldEntity[]) => entities.map((entity) => FIELD_ENTITY_NOUN[entity]).join(" or ");

/** A group or a repeater is picked as one field, so its option says what it holds. */
const structureNote = (def: FieldDef) =>
  def.type === "group" || def.type === "repeater" ? ` (${def.type}, ${def.subFields?.length ?? 0} fields)` : "";
const fieldOption = (def: FieldDef) =>
  `${def.label}${structureNote(def)}${def.access === "public" ? "" : " (not shown on the site)"}`;

/**
 * What a component shows of the custom fields: `group` a whole group (none
 * chosen: every group that applies to the thing), `field` one field of a
 * group, `either` one or the other. Its display, whether each field's label
 * shows, and the heading over a group.
 */
export function FieldsSettingsFields({
  value,
  entities: own,
  mode,
  onChange,
}: {
  value: FieldsSettings;
  /** What the component's own fields are on: the product, the page or article. */
  entities: readonly FieldEntity[];
  mode: "group" | "field" | "either";
  onChange: (patch: FieldsSettings) => void;
}) {
  // Fields of the store itself (D120) instead of those of the thing the component is on.
  const ofStore = value.source === "store";
  const entities: readonly FieldEntity[] = ofStore ? ["store"] : own;
  const groups = useFieldGroups(entities);
  const storeHasGroups = useFieldGroups(["store"]).length > 0;
  const sourceId = useId();
  const id = useId();
  const chosen = value.fieldId ? `f:${value.fieldId}` : value.groupId ? `g:${value.groupId}` : "";
  const known =
    chosen === "" ||
    groups.some((group) => (value.fieldId ? group.fields.some((f) => f.id === value.fieldId) : group.id === value.groupId));
  const words = entities.map((entity) => ENTITY_WORDS[entity]).join(" and ");
  const single = mode === "field" || Boolean(value.fieldId);
  const wholeGroup = !single && Boolean(value.groupId);
  const pick = (next: string) => {
    if (next === "") return onChange({ groupId: undefined, fieldId: undefined });
    const [kind, key] = [next.slice(0, 1), next.slice(2)];
    if (kind === "g") return onChange({ groupId: key, fieldId: undefined });
    const group = groups.find((g) => g.fields.some((f) => f.id === key));
    onChange({ groupId: group?.id, fieldId: key });
  };

  // Whose fields: the thing's own, or the store's (D120), which a header or footer has nothing else to show.
  const sourceSelect =
    storeHasGroups || ofStore ? (
      <div className="flex flex-col gap-1">
        <label htmlFor={sourceId} className="text-sm font-medium">
          Fields of
        </label>
        <select
          id={sourceId}
          value={ofStore ? "store" : "own"}
          onChange={(event) => onChange({ source: event.target.value === "store" ? "store" : undefined, groupId: undefined, fieldId: undefined })}
          className={fieldClass}
        >
          <option value="own">{`This ${thing(own)}`}</option>
          <option value="store">The store (its own custom fields)</option>
        </select>
      </div>
    ) : null;

  if (groups.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        {sourceSelect}
        <p className="rounded-md bg-surface p-3 text-sm text-muted">
          There are no custom fields for {words} yet. Make a group under Custom fields in the store&apos;s menu, then choose it here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {sourceSelect}
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-sm font-medium">
          {mode === "field" ? "Field" : mode === "group" ? "Group" : "Shows"}
        </label>
        <select id={id} value={chosen} onChange={(event) => pick(event.target.value)} className={fieldClass}>
          {mode !== "field" && <option value="">{`Every group that applies to the ${thing(entities)}`}</option>}
          {mode === "field" && <option value="">Choose a field</option>}
          {!known && <option value={chosen}>A field or group that is gone</option>}
          {groups.map((group) => (
            <optgroup key={group.id} label={group.name}>
              {mode !== "field" && <option value={`g:${group.id}`}>{`The whole group: ${group.name}`}</option>}
              {mode !== "group" && group.fields.map((def) => <option key={def.id} value={`f:${def.id}`}>{fieldOption(def)}</option>)}
            </optgroup>
          ))}
        </select>
        <p className="text-xs text-muted">Only fields set to be shown on the site are drawn, and only those with a value. A field with none draws nothing.</p>
      </div>
      <Choices
        legend="Show as"
        options={(Object.keys(FIELD_DISPLAYS) as FieldDisplay[]).map((display) => ({ value: display, label: FIELD_DISPLAYS[display] }))}
        value={value.display ?? "table"}
        onChange={(display) => onChange({ display: display === "table" ? undefined : display })}
      />
      <Check label="Label of each field" hint="Beside its value." checked={value.showLabel !== false} onChange={(on) => onChange({ showLabel: on ? undefined : false })} />
      {!single && (
        <Check
          label="Group name as a heading"
          checked={value.showHeading !== false}
          onChange={(on) => onChange({ showHeading: on ? undefined : false })}
        />
      )}
      {(single || (value.showHeading !== false && wholeGroup)) && (
        <TextField
          label="Heading text"
          value={value.heading ?? ""}
          max={HEADING_MAX}
          placeholder={single ? "No heading" : "The group's name"}
          hint={single ? "Over the field; none unless you write one." : "Empty: the group's name. With every group chosen, each shows under its own name."}
          onChange={(heading) => onChange({ heading: heading || undefined })}
        />
      )}
    </div>
  );
}

/**
 * What the custom fields a block can take its content from are on (D118,
 * phase 2), set by the builder: the page's or article's own, or the product's
 * in a product layout. Null where a block has no fields to take: a header, a
 * footer, Kaizen's own pages.
 */
export const BindEntitiesContext = createContext<readonly FieldEntity[] | null>(null);

/** The top-level fields a kind of block can take, by group, from the groups that can be on the thing. */
function bindOptions(blockType: string, groups: readonly FieldGroup[]): { group: FieldGroup; fields: FieldDef[] }[] {
  return groups
    .map((group) => ({ group, fields: group.fields.filter((def) => bindable(blockType, def.type)) }))
    .filter((option) => option.fields.length > 0);
}

/**
 * "Take from field" (D118): the block shows the value of a custom field of the
 * thing the page is on instead of its own content, which stays as what shows
 * when the field is empty, if the owner keeps it. Sits at the top of a
 * heading's, rich text's, image's and button's General tab.
 */
export function BindFields({
  blockType,
  bind,
  onChange,
}: {
  blockType: string;
  bind: FieldBinding | undefined;
  onChange: (bind: FieldBinding | undefined) => void;
}) {
  const entities = useContext(BindEntitiesContext);
  // The store's own fields (D120): the only ones a header or footer has, and an option anywhere else.
  const storeOnly = entities !== null && entities.length === 1 && entities[0] === "store";
  const [source, setSource] = useState<"store" | undefined>(bind?.source);
  const ofStore = storeOnly || source === "store";
  const groups = useFieldGroups(ofStore ? ["store"] : (entities ?? []));
  const storeHasGroups = useFieldGroups(["store"]).length > 0;
  const id = useId();
  const sourceId = useId();
  if (entities === null || !canBind(blockType) || (groups.length === 0 && !bind && !storeHasGroups)) return null;
  const options = bindOptions(blockType, groups);
  const known = !bind || options.some((option) => option.fields.some((def) => def.id === bind.fieldId));
  const noun = thing(ofStore ? ["store"] : entities);
  const bound = (fieldId: string, fallback: boolean | undefined): FieldBinding => ({
    fieldId,
    ...(ofStore && { source: "store" as const }),
    ...(fallback && { fallback: true }),
  });
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      {!storeOnly && storeHasGroups && (
        <div className="flex flex-col gap-1">
          <label htmlFor={sourceId} className="text-sm font-medium">
            Fields of
          </label>
          <select
            id={sourceId}
            value={ofStore ? "store" : "own"}
            onChange={(event) => {
              setSource(event.target.value === "store" ? "store" : undefined);
              if (bind) onChange(undefined);
            }}
            className={fieldClass}
          >
            <option value="own">{`This ${thing(entities)}`}</option>
            <option value="store">The store (its own custom fields)</option>
          </select>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-sm font-medium">
          Take from field
        </label>
        <select
          id={id}
          value={bind?.fieldId ?? ""}
          onChange={(event) => onChange(event.target.value ? bound(event.target.value, bind?.fallback) : undefined)}
          className={fieldClass}
        >
          <option value="">No, use what is written here</option>
          {bind && !known && <option value={bind.fieldId}>A field that is gone or cannot be used here</option>}
          {options.map(({ group, fields }) => (
            <optgroup key={group.id} label={group.name}>
              {fields.map((def) => (
                <option key={def.id} value={def.id}>{`${group.name} › ${def.label}${def.access === "public" ? "" : " (not shown on the site)"}`}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <p className="text-xs text-muted">
          {options.length === 0
            ? `None of the ${noun}'s fields is of a kind this can take yet.`
            : `Shows the value of the ${noun}'s field, in the shopper's language. Only fields set to be shown on the site can be used, and a ${noun} with no value for it shows nothing here.`}
        </p>
      </div>
      {bind && (
        <Check
          label="Keep my own content when the field is empty"
          hint="What is written or chosen below then shows, rather than nothing."
          checked={Boolean(bind.fallback)}
          onChange={(on) => onChange(bound(bind.fieldId, on))}
        />
      )}
    </div>
  );
}

/** On the canvas: a small note that a block takes its content from a field, and which. */
export function BindBadge({ bind }: { bind: FieldBinding }) {
  const groups = useContext(FieldGroupsContext);
  const def = (groups ?? []).flatMap((group) => group.fields).find((f) => f.id === bind.fieldId);
  return (
    <p className="mb-1 w-fit rounded border border-dashed border-border px-1.5 py-0.5 text-[11px] text-muted">
      {`From field: ${def?.label ?? "one that is gone"}${bind.fallback ? " (own content if empty)" : ""}`}
    </p>
  );
}

/** The page component that shows the fields of the page or article it is on. */
function CustomFieldFields({ block, onChange }: BlockEditorProps<CustomFieldBlock>) {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">
        Shows the custom fields of the page or article this is on, or of the store itself, in the shopper&apos;s language. Nothing shows where there is no value.
      </p>
      <FieldsSettingsFields value={block} entities={["page", "article"]} mode="either" onChange={onChange} />
    </div>
  );
}

/**
 * What a field loop is set to (D120): the repeater whose rows it draws (a
 * top-level repeater of the groups that can be on the thing), the layout, the
 * columns, and which of the repeater's sub fields fills each slot of a row,
 * each list holding only the sub fields of a kind the slot can draw. Shared
 * by the page component and the product layout's part.
 */
export function LoopSettingsFields({
  value,
  entities,
  onChange,
}: {
  value: LoopConfig;
  entities: readonly FieldEntity[];
  onChange: (patch: Partial<LoopConfig>) => void;
}) {
  const groups = useFieldGroups(entities);
  const id = useId();
  const repeaters = groups.flatMap((group) => group.fields.filter(isLoopable).map((def) => ({ group, def })));
  const chosen = repeaters.find(({ def }) => def.id === value.fieldId);
  const words = entities.map((entity) => ENTITY_WORDS[entity]).join(" and ");
  const layout = value.layout ?? "cards";

  if (repeaters.length === 0) {
    return (
      <p className="rounded-md bg-surface p-3 text-sm text-muted">
        There is no repeater among the custom fields for {words} yet. Add a field of the kind Repeater to a group under Custom fields in the store&apos;s menu, then choose it here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-sm font-medium">
          Repeater
        </label>
        <select
          id={id}
          value={value.fieldId ?? ""}
          onChange={(event) => {
            const next = repeaters.find(({ def }) => def.id === event.target.value);
            onChange(
              next
                ? { fieldId: next.def.id, groupId: next.group.id, slots: suggestSlots(next.def) }
                : { fieldId: undefined, groupId: undefined, slots: {} },
            );
          }}
          className={fieldClass}
        >
          <option value="">Choose a repeater</option>
          {value.fieldId && !chosen && <option value={value.fieldId}>A repeater that is gone</option>}
          {repeaters.map(({ group, def }) => (
            <option key={def.id} value={def.id}>{`${group.name} › ${def.label}${def.access === "public" ? "" : " (not shown on the site)"}`}</option>
          ))}
        </select>
        <p className="text-xs text-muted">Each row of the repeater is drawn as one card, line or column. Only a repeater set to be shown on the site draws, and only rows with something in them.</p>
      </div>
      <Choices
        legend="Layout"
        options={(Object.keys(LOOP_LAYOUTS) as LoopLayout[]).map((key) => ({ value: key, label: LOOP_LAYOUTS[key] }))}
        value={layout}
        onChange={(next) => onChange({ layout: next === "cards" ? undefined : next })}
      />
      {layout !== "list" && (
        <Choices
          legend="Columns"
          hint="on larger screens"
          options={LOOP_COLUMNS.map((n) => ({ value: String(n), label: String(n) }))}
          value={String(value.columns ?? 3)}
          onChange={(next) => onChange({ columns: (Number(next) === 3 ? undefined : Number(next)) as LoopColumns | undefined })}
        />
      )}
      {chosen && (
        <div className="flex flex-col gap-3 rounded-md border border-border p-3">
          <p className="text-sm font-medium">What each row shows</p>
          {LOOP_SLOT_KEYS.map((slot) => (
            <SlotPicker
              key={slot}
              slot={slot}
              choices={slotChoices(chosen.def, slot)}
              value={validSlots(chosen.def, value.slots)[slot]}
              onChange={(sub) => onChange({ slots: { ...validSlots(chosen.def, value.slots), [slot]: sub } })}
            />
          ))}
          <Check
            label="The whole card is the link"
            hint="Otherwise the title is the link, or the link's own words when there is no title."
            checked={Boolean(value.linkWholeCard)}
            onChange={(on) => onChange({ linkWholeCard: on ? true : undefined })}
          />
        </div>
      )}
      <TextField
        label="Heading"
        value={value.heading ?? ""}
        max={HEADING_MAX}
        placeholder="No heading"
        hint="Over the loop; none unless you write one."
        onChange={(heading) => onChange({ heading: heading || undefined })}
      />
    </div>
  );
}

const SLOT_HINTS: Record<LoopSlot, string> = {
  image: "A picture field.",
  title: "A short text, choice or number.",
  text: "A text, text area or rich text.",
  link: "A link or file field.",
  badge: "A short text, choice or number, as a small label.",
};

function SlotPicker({
  slot,
  choices,
  value,
  onChange,
}: {
  slot: LoopSlot;
  choices: FieldDef[];
  value: string | undefined;
  onChange: (sub: string | undefined) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm">
        {LOOP_SLOTS[slot]}
      </label>
      <select id={id} value={value ?? ""} onChange={(event) => onChange(event.target.value || undefined)} className={fieldClass} disabled={choices.length === 0}>
        <option value="">{choices.length === 0 ? `No sub field fits (${SLOT_HINTS[slot]})` : "Nothing"}</option>
        {choices.map((sub) => (
          <option key={sub.id} value={sub.id}>
            {sub.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * "Show fields on tiles" (D120): up to three plain custom fields of the kind of
 * thing a content grid lists (products, pages or articles) that each tile shows
 * under its title, one line each. Only the groups that can be on that kind of
 * thing are offered; nothing shows where the owner has no fields (Kaizen's own pages).
 */
export function TileFieldsPicker({
  entity,
  value,
  onChange,
}: {
  entity: "product" | "page" | "article";
  value: readonly string[];
  onChange: (ids: string[] | undefined) => void;
}) {
  const options = tileFieldOptions(useFieldGroups([entity]));
  const offered = new Set(options.flatMap((option) => option.fields.map((def) => def.id)));
  // What was chosen for another kind of thing is not on these tiles: it goes at the next change.
  const chosen = value.filter((id) => offered.has(id));
  if (options.length === 0) return null;
  const toggle = (id: string, on: boolean) => {
    const next = on ? [...chosen, id] : chosen.filter((f) => f !== id);
    onChange(next.length > 0 ? next : undefined);
  };
  return (
    <fieldset className="flex flex-col gap-2 border-t border-border pt-4">
      <legend className="float-left mb-2 w-full text-sm font-medium">
        Show fields on tiles <span className="font-normal text-muted">(up to {TILE_FIELDS_MAX})</span>
      </legend>
      <p className="text-xs text-muted">
        Each tile shows the field&apos;s label and value under its title, when the item has one. Only fields set to be shown on the site are drawn.
      </p>
      {options.map(({ group, fields }) => (
        <div key={group.id} className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted">{group.name}</p>
          {fields.map((def) => (
            <Check
              key={def.id}
              label={def.label}
              hint={def.access === "public" ? undefined : "Not shown on the site yet"}
              checked={chosen.includes(def.id)}
              disabled={!chosen.includes(def.id) && chosen.length >= TILE_FIELDS_MAX}
              onChange={(on) => toggle(def.id, on)}
            />
          ))}
        </div>
      ))}
    </fieldset>
  );
}

/** The page component that draws a repeater's rows of the page or article it is on. */
function FieldLoopFields({ block, onChange }: BlockEditorProps<FieldLoopBlock>) {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">
        Draws the rows of a repeater of the page or article this is on, in the shopper&apos;s language, each as a card, line or column. A page with no rows shows nothing here.
      </p>
      <LoopSettingsFields value={block} entities={["page", "article"]} onChange={onChange} />
    </div>
  );
}

/** A field loop on the canvas: which repeater and how, as the canvas cannot know a thing's rows. */
export function LoopStandIn({ value, entities }: { value: LoopConfig; entities: readonly FieldEntity[] }) {
  const groups = useFieldGroups(entities);
  const def = groups.flatMap((group) => group.fields).find((f) => f.id === value.fieldId);
  const layout = value.layout ?? "cards";
  const columns = layout === "list" ? 1 : (value.columns ?? 3);
  const slots = def ? validSlots(def, value.slots) : {};
  const named = LOOP_SLOT_KEYS.flatMap((slot) => {
    const sub = slots[slot] && def?.subFields?.find((f) => f.id === slots[slot]);
    return sub ? [`${LOOP_SLOTS[slot].toLowerCase()}: ${sub.label}`] : [];
  });
  return (
    <span className="flex flex-col gap-2 text-sm">
      <span className="font-medium">{`Field loop: ${def ? def.label : value.fieldId ? "a repeater that is gone" : "choose a repeater"}`}</span>
      {def ? (
        <>
          <span className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(columns, 3)}, minmax(0, 1fr))` }}>
            {[0, 1, 2].slice(0, layout === "list" ? 2 : Math.min(columns, 3)).map((n) => (
              <span
                key={n}
                className={`flex gap-2 rounded-lg border border-border p-2 ${layout === "list" ? "flex-row items-center" : "flex-col"}`}
              >
                {slots.image && <span className={layout === "list" ? "size-10 shrink-0 rounded bg-foreground/10" : "aspect-video rounded bg-foreground/10"} />}
                <span className="flex flex-1 flex-col gap-1">
                  <span className="h-2.5 w-2/3 rounded bg-foreground/20" />
                  {slots.text && <span className="h-2 w-full rounded bg-foreground/10" />}
                </span>
              </span>
            ))}
          </span>
          <span className="text-xs text-muted">{named.length > 0 ? `Each row: ${named.join(", ")}.` : "Choose which sub field fills each slot in the settings."}</span>
        </>
      ) : (
        <span className="text-xs text-muted">Choose a repeater in the settings.</span>
      )}
      <span className="text-xs text-muted">The rows are read from each {thing(entities)} where it is shown; a thing with none draws nothing.</span>
    </span>
  );
}

/**
 * How a component that shows custom fields looks on the canvas: what it is
 * and which fields, as the canvas cannot know a product's or page's values.
 */
export function FieldsStandIn({
  value,
  entities,
  mode,
}: {
  value: FieldsSettings;
  entities: readonly FieldEntity[];
  mode: "group" | "field" | "either";
}) {
  const groups = useFieldGroups(value.source === "store" ? ["store"] : entities);
  const single = mode === "field" || Boolean(value.fieldId);
  const shownGroups = value.groupId ? groups.filter((g) => g.id === value.groupId) : groups;
  const field = value.fieldId ? groups.flatMap((g) => g.fields).find((f) => f.id === value.fieldId) : undefined;
  const publicFields = (g: FieldGroup) => g.fields.filter((f) => f.access === "public");
  const display = value.display ?? "table";

  const title = single
    ? `Custom field${value.source === "store" ? " of the store" : ""}: ${field?.label ?? "choose one"}`
    : `Custom fields${value.source === "store" ? " of the store" : ""}: ${value.groupId ? (shownGroups[0]?.name ?? "a group that is gone") : "every group that applies"}`;
  const names = single ? (field ? [field] : []) : shownGroups.flatMap(publicFields);
  const label = (name: string, n: number) =>
    display === "cards" ? (
      <span key={n} className="flex flex-col gap-1 rounded-lg border border-border p-2">
        {value.showLabel !== false && <span className="text-[10px] font-medium tracking-wide text-muted uppercase">{name}</span>}
        <span className="h-2.5 w-2/3 rounded bg-foreground/10" />
      </span>
    ) : (
      <span key={n} className="flex items-center gap-3 border-b border-border py-1.5 last:border-b-0">
        {value.showLabel !== false && <span className="w-1/3 truncate text-muted">{display === "list" ? `${name}:` : name}</span>}
        <span className="h-2.5 flex-1 rounded bg-foreground/10" />
      </span>
    );

  return (
    <span className="flex flex-col gap-2 text-sm">
      <span className="font-medium">{title}</span>
      {names.length > 0 ? (
        <span className={display === "cards" ? "grid grid-cols-2 gap-2" : "flex flex-col"}>{names.map((f, n) => label(f.label, n))}</span>
      ) : (
        <span className="text-xs text-muted">
          {single && !field
            ? "Choose a field in the settings."
            : "None of its fields is set to be shown on the site yet. Set a field's access to Shown on the site."}
        </span>
      )}
      <span className="text-xs text-muted">The values are read from each {thing(entities)} where it is shown; a field with none draws nothing.</span>
    </span>
  );
}
