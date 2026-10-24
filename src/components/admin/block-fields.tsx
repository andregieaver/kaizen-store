"use client";

import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Fragment, createContext, useContext, useId, useRef, useState, type ReactNode } from "react";

import type { ButtonLook } from "@/components/page-block";
import { ListIcon } from "@/components/list-icon";
import { type FieldDef, type FieldEntity, type FieldGroup } from "@/lib/custom-fields";
import { bindable, canBind } from "@/lib/field-binding";
import { LOOP_SLOT_KEYS, isLoopable, slotChoices, suggestSlots, validSlots } from "@/lib/field-loop";
import { AUTOPLAY_SECONDS, CAROUSEL_SNAPS, cleanCarousel, normalizeSeconds, resolveCarousel, type CarouselSettings, type CarouselSnap } from "@/lib/carousel-settings";
import { setAt, sizeSource, valueAt } from "@/lib/responsive";
import { brandColumns } from "@/lib/brands";
import { galleryColumns } from "@/lib/gallery";
import { SIZES } from "@/lib/breakpoints";
import { tileFieldOptions } from "@/lib/tile-fields";
import { isEmail } from "@/lib/forms";
import { t } from "@/lib/i18n";
import { ICONS, type IconName } from "@/lib/icons";
import { SOCIAL_NETWORKS, socialHref, socialPlaceholder, type SocialNetwork } from "@/lib/social-links";
import { embedUrl, EMBED_NAMES } from "@/lib/video-embed";

import { iconToken } from "@/lib/table-icons";
import { addColumn, addRowTo, entriesOf, moveEntry, removeColumn, removeRowFrom, setCell, setSection, type TableData } from "@/lib/table-edit";

import { PixelRange } from "./pixel-range";
import { ColorField } from "./colour-field";
import { GradientText } from "./typography-fields";
import { RichTextEditor } from "./rich-text-editor";
import { inlinePlain } from "@/lib/inline-text";
import { newBlock } from "@/lib/page-rows";
import { ButtonHoverField } from "./hover-fields";
import { SizeMark, inheritedClass, useSizeEdit } from "./responsive-edit";

import {
  ACCORDION_LOOKS,
  TABS_ALIGNS,
  VIDEO_RATIOS,
  VIDEO_SOURCES,
  GRID_GAP_MAX,
  type VideoSource,
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
  SIGNUP_TAGS_MAX,
  ICON_LIST_LAYOUTS,
  ICON_LIST_TEXT_MAX,
  TABLE_CELL_MAX,
  TABLE_COLUMNS_MAX,
  TABLE_FIXED,
  TABLE_MAX_HEIGHT_MAX,
  TABLE_MOBILE,
  TABLE_ROWS_MAX,
  type TableBlock,
  type IconListBlock,
  type IconListItem,
  TESTIMONIAL_COLUMNS,
  TESTIMONIAL_LOOKS,
  TESTIMONIAL_NAME_MAX,
  TESTIMONIAL_QUOTE_MAX,
  type Testimonial,
  type TestimonialsBlock,
  type BrandsBlock,
  type BrandItem,
  GALLERY_DEFAULTS,
  GALLERY_ITEMS_MAX,
  GALLERY_LIMITS,
  GALLERY_TRANSITIONS,
  type GalleryTransition,
  GALLERY_KINDS,
  GALLERY_RATIOS,
  GALLERY_TEXT_MAX,
  GALLERY_VIEWS,
  galleryItemShows,
  type GalleryBlock,
  type GalleryItem,
  type GalleryKind,
  type GalleryRatio,
  type GalleryView,
  BRANDS_DEFAULTS,
  BRANDS_LIMITS,
  BRANDS_VIEWS,
  BRANDS_MOTIONS,
  BRAND_TINTS,
  type BrandTint,
  type BrandsMotion,
  type BrandsView,
  GRID_COLUMNS_MAX,
  CUSTOM_ITEMS_MAX,
  TABS_LOOKS,
  EMPTY_DOC,
  ITEM_TITLE_MAX,
  ITEMS_MAX,
  BUTTON_SHAPES,
  BUTTON_SIZES,
  BUTTON_LABEL_MAX,
  BUTTON_VARIANTS,
  DUAL_GAP_MAX,
  FIELD_DISPLAYS,
  LOOP_COLUMNS,
  LOOP_LAYOUTS,
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
  type FaqBlock,
  type FaqChildType,
  type FaqItem,
  FAQ_CHILD_TYPES,
  FAQ_CHILDREN_MAX,
  blockText,
  isFaqChildType,
  type PanelItem,
  type TabsBlock,
  type VideoBlock,
  type ButtonShape,
  type ButtonSize,
  type ButtonVariant,
  type DualButtonBlock,
  type DualButtonSide,
  type ColumnsBlock,
  type PageBlock,
  type SeparatorBlock,
  type TextAlign,
  type SizeOverrides,
} from "@/lib/page-content";

import type { BlocksMessages } from "@/lib/admin-messages/blocks.en";
import { fillWords } from "@/lib/admin-fill";

import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { useAdminLang, useAdminText } from "./admin-text";
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

export type BlockEditorContext = {
  upload: Upload | null;
  startVideo: StartVideo | null;
  /** Opens a component's own settings (an FAQ's answer's, D208); absent where it cannot be edited (a saved part). */
  editPart?: (blockId: string) => void;
};

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
  columns: { title: "Columns", General: ColumnsFields },
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
  table: {
    title: "Table",
    font: { label: "Font", fallback: "The site's body font" },
    General: TableFields,
    Style: TableStyleFields,
  },
  socialLinks: {
    title: "Social media",
    font: { label: "Font of the names", fallback: "The site's body font" },
    General: SocialLinksFields,
    Style: SocialLinksStyleFields,
  },
  gallery: {
    title: "Gallery",
    font: { label: "Font of the captions", fallback: "The site's body font" },
    General: GalleryFields,
    Style: GalleryStyleFields,
  },
  brands: {
    title: "Brands",
    font: { label: "Font of the names", fallback: "The site's body font" },
    General: BrandsFields,
    Style: BrandsStyleFields,
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
export function editorFor(block: PageBlock, words?: BlocksMessages): BlockEditor<PageBlock> | undefined {
  const editor = BLOCK_EDITORS[block.type] as BlockEditor<PageBlock> | undefined;
  if (!editor || !words) return editor;
  const title = (words.titles as Record<string, string>)[block.type] ?? editor.title;
  const font = editor.font && {
    label: editor.font.label === "Font of the names" ? words.font.names : editor.font.label === "Font of the captions" ? words.font.captions : words.font.label,
    fallback: words.font.fallback,
  };
  return { ...editor, title, font };
}

// ---------------------------------------------------------------------------
// Shared fields
// ---------------------------------------------------------------------------

export const fieldClass = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";
export const smallButton = "min-h-9 rounded-pill border border-edge px-3 text-sm disabled:opacity-40";

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
  const w = useAdminText("blocks");
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
        {unit && <span className="text-sm text-muted">{(w.units as Record<string, string>)[unit] ?? unit}</span>}
      </div>
      {/* A field in pixels has a slider with the value over its thumb (D183). */}
      {unit && /^(px|pixels)$/.test(unit) && max > min && (
        <PixelRange value={value} min={min} max={max} step={max - min > 400 ? 4 : 1} label={fillWords(w.common.slider, { label })} onChange={onChange} className="max-w-64" />
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
            className="relative flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-line px-3 text-sm has-checked:border-brand has-checked:bg-sunken has-checked:font-medium has-focus-visible:outline-2 has-disabled:cursor-default"
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
  const w = useAdminText("blocks").common;
  return (
    <div className="flex flex-col gap-3">
      <Check
        label={fillWords(w.own, { label: label.toLowerCase() })}
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


const ALIGNS = ["left", "center", "right"] as const;


/**
 * A part's alignment (D48), at the screen size the builder edits (D179): at Extra large the part's own, below it an
 * override of the size (`setAt()`), the inherited one greyed with where it comes from, and a × to give it back.
 */
export function TextAlignFields({
  what: asked,
  value: part,
  onChange,
}: {
  what?: string;
  value: { align?: TextAlign; at?: SizeOverrides };
  onChange: (patch: { align?: TextAlign | undefined; at?: SizeOverrides | undefined }) => void;
}) {
  const { size } = useSizeEdit();
  const w = useAdminText("blocks");
  const what = asked ?? w.common.textAlign;
  const source = sizeSource(part, size, "align");
  return (
    <Choices
      legend={what}
      mark={<SizeMark part={part} field="align" label={what} onPatch={onChange} />}
      muted={inheritedClass(source, size)}
      options={ALIGNS.map((value) => ({ value, label: w.lists.positions[value] }))}
      value={valueAt(part, "align", size) ?? "left"}
      onChange={(align) => onChange(setAt(part, size, { align: size === "xl" && align === "left" ? undefined : align }))}
    />
  );
}


/** A button's kind, size, corners and colours (D49): a button's, or a content grid's tile buttons (D51). */
export function ButtonLookFields({ look, onChange }: { look: ButtonLook; onChange: (patch: Partial<ButtonLook>) => void }) {
  const variant = look.variant ?? "filled";
  const w = useAdminText("blocks");
  return (
    <>
      <Choices
        legend={w.button.style}
        options={(Object.keys(BUTTON_VARIANTS) as ButtonVariant[]).map((v) => ({ value: v, label: w.lists.buttonVariants[v] }))}
        value={variant}
        onChange={(v) => onChange({ variant: v === "filled" ? undefined : v })}
      />
      <Choices
        legend={w.button.size}
        options={(Object.keys(BUTTON_SIZES) as ButtonSize[]).map((size) => ({ value: size, label: w.lists.buttonSizes[size] }))}
        value={look.size ?? "md"}
        onChange={(size) => onChange({ size: size === "md" ? undefined : size })}
      />
      <Choices
        legend={w.button.corners}
        disabled={variant === "text"}
        options={(Object.keys(BUTTON_SHAPES) as ButtonShape[]).map((shape) => ({ value: shape, label: w.lists.buttonShapes[shape] }))}
        value={look.shape ?? "rounded"}
        onChange={(shape) => onChange({ shape: shape === "rounded" ? undefined : shape })}
      />
      <OptionalColor
        label={w.button.colour}
        hint={variant === "filled" ? w.button.fillsHint : w.button.outlineHint}
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
  placeholder: asked,
  onChange,
}: {
  label: string;
  href: string;
  newTab: boolean | undefined;
  placeholder?: string;
  onChange: (patch: { label?: string; href?: string; newTab?: boolean }) => void;
}) {
  const id = useId();
  const w = useAdminText("blocks").link;
  const placeholder = asked ?? w.placeholder;
  const address = href.trim();
  const problem = address === "" ? w.noAddress : isLinkAddress(address) ? null : w.badAddress;
  return (
    <div className="flex flex-col gap-4">
      <TextField label={w.text} value={label} max={BUTTON_LABEL_MAX} placeholder={placeholder} onChange={(value) => onChange({ label: value })} />
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-href`} className="text-sm font-medium">
          {w.address}
        </label>
        <input
          id={`${id}-href`}
          value={href}
          maxLength={2000}
          spellCheck={false}
          placeholder={w.addressPlaceholder}
          aria-invalid={Boolean(problem && address)}
          aria-describedby={`${id}-hint`}
          onChange={(event) => onChange({ href: event.target.value })}
          className={`${fieldClass} aria-invalid:border-danger-text`}
        />
        <span id={`${id}-hint`} className={`text-xs ${problem && address ? "text-danger-text " : "text-muted"}`}>
          {problem ?? w.addressHint}
        </span>
      </div>
      <Check
        label={w.newTab}
        hint={w.newTabHint}
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
  const w = useAdminText("blocks").items;
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
      {items.length === 0 && <p className="text-sm text-muted">{w.none}</p>}
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
                    className="min-h-9 flex-1 truncate rounded px-2 text-left text-sm font-medium hover:bg-sunken"
                  >
                    <span aria-hidden className="mr-2 inline-block w-3 text-muted">
                      {expanded ? "▾" : "▸"}
                    </span>
                    {name}
                  </button>
                  <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={fillWords(w.moveUp, { name })} className={smallButton}>
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === items.length - 1}
                    aria-label={fillWords(w.moveDown, { name })}
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
                      aria-label={fillWords(w.duplicateName, { name })}
                      className={smallButton}
                    >
                      {w.duplicate}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onChange(items.filter((i) => i.id !== item.id))}
                    aria-label={fillWords(w.removeName, { name })}
                    className={`${smallButton} text-danger-text `}
                  >
                    {w.remove}
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
      {items.length >= max && <p className="text-xs text-muted">{fillWords(w.atMost, { max })}</p>}
    </fieldset>
  );
}

/**
 * One item in the list: its row of buttons (the children), with a handle to drag it by, and its fields under them while
 * it is open. The handle is a button too, so a keyboard moves it (Space to pick up, the arrows, Space to drop).
 */
function SortableItem({ id, name, body, children }: { id: string; name: string; body: ReactNode; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const w = useAdminText("blocks").items;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-md border border-line bg-card ${isDragging ? "relative z-10 shadow-lg" : ""}`}
    >
      <div className="flex items-center gap-1 p-1">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={fillWords(w.drag, { name })}
          className="min-h-9 cursor-grab touch-none rounded px-1.5 text-muted hover:bg-sunken active:cursor-grabbing"
        >
          <span aria-hidden>⠿</span>
        </button>
        {children}
      </div>
      {body && <div className="flex flex-col gap-4 border-t border-line p-3">{body}</div>}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/** Options for `Choices` from a record of labels. */
const optionsOf = <T extends string>(labels: Record<T, string>, own?: Partial<Record<T, string>>) =>
  (Object.entries(labels) as [T, string][]).map(([value, label]) => ({ value, label: own?.[value] ?? label }));

/** A separator line (D91): its style, thickness, colour, width and place. */
function SeparatorFields({ block, onChange }: BlockEditorProps<SeparatorBlock>) {
  const w = useAdminText("blocks");
  return (
    <>
      <Choices legend={w.separator.line} options={optionsOf(SEPARATOR_LINES, w.lists.separatorLines)} value={block.line ?? "solid"} onChange={(line) => onChange({ line })} />
      <NumberField label={w.separator.thickness} value={block.thickness ?? 1} min={1} max={SEPARATOR_THICKNESS_MAX} unit="pixels" onChange={(thickness) => onChange({ thickness })} />
      <OptionalColor
        label={w.separator.colour}
        hint={w.separator.colourHint}
        value={block.color}
        fallback="#d4d4d8"
        onChange={(color) => onChange({ color })}
      />
      <NumberField label={w.separator.width} value={block.width ?? 100} min={10} max={100} unit="% of the column" onChange={(width) => onChange({ width })} />
      {(block.width ?? 100) < 100 && (
        <Choices legend={w.separator.position} options={optionsOf(SEPARATOR_POSITIONS, w.lists.positions)} value={block.position ?? "center"} onChange={(position) => onChange({ position })} />
      )}
    </>
  );
}

/**
 * A Columns component (D294): how its columns lie and how far apart. Its columns are arranged on the canvas as a row's are (drag one
 * in, out or onto a line of its own; drag the edges between them), and each column has its own settings.
 */
function ColumnsFields({ block, onChange }: BlockEditorProps<ColumnsBlock>) {
  const stacking = block.stack === undefined ? "phones" : block.stack ? "always" : "never";
  const w = useAdminText("blocks").columns;
  return (
    <>
      <p className="text-sm text-muted">{w.intro}</p>
      <Choices
        legend={w.stack}
        options={[
          { value: "phones", label: w.onPhones },
          { value: "never", label: w.never },
          { value: "always", label: w.always },
        ]}
        value={stacking}
        onChange={(value) => onChange({ stack: value === "phones" ? undefined : value === "always" })}
      />
      <ReverseColumns block={block} onChange={onChange} />
      <NumberField label={w.gap} value={block.gap ?? 32} min={0} max={GRID_GAP_MAX} unit="pixels" onChange={(gap) => onChange({ gap })} />
      <Check label={w.equal} checked={Boolean(block.equalHeight)} onChange={(equalHeight) => onChange({ equalHeight: equalHeight || undefined })} />
      <Choices
        legend={w.where}
        options={[
          { value: "top", label: w.top },
          { value: "middle", label: w.middle },
          { value: "bottom", label: w.bottom },
        ]}
        value={block.verticalAlign ?? "top"}
        onChange={(verticalAlign) => onChange({ verticalAlign: verticalAlign === "top" ? undefined : verticalAlign })}
      />
    </>
  );
}

/** Whether a Columns component's last column comes first at the size edited, side by side or one under another (D179). */
function ReverseColumns({ block, onChange }: Pick<BlockEditorProps<ColumnsBlock>, "block" | "onChange">) {
  const { size } = useSizeEdit();
  const w = useAdminText("blocks").columns;
  return (
    <div className={`flex flex-wrap items-start gap-1 ${inheritedClass(sizeSource(block, size, "reverse"), size)}`}>
      <Check
        label={w.reverse}
        hint={w.reverseHint}
        checked={valueAt(block, "reverse", size) === true}
        onChange={(on) => onChange(setAt(block, size, { reverse: size === "xl" ? on || undefined : on }))}
      />
      <SizeMark part={block} field="reverse" label={w.reverse} onPatch={onChange} />
    </div>
  );
}

/** A dual button's two buttons (D91): each one's text, address and new tab. */
function DualButtonFields({ block, onChange }: BlockEditorProps<DualButtonBlock>) {
  const w = useAdminText("blocks").dual;
  const side = (which: "first" | "second", title: string, placeholder: string) => (
    <fieldset className="flex flex-col gap-3 rounded-md border border-line p-3">
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
      {side("first", w.first, w.firstPlaceholder)}
      {side("second", w.second, w.secondPlaceholder)}
    </>
  );
}

/** A dual button's look (D91): each button's style and colours, then their shared size, corners, weight, spacing and place. */
function DualButtonStyleFields({ block, onChange }: BlockEditorProps<DualButtonBlock>) {
  const all = useAdminText("blocks");
  const w = all.dual;
  const look = (which: "first" | "second", title: string, fallback: ButtonVariant) => {
    const side: DualButtonSide = block[which];
    const variant = side.variant ?? fallback;
    const set = (patch: Partial<DualButtonSide>) => onChange({ [which]: { ...side, ...patch } });
    return (
      <fieldset className="flex flex-col gap-3 rounded-md border border-line p-3">
        <legend className="px-1 text-sm font-medium">{title}</legend>
        <Choices legend={all.button.style} options={optionsOf(BUTTON_VARIANTS, all.lists.buttonVariants)} value={variant} onChange={(v) => set({ variant: v })} />
        <OptionalColor
          label={all.button.colour}
          hint={variant === "filled" ? w.accentHint : all.button.outlineHint}
          value={side.fill}
          fallback="#1d4ed8"
          onChange={(fill) => set({ fill })}
        />
      </fieldset>
    );
  };
  return (
    <>
      {look("first", w.first, "filled")}
      {look("second", w.second, "filled")}
      <Choices legend={all.button.size} options={optionsOf(BUTTON_SIZES, all.lists.buttonSizes)} value={block.size ?? "md"} onChange={(size: ButtonSize) => onChange({ size: size === "md" ? undefined : size })} />
      <Choices legend={all.button.corners} options={optionsOf(BUTTON_SHAPES, all.lists.buttonShapes)} value={block.shape ?? "rounded"} onChange={(shape: ButtonShape) => onChange({ shape: shape === "rounded" ? undefined : shape })} />
      <ButtonHoverField value={block.hover} onChange={(hover) => onChange({ hover })} />
      <NumberField label={w.gap} value={block.gap ?? 12} min={0} max={DUAL_GAP_MAX} unit="pixels" onChange={(gap) => onChange({ gap })} />
      <DualStackField block={block} onChange={onChange} />
      <TextAlignFields what={w.position} value={block} onChange={onChange} />
    </>
  );
}

/** A dual button's two one under another, each as wide as the column, at the size edited (D179). */
function DualStackField({ block, onChange }: { block: DualButtonBlock; onChange: (patch: Partial<DualButtonBlock>) => void }) {
  const { size } = useSizeEdit();
  const w = useAdminText("blocks").dual;
  const source = sizeSource(block, size, "stack");
  return (
    <div className={`flex flex-wrap items-start gap-1 ${inheritedClass(source, size)}`}>
      <Check
        label={w.stack}
        hint={w.stackHint}
        checked={valueAt(block, "stack", size) === true}
        onChange={(on) => onChange(setAt(block, size, { stack: size === "xl" ? on || undefined : on }))}
      />
      <SizeMark part={block} field="stack" label={w.stack} onPatch={onChange} />
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
  names: asked,
  onChange,
}: {
  items: PanelItem[];
  /** What one is: a section of an accordion, or a tab. */
  noun: "section" | "tab";
  /** What its title and text are called. */
  names?: { title: string; body: string };
  onChange: (items: PanelItem[]) => void;
}) {
  const w = useAdminText("blocks").panels;
  const names = asked ?? { title: w.title, body: w.text };
  return (
    <ItemsEditor
      label={noun === "section" ? w.sections : w.tabs}
      items={items}
      max={ITEMS_MAX}
      addLabel={noun === "section" ? w.addSection : w.addTab}
      nameOf={(item, index) => item.title.trim() || fillWords(noun === "section" ? w.section : w.tab, { n: index + 1 })}
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
  const w = useAdminText("blocks").panels;
  return (
    <>
      <PanelItemsFields items={block.items} noun="section" onChange={(items) => onChange({ items })} />
      <p className="text-xs text-muted">{w.sectionLeftOut}</p>
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
  const all = useAdminText("blocks");
  const w = all.panels;
  return (
    <>
      <Check label={block.type === "faq" ? w.firstQuestion : w.firstSection} hint={w.firstHint} checked={Boolean(block.openFirst)} onChange={(openFirst) => onChange({ openFirst: openFirst || undefined })} />
      <Check label={w.single} hint={block.type === "faq" ? w.singleQuestion : w.singleSection} checked={Boolean(block.single)} onChange={(single) => onChange({ single: single || undefined })} />
      <Choices legend={w.look} options={optionsOf(ACCORDION_LOOKS, all.lists.accordionLooks)} value={block.look ?? "lines"} onChange={(look) => onChange({ look: look === "lines" ? undefined : look })} />
    </>
  );
}

/** Tabs' titles and texts (D91). */
function TabsFields({ block, onChange }: BlockEditorProps<TabsBlock>) {
  const w = useAdminText("blocks").panels;
  return (
    <>
      <PanelItemsFields items={block.items} noun="tab" onChange={(items) => onChange({ items })} />
      <p className="text-xs text-muted">{w.tabLeftOut}</p>
    </>
  );
}

/** How tabs look (D91). */
function TabsStyleFields({ block, onChange }: BlockEditorProps<TabsBlock>) {
  const all = useAdminText("blocks");
  return (
    <>
      <Choices legend={all.panels.look} options={optionsOf(TABS_LOOKS, all.lists.tabsLooks)} value={block.look ?? "underline"} onChange={(look) => onChange({ look: look === "underline" ? undefined : look })} />
      <Choices
        legend={all.panels.tabsAlign}
        options={optionsOf(TABS_ALIGNS, all.lists.tabsAligns)}
        value={block.tabsAlign ?? "start"}
        onChange={(tabsAlign) => onChange({ tabsAlign: tabsAlign === "start" ? undefined : tabsAlign })}
      />
    </>
  );
}

/** Questions and their answers (D91), each answer with components of its own under its text (D208). */
function FaqFields({ block, onChange, context }: BlockEditorProps<FaqBlock>) {
  const w = useAdminText("blocks").faq;
  return (
    <>
      <ItemsEditor
        label={w.questions}
        items={block.items}
        max={ITEMS_MAX}
        addLabel={w.add}
        nameOf={(item, index) => item.title.trim() || fillWords(w.unnamed, { n: index + 1 })}
        newItem={(): FaqItem => ({ id: newItemId(), title: "", body: EMPTY_DOC })}
        onChange={(items) => onChange({ items })}
      >
        {(item, change) => (
          <>
            <TextField label={w.question} value={item.title} max={ITEM_TITLE_MAX} onChange={(title) => change({ title })} />
            <RichTextEditor key={item.id} value={item.body} onChange={(body) => change({ body })} label={w.answer} />
            <AnswerPartsFields blocks={item.blocks ?? []} editPart={context.editPart} onChange={(blocks) => change({ blocks: blocks.length > 0 ? blocks : undefined })} />
          </>
        )}
      </ItemsEditor>
      <p className="text-xs text-muted">{w.shows}</p>
    </>
  );
}

/** What each kind of component an answer can hold is called (D208). */
const ANSWER_PART_NAMES: Record<FaqChildType, string> = {
  richText: "Text",
  heading: "Heading",
  image: "Image",
  button: "Button",
  dualButton: "Two buttons",
  separator: "Separator",
  iconList: "Icon list",
  table: "Table",
  video: "Video",
  socialLinks: "Social links",
};

/** A component's few words in the list: its text, else what it is. */
function answerPartName(block: PageBlock, names: Record<FaqChildType, string> = ANSWER_PART_NAMES): string {
  const words =
    block.type === "button" ? inlinePlain(block.label) : block.type === "dualButton" ? [block.first.label, block.second.label].map(inlinePlain).filter(Boolean).join(" · ") : blockText(block);
  const kind = isFaqChildType(block.type) ? names[block.type] : block.type;
  return words.trim() ? `${kind}: ${words.trim().slice(0, 60)}${words.trim().length > 60 ? "…" : ""}` : kind;
}

/**
 * The components under an answer's text (D208): added from a short list, ordered, taken out, and each opened in its own
 * settings (General, Style, Advanced) as any component on the page is.
 */
function AnswerPartsFields({ blocks, editPart, onChange }: { blocks: PageBlock[]; editPart?: (blockId: string) => void; onChange: (blocks: PageBlock[]) => void }) {
  const id = useId();
  const [kind, setKind] = useState<FaqChildType>("button");
  const w = useAdminText("blocks").faq;
  const nameOf = (block: PageBlock) => answerPartName(block, w.parts);
  const full = blocks.length >= FAQ_CHILDREN_MAX;
  const move = (from: number, to: number) => {
    if (to < 0 || to >= blocks.length) return;
    const next = [...blocks];
    const [taken] = next.splice(from, 1);
    next.splice(to, 0, taken);
    onChange(next);
  };
  const small = "min-h-9 rounded-pill border border-edge px-2 text-xs disabled:opacity-40";
  return (
    <fieldset className="flex flex-col gap-2 rounded-md border border-line p-3" data-answer-parts="">
      <legend className="px-1 text-sm font-medium">{w.under}</legend>
      {blocks.length === 0 && <p className="text-xs text-muted">{w.noneYet}</p>}
      {blocks.length > 0 && (
        <ol className="flex flex-col gap-1">
          {blocks.map((child, index) => (
            <li key={child.id} className="flex flex-wrap items-center gap-1 rounded-md bg-sunken px-2 py-1">
              <span className="mr-auto min-w-0 truncate text-sm">{nameOf(child)}</span>
              {editPart && (
                <button type="button" className={small} onClick={() => editPart(child.id)}>
                  {w.edit}
                </button>
              )}
              <button type="button" className={small} disabled={index === 0} onClick={() => move(index, index - 1)} aria-label={fillWords(w.moveUp, { name: nameOf(child) })}>
                ↑
              </button>
              <button type="button" className={small} disabled={index === blocks.length - 1} onClick={() => move(index, index + 1)} aria-label={fillWords(w.moveDown, { name: nameOf(child) })}>
                ↓
              </button>
              <button type="button" className={small} onClick={() => onChange(blocks.filter((b) => b.id !== child.id))} aria-label={fillWords(w.removeName, { name: nameOf(child) })}>
                {w.remove}
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label htmlFor={`${id}-kind`} className="flex flex-col gap-1 text-xs font-medium">
          {w.component}
          <select id={`${id}-kind`} value={kind} onChange={(event) => setKind(event.target.value as FaqChildType)} className="min-h-9 rounded-md border border-line bg-card px-2 text-sm font-normal">
            {FAQ_CHILD_TYPES.map((type) => (
              <option key={type} value={type}>
                {w.parts[type]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={full}
          onClick={() => {
            const child = newBlock(kind, newItemId);
            onChange([...blocks, child]);
            // Its settings open at once, so it can be filled in.
            if (editPart) window.setTimeout(() => editPart(child.id), 0);
          }}
          className="min-h-9 rounded-pill border border-line px-3 text-sm disabled:opacity-40"
        >
          {w.addPart}
        </button>
        {full && <span className="text-xs text-muted">{fillWords(w.full, { max: FAQ_CHILDREN_MAX })}</span>}
      </div>
      {!editPart && blocks.length > 0 && <p className="text-xs text-muted">{w.elsewhere}</p>}
    </fieldset>
  );
}

/** How FAQs open and look, and whether search engines are given them as questions and answers (D91). */
function FaqStyleFields({ block, onChange }: BlockEditorProps<FaqBlock>) {
  const w = useAdminText("blocks").faq;
  return (
    <>
      <AccordionStyleFields block={block} onChange={onChange} />
      <Check
        label={w.structured}
        hint={w.structuredHint}
        checked={block.structuredData !== false}
        onChange={(on) => onChange({ structuredData: on ? undefined : false })}
      />
    </>
  );
}

/** A video (D91): where it comes from, the video, its title and the picture shown before it plays. */
function VideoFields({ block, onChange, context }: BlockEditorProps<VideoBlock>) {
  const all = useAdminText("blocks");
  const w = all.video;
  const embedded = block.source !== "upload";
  const link = block.link.trim();
  const found = embedded && link !== "" && embedUrl(block.source as "youtube" | "vimeo", link) !== null;
  return (
    <>
      <Choices legend={w.from} options={optionsOf(VIDEO_SOURCES, all.lists.videoSources)} value={block.source} onChange={(source) => onChange({ source })} />
      {embedded ? (
        <TextField
          label={fillWords(w.addressOn, { site: EMBED_NAMES[block.source as "youtube" | "vimeo"] })}
          value={block.link}
          max={500}
          placeholder={block.source === "youtube" ? "https://www.youtube.com/watch?v=…" : "https://vimeo.com/…"}
          hint={
            link === ""
              ? w.paste
              : fillWords(found ? w.found : w.notVideo, { site: EMBED_NAMES[block.source as "youtube" | "vimeo"] })
          }
          onChange={(value) => onChange({ link: value })}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">{w.video}</p>
          {block.video && <p className="break-all text-sm text-muted">{block.video.url.split("/").pop()}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <VideoUploadButton
              startVideo={context.startVideo}
              upload={context.upload}
              label={block.video ? w.another : w.upload}
              onUploaded={({ video, poster }) => onChange({ video, ...(poster && !block.poster ? { poster } : {}) })}
            />
            {block.video && (
              <button type="button" onClick={() => onChange({ video: null })} className={smallButton}>
                {w.remove}
              </button>
            )}
          </div>
          <p className="text-xs text-muted">{w.formats}</p>
        </div>
      )}
      <TextField
        label={w.title}
        value={block.title}
        max={VIDEO_TITLE_MAX}
        hint={w.titleHint}
        onChange={(title) => onChange({ title })}
      />
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">{w.poster}</p>
        {block.poster && (
          // eslint-disable-next-line @next/next/no-img-element -- the site's own picture, shown as it is
          <img src={block.poster.url} alt="" className="h-24 w-fit rounded-md border border-line object-cover" />
        )}
        <div className="flex flex-wrap items-center gap-3">
          <ImageUploadButton
            upload={context.upload}
            label={block.poster ? w.anotherPicture : w.choosePicture}
            current={block.poster}
            onUploaded={(poster) => onChange({ poster })}
          />
          {block.poster && (
            <button type="button" onClick={() => onChange({ poster: null })} className={smallButton}>
              {w.remove}
            </button>
          )}
        </div>
        <p className="text-xs text-muted">
          {embedded ? w.posterEmbedded : w.posterUpload}
        </p>
      </div>
    </>
  );
}

/** A video's shape and, uploaded, how it plays (D91). */
function VideoStyleFields({ block, onChange }: BlockEditorProps<VideoBlock>) {
  const all = useAdminText("blocks");
  const w = all.video;
  return (
    <>
      <Choices legend={w.shape} options={optionsOf(VIDEO_RATIOS, all.lists.videoRatios)} value={block.ratio ?? "16:9"} onChange={(ratio) => onChange({ ratio: ratio === "16:9" ? undefined : ratio })} />
      {block.source === "upload" && (
        <>
          <Check
            label={w.autoplay}
            hint={w.autoplayHint}
            checked={Boolean(block.autoplay)}
            onChange={(autoplay) => onChange({ autoplay: autoplay || undefined })}
          />
          <Check label={w.loop} checked={Boolean(block.loop) || Boolean(block.autoplay)} disabled={Boolean(block.autoplay)} onChange={(loop) => onChange({ loop: loop || undefined })} />
          <Check
            label={w.controls}
            hint={w.controlsHint}
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
  const w = useAdminText("blocks").html;
  const locale = ADMIN_LANG_FACTS[useAdminLang()].locale;
  return (
    <>
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-sm font-medium">
          {w.html}
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
        <p className="text-xs text-muted">{fillWords(w.about, { count: block.html.length.toLocaleString(locale), max: HTML_MAX.toLocaleString(locale) })}</p>
      </div>
      <TextField
        label={w.title}
        value={block.title}
        max={200}
        hint={w.titleHint}
        onChange={(title) => onChange({ title })}
      />
      <Check
        label={w.wait}
        hint={w.waitHint}
        checked={Boolean(block.waitForClick)}
        onChange={(waitForClick) => onChange({ waitForClick: waitForClick || undefined })}
      />
    </>
  );
}

/** The HTML's height: its content's, or set (D91). */
function HtmlStyleFields({ block, onChange }: BlockEditorProps<HtmlBlock>) {
  const w = useAdminText("blocks").html;
  return (
    <>
      <Choices
        legend={w.height}
        options={[
          { value: "fit", label: w.fits },
          { value: "set", label: w.set },
        ]}
        value={block.height === undefined ? "fit" : "set"}
        onChange={(mode) => onChange({ height: mode === "fit" ? undefined : 400 })}
      />
      {block.height !== undefined && (
        <NumberField label={w.height} value={block.height} min={20} max={HTML_HEIGHT_MAX} unit="px" onChange={(height) => onChange({ height })} />
      )}
    </>
  );
}

/** Testimonials written in by the owner (D91). */
function TestimonialsFields({ block, onChange, context }: BlockEditorProps<TestimonialsBlock>) {
  const w = useAdminText("blocks").testimonials;
  const source = (
    <Choices
      legend={w.from}
      options={[
        { value: "custom", label: w.custom },
        { value: "google", label: w.google },
      ]}
      value={block.source ?? "custom"}
      onChange={(value) => onChange({ source: value === "google" ? "google" : undefined })}
    />
  );
  if (block.source === "google") {
    return (
      <>
        {source}
        <p className="text-sm text-muted">{w.googleAbout}</p>
        <Choices
          legend={w.atLeast}
          options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: n === 1 ? w.anyStars : fillWords(w.stars, { n }) }))}
          value={String(block.minRating ?? 1)}
          onChange={(value) => onChange({ minRating: value === "1" ? undefined : Number(value) })}
        />
        <Choices
          legend={w.atMost}
          hint={w.atMostHint}
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
        label={w.label}
        items={block.items}
        max={ITEMS_MAX}
        addLabel={w.add}
        nameOf={(item, index) => item.name.trim() || `${fillWords(w.unnamed, { n: index + 1 })}${item.quote.trim() ? "" : w.noWords}`}
        newItem={() => ({ id: newItemId(), quote: "", name: "", role: "", picture: null })}
        onChange={(items) => onChange({ items })}
      >
        {(item, change) => (
          <>
            <TextField label={w.said} value={item.quote} max={TESTIMONIAL_QUOTE_MAX} multiline onChange={(quote) => change({ quote })} />
            <TextField label={w.name} value={item.name} max={TESTIMONIAL_NAME_MAX} onChange={(name) => change({ name })} />
            <TextField
              label={w.role}
              value={item.role}
              max={TESTIMONIAL_NAME_MAX}
              placeholder={w.rolePlaceholder}
              onChange={(role) => change({ role })}
            />
            <Choices
              legend={w.starsLegend}
              options={[{ value: "0", label: w.none }, ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: "★".repeat(n) }))]}
              value={String(item.rating ?? 0)}
              onChange={(value) => change({ rating: value === "0" ? undefined : Number(value) })}
            />
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">{w.picture}</p>
              <div className="flex flex-wrap items-center gap-3">
                {item.picture && (
                  // eslint-disable-next-line @next/next/no-img-element -- the site's own picture, shown as it is
                  <img src={item.picture.url} alt="" className="size-12 rounded-full object-cover" />
                )}
                <ImageUploadButton
                  upload={context.upload}
                  label={item.picture ? w.chooseAnother : w.choose}
                  current={item.picture}
                  onUploaded={(picture) => change({ picture })}
                />
                {item.picture && (
                  <button type="button" onClick={() => change({ picture: null })} className={smallButton}>
                    {w.remove}
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </ItemsEditor>
      <p className="text-xs text-muted">{w.honest}</p>
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
  const all = useAdminText("blocks");
  const w = all.carousel;
  return (
    <div className="flex flex-col gap-4">
      <Check label={w.arrows} hint={w.arrowsHint} checked={resolved.arrows} onChange={(arrows) => set({ arrows })} />
      <Check label={w.dots} hint={w.dotsHint} checked={resolved.dots} onChange={(dots) => set({ dots })} />
      <Choices<CarouselSnap>
        legend={w.rests}
        options={(Object.keys(CAROUSEL_SNAPS) as CarouselSnap[]).map((snap) => ({ value: snap, label: all.lists.carouselSnaps[snap] }))}
        value={resolved.snap}
        onChange={(snap) => set({ snap })}
      />
      <Check
        label={w.rewind}
        hint={w.rewindHint}
        checked={resolved.rewind}
        onChange={(rewind) => set({ rewind })}
      />
      <Check
        label={w.autoplay}
        hint={w.autoplayHint}
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
              {w.seconds}
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
              className="min-h-10 w-20 rounded-md border border-line bg-card px-2 text-sm"
            />
            <span className="text-muted">{fillWords(w.range, { min: AUTOPLAY_SECONDS.min, max: AUTOPLAY_SECONDS.max })}</span>
          </div>
          <p className="text-xs text-muted">
            {w.safe}
            {resolved.rewind ? "" : w.stopsAtLast}
          </p>
        </div>
      )}
      <p className="text-xs text-muted">{w.about}</p>
    </div>
  );
}

/** How testimonials are laid out and look (D91). */
function TestimonialsStyleFields({ block, onChange }: BlockEditorProps<TestimonialsBlock>) {
  const all = useAdminText("blocks");
  const w = all.testimonials;
  return (
    <>
      <Choices
        legend={w.showAs}
        options={[
          { value: "grid", label: w.grid },
          { value: "carousel", label: w.carousel },
        ]}
        value={block.display ?? "grid"}
        onChange={(display) => onChange({ display: display === "carousel" ? "carousel" : undefined })}
      />
      <Choices
        legend={block.display === "carousel" ? w.toScreen : w.columns}
        hint={w.onPhones}
        options={TESTIMONIAL_COLUMNS.map((n) => ({ value: String(n), label: String(n) }))}
        value={String(block.columns ?? 3)}
        onChange={(value) => onChange({ columns: value === "3" ? undefined : (Number(value) as TestimonialsBlock["columns"]) })}
      />
      {block.display === "carousel" && <CarouselFields value={block.carousel} onChange={(carousel) => onChange({ carousel })} />}
      <Choices legend={w.look} options={optionsOf(TESTIMONIAL_LOOKS, all.lists.testimonialLooks)} value={block.look ?? "cards"} onChange={(look) => onChange({ look: look === "cards" ? undefined : look })} />
      <Check label={w.showStars} checked={block.showRating !== false} onChange={(show) => onChange({ showRating: show ? undefined : false })} />
    </>
  );
}

/** A gallery's pictures and videos (D209), in the order they are dragged into, each with its description and caption. */
function GalleryFields({ block, onChange, context }: BlockEditorProps<GalleryBlock>) {
  const sourceId = useId();
  const all = useAdminText("blocks");
  const w = all.gallery;
  const v = all.video;
  return (
    <>
      <ItemsEditor<GalleryItem>
        label={w.label}
        items={block.items}
        max={GALLERY_ITEMS_MAX}
        addLabel={w.add}
        nameOf={(item, index) => {
          const what = item.kind === "image" ? w.picture : w.video;
          const words = item.alt.trim() || item.caption.trim();
          return `${what} ${index + 1}${words ? `: ${words.slice(0, 40)}` : galleryItemShows(item) ? "" : item.kind === "image" ? w.noPicture : w.noVideo}`;
        }}
        newItem={(): GalleryItem => ({ id: newItemId(), kind: "image", picture: null, alt: "", caption: "" })}
        onChange={(items) => onChange({ items })}
      >
        {(item, change) => {
          const source = item.source ?? "upload";
          const link = (item.link ?? "").trim();
          const found = source !== "upload" && link !== "" && embedUrl(source, link) !== null;
          return (
            <>
              <Choices<GalleryKind>
                legend={w.thisIs}
                options={(Object.keys(GALLERY_KINDS) as GalleryKind[]).map((kind) => ({ value: kind, label: all.lists.galleryKinds[kind] }))}
                value={item.kind}
                onChange={(kind) => change(kind === "image" ? { kind, source: undefined, video: undefined, link: undefined } : { kind })}
              />
              {item.kind === "video" && (
                <>
                  <div className="flex flex-col gap-1">
                    <label htmlFor={`${sourceId}-${item.id}`} className="text-sm font-medium">
                      {v.from}
                    </label>
                    <select
                      id={`${sourceId}-${item.id}`}
                      value={source}
                      onChange={(event) => change({ source: event.target.value === "upload" ? undefined : (event.target.value as VideoSource) })}
                      className="min-h-10 rounded-md border border-line bg-card px-3"
                    >
                      {(Object.keys(VIDEO_SOURCES) as VideoSource[]).map((key) => (
                        <option key={key} value={key}>
                          {all.lists.videoSources[key]}
                        </option>
                      ))}
                    </select>
                  </div>
                  {source === "upload" ? (
                    <div className="flex flex-col gap-2">
                      {item.video && <p className="break-all text-sm text-muted">{item.video.url.split("/").pop()}</p>}
                      <div className="flex flex-wrap items-center gap-3">
                        <VideoUploadButton
                          startVideo={context.startVideo}
                          upload={context.upload}
                          label={item.video ? v.another : v.upload}
                          onUploaded={({ video, poster }) => change({ video, ...(poster && !item.picture ? { picture: poster } : {}) })}
                        />
                        {item.video && (
                          <button type="button" onClick={() => change({ video: null })} className={smallButton}>
                            {v.remove}
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-muted">{v.formats}</p>
                    </div>
                  ) : (
                    <TextField
                      label={fillWords(v.addressOn, { site: EMBED_NAMES[source] })}
                      value={item.link ?? ""}
                      max={500}
                      placeholder={source === "youtube" ? "https://www.youtube.com/watch?v=…" : "https://vimeo.com/…"}
                      hint={
                        link === ""
                          ? v.paste
                          : fillWords(found ? v.found : v.notVideo, { site: EMBED_NAMES[source] })
                      }
                      onChange={(value) => change({ link: value || undefined })}
                    />
                  )}
                </>
              )}
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium">{item.kind === "image" ? w.picture : w.pictureForVideo}</p>
                <div className="flex flex-wrap items-center gap-3">
                  {item.picture && (
                    // eslint-disable-next-line @next/next/no-img-element -- the owner's own picture, shown small
                    <img src={item.picture.url} alt="" className="h-16 w-24 rounded border border-line object-cover" />
                  )}
                  <ImageUploadButton
                    upload={context.upload}
                    label={item.picture ? w.chooseAnother : item.kind === "image" ? w.uploadPicture : w.choosePicture}
                    current={item.picture ? { ...item.picture, alt: item.alt } : null}
                    // A picture made by prompt (D283) is described by what it was asked for; a video keeps its own title.
                    onUploaded={(picture, made) => change({ picture, ...(made && item.kind === "image" ? { alt: made.alt } : {}) })}
                  />
                  {item.picture && (
                    <button type="button" onClick={() => change({ picture: null })} className={smallButton}>
                      {v.remove}
                    </button>
                  )}
                </div>
                {item.kind === "video" && source !== "upload" && (
                  <p className="text-xs text-muted">{w.darkTile}</p>
                )}
              </div>
              <TextField
                label={item.kind === "image" ? w.alt : w.title}
                value={item.alt}
                max={GALLERY_TEXT_MAX}
                hint={item.kind === "image" ? w.altHint : w.titleHint}
                onChange={(alt) => change({ alt })}
              />
              <TextField label={w.caption} value={item.caption} max={GALLERY_TEXT_MAX} hint={w.captionHint} onChange={(caption) => change({ caption })} />
            </>
          );
        }}
      </ItemsEditor>
      <p className="text-xs text-muted">{w.order}</p>
    </>
  );
}

/** How a gallery is laid out (D209): a grid or a carousel, tiles in a row per screen size, their shape, the space between and the lightbox. */
function GalleryStyleFields({ block, onChange }: BlockEditorProps<GalleryBlock>) {
  const { size } = useSizeEdit();
  const carousel = block.view === "carousel";
  const all = useAdminText("blocks");
  const w = all.gallery;
  return (
    <>
      <Choices<GalleryView>
        legend={w.showAs}
        options={(Object.keys(GALLERY_VIEWS) as GalleryView[]).map((view) => ({ value: view, label: all.lists.galleryViews[view] }))}
        value={block.view ?? "grid"}
        onChange={(view) => onChange({ view: view === "grid" ? undefined : view })}
      />
      <Choices
        legend={carousel ? w.inView : w.columns}
        hint={w.atSize}
        mark={<SizeMark part={block} field="columns" label={w.columns} onPatch={onChange} />}
        muted={inheritedClass(sizeSource(block, size, "columns"), size)}
        options={Array.from({ length: GRID_COLUMNS_MAX.desktop }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
        value={String(galleryColumns(block, size))}
        onChange={(n) => onChange(setAt(block, size, { columns: Number(n) }))}
      />
      <Choices<GalleryRatio>
        legend={w.shape}
        options={(Object.keys(GALLERY_RATIOS) as GalleryRatio[]).map((ratio) => ({ value: ratio, label: all.lists.galleryRatios[ratio] }))}
        value={block.ratio ?? GALLERY_DEFAULTS.ratio}
        onChange={(ratio) => onChange({ ratio: ratio === GALLERY_DEFAULTS.ratio ? undefined : ratio })}
      />
      <NumberField label={w.gap} value={block.gap ?? GALLERY_DEFAULTS.gap} min={0} max={GRID_GAP_MAX} unit="pixels" onChange={(gap) => onChange({ gap: gap === GALLERY_DEFAULTS.gap ? undefined : gap })} />
      <Check
        label={w.lightbox}
        hint={w.lightboxHint}
        checked={block.lightbox !== false}
        onChange={(on) => onChange({ lightbox: on ? undefined : false })}
      />
      <Check label={w.captions} hint={w.captionsHint} checked={block.showCaptions !== false} onChange={(on) => onChange({ showCaptions: on ? undefined : false })} />
      <fieldset className="flex flex-col gap-3 border-t border-line pt-4">
        <legend className="float-left mb-1 w-full font-medium">{w.zoom}</legend>
        <NumberField
          label={w.grows}
          value={block.hoverZoom ?? GALLERY_DEFAULTS.hoverZoom}
          min={GALLERY_LIMITS.hoverZoom.min}
          max={GALLERY_LIMITS.hoverZoom.max}
          unit="% (0 for none)"
          onChange={(hoverZoom) => onChange({ hoverZoom: hoverZoom === GALLERY_DEFAULTS.hoverZoom ? undefined : hoverZoom })}
        />
        <Check
          label={w.ownSpeed}
          hint={w.ownSpeedHint}
          checked={block.hoverZoomMs !== undefined}
          onChange={(on) => onChange({ hoverZoomMs: on ? GALLERY_DEFAULTS.hoverZoomMs : undefined })}
        />
        {block.hoverZoomMs !== undefined && (
          <NumberField
            label={w.timeToGrow}
            value={block.hoverZoomMs}
            min={GALLERY_LIMITS.hoverZoomMs.min}
            max={GALLERY_LIMITS.hoverZoomMs.max}
            unit="milliseconds"
            onChange={(hoverZoomMs) => onChange({ hoverZoomMs })}
          />
        )}
      </fieldset>
      {carousel && (
        <>
          {SIZES.every((s) => galleryColumns(block, s) === 1) ? (
            <>
              <Choices<GalleryTransition>
                legend={w.transition}
                options={(Object.keys(GALLERY_TRANSITIONS) as GalleryTransition[]).map((transition) => ({ value: transition, label: all.lists.galleryTransitions[transition] }))}
                value={block.transition ?? "slide"}
                onChange={(transition) => onChange({ transition: transition === "slide" ? undefined : transition })}
              />
              {block.transition === "fade" && (
                <NumberField
                  label={w.timeToFade}
                  value={block.fadeMs ?? GALLERY_DEFAULTS.fadeMs}
                  min={GALLERY_LIMITS.fadeMs.min}
                  max={GALLERY_LIMITS.fadeMs.max}
                  unit="milliseconds"
                  onChange={(fadeMs) => onChange({ fadeMs: fadeMs === GALLERY_DEFAULTS.fadeMs ? undefined : fadeMs })}
                />
              )}
            </>
          ) : (
            <p className="text-xs text-muted">{w.fadeOnlyOne}</p>
          )}
          <CarouselFields value={block.carousel} onChange={(settings) => onChange({ carousel: settings })} />
        </>
      )}
    </>
  );
}

/** The logos of the brands, each with a name that shows under it (D204). */
function BrandsFields({ block, onChange, context }: BlockEditorProps<BrandsBlock>) {
  const all = useAdminText("blocks");
  const w = all.brands;
  return (
    <>
      <ItemsEditor<BrandItem>
        label={w.label}
        items={block.items}
        max={CUSTOM_ITEMS_MAX}
        addLabel={w.add}
        nameOf={(item, index) => item.name.trim() || `${fillWords(w.unnamed, { n: index + 1 })}${item.picture ? "" : w.noLogo}`}
        newItem={() => ({ id: newItemId(), name: "", picture: null })}
        onChange={(items) => onChange({ items })}
      >
        {(item, change) => (
          <>
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">{w.logo}</p>
              <div className="flex flex-wrap items-center gap-3">
                {item.picture && (
                  // eslint-disable-next-line @next/next/no-img-element -- the owner's own logo, shown as it is
                  <img src={item.picture.url} alt="" className="h-12 max-w-32 rounded border border-line bg-card object-contain p-1" />
                )}
                <ImageUploadButton
                  upload={context.upload}
                  label={item.picture ? w.chooseAnother : w.upload}
                  // A logo is the brand's own: a picture model may not draw one (D283).
                  make={false}
                  onUploaded={(picture) => change({ picture })}
                />
                {item.picture && (
                  <button type="button" onClick={() => change({ picture: null })} className={smallButton}>
                    {w.remove}
                  </button>
                )}
              </div>
            </div>
            <TextField label={w.name} hint={w.nameHint} value={item.name} max={100} onChange={(name) => change({ name })} />
            <TextField
              label={w.links}
              value={item.href ?? ""}
              max={2000}
              placeholder={all.link.addressPlaceholder}
              hint={!item.href?.trim() || isLinkAddress(item.href.trim()) ? undefined : all.link.badAddress}
              onChange={(href) => change({ href: href || undefined })}
            />
          </>
        )}
      </ItemsEditor>
      <p className="text-xs text-muted">{w.leftOut}</p>
    </>
  );
}

/** How the brands are laid out: a grid or a carousel, logos in view per screen size, speed, gap and the tallest logo (D204). */
function BrandsStyleFields({ block, onChange }: BlockEditorProps<BrandsBlock>) {
  const { size } = useSizeEdit();
  const carousel = block.view === "carousel";
  const movement: BrandsMotion = block.movement ?? "continuous";
  const all = useAdminText("blocks");
  const w = all.brands;
  return (
    <>
      <Choices<BrandsView>
        legend={w.showAs}
        options={(Object.keys(BRANDS_VIEWS) as BrandsView[]).map((view) => ({ value: view, label: all.lists.brandsViews[view] }))}
        value={block.view ?? "grid"}
        onChange={(view) => onChange({ view: view === "grid" ? undefined : view })}
      />
      <Choices
        legend={carousel ? w.inView : w.inRow}
        hint={all.gallery.atSize}
        mark={<SizeMark part={block} field="columns" label={w.inRow} onPatch={onChange} />}
        muted={inheritedClass(sizeSource(block, size, "columns"), size)}
        options={Array.from({ length: GRID_COLUMNS_MAX.desktop }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
        value={String(brandColumns(block, size))}
        onChange={(n) => onChange(setAt(block, size, { columns: Number(n) }))}
      />
      {carousel && (
        <>
          <Choices<BrandsMotion>
            legend={w.movement}
            options={(Object.keys(BRANDS_MOTIONS) as BrandsMotion[]).map((key) => ({ value: key, label: all.lists.brandsMotions[key] }))}
            value={movement}
            onChange={(value) => onChange({ movement: value === "continuous" ? undefined : value })}
          />
          {movement === "none" ? (
            <p className="text-xs text-muted">{w.byVisitors}</p>
          ) : movement === "continuous" ? (
            <NumberField
              label={w.speed}
              value={block.speed ?? BRANDS_DEFAULTS.speed}
              min={BRANDS_LIMITS.speed.min}
              max={BRANDS_LIMITS.speed.max}
              unit="seconds (more is slower)"
              onChange={(speed) => onChange({ speed: speed === BRANDS_DEFAULTS.speed ? undefined : speed })}
            />
          ) : (
            <NumberField
              label={w.interval}
              value={block.interval ?? BRANDS_DEFAULTS.interval}
              min={BRANDS_LIMITS.interval.min}
              max={BRANDS_LIMITS.interval.max}
              unit="seconds"
              onChange={(interval) => onChange({ interval: interval === BRANDS_DEFAULTS.interval ? undefined : interval })}
            />
          )}
          {movement !== "none" && <p className="text-xs text-muted">{w.stops}</p>}
        </>
      )}
      <NumberField
        label={w.tallest}
        value={block.logoHeight ?? BRANDS_DEFAULTS.logoHeight}
        min={BRANDS_LIMITS.logoHeight.min}
        max={BRANDS_LIMITS.logoHeight.max}
        unit="pixels"
        onChange={(logoHeight) => onChange({ logoHeight: logoHeight === BRANDS_DEFAULTS.logoHeight ? undefined : logoHeight })}
      />
      <NumberField label={w.gap} value={block.gap ?? BRANDS_DEFAULTS.gap} min={0} max={200} unit="pixels" onChange={(gap) => onChange({ gap: gap === BRANDS_DEFAULTS.gap ? undefined : gap })} />
      <Check label={w.showNames} hint={w.showNamesHint} checked={block.showNames !== false} onChange={(show) => onChange({ showNames: show ? undefined : false })} />
      <Choices
        legend={w.colour}
        hint={w.colourHint}
        options={[
          { value: "original", label: w.original },
          { value: "grey", label: w.grey },
          ...(Object.keys(BRAND_TINTS) as BrandTint[]).map((tint) => ({ value: tint, label: all.lists.brandTints[tint] })),
        ]}
        value={block.tint ?? (block.greyscale ? "grey" : "original")}
        onChange={(choice) =>
          onChange({
            greyscale: choice === "grey" || undefined,
            tint: choice === "original" || choice === "grey" ? undefined : (choice as BrandTint),
            ...(choice !== "custom" && { tintColor: undefined }),
            ...(choice === "original" && { colourOnHover: undefined }),
          })
        }
      />
      {block.tint === "custom" && (
        <OptionalColor label={w.custom} hint={w.customHint} value={block.tintColor} fallback="#1d4ed8" onChange={(tintColor) => onChange({ tintColor })} />
      )}
      {(block.greyscale || block.tint) && (
        <Check
          label={w.hoverOriginal}
          hint={w.hoverOriginalHint}
          checked={Boolean(block.colourOnHover)}
          onChange={(on) => onChange({ colourOnHover: on || undefined })}
        />
      )}
    </>
  );
}

/** The profiles social media buttons link to (D91). */
function SocialLinksFields({ block, onChange }: BlockEditorProps<SocialLinksBlock>) {
  const networkId = useId();
  const w = useAdminText("blocks").social;
  const networkName = (network: SocialNetwork) => (w.networks as Record<string, string>)[network] ?? SOCIAL_NETWORKS[network];
  return (
    <>
      <ItemsEditor<SocialLink>
        label={w.links}
        items={block.links}
        max={ITEMS_MAX}
        addLabel={w.add}
        nameOf={(link) => `${networkName(link.network)}${link.href.trim() ? "" : w.noAddress}`}
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
                  {w.network}
                </label>
                <select
                  id={`${networkId}-${link.id}`}
                  value={link.network}
                  onChange={(event) => change({ network: event.target.value as SocialNetwork })}
                  className={fieldClass}
                >
                  {(Object.keys(SOCIAL_NETWORKS) as SocialNetwork[]).map((network) => (
                    <option key={network} value={network}>
                      {networkName(network)}
                    </option>
                  ))}
                </select>
              </div>
              <TextField
                label={link.network === "email" ? w.email : link.network === "phone" ? w.phone : w.profile}
                value={link.href}
                max={500}
                placeholder={socialPlaceholder(link.network)}
                hint={works ? undefined : w.bad}
                onChange={(href) => change({ href })}
              />
            </>
          );
        }}
      </ItemsEditor>
      <p className="text-xs text-muted">{w.newTab}</p>
    </>
  );
}

/** How social media buttons look (D91). */
function SocialLinksStyleFields({ block, onChange }: BlockEditorProps<SocialLinksBlock>) {
  const look = block.look ?? "plain";
  const all = useAdminText("blocks");
  const w = all.social;
  return (
    <>
      <Choices legend={w.look} options={optionsOf(SOCIAL_LOOKS, all.lists.socialLooks)} value={look} onChange={(value) => onChange({ look: value === "plain" ? undefined : value })} />
      {look !== "plain" && (
        <Choices legend={w.shape} options={optionsOf(SOCIAL_SHAPES, all.lists.socialShapes)} value={block.shape ?? "circle"} onChange={(shape) => onChange({ shape: shape === "circle" ? undefined : shape })} />
      )}
      <Choices
        legend={w.colours}
        options={optionsOf(SOCIAL_COLORS, all.lists.socialColors)}
        value={block.colors ?? "brand"}
        onChange={(colors) => onChange({ colors: colors === "brand" ? undefined : colors, ...(colors !== "custom" && { color: undefined }) })}
      />
      {block.colors === "custom" && <ColorField label={w.colour} value={block.color ?? "#111111"} onChange={(color) => onChange({ color })} />}
      <Choices legend={w.size} options={optionsOf(BUTTON_SIZES, all.lists.buttonSizes)} value={block.size ?? "md"} onChange={(size) => onChange({ size: size === "md" ? undefined : size })} />
      <NumberField label={w.gap} value={block.gap ?? 12} min={0} max={SOCIAL_GAP_MAX} unit="px" onChange={(gap) => onChange({ gap: gap === 12 ? undefined : gap })} />
      <Choices
        legend={w.place}
        options={optionsOf(SEPARATOR_POSITIONS, all.lists.positions)}
        value={block.position ?? "left"}
        onChange={(position) => onChange({ position: position === "left" ? undefined : position })}
      />
      <Check label={w.showNames} checked={Boolean(block.showNames)} onChange={(showNames) => onChange({ showNames: showNames || undefined })} />
    </>
  );
}

/** Chooses one of the icon list's icons (D91). */
function IconPicker({ value, onChange }: { value: IconName; onChange: (icon: IconName) => void }) {
  const w = useAdminText("blocks").icons;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{fillWords(w.icon, { name: ICONS[value] })}</legend>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))] gap-1">
        {(Object.keys(ICONS) as IconName[]).map((icon) => (
          <button
            key={icon}
            type="button"
            aria-pressed={icon === value}
            aria-label={ICONS[icon]}
            title={ICONS[icon]}
            onClick={() => onChange(icon)}
            className={`flex size-10 items-center justify-center rounded-pill border ${
              icon === value ? "border-brand bg-brand text-brand-ink" : "border-edge hover:bg-sunken"
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
  const all = useAdminText("blocks");
  const w = all.iconList;
  return (
    <>
      <ItemsEditor<IconListItem>
        label={w.lines}
        items={block.items}
        max={ITEMS_MAX}
        addLabel={w.add}
        nameOf={(item, index) => item.text.trim() || fillWords(w.unnamed, { n: index + 1 })}
        // A new line takes the icon of the one before, as lists mostly share one.
        newItem={() => ({ id: newItemId(), icon: block.items.at(-1)?.icon ?? "check", text: "", href: "" })}
        onChange={(items) => onChange({ items })}
      >
        {(item, change) => {
          const address = item.href.trim();
          return (
            <>
              <TextField label={w.words} value={item.text} max={ICON_LIST_TEXT_MAX} placeholder={w.wordsPlaceholder} onChange={(text) => change({ text })} />
              <TextField
                label={w.links}
                value={item.href}
                max={2000}
                placeholder={all.link.addressPlaceholder}
                hint={address === "" || isLinkAddress(address) ? undefined : all.link.badAddress}
                onChange={(href) => change({ href })}
              />
              <IconPicker value={item.icon} onChange={(icon) => change({ icon })} />
            </>
          );
        }}
      </ItemsEditor>
      <p className="text-xs text-muted">{w.leftOut}</p>
    </>
  );
}

const ICON_BUTTON = "inline-flex size-7 shrink-0 items-center justify-center rounded border border-line text-xs hover:bg-card disabled:opacity-40";

/**
 * A table's cells (D194) as a grid of fields: every column has its own add and remove buttons above it and every row at its end,
 * and "Add row" and "Add column" put one at the end. The first row is the header while the header is on.
 */
function TableFields({ block, onChange }: BlockEditorProps<TableBlock>) {
  const rows = block.rows;
  const columns = rows[0]?.length ?? 1;
  const set = (next: string[][]) => onChange({ rows: next });
  const setTable = (next: TableData) => onChange({ rows: next.rows, sections: next.sections });
  const table: TableData = { rows, sections: block.sections };
  const w = useAdminText("blocks").table;
  const isHeader = (r: number) => Boolean(block.header) && r === 0;
  // The cell last typed in: an icon from the palette goes into it, at the cursor (D201).
  const lastCell = useRef<{ r: number; c: number; input: HTMLInputElement } | null>(null);
  const putIcon = (name: IconName) => {
    const at = lastCell.current;
    const r = at ? Math.min(at.r, rows.length - 1) : rows.length - 1;
    const c = at ? Math.min(at.c, columns - 1) : 0;
    const text = rows[r]?.[c] ?? "";
    const pos = at && at.input.isConnected ? (at.input.selectionStart ?? text.length) : text.length;
    const next = `${text.slice(0, pos)}${iconToken(name)}${text.slice(pos)}`;
    if (next.length <= TABLE_CELL_MAX) set(setCell(rows, r, c, next));
  };
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  // Rows and dividers are each dragged by their own handle (D202); a header stays first.
  const start = block.header ? 1 : 0;
  const order = entriesOf(table, start).map((entry, i) => ("divider" in entry ? `div-${i}` : `row-${i}`));
  const dropped = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = order.indexOf(String(active.id));
    const to = order.indexOf(String(over.id));
    if (from >= 0 && to >= 0) setTable(moveEntry(table, start, from, to));
  };
  const dividerLine = (r: number, handle: ReactNode) => (
    <tr>
      <td colSpan={columns}>
        <input
          value={block.sections?.[r] ?? ""}
          maxLength={200}
          placeholder={w.sectionTitle}
          aria-label={fillWords(w.sectionAbove, { n: r + 1 })}
          className="h-8 w-full rounded border border-dashed border-line bg-sunken px-2 font-medium"
          onChange={(event) => setTable(setSection(table, r, event.target.value))}
        />
      </td>
      <td>
        <span className="flex items-center gap-1">
          {handle}
          <button type="button" className={ICON_BUTTON} aria-label={fillWords(w.removeDivider, { n: r + 1 })} title={w.removeDividerTitle} onClick={() => setTable(setSection(table, r, null))}>
            ×
          </button>
        </span>
      </td>
    </tr>
  );
  const rowLine = (cells: string[], r: number, handle: ReactNode) => (
              <tr>
                {cells.map((text, c) => (
                  <td key={c}>
                    <input
                      value={text}
                      maxLength={TABLE_CELL_MAX}
                      aria-label={block.header && r === 0 ? fillWords(w.headingOf, { c: c + 1 }) : fillWords(w.cell, { r: r + 1, c: c + 1 })}
                      className={`h-8 w-32 rounded border border-line bg-card px-2 ${block.header && r === 0 ? "font-medium" : ""}`}
                      onFocus={(event) => (lastCell.current = { r, c, input: event.currentTarget })}
                      onChange={(event) => set(setCell(rows, r, c, event.target.value))}
                    />
                  </td>
                ))}
                <td>
                  <span className="flex items-center gap-1">
                    {handle}
                    <button type="button" className={ICON_BUTTON} aria-label={fillWords(w.addRowAfter, { n: r + 1 })} title={w.addRowAfterTitle} disabled={rows.length >= TABLE_ROWS_MAX} onClick={() => setTable(addRowTo(table, r))}>
                      +
                    </button>
                    <button type="button" className={ICON_BUTTON} aria-label={fillWords(w.removeRow, { n: r + 1 })} title={w.removeRowTitle} disabled={rows.length <= 1} onClick={() => setTable(removeRowFrom(table, r))}>
                      ×
                    </button>
                    {!isHeader(r) && block.sections?.[r] == null && (
                      <button type="button" className={ICON_BUTTON} aria-label={fillWords(w.addDivider, { n: r + 1 })} title={w.addDividerTitle} onClick={() => setTable(setSection(table, r, ""))}>
                        ―
                      </button>
                    )}
                  </span>
                </td>
              </tr>
  );
  return (
    <>
      <Check label={w.header} hint={w.headerHint} checked={Boolean(block.header)} onChange={(header) => onChange({ header: header || undefined })} />
      <TextField label={w.caption} value={block.caption ?? ""} max={200} placeholder={w.captionPlaceholder} onChange={(caption) => onChange({ caption: caption || undefined })} />
      <div className="overflow-x-auto rounded border border-line p-2">
        <table className="border-separate border-spacing-1 text-sm">
          <thead>
            <tr>
              {rows[0]?.map((_, c) => (
                <th key={c} scope="col" className="font-normal">
                  <span className="flex items-center justify-center gap-1">
                    <button type="button" className={ICON_BUTTON} aria-label={fillWords(w.addColumnAfter, { n: c + 1 })} title={w.addColumnAfterTitle} disabled={columns >= TABLE_COLUMNS_MAX} onClick={() => set(addColumn(rows, c))}>
                      +
                    </button>
                    <button type="button" className={ICON_BUTTON} aria-label={fillWords(w.removeColumn, { n: c + 1 })} title={w.removeColumnTitle} disabled={columns <= 1} onClick={() => set(removeColumn(rows, c))}>
                      ×
                    </button>
                  </span>
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dropped}>
            <SortableContext items={order} strategy={verticalListSortingStrategy}>
              {rows.slice(0, start).map((cells, r) => (
                <tbody key={`head-${r}`}>{rowLine(cells, r, null)}</tbody>
              ))}
              {(() => {
                let index = 0;
                return rows.slice(start).flatMap((cells, i) => {
                  const r = i + start;
                  const out: ReactNode[] = [];
                  if (block.sections?.[r] != null) {
                    out.push(
                      <SortableRows key={`div-${r}`} id={`div-${index}`} label={fillWords(w.dividerAbove, { n: r + 1 })}>
                        {(handle) => dividerLine(r, handle)}
                      </SortableRows>,
                    );
                    index++;
                  }
                  out.push(
                    <SortableRows key={`row-${r}`} id={`row-${index}`} label={fillWords(w.row, { n: r + 1 })}>
                      {(handle) => rowLine(cells, r, handle)}
                    </SortableRows>,
                  );
                  index++;
                  return out;
                });
              })()}
            </SortableContext>
          </DndContext>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="min-h-9 rounded border border-line px-3 text-sm hover:bg-card disabled:opacity-40" disabled={rows.length >= TABLE_ROWS_MAX} onClick={() => setTable(addRowTo(table))}>
          {w.addRow}
        </button>
        <button type="button" className="min-h-9 rounded border border-line px-3 text-sm hover:bg-card disabled:opacity-40" disabled={columns >= TABLE_COLUMNS_MAX} onClick={() => set(addColumn(rows))}>
          {w.addColumn}
        </button>
      </div>
      <p className="text-xs text-muted">{fillWords(w.limits, { rows: TABLE_ROWS_MAX, columns: TABLE_COLUMNS_MAX })}</p>
      <TableIconPalette onPick={putIcon} />
    </>
  );
}

/** The icons that can go in a cell (D201): the common ones as buttons, the rest from a list; each puts `{{name}}` in the cell last typed in. */
const TABLE_ICONS: IconName[] = ["check", "x", "minus", "plus", "circleCheck", "circleAlert", "star", "heart", "thumbsUp", "info"];
function TableIconPalette({ onPick }: { onPick: (name: IconName) => void }) {
  const w = useAdminText("blocks").table;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">{w.icons}</legend>
      <p className="text-xs text-muted">{fillWords(w.iconsHint, { token: "{{check}}" })}</p>
      <div className="flex flex-wrap items-center gap-1">
        {TABLE_ICONS.map((name) => (
          // The press keeps the focus in the cell, so the icon goes where the cursor is.
          <button key={name} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onPick(name)} aria-label={fillWords(w.putIcon, { name: ICONS[name] })} title={ICONS[name]} className="flex size-9 items-center justify-center rounded border border-line hover:bg-card">
            <ListIcon name={name} className="size-5" />
          </button>
        ))}
        <select aria-label={w.moreIcons} value="" onChange={(event) => event.target.value && onPick(event.target.value as IconName)} className="h-9 rounded border border-line bg-card px-2 text-sm">
          <option value="">{w.more}</option>
          {(Object.keys(ICONS) as IconName[]).map((name) => (
            <option key={name} value={name}>
              {ICONS[name]}
            </option>
          ))}
        </select>
      </div>
    </fieldset>
  );
}

/** One row of the table's grid (a body of its own, with the divider above it) that can be dragged by its handle (D200). */
function SortableRows({ id, label, children }: { id: string; label: string; children: (handle: ReactNode) => ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const w = useAdminText("blocks").table;
  const handle = (
    <button type="button" {...attributes} {...listeners} aria-label={fillWords(w.drag, { name: label })} title={w.dragTitle} className={`${ICON_BUTTON} cursor-grab touch-none active:cursor-grabbing`}>
      <span aria-hidden>⠿</span>
    </button>
  );
  return (
    <tbody ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={isDragging ? "relative z-10 bg-card shadow-lg" : undefined}>
      {children(handle)}
    </tbody>
  );
}

/** How a table looks and behaves on a phone (D194). */
function TableStyleFields({ block, onChange }: BlockEditorProps<TableBlock>) {
  const all = useAdminText("blocks");
  const w = all.table;
  return (
    <>
      <Choices
        legend={w.onPhone}
        options={optionsOf(TABLE_MOBILE, all.lists.tableMobile)}
        value={block.mobile ?? "stack"}
        onChange={(mobile) => onChange({ mobile: mobile === "stack" ? undefined : mobile })}
      />
      <p className="text-xs text-muted">
        {(block.mobile ?? "stack") === "stack" ? w.stackHint : w.scrollHint}
      </p>
      <Choices legend={w.scrollInside} options={optionsOf(TABLE_FIXED, all.lists.tableFixed)} value={block.fixedHeader ?? "popup"} onChange={(fixedHeader) => onChange({ fixedHeader: fixedHeader === "popup" ? undefined : fixedHeader })} />
      <p className="text-xs text-muted">{w.scrollInsideHint}</p>
      {(block.fixedHeader ?? "popup") !== "never" && (
        <NumberField label={w.maxHeight} value={block.maxHeight ?? 0} min={0} max={TABLE_MAX_HEIGHT_MAX} unit="px" onChange={(maxHeight) => onChange({ maxHeight: maxHeight >= 120 ? maxHeight : undefined })} />
      )}
      <Check label={w.rowHeaders} hint={w.rowHeadersHint} checked={Boolean(block.rowHeaders)} onChange={(rowHeaders) => onChange({ rowHeaders: rowHeaders || undefined })} />
      <Check label={w.striped} checked={Boolean(block.striped)} onChange={(striped) => onChange({ striped: striped || undefined })} />
      <OptionalColor label={w.iconColour} hint={w.iconColourHint} value={block.iconColor} fallback="#16a34a" onChange={(iconColor) => onChange({ iconColor })} />
      {block.header && (
        <>
          <OptionalColor label={w.headerColour} hint={w.pageText} value={block.headerColor} fallback="#111111" onChange={(headerColor) => onChange({ headerColor })} />
          <OptionalColor label={w.headerBackground} hint={w.headerBackgroundHint} value={block.headerBackground} fallback="#f5f5f4" onChange={(headerBackground) => onChange({ headerBackground })} />
        </>
      )}
      {block.sections?.some((title) => title != null) && (
        <>
          <OptionalColor label={w.sectionColour} hint={w.pageText} value={block.sectionColor} fallback="#111111" onChange={(sectionColor) => onChange({ sectionColor })} />
          <OptionalColor label={w.sectionBackground} hint={w.surface} value={block.sectionBackground} fallback="#f5f5f4" onChange={(sectionBackground) => onChange({ sectionBackground })} />
        </>
      )}
      {block.striped && (
        <>
          <OptionalColor label={w.stripeColour} hint={w.pageText} value={block.stripeColor} fallback="#111111" onChange={(stripeColor) => onChange({ stripeColor })} />
          <OptionalColor label={w.stripeBackground} hint={w.surface} value={block.stripeBackground} fallback="#f5f5f4" onChange={(stripeBackground) => onChange({ stripeBackground })} />
        </>
      )}
    </>
  );
}

/** How an icon list is laid out and its icons look (D91). */
function IconListStyleFields({ block, onChange }: BlockEditorProps<IconListBlock>) {
  const all = useAdminText("blocks");
  const w = all.iconList;
  return (
    <>
      <Choices legend={w.layout} options={optionsOf(ICON_LIST_LAYOUTS, all.lists.iconListLayouts)} value={block.layout ?? "column"} onChange={(layout) => onChange({ layout: layout === "column" ? undefined : layout })} />
      {block.layout === "row" && (
        <Choices
          legend={w.place}
          options={optionsOf(SEPARATOR_POSITIONS, all.lists.positions)}
          value={block.position ?? "left"}
          onChange={(position) => onChange({ position: position === "left" ? undefined : position })}
        />
      )}
      <Choices legend={w.iconSize} options={optionsOf(BUTTON_SIZES, all.lists.buttonSizes)} value={block.iconSize ?? "md"} onChange={(iconSize) => onChange({ iconSize: iconSize === "md" ? undefined : iconSize })} />
      <OptionalColor label={w.iconColour} hint={w.iconColourHint} value={block.iconColor} fallback="#2563eb" onChange={(iconColor) => onChange({ iconColor })} />
      <GradientText
        label={w.gradient}
        hint={w.gradientHint}
        value={block.iconGradient}
        onChange={(iconGradient) => onChange({ iconGradient })}
        mark={null}
        muted=""
      />
      <NumberField label={w.gap} value={block.gap ?? 12} min={0} max={SOCIAL_GAP_MAX} unit="px" onChange={(gap) => onChange({ gap: gap === 12 ? undefined : gap })} />
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
  const w = useAdminText("blocks").form;
  return (
    <TextField
      label={w.sendTo}
      value={text}
      max={1500}
      multiline
      placeholder={w.sendToPlaceholder}
      hint={
        wrong.length > 0
          ? fillWords(w.notEmails, { list: wrong.join(", ") })
          : fillWords(typed.length > FORM_RECIPIENTS_MAX ? w.tooMany : w.recipientsHint, { max: FORM_RECIPIENTS_MAX })
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
  const w = useAdminText("blocks").form;
  return (
    <>
      <TextField label={w.buttonText} value={block.submitLabel} max={BUTTON_LABEL_MAX} placeholder={usual.submit} hint={w.usualWords} onChange={(submitLabel) => onChange({ submitLabel })} />
      <TextField
        label={w.thanks}
        value={block.successMessage}
        max={FORM_TEXT_MAX}
        multiline
        placeholder={usual.success}
        hint={`${usual.when ?? w.whenSent} ${w.usualWords}`}
        onChange={(successMessage) => onChange({ successMessage })}
      />
    </>
  );
}

/** The usual words of a form in the admin's own language: what the page shows when the owner writes none. */
const usualForm = (lang: string) => t(lang === "nb" ? "nb" : "en").form;

/** An email form's questions and where it sends (D93). */
function EmailFormFields({ block, onChange }: BlockEditorProps<EmailFormBlock>) {
  const en = usualForm(useAdminLang());
  const all = useAdminText("blocks");
  const w = all.form;
  const labelHints = w.labelHints as Partial<Record<FormFieldKind, string>>;
  return (
    <>
      <RecipientsField value={block.recipients} onChange={(recipients) => onChange({ recipients })} />
      <TextField
        label={w.subject}
        value={block.subject}
        max={FORM_LABEL_MAX}
        placeholder={en.messageSubject(w.siteName)}
        hint={w.subjectHint}
        onChange={(subject) => onChange({ subject })}
      />
      <ItemsEditor<FormField>
        label={w.questions}
        items={block.fields}
        max={FORM_FIELDS_MAX}
        addLabel={w.add}
        nameOf={(field, index) => field.label.trim() || labelHints[field.kind] || fillWords(w.unnamed, { n: index + 1, kind: all.lists.formFieldKinds[field.kind].toLowerCase() })}
        newItem={() => ({ id: newItemId(), kind: "text", label: "" })}
        onChange={(fields) => onChange({ fields })}
      >
        {(field, change) => (
          <>
            <Choices
              legend={w.kind}
              options={optionsOf(FORM_FIELD_KINDS, all.lists.formFieldKinds)}
              value={field.kind}
              onChange={(kind) => change({ kind, ...(kind === "select" && !field.options?.length && { options: [""] }) })}
            />
            <TextField
              label={LABELLED_KINDS.includes(field.kind) ? w.question : w.questionOptional}
              value={field.label}
              max={FORM_LABEL_MAX}
              placeholder={labelHints[field.kind]}
              hint={LABELLED_KINDS.includes(field.kind) ? undefined : w.usualWord}
              onChange={(label) => change({ label })}
            />
            {field.kind === "select" && (
              <OptionsField value={field.options ?? []} onChange={(options) => change({ options })} />
            )}
            {field.kind !== "checkbox" && field.kind !== "select" && (
              <TextField label={w.placeholder} value={field.placeholder ?? ""} max={FORM_LABEL_MAX} onChange={(placeholder) => change({ placeholder: placeholder || undefined })} />
            )}
            <Check
              label={field.kind === "checkbox" ? w.mustTick : w.mustAnswer}
              hint={field.kind === "email" ? w.replyTo : undefined}
              checked={Boolean(field.required)}
              onChange={(required) => change({ required: required || undefined })}
            />
          </>
        )}
      </ItemsEditor>
      <Check
        label={w.consent}
        hint={w.consentHint}
        checked={block.consent !== undefined}
        onChange={(on) => onChange({ consent: on ? "" : undefined })}
      />
      {block.consent !== undefined && (
        <div className="pl-7">
          <TextField label={w.consentWords} value={block.consent} max={FORM_TEXT_MAX} multiline placeholder={w.consentPlaceholder} onChange={(consent) => onChange({ consent })} />
        </div>
      )}
      <FormTexts block={block} onChange={onChange} usual={{ submit: en.send, success: en.sent }} />
    </>
  );
}

/** A choice's options, one per line. */
function OptionsField({ value, onChange }: { value: string[]; onChange: (options: string[]) => void }) {
  const [text, setText] = useState(value.join("\n"));
  const w = useAdminText("blocks").form;
  return (
    <TextField
      label={w.choices}
      value={text}
      max={FORM_OPTIONS_MAX * (FORM_LABEL_MAX + 1)}
      multiline
      hint={fillWords(w.choicesHint, { max: FORM_OPTIONS_MAX })}
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
  const all = useAdminText("blocks");
  return (
    <>
      {block.type === "newsletter" && (
        <Choices
          legend={all.form.layout}
          options={optionsOf(NEWSLETTER_LAYOUTS, all.lists.newsletterLayouts)}
          value={block.layout ?? "inline"}
          onChange={(layout) => (onChange as (patch: Partial<NewsletterBlock>) => void)({ layout: layout === "inline" ? undefined : layout })}
        />
      )}
      <ButtonLookFields look={look} onChange={set} />
      <Check label={all.form.fullWidth} checked={Boolean(look.fullWidth)} onChange={(fullWidth) => set({ fullWidth: fullWidth || undefined })} />
    </>
  );
}

/** A newsletter sign-up (D93). */
/** A store's discounts with single-use codes (D304 J3), from the page editor; null on Kaizena Flow's own pages. */
export const SignupCodesContext = createContext<{ id: string; code: string }[] | null>(null);

function NewsletterFields({ block, onChange }: BlockEditorProps<NewsletterBlock>) {
  const en = usualForm(useAdminLang());
  const w = useAdminText("blocks").form;
  const codes = useContext(SignupCodesContext);
  const [tagsText, setTagsText] = useState((block.tags ?? []).join(", "));
  return (
    <>
      <RecipientsField value={block.recipients} onChange={(recipients) => onChange({ recipients })} />
      {codes && (
        <>
          <label className="block text-sm">
            <span className="text-ink-2">{w.welcomeCode}</span>
            <select
              className="mt-1 w-full rounded-lg border border-edge bg-card px-3 py-2"
              value={block.incentive ?? ""}
              onChange={(event) => onChange({ incentive: event.target.value || undefined })}
            >
              <option value="">{w.welcomeCodeNone}</option>
              {block.incentive && !codes.some((c) => c.id === block.incentive) && <option value={block.incentive}>?</option>}
              {codes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-muted">{w.welcomeCodeHint}</span>
          </label>
          <TextField
            label={w.tagsLabel}
            value={tagsText}
            max={SIGNUP_TAGS_MAX * 41}
            hint={w.tagsHint.replace("{max}", String(SIGNUP_TAGS_MAX))}
            onChange={(text) => {
              setTagsText(text);
              const tags = text.split(",").map((tag) => tag.trim().slice(0, 40)).filter(Boolean).slice(0, SIGNUP_TAGS_MAX);
              onChange({ tags: tags.length ? tags : undefined });
            }}
          />
        </>
      )}
      <Check
        label={w.doubleOptIn}
        hint={w.doubleOptInHint}
        checked={block.confirm !== false}
        onChange={(confirm) => onChange({ confirm: confirm ? undefined : false })}
      />
      <Check label={w.askName} hint={w.askNameHint} checked={Boolean(block.askName)} onChange={(askName) => onChange({ askName: askName || undefined })} />
      <TextField label={w.emailHint} value={block.placeholder} max={FORM_LABEL_MAX} placeholder={en.emailPlaceholder} onChange={(placeholder) => onChange({ placeholder })} />
      <TextField
        label={w.newsletterConsent}
        value={block.consent}
        max={FORM_TEXT_MAX}
        multiline
        placeholder={en.newsletterConsent}
        hint={w.newsletterConsentHint}
        onChange={(consent) => onChange({ consent })}
      />
      <FormTexts block={block} onChange={onChange} usual={{
          submit: en.subscribe,
          success: block.confirm === false ? en.subscribed : en.confirmed,
          when:
            block.confirm === false ? w.whenSignedUp : w.whenConfirmed,
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
type FieldWords = BlocksMessages["fields"];

/** What the fields are on, for a sentence: "the product", "the page or article". */
const thing = (entities: readonly FieldEntity[], w?: FieldWords) =>
  entities.map((entity) => (w ? w.noun[entity] : FIELD_ENTITY_NOUN[entity])).join(w ? w.or : " or ");
/** The kinds of thing as a plural, for a sentence: "products and variants". */
const thingsOf = (entities: readonly FieldEntity[], w?: FieldWords) =>
  entities.map((entity) => (w ? w.plural[entity] : ENTITY_WORDS[entity])).join(w ? w.and : " and ");

/** A group or a repeater is picked as one field, so its option says what it holds. */
const structureNote = (def: FieldDef, w?: FieldWords) =>
  def.type === "group" || def.type === "repeater"
    ? w
      ? fillWords(w.structure, { kind: w.kinds[def.type], n: def.subFields?.length ?? 0 })
      : ` (${def.type}, ${def.subFields?.length ?? 0} fields)`
    : "";
const fieldOption = (def: FieldDef, w?: FieldWords) =>
  `${def.label}${structureNote(def, w)}${def.access === "public" ? "" : (w?.notShown ?? " (not shown on the site)")}`;

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
  const all = useAdminText("blocks");
  const w = all.fields;
  const chosen = value.fieldId ? `f:${value.fieldId}` : value.groupId ? `g:${value.groupId}` : "";
  const known =
    chosen === "" ||
    groups.some((group) => (value.fieldId ? group.fields.some((f) => f.id === value.fieldId) : group.id === value.groupId));
  const words = thingsOf(entities, w);
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
          {w.fieldsOf}
        </label>
        <select
          id={sourceId}
          value={ofStore ? "store" : "own"}
          onChange={(event) => onChange({ source: event.target.value === "store" ? "store" : undefined, groupId: undefined, fieldId: undefined })}
          className={fieldClass}
        >
          <option value="own">{fillWords(w.this, { thing: thing(own, w) })}</option>
          <option value="store">{w.ofStore}</option>
        </select>
      </div>
    ) : null;

  if (groups.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        {sourceSelect}
        <p className="rounded-md bg-sunken p-3 text-sm text-muted">{fillWords(w.none, { words })}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {sourceSelect}
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-sm font-medium">
          {mode === "field" ? w.field : mode === "group" ? w.group : w.shows}
        </label>
        <select id={id} value={chosen} onChange={(event) => pick(event.target.value)} className={fieldClass}>
          {mode !== "field" && <option value="">{fillWords(w.everyGroup, { thing: thing(entities, w) })}</option>}
          {mode === "field" && <option value="">{w.chooseField}</option>}
          {!known && <option value={chosen}>{w.gone}</option>}
          {groups.map((group) => (
            <optgroup key={group.id} label={group.name}>
              {mode !== "field" && <option value={`g:${group.id}`}>{fillWords(w.wholeGroup, { name: group.name })}</option>}
              {mode !== "group" && group.fields.map((def) => <option key={def.id} value={`f:${def.id}`}>{fieldOption(def, w)}</option>)}
            </optgroup>
          ))}
        </select>
        <p className="text-xs text-muted">{w.onlyShown}</p>
      </div>
      <Choices
        legend={w.showAs}
        options={(Object.keys(FIELD_DISPLAYS) as FieldDisplay[]).map((display) => ({ value: display, label: all.lists.fieldDisplays[display] }))}
        value={value.display ?? "table"}
        onChange={(display) => onChange({ display: display === "table" ? undefined : display })}
      />
      <Check label={w.label} hint={w.labelHint} checked={value.showLabel !== false} onChange={(on) => onChange({ showLabel: on ? undefined : false })} />
      {!single && (
        <Check
          label={w.groupHeading}
          checked={value.showHeading !== false}
          onChange={(on) => onChange({ showHeading: on ? undefined : false })}
        />
      )}
      {(single || (value.showHeading !== false && wholeGroup)) && (
        <TextField
          label={w.heading}
          value={value.heading ?? ""}
          max={HEADING_MAX}
          placeholder={single ? w.noHeading : w.groupName}
          hint={single ? w.headingSingle : w.headingGroup}
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
  const w = useAdminText("blocks").fields;
  if (entities === null || !canBind(blockType) || (groups.length === 0 && !bind && !storeHasGroups)) return null;
  const options = bindOptions(blockType, groups);
  const known = !bind || options.some((option) => option.fields.some((def) => def.id === bind.fieldId));
  const noun = thing(ofStore ? ["store"] : entities, w);
  const bound = (fieldId: string, fallback: boolean | undefined): FieldBinding => ({
    fieldId,
    ...(ofStore && { source: "store" as const }),
    ...(fallback && { fallback: true }),
  });
  return (
    <div className="flex flex-col gap-3 rounded-md border border-line p-3">
      {!storeOnly && storeHasGroups && (
        <div className="flex flex-col gap-1">
          <label htmlFor={sourceId} className="text-sm font-medium">
            {w.fieldsOf}
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
            <option value="own">{fillWords(w.this, { thing: thing(entities, w) })}</option>
            <option value="store">{w.ofStore}</option>
          </select>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-sm font-medium">
          {w.takeFrom}
        </label>
        <select
          id={id}
          value={bind?.fieldId ?? ""}
          onChange={(event) => onChange(event.target.value ? bound(event.target.value, bind?.fallback) : undefined)}
          className={fieldClass}
        >
          <option value="">{w.useOwn}</option>
          {bind && !known && <option value={bind.fieldId}>{w.cannotUse}</option>}
          {options.map(({ group, fields }) => (
            <optgroup key={group.id} label={group.name}>
              {fields.map((def) => (
                <option key={def.id} value={def.id}>{`${group.name} › ${def.label}${def.access === "public" ? "" : w.notShown}`}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <p className="text-xs text-muted">{fillWords(options.length === 0 ? w.noneOfKind : w.showsValue, { noun })}</p>
      </div>
      {bind && (
        <Check
          label={w.keepOwn}
          hint={w.keepOwnHint}
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
  const w = useAdminText("blocks").fields;
  return (
    <p className="mb-1 w-fit rounded border border-dashed border-line px-1.5 py-0.5 text-[11px] text-muted">
      {`${fillWords(w.badge, { name: def?.label ?? w.badgeGone })}${bind.fallback ? w.badgeFallback : ""}`}
    </p>
  );
}

/** The page component that shows the fields of the page or article it is on. */
function CustomFieldFields({ block, onChange }: BlockEditorProps<CustomFieldBlock>) {
  const w = useAdminText("blocks").fields;
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">{w.customIntro}</p>
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
  const all = useAdminText("blocks");
  const w = all.fields;
  const words = thingsOf(entities, w);
  const layout = value.layout ?? "cards";

  if (repeaters.length === 0) {
    return <p className="rounded-md bg-sunken p-3 text-sm text-muted">{fillWords(w.noRepeater, { words })}</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-sm font-medium">
          {w.repeater}
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
          <option value="">{w.chooseRepeater}</option>
          {value.fieldId && !chosen && <option value={value.fieldId}>{w.repeaterGone}</option>}
          {repeaters.map(({ group, def }) => (
            <option key={def.id} value={def.id}>{`${group.name} › ${def.label}${def.access === "public" ? "" : w.notShown}`}</option>
          ))}
        </select>
        <p className="text-xs text-muted">{w.eachRow}</p>
      </div>
      <Choices
        legend={w.layout}
        options={(Object.keys(LOOP_LAYOUTS) as LoopLayout[]).map((key) => ({ value: key, label: all.lists.loopLayouts[key] }))}
        value={layout}
        onChange={(next) => onChange({ layout: next === "cards" ? undefined : next })}
      />
      {layout !== "list" && (
        <Choices
          legend={w.columns}
          hint={w.larger}
          options={LOOP_COLUMNS.map((n) => ({ value: String(n), label: String(n) }))}
          value={String(value.columns ?? 3)}
          onChange={(next) => onChange({ columns: (Number(next) === 3 ? undefined : Number(next)) as LoopColumns | undefined })}
        />
      )}
      {chosen && (
        <div className="flex flex-col gap-3 rounded-md border border-line p-3">
          <p className="text-sm font-medium">{w.rowShows}</p>
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
            label={w.wholeCard}
            hint={w.wholeCardHint}
            checked={Boolean(value.linkWholeCard)}
            onChange={(on) => onChange({ linkWholeCard: on ? true : undefined })}
          />
        </div>
      )}
      <TextField
        label={w.loopHeading}
        value={value.heading ?? ""}
        max={HEADING_MAX}
        placeholder={w.noHeading}
        hint={w.loopHeadingHint}
        onChange={(heading) => onChange({ heading: heading || undefined })}
      />
    </div>
  );
}

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
  const all = useAdminText("blocks");
  const w = all.fields;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm">
        {all.lists.loopSlots[slot]}
      </label>
      <select id={id} value={value ?? ""} onChange={(event) => onChange(event.target.value || undefined)} className={fieldClass} disabled={choices.length === 0}>
        <option value="">{choices.length === 0 ? fillWords(w.noFit, { hint: w.slots[slot] }) : w.nothing}</option>
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
  const w = useAdminText("blocks").fields;
  // What was chosen for another kind of thing is not on these tiles: it goes at the next change.
  const chosen = value.filter((id) => offered.has(id));
  if (options.length === 0) return null;
  const toggle = (id: string, on: boolean) => {
    const next = on ? [...chosen, id] : chosen.filter((f) => f !== id);
    onChange(next.length > 0 ? next : undefined);
  };
  return (
    <fieldset className="flex flex-col gap-2 border-t border-line pt-4">
      <legend className="float-left mb-2 w-full text-sm font-medium">
        {w.onTiles} <span className="font-normal text-muted">{fillWords(w.upTo, { max: TILE_FIELDS_MAX })}</span>
      </legend>
      <p className="text-xs text-muted">{w.onTilesHint}</p>
      {options.map(({ group, fields }) => (
        <div key={group.id} className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted">{group.name}</p>
          {fields.map((def) => (
            <Check
              key={def.id}
              label={def.label}
              hint={def.access === "public" ? undefined : w.notShownYet}
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
  const w = useAdminText("blocks").fields;
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">{w.loopIntro}</p>
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
  const all = useAdminText("blocks");
  const w = all.fields;
  const named = LOOP_SLOT_KEYS.flatMap((slot) => {
    const sub = slots[slot] && def?.subFields?.find((f) => f.id === slots[slot]);
    return sub ? [`${all.lists.loopSlots[slot].toLowerCase()}: ${sub.label}`] : [];
  });
  return (
    <span className="flex flex-col gap-2 text-sm">
      <span className="font-medium">{fillWords(w.loopTitle, { name: def ? def.label : value.fieldId ? w.repeaterGoneLower : w.chooseOne })}</span>
      {def ? (
        <>
          <span className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(columns, 3)}, minmax(0, 1fr))` }}>
            {[0, 1, 2].slice(0, layout === "list" ? 2 : Math.min(columns, 3)).map((n) => (
              <span
                key={n}
                className={`flex gap-2 rounded-panel border border-line p-2 ${layout === "list" ? "flex-row items-center" : "flex-col"}`}
              >
                {slots.image && <span className={layout === "list" ? "size-10 shrink-0 rounded bg-inverse/10" : "aspect-video rounded bg-inverse/10"} />}
                <span className="flex flex-1 flex-col gap-1">
                  <span className="h-2.5 w-2/3 rounded bg-inverse/20" />
                  {slots.text && <span className="h-2 w-full rounded bg-inverse/10" />}
                </span>
              </span>
            ))}
          </span>
          <span className="text-xs text-muted">{named.length > 0 ? fillWords(w.eachRowSlots, { list: named.join(", ") }) : w.chooseSlots}</span>
        </>
      ) : (
        <span className="text-xs text-muted">{w.chooseRepeaterSettings}</span>
      )}
      <span className="text-xs text-muted">{fillWords(w.rowsRead, { thing: thing(entities, w) })}</span>
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
  const w = useAdminText("blocks").fields;
  const store = value.source === "store" ? w.ofTheStore : "";
  const title = single
    ? fillWords(w.oneField, { store, name: field?.label ?? w.chooseOneField })
    : fillWords(w.manyFields, { store, name: value.groupId ? (shownGroups[0]?.name ?? w.groupGone) : w.everyApplies });
  const names = single ? (field ? [field] : []) : shownGroups.flatMap(publicFields);
  const label = (name: string, n: number) =>
    display === "cards" ? (
      <span key={n} className="flex flex-col gap-1 rounded-panel border border-line p-2">
        {value.showLabel !== false && <span className="text-[10px] font-medium tracking-wide text-muted uppercase">{name}</span>}
        <span className="h-2.5 w-2/3 rounded bg-inverse/10" />
      </span>
    ) : (
      <span key={n} className="flex items-center gap-3 border-b border-line py-1.5 last:border-b-0">
        {value.showLabel !== false && <span className="w-1/3 truncate text-muted">{display === "list" ? `${name}:` : name}</span>}
        <span className="h-2.5 flex-1 rounded bg-inverse/10" />
      </span>
    );

  return (
    <span className="flex flex-col gap-2 text-sm">
      <span className="font-medium">{title}</span>
      {names.length > 0 ? (
        <span className={display === "cards" ? "grid grid-cols-2 gap-2" : "flex flex-col"}>{names.map((f, n) => label(f.label, n))}</span>
      ) : (
        <span className="text-xs text-muted">
          {single && !field ? w.chooseFieldSettings : w.noneShown}
        </span>
      )}
      <span className="text-xs text-muted">{fillWords(w.valuesRead, { thing: thing(entities, w) })}</span>
    </span>
  );
}
