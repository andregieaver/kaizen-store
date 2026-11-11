"use client";

import { ButtonHoverField } from "./hover-fields";
import { type Size } from "@/lib/breakpoints";
import { type ThemeTabValue } from "@/lib/theme";
import { rowWidthPatch } from "@/lib/theme-elements";
import { sectionStyleChoices, sectionStyleLabel } from "@/lib/section-styles";
import { MarkupInput } from "@/components/admin/markup-input";
import { carouselAnywhere, carouselAt, clearAt, inheritedAt, setAt, sizeSource, stackAt, stackPatchAt, valueAt } from "@/lib/responsive";
import { createContext, useContext, useEffect, useEffectEvent, useId, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { ContentGridView } from "@/components/content-grid";
import { t } from "@/lib/i18n";
import { PartBackground } from "@/components/page-parts";
import { useAdminText } from "./admin-text";
import { fillWords } from "@/lib/admin-fill";
import { PixelRange } from "./pixel-range";
import { BackgroundMotionFields, GradientFields } from "./gradient-fields";
import { ROW_LAYOUTS, BACKDROP_BLUR_MAX, BLUR_MAX, BORDER_MAX, BORDER_STYLES, BUTTON_LABEL_MAX, GRID_COLUMNS_MAX, GRID_CONTENT, GRID_ELEMENTS, GRID_GAP_MAX, GRID_LIMIT_MAX, GRID_SORTS, PRICE_SORTS, PRODUCT_SORTS, HEADING_MAX, HTML_ID_MAX, IMAGE_SHAPES, RADIUS_MAX, CONTENT_MAX_MAX, CONTENT_MAX_MIN, COLUMN_SHARE_MAX, ROW_HEIGHT_VH, SHADOWS, shadowOpacityOf, SPACING_MAX, classNameProblem, htmlIdProblem, isLinkAddress, gridImageShape, DEFAULT_GRID_RECOMMEND, type RowBackground, type BorderStyle, type ButtonBlock, type HeadingBlock, type HeadingLevel, isDualHeading, type Shadow, type ColumnLink, type ContentGridBlock, type GridContent, type GridElement, type GridSort, type GridSource, type ImageShape, type PartBase, type PageBlock, type PageColumn, type ImageBlock, type PageRow, type Sides, type Spacing, contentSides } from "@/lib/page-content";
import { type BackgroundMotion } from "@/lib/motion";
import { backgroundMoves, switchBackground } from "@/lib/motion-edit";
import type { BackgroundLayer } from "@/lib/background-layers";
import type { BackdropPatch } from "@/lib/backdrops";
import { partFeatureOn } from "@/lib/part-features";
import { linesOf, locateColumn, type BlockPatch, type ColumnPatch, type RowPatch } from "@/lib/page-rows";
import type { GridData } from "@/lib/content-grid";
import { tileEntity } from "@/lib/tile-fields";
import { typeAsGroup } from "@/lib/content-types";
import { copiedItems, customGridData, sourceChoice } from "@/lib/custom-grid";
import { sourceTraits } from "@/lib/grid-source";
import { CopyCurrentItems, CustomItemsEditor } from "./custom-items-editor";
import { SizeMark, inheritedClass, useSizeEdit } from "./responsive-edit";
import { byName, categoryTree, type Term } from "@/lib/taxonomy";
import type { GridStore } from "@/server/content-grid";
import { ButtonLookFields, CarouselFields, Check, Choices, ColorField, TileFieldsPicker, OptionalColor, TextAlignFields } from "./block-fields";
import { ImageUploadButton, type Upload } from "./image-upload";
import { VideoUploadButton, type StartVideo } from "./video-upload";
import type { GridContext } from "./page-builder";

/**
 * The page builder's settings fields (D43, D179, D182, CODE-06): a row's, column's and component's spacing, background, frame,
 * shadow, size per screen, link and advanced settings, and the fields of the builder's own components (heading, button, content
 * grid). Moved out of `page-builder.tsx` as they were, used by its settings panel.
 */

const SIDES = ["top", "right", "bottom", "left"] as const;
const NO_SIDES: Sides = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Margin (space outside) and padding (space inside), each for the top,
 * right, bottom and left, in pixels (D47). Changes show on the canvas at once.
 * `defaults` is what a part has until given its own (a row's padding); set
 * to 0 there, it is kept, so the default does not come back.
 */
export function SpacingFields({
  value,
  defaults,
  onChange,
  sized,
}: {
  value: Spacing | undefined;
  defaults?: Spacing;
  onChange: (value: Spacing) => void;
  /** Margin and padding differ by screen size (D179): the part, for where each value comes from, and how to give one back. */
  sized?: { part: PartBase; onPatch: (patch: Partial<PartBase>) => void };
}) {
  const id = useId();
  const { size } = useSizeEdit();
  const fw = useAdminText("builder").fields;
  const set = (kind: "margin" | "padding", side: (typeof SIDES)[number], text: string) => {
    const number = Math.max(kind === "margin" ? -SPACING_MAX : 0, Math.min(SPACING_MAX, Math.round(Number(text) || 0)));
    const sides = { ...NO_SIDES, ...(value?.[kind] ?? defaults?.[kind]), [side]: number };
    const empty = SIDES.every((s) => sides[s] === 0);
    const next: Spacing = { ...value };
    if (empty && !defaults?.[kind]) delete next[kind];
    else next[kind] = sides;
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-4 border-t border-border pt-4">
      {(["margin", "padding"] as const).map((kind) => (
        <fieldset key={kind} className={`flex flex-col gap-2 ${sized ? inheritedClass(sizeSource(sized.part, size, kind), size) : ""}`}>
          <legend className="text-sm font-medium">
            {fw[kind]}{" "}
            <span className="font-normal text-muted">({kind === "margin" ? fw.marginHint : fw.paddingHint})</span>
            {sized && <SizeMark part={sized.part} field={kind} label={fw[kind]} onPatch={sized.onPatch} />}
          </legend>
          <div className="grid grid-cols-4 gap-2">
            {SIDES.map((side) => (
              <label key={side} htmlFor={`${id}-${kind}-${side}`} className="flex flex-col gap-1 text-xs text-muted">
                {fw.sides[side]}
                <input
                  id={`${id}-${kind}-${side}`}
                  type="number"
                  inputMode="numeric"
                  min={kind === "margin" ? -SPACING_MAX : 0}
                  max={SPACING_MAX}
                  step={4}
                  value={value?.[kind]?.[side] ?? defaults?.[kind]?.[side] ?? 0}
                  onChange={(event) => set(kind, side, event.target.value)}
                  className="min-h-10 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground"
                />
                <PixelRange
                  value={value?.[kind]?.[side] ?? defaults?.[kind]?.[side] ?? 0}
                  min={kind === "margin" ? -SPACING_MAX : 0}
                  max={SPACING_MAX}
                  step={2}
                  label={fillWords(fw.sideSlider, { what: fw[kind], side: fw.sides[side].toLowerCase() })}
                  onChange={(next) => set(kind, side, String(next))}
                />
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

/** A picture block's picture, description and caption (D47). */
export function ImageFields({
  block,
  upload,
  onChange,
}: {
  block: ImageBlock;
  upload: Upload | null;
  onChange: (block: ImageBlock) => void;
}) {
  const id = useId();
  const iw = useAdminText("builder").image;
  return (
    <div className="flex flex-col gap-4">
      {block.image ? (
        // eslint-disable-next-line @next/next/no-img-element -- admin preview of the uploaded picture
        <img src={block.image.url} alt="" className="max-h-72 w-full rounded-md border border-border bg-surface object-contain" />
      ) : (
        <div className="flex h-40 items-center justify-center rounded-md border border-dashed border-border bg-surface text-sm text-muted">
          {iw.none}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <ImageUploadButton
          upload={upload}
          label={block.image ? iw.replace : iw.upload}
          current={block.image}
          // A picture made by prompt (D283) comes described by what it was asked for.
          onUploaded={(image, made) => onChange({ ...block, image: { ...image, alt: made?.alt ?? block.image?.alt ?? "" } })}
        />
        {block.image && (
          <button type="button" onClick={() => onChange({ ...block, image: null })} className="px-2 py-2 text-sm underline">
            {iw.remove}
          </button>
        )}
      </div>
      {block.image && (
        <p className="text-xs text-muted">{fillWords(iw.ownSize, { width: block.image.width, height: block.image.height })}</p>
      )}
      {block.image && (
        <label htmlFor={`${id}-alt`} className="flex flex-col gap-1 text-sm font-medium">
          {iw.description}
          <textarea
            id={`${id}-alt`}
            rows={2}
            maxLength={300}
            value={block.image.alt}
            onChange={(event) => block.image && onChange({ ...block, image: { ...block.image, alt: event.target.value } })}
            placeholder={iw.descriptionPlaceholder}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
          />
          <span className="text-xs font-normal text-muted">{iw.decoration}</span>
        </label>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-href`} className="text-sm font-medium">
          {iw.link} <span className="font-normal text-muted">({iw.optional})</span>
        </label>
        <input
          id={`${id}-href`}
          value={block.href ?? ""}
          maxLength={2000}
          spellCheck={false}
          placeholder={iw.addressPlaceholder}
          aria-invalid={Boolean(block.href?.trim() && !isLinkAddress(block.href.trim()))}
          aria-describedby={`${id}-href-hint`}
          onChange={(event) => onChange({ ...block, href: event.target.value || undefined })}
          className="min-h-10 rounded-md border border-border bg-background px-3 text-sm aria-invalid:border-red-700"
        />
        <span
          id={`${id}-href-hint`}
          className={`text-xs ${block.href?.trim() && !isLinkAddress(block.href.trim()) ? "text-red-700 dark:text-red-400" : "text-muted"}`}
        >
          {block.href?.trim() && !isLinkAddress(block.href.trim()) ? iw.badAddress : iw.linkHint}
        </span>
      </div>
      {block.href?.trim() && (
        <Check
          label={iw.newTab}
          hint={iw.newTabHint}
          checked={Boolean(block.newTab)}
          onChange={(newTab) => onChange({ ...block, newTab: newTab || undefined })}
        />
      )}
      <label htmlFor={`${id}-caption`} className="flex flex-col gap-1 text-sm font-medium">
        <span>
          {iw.caption} <span className="font-normal text-muted">({iw.captionHint})</span>
        </span>
        <MarkupInput id={`${id}-caption`} label={iw.caption} value={block.caption} max={300} className="font-normal" onChange={(caption) => onChange({ ...block, caption })} />
      </label>
    </div>
  );
}

/**
 * What the builder adds at the foot of a settings dialog's General tab for the part the dialog is for: its schedule, *Show from*
 * and *Show until* (D432), in every row's, column's and component's settings without each dialog naming it.
 */
export const GeneralFoot = createContext<ReactNode>(null);

const SETTINGS_TABS = [{ key: "general" }, { key: "style" }, { key: "motion" }, { key: "advanced" }] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number]["key"];

/** A settings dialog's four tabs (D48, D128): what it holds, how it looks, how it moves, and its id and classes. */
export function SettingsTabs(panels: Record<SettingsTab, ReactNode>) {
  const [tab, setTab] = useState<SettingsTab>("general");
  const foot = useContext(GeneralFoot);
  const id = useId();
  const fw = useAdminText("builder").fields;
  const select = (index: number) => {
    const next = SETTINGS_TABS[(index + SETTINGS_TABS.length) % SETTINGS_TABS.length].key;
    setTab(next);
    document.getElementById(`${id}-${next}`)?.focus();
  };
  return (
    <div className="flex flex-col gap-5">
      <div role="tablist" aria-label={fw.settings} className="sticky -top-5 z-10 -mx-5 -mt-5 flex border-b border-border bg-background px-3">
        {SETTINGS_TABS.map((t, index) => (
          <button
            key={t.key}
            id={`${id}-${t.key}`}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            aria-controls={`${id}-panel`}
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => setTab(t.key)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") select(index + 1);
              if (event.key === "ArrowLeft") select(index - 1);
            }}
            className="min-h-11 border-b-2 border-transparent px-3 text-sm font-medium text-muted aria-selected:border-foreground aria-selected:text-foreground"
          >
            {fw.tabs[t.key]}
          </button>
        ))}
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`} className="flex flex-col gap-5">
        {panels[tab]}
        {tab === "general" && foot}
      </div>
    </div>
  );
}




// Backdrops, the hue and the layers (D534) are fetched when a background's settings are first opened: the builder's first scripts do not carry them.
const BackdropPicker = dynamic(() => import("./backdrop-fields").then((m) => m.BackdropPicker), { ssr: false, loading: () => null });
const LayerFields = dynamic(() => import("./backdrop-fields").then((m) => m.LayerFields), { ssr: false, loading: () => null });

/**
 * A row's or column's background (D48): none, a colour, or a picture (or,
 * for rows, given `startVideo`, a video) with a colour and blur over it,
 * previewed as the page draws it. With none or a colour (see-through if
 * wanted), what is behind the part can be blurred (D86). Given `backdrop`, the ready-made backdrops and the hue of the whole
 * background come right under the kind (Homer's), and the layers over the background last, behind one press (Lisa's; D534).
 */
export function BackgroundFields({
  backdrop,
  value,
  upload,
  startVideo,
  onChange,
  backdropBlur,
  onBackdropBlur,
  target,
  motion,
  onMotion,
  mark,
  fixed,
  onFixed,
  align,
  onAlign,
  still = false,
}: {
  /** The layers over the background and the hue of the whole (D534), and what changing them does; left out, neither is offered. */
  backdrop?: {
    layers: BackgroundLayer[] | undefined;
    hue: number | undefined;
    /** A ready-made backdrop put on: the background, layers and hue together, as one change. */
    onBackdrop: (patch: BackdropPatch) => void;
    onLayers: (layers: BackgroundLayer[] | undefined) => void;
    onHue: (hue: number | undefined) => void;
  };
  /** Which part of a picture or video shows where it is cut to fit, for a fixed background (D184). */
  align?: "top" | "middle" | "bottom";
  onAlign?: (align: "top" | "middle" | "bottom" | undefined) => void;
  /** Rows alone can fix a picture, video or gradient to the screen (D184); given, the choice is offered. */
  fixed?: boolean;
  onFixed?: (fixed: boolean) => void;
  value: RowBackground | undefined;
  upload: Upload | null;
  /** Given for rows, which alone take a video; null where uploads are not set up. */
  startVideo?: StartVideo | null;
  onChange: (background: RowBackground | undefined) => void;
  backdropBlur: number | undefined;
  onBackdropBlur: (blur: number | undefined) => void;
  /** Whether this is a row's or a column's, for the effects offered a background (D128). */
  target: "row" | "column";
  /** How the picture, video or gradient moves; only they can. */
  motion: BackgroundMotion | undefined;
  onMotion: (motion: BackgroundMotion | undefined) => void;
  /** After the legend: its device icon (D179; a colour can differ by screen size). */
  mark?: ReactNode;
  /** A background that does not move (the phone menu's): no effects are offered. */
  still?: boolean;
}) {
  // A picture or video chosen as the kind waits for its upload before it is kept.
  const [kind, setKind] = useState<"none" | RowBackground["type"]>(value?.type ?? "none");
  const choose = (next: typeof kind) => {
    setKind(next);
    // The new kind is made from its own settings only, so nothing of the old one stays on it (D128).
    const switched = switchBackground(value, next);
    // A picture, video or gradient is drawn over what is behind, so blurring that would show nothing.
    if (switched.clearBackdropBlur && backdropBlur) onBackdropBlur(undefined);
    onChange(switched.background);
    // A colour does not move.
    if (switched.clearMotion && motion) onMotion(undefined);
  };
  const media = value?.type === "image" || value?.type === "video" ? value : null;
  const kept = { overlay: media?.overlay ?? null, ...(media?.blur ? { blur: media.blur } : {}) };
  const bw = useAdminText("builder").background;
  return (
    <div className="flex flex-col gap-4">
      <Choices
        legend={bw.legend}
        mark={mark}
        options={[
          { value: "none", label: bw.kinds.none },
          { value: "color", label: bw.kinds.color },
          { value: "image", label: bw.kinds.image },
          { value: "gradient", label: bw.kinds.gradient },
          ...(startVideo !== undefined ? [{ value: "video" as const, label: bw.kinds.video }] : []),
        ]}
        value={kind}
        onChange={choose}
      />
      {backdrop && (
        <BackdropPicker
          background={value}
          layers={backdrop.layers}
          hue={backdrop.hue}
          onBackdrop={(patch) => {
            // The kind follows the backdrop's own background, so its fields show under it.
            setKind(patch.background?.type ?? "none");
            backdrop.onBackdrop(patch);
          }}
          onHue={backdrop.onHue}
        />
      )}
      {kind === "color" && value?.type === "color" && (
        <ColorField
          label={bw.colour}
          value={value.color}
          onChange={(color) => onChange({ ...value, color })}
          opacity={{
            value: value.opacity,
            onChange: (opacity) => {
              const next: RowBackground = { type: "color", color: value.color };
              onChange(opacity === undefined ? next : { ...next, opacity });
            },
          }}
        />
      )}
      {(kind === "none" || kind === "color") && (
        <>
          <Check
            label={bw.blurBehind}
            hint={kind === "none" ? bw.blurBehindNone : bw.blurBehindColour}
            checked={Boolean(backdropBlur)}
            onChange={(on) => onBackdropBlur(on ? 12 : undefined)}
          />
          {backdropBlur ? (
            <div className="pl-7">
              <RangeField
                label={bw.blur}
                min={1}
                max={BACKDROP_BLUR_MAX}
                step={1}
                value={backdropBlur}
                shown={`${backdropBlur} px`}
                onChange={onBackdropBlur}
              />
            </div>
          ) : null}
        </>
      )}
      {(kind === "image" || kind === "video") && (
        <div className="flex flex-col gap-3">
          {media?.type === kind ? (
            // The picture or video as the page draws it, with its colour and blur, so changes show here at once.
            <div className="relative isolate h-48 w-full overflow-hidden rounded-md border border-border">
              <PartBackground background={media} motion={motion} layers={backdrop?.layers} hue={backdrop?.hue} preview />
            </div>
          ) : (
            <div className="flex h-28 items-center justify-center rounded-md border border-dashed border-border bg-surface text-sm text-muted">
              {kind === "video" ? bw.noVideo : bw.noPicture}
            </div>
          )}
          {kind === "image" ? (
            <ImageUploadButton
              upload={upload}
              label={media?.type === "image" ? bw.replacePicture : bw.uploadPicture}
              current={media?.type === "image" ? media.image : null}
              onUploaded={(uploaded) => onChange({ type: "image", image: uploaded, ...kept })}
            />
          ) : (
            <VideoUploadButton
              startVideo={startVideo ?? null}
              upload={upload}
              label={media?.type === "video" ? bw.replaceVideo : bw.uploadVideo}
              onUploaded={(uploaded) => onChange({ type: "video", ...uploaded, ...kept })}
            />
          )}
          {media?.type === kind && (
            <>
              <Check
                label={kind === "video" ? bw.overVideo : bw.overPicture}
                hint={bw.overHint}
                checked={Boolean(media.overlay)}
                onChange={(on) => onChange({ ...media, overlay: on ? { color: "#000000", opacity: 40 } : null })}
              />
              {media.overlay && (
                <OverlayFields overlay={media.overlay} onChange={(overlay) => onChange({ ...media, overlay })} />
              )}
              <Check
                label={kind === "video" ? bw.blurVideo : bw.blurPicture}
                hint={bw.blurHint}
                checked={Boolean(media.blur)}
                onChange={(on) => onChange(withBlur(media, on ? 6 : 0))}
              />
              {media.blur ? (
                <div className="pl-7">
                  <RangeField
                    label={bw.blur}
                    min={1}
                    max={BLUR_MAX}
                    step={1}
                    value={media.blur}
                    shown={`${media.blur} px`}
                    onChange={(blur) => onChange(withBlur(media, blur))}
                  />
                </div>
              ) : null}
            </>
          )}
        </div>
      )}
      {kind === "gradient" && value?.type === "gradient" && (
        <div className="flex flex-col gap-4">
          {/* The gradient as the page draws it, moving as it will. */}
          <div className="relative isolate h-40 w-full overflow-hidden rounded-md border border-border">
            <PartBackground background={value} motion={motion} layers={backdrop?.layers} hue={backdrop?.hue} preview />
          </div>
          <GradientFields value={value} onChange={onChange} />
        </div>
      )}
      {onFixed && backgroundMoves(value) && (
        <Check
          label={bw.fixed}
          hint={bw.fixedHint}
          checked={Boolean(fixed)}
          onChange={onFixed}
        />
      )}
      {onAlign && fixed && (value?.type === "image" || value?.type === "video") && (
        <Choices
          legend={bw.position}
          hint={bw.positionHint}
          options={[
            { value: "top", label: bw.top },
            { value: "middle", label: bw.middle },
            { value: "bottom", label: bw.bottom },
          ]}
          value={align ?? "middle"}
          onChange={(next) => onAlign(next === "middle" ? undefined : next)}
        />
      )}
      {/* A picture, video or gradient can move; a colour cannot. */}
      {backgroundMoves(value) && !fixed && !still && <BackgroundMotionFields target={target} value={motion} onChange={onMotion} />}
      {backdrop && <LayerFields layers={backdrop.layers} hue={backdrop.hue} upload={upload} onLayers={backdrop.onLayers} />}
    </div>
  );
}

type MediaBackground = Extract<RowBackground, { type: "image" | "video" }>;

/** A picture or video background with this much blur; none is left out, so the page stays as small as it can. */
const withBlur = <T extends MediaBackground>(media: T, blur: number): T => {
  const next = { ...media };
  if (blur > 0) next.blur = blur;
  else delete next.blur;
  return next;
};

/** A slider with its value shown beside it. */
function RangeField({
  label,
  min,
  max,
  step,
  value,
  shown,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  shown: string;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex min-h-10 items-center gap-3">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="w-40"
        />
        <output htmlFor={id} className="w-12 text-sm tabular-nums">
          {shown}
        </output>
      </div>
    </div>
  );
}

function OverlayFields({
  overlay,
  onChange,
}: {
  overlay: { color: string; opacity: number };
  onChange: (overlay: { color: string; opacity: number }) => void;
}) {
  const bw = useAdminText("builder").background;
  return (
    <div className="flex flex-wrap items-end gap-6 pl-7">
      <ColorField label={bw.overlayColour} value={overlay.color} onChange={(color) => onChange({ ...overlay, color })} />
      <RangeField
        label={bw.opacity}
        min={0}
        max={100}
        step={5}
        value={overlay.opacity}
        shown={`${overlay.opacity}%`}
        onChange={(opacity) => onChange({ ...overlay, opacity })}
      />
    </div>
  );
}

/**
 * What the theme's Row says about every row's width (D190): a row's own choice wins, so its fields show what it comes to (its own, else
 * the theme's) and write its own only where that is not what it would be without it.
 */
export const ThemeRowWidths = createContext<{ width?: "content" | "full"; contentWidth?: "content" | "full" }>({});
/** The live theme's section styles (D242), for a row's choice; undefined where the builder has no Theme tab. */
export const ThemeSections = createContext<ThemeTabValue["sections"]>(undefined);

/**
 * The theme's section style a row is drawn in (D242): None keeps the row on the site's elements; a style the theme does not have
 * draws as its Plain. The name is all the row keeps, so switching themes restyles it.
 */
function SectionStyleField({ row, onChange }: { row: PageRow; onChange: (patch: RowPatch) => void }) {
  const sections = useContext(ThemeSections);
  const id = useId();
  const choices = sectionStyleChoices(sections);
  const current = row.sectionStyle;
  const known = current === undefined || choices.includes(current);
  const rw = useAdminText("builder").row;
  const styleName = useStyleName();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {rw.sectionStyle}
      </label>
      <select
        id={id}
        value={current ?? ""}
        onChange={(event) => onChange({ sectionStyle: event.target.value || undefined })}
        className="min-h-10 rounded-md border border-border bg-background px-2 text-sm"
      >
        <option value="">{rw.sectionNone}</option>
        {choices.map((name) => (
          <option key={name} value={name}>
            {styleName(name)}
          </option>
        ))}
        {!known && current && <option value={current}>{fillWords(rw.sectionMissing, { name: styleName(current) })}</option>}
      </select>
      <p className="text-xs text-muted">{rw.sectionHint}</p>
    </div>
  );
}

/** A section style's name in the account's language: the core styles' from the design words (D312 A7), a theme's own as it is written. */
export function useStyleName(): (name: string) => string {
  const names = useAdminText("design").changes.styles;
  return (name) => names[name] ?? sectionStyleLabel(name);
}

/** A row's width and what it holds, the same two choices on a row and on the theme's Row (D48, D190). */
export function RowWidthChoices({
  width,
  contentWidth,
  onWidth,
  onContentWidth,
}: {
  width: "content" | "full";
  contentWidth: "content" | "full";
  onWidth: (width: "content" | "full") => void;
  onContentWidth: (contentWidth: "content" | "full") => void;
}) {
  const full = width === "full";
  const rw = useAdminText("builder").row;
  return (
    <>
      <Choices
        legend={rw.rowWidth}
        options={[
          { value: "content", label: rw.contentWidth },
          { value: "full", label: rw.fullWidth },
        ]}
        value={width}
        onChange={onWidth}
      />
      <Choices
        legend={rw.contentWidth}
        hint={full ? rw.whatItHolds : rw.forFullWidth}
        disabled={!full}
        options={[
          { value: "content", label: rw.contentWidth },
          { value: "full", label: rw.fullWidth },
        ]}
        value={contentWidth}
        onChange={onContentWidth}
      />
    </>
  );
}

/** A row's width and height, its columns at each screen size, and how they line up (D48, D179). */
export function RowFields({ row, onChange }: { row: PageRow; onChange: (patch: RowPatch) => void }) {
  // What the row comes to: its own choice, else the theme's Row, else the content's width (D190).
  const theme = useContext(ThemeRowWidths);
  const width = row.width ?? theme.width ?? "content";
  const contentWidth = row.contentWidth ?? theme.contentWidth ?? "content";
  const rw = useAdminText("builder").row;
  return (
    <div className="flex flex-col gap-4 border-t border-border pt-4">
      <SectionStyleField row={row} onChange={onChange} />
      <RowWidthChoices
        width={width}
        contentWidth={contentWidth}
        onWidth={(next) => onChange(rowWidthPatch(theme, { width: next }))}
        onContentWidth={(next) => onChange(rowWidthPatch(theme, { contentWidth: next }))}
      />
      <ContentMaxField row={row} limited={width !== "full" || contentWidth !== "full"} onChange={onChange} />
      <RowHeightField row={row} onChange={onChange} />
      <Check
        label={rw.fullHeight}
        hint={rw.fullHeightHint}
        checked={Boolean(row.fullHeight)}
        onChange={(fullHeight) => onChange({ fullHeight })}
      />
      <RowSizeFields row={row} onChange={onChange} />
      <Check
        label={rw.equalHeight}
        hint={rw.equalHeightHint}
        checked={Boolean(row.equalHeight)}
        onChange={(equalHeight) => onChange({ equalHeight })}
      />
      <Choices
        legend={rw.columnContent}
        options={[
          { value: "top", label: rw.top },
          { value: "middle", label: rw.middle },
          { value: "bottom", label: rw.bottom },
        ]}
        value={row.align ?? "top"}
        onChange={(align) => onChange({ align: align === "top" ? undefined : align })}
      />
    </div>
  );
}

/**
 * A row's height as a share of the screen's, at the size edited (D184): at least that tall. With a fixed background (and a
 * background of full screen height) it is the window that shows part of the background as the page scrolls.
 */
function RowHeightField({ row, onChange }: { row: PageRow; onChange: (patch: RowPatch) => void }) {
  const { size } = useSizeEdit();
  const id = useId();
  const value = valueAt(row, "height", size) ?? null;
  const [draft, setDraft] = useState<string | null>(null);
  const back = (patch: { at: PageRow["at"] }) => onChange(patch);
  const rw = useAdminText("builder").row;
  return (
    <div className={`flex flex-col gap-1 ${inheritedClass(sizeSource(row, size, "height"), size)}`}>
      <div className="flex flex-wrap items-center gap-1">
        <label htmlFor={id} className="text-sm font-medium">
          {rw.height} <span className="font-normal text-muted">({fillWords(rw.heightHint, { min: ROW_HEIGHT_VH.min, max: ROW_HEIGHT_VH.max })})</span>
        </label>
        <SizeMark part={row} field="height" label={rw.height} onPatch={back} />
      </div>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={ROW_HEIGHT_VH.min}
        max={ROW_HEIGHT_VH.max}
        placeholder={rw.heightPlaceholder}
        value={draft ?? value ?? ""}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          const number = Math.round(Number(next));
          if (next === "") onChange(setAt(row, size, { height: undefined }));
          else if (number >= ROW_HEIGHT_VH.min && number <= ROW_HEIGHT_VH.max) onChange(setAt(row, size, { height: number }));
        }}
        onBlur={() => setDraft(null)}
        className="min-h-10 w-40 rounded-md border border-border bg-background px-2 text-sm"
      />
      <PixelRange
        value={value ?? 100}
        min={ROW_HEIGHT_VH.min}
        max={100}
        step={5}
        unit="vh"
        label={fillWords(rw.slider, { what: rw.height })}
        onChange={(next) => {
          setDraft(null);
          onChange(setAt(row, size, { height: next }));
        }}
        className="max-w-64"
      />
      <p className="text-xs text-muted">{rw.heightNote}</p>
    </div>
  );
}

/**
 * How wide a row's content may be, in pixels, at the size edited (D182): over the theme's content width, which a row takes where it sets
 * none. Dragging the row's side edges on the canvas sets it too. Where the row spreads, there is no limit to set.
 */
function ContentMaxField({ row, limited, onChange }: { row: PageRow; /** Whether the row keeps to a content width (D190: the theme's Row may spread every row). */ limited: boolean; onChange: (patch: RowPatch) => void }) {
  const { size } = useSizeEdit();
  const id = useId();
  const value = valueAt(row, "contentMax", size) ?? null;
  // What is typed until it is a width the row can have.
  const [draft, setDraft] = useState<string | null>(null);
  const back = (patch: { at: PageRow["at"] }) => onChange(patch);
  const rw = useAdminText("builder").row;
  return (
    <div className={`flex flex-col gap-1 ${inheritedClass(sizeSource(row, size, "contentMax"), size)}`}>
      <div className="flex flex-wrap items-center gap-1">
        <label htmlFor={id} className="text-sm font-medium">
          {rw.maxWidth} <span className="font-normal text-muted">({fillWords(rw.pixelsRange, { min: CONTENT_MAX_MIN, max: CONTENT_MAX_MAX })})</span>
        </label>
        <SizeMark part={row} field="contentMax" label={rw.maxWidth} onPatch={back} />
      </div>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={CONTENT_MAX_MIN}
        max={CONTENT_MAX_MAX}
        disabled={!limited}
        placeholder={rw.themes}
        aria-describedby={`${id}-hint`}
        value={draft ?? value ?? ""}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          const number = Math.round(Number(next));
          if (next === "") onChange(setAt(row, size, { contentMax: undefined }));
          else if (number >= CONTENT_MAX_MIN && number <= CONTENT_MAX_MAX) onChange(setAt(row, size, { contentMax: number }));
        }}
        onBlur={() => setDraft(null)}
        className="min-h-10 w-32 rounded-md border border-border bg-background px-2 text-sm disabled:opacity-50"
      />
      <PixelRange
        value={value ?? 1024}
        min={CONTENT_MAX_MIN}
        max={CONTENT_MAX_MAX}
        step={8}
        disabled={!limited}
        label={fillWords(rw.slider, { what: rw.maxWidth })}
        onChange={(next) => {
          setDraft(null);
          onChange(setAt(row, size, { contentMax: next }));
        }}
        className="max-w-64"
      />
      <p id={`${id}-hint`} className="text-xs text-muted">
        {limited ? rw.maxWidthHint : rw.spreadsHint}
      </p>
    </div>
  );
}

/**
 * A row's columns at the size edited (D179): side by side or one under another (on Small unless set), the last first where
 * reversed (either way), and the space between them. Each with its device icon; below Extra large an override of the size.
 */
function RowSizeFields({ row, onChange }: { row: PageRow; onChange: (patch: RowPatch) => void }) {
  const { size } = useSizeEdit();
  const stacked = stackAt(row, size);
  const reverse = valueAt(row, "reverse", size) === true;
  const back = (patch: { at: PageRow["at"] }) => onChange(patch);
  const rw = useAdminText("builder").row;
  return (
    <div className="flex flex-col gap-4">
      <Choices
        legend={rw.columns}
        mark={<SizeMark part={row} field="stack" label={rw.columns} onPatch={back} />}
        muted={inheritedClass(sizeSource(row, size, "stack"), size)}
        options={[
          { value: "side", label: rw.side },
          { value: "stack", label: rw.stack },
        ]}
        value={stacked ? "stack" : "side"}
        onChange={(choice) => onChange(stackPatchAt(row, size, choice === "stack"))}
      />
      <div className={`flex flex-wrap items-start gap-1 ${inheritedClass(sizeSource(row, size, "reverse"), size)}`}>
        <Check
          label={rw.reverse}
          hint={stacked ? rw.reverseStacked : rw.reverseSide}
          checked={reverse}
          onChange={(on) => onChange(setAt(row, size, { reverse: size === "xl" ? on || undefined : on }))}
        />
        <SizeMark part={row} field="reverse" label={rw.reverse} onPatch={back} />
      </div>
      <NumberField
        label={rw.gap}
        hint={fillWords(rw.upTo, { max: GRID_GAP_MAX })}
        value={valueAt(row, "gap", size) ?? 32}
        max={GRID_GAP_MAX}
        mark={<SizeMark part={row} field="gap" label={rw.gap} onPatch={back} />}
        muted={inheritedClass(sizeSource(row, size, "gap"), size)}
        onChange={(gap) => onChange(setAt(row, size, { gap }))}
      />
    </div>
  );
}

/** A column's share of its row and its place among the others, at the size edited (D179); the layout's until set. */
export function ColumnSizeFields({ column, row, onChange }: { column: PageColumn; row: PageRow; onChange: (patch: ColumnPatch) => void }) {
  const { size } = useSizeEdit();
  // Its share in its own line's layout (D187): a row of one line has the one.
  const place = locateColumn(row, column.id);
  const layoutWidth: number = place ? (ROW_LAYOUTS[linesOf(row)[place.line].layout].widths[place.index] ?? 1) : 1;
  const rw = useAdminText("builder").row;
  const shareOf = row.moreLines ? rw.shareOfLine : rw.shareOfRow;
  const back = (patch: { at: PageColumn["at"] }) => onChange(patch);
  const width = valueAt(column, "width", size);
  const order = valueAt(column, "order", size);
  // The layout's share and the first place are no setting: chosen where nothing larger says otherwise, the setting goes.
  const sizedOrDefault = (key: "width" | "order", value: number, fallback: number): ColumnPatch =>
    size !== "xl" && value === (inheritedAt(column, key, size) ?? fallback)
      ? clearAt(column, size, key)
      : setAt(column, size, { [key]: size === "xl" && value === fallback ? undefined : value });
  return (
    <div className="flex flex-col gap-4 border-t border-border pt-4">
      <NumberField
        label={shareOf}
        hint={fillWords(rw.shareHint, { n: layoutWidth })}
        value={width ?? layoutWidth}
        max={COLUMN_SHARE_MAX}
        mark={<SizeMark part={column} field="width" label={shareOf} onPatch={back} />}
        muted={inheritedClass(sizeSource(column, size, "width"), size)}
        onChange={(share) => onChange(sizedOrDefault("width", share, layoutWidth))}
      />
      <NumberField
        label={rw.place}
        hint={rw.placeHint}
        value={order ?? 0}
        min={-12}
        max={12}
        mark={<SizeMark part={column} field="order" label={rw.place} onPatch={back} />}
        muted={inheritedClass(sizeSource(column, size, "order"), size)}
        onChange={(place) => onChange(sizedOrDefault("order", place, 0))}
      />
    </div>
  );
}

/**
 * A row's or column's background below Extra large (D179): a colour (see-through if wanted) or none, and the blur of what
 * is behind. A picture, video or gradient is the part's own at every size.
 */
export function BackgroundAtSize({
  part,
  size,
  onChange,
  onPatch,
}: {
  part: PageRow | PageColumn;
  size: Size;
  onChange: (patch: Partial<PartBase>) => void;
  onPatch: (patch: Partial<PartBase>) => void;
}) {
  const own = part.background;
  const bw = useAdminText("builder").background;
  if (own && own.type !== "color") {
    return <p className="text-sm text-muted">{bw.sameEverySize[own.type]}</p>;
  }
  const value = valueAt(part, "background", size) ?? undefined;
  const blur = valueAt(part, "backdropBlur", size) ?? undefined;
  const color = value?.type === "color" ? value : null;
  const back = (patch: { at: PartBase["at"] }) => onPatch(patch);
  return (
    <div className="flex flex-col gap-4">
      <Choices
        legend={bw.legend}
        mark={<SizeMark part={part} field="background" label={bw.legend} onPatch={back} />}
        muted={inheritedClass(sizeSource(part, size, "background"), size)}
        options={[
          { value: "none", label: bw.kinds.none },
          { value: "color", label: bw.kinds.color },
        ]}
        value={color ? "color" : "none"}
        onChange={(kind) => onChange({ background: kind === "color" ? { type: "color", color: own?.type === "color" ? own.color : "#ffffff" } : undefined } as Partial<PartBase>)}
      />
      {color && (
        <ColorField
          label={bw.colour}
          value={color.color}
          onChange={(next) => onChange({ background: { ...color, color: next } } as Partial<PartBase>)}
          opacity={{
            value: color.opacity,
            onChange: (opacity) => {
              const next = { type: "color" as const, color: color.color };
              onChange({ background: opacity === undefined ? next : { ...next, opacity } } as Partial<PartBase>);
            },
          }}
        />
      )}
      <div className={`flex flex-col gap-3 ${inheritedClass(sizeSource(part, size, "backdropBlur"), size)}`}>
        <div className="flex flex-wrap items-start gap-1">
          <Check
            label={bw.blurBehind}
            hint={bw.blurBehindShort}
            checked={Boolean(blur)}
            onChange={(on) => onChange({ backdropBlur: on ? (blur ?? 12) : undefined } as Partial<PartBase>)}
          />
          <SizeMark part={part} field="backdropBlur" label={bw.blurBehind} onPatch={back} />
        </div>
        {blur ? (
          <div className="pl-7">
            <RangeField
              label={bw.blur}
              min={1}
              max={BACKDROP_BLUR_MAX}
              step={1}
              value={blur}
              shown={`${blur} px`}
              onChange={(next) => onChange({ backdropBlur: next } as Partial<PartBase>)}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Whether the whole column is a link, where to, and its name for screen readers (D48). */
export function ColumnLinkFields({ link, onChange }: { link: ColumnLink | undefined; onChange: (link: ColumnLink | undefined) => void }) {
  const id = useId();
  const lw = useAdminText("builder").link;
  const href = link?.href.trim() ?? "";
  const problem = link && href === "" ? lw.giveAddress : link && !isLinkAddress(href) ? lw.badAddress : null;
  return (
    <div className="flex flex-col gap-3">
      <Check
        label={lw.columnLink}
        hint={lw.columnLinkHint}
        checked={Boolean(link)}
        onChange={(on) => onChange(on ? { href: "", label: "" } : undefined)}
      />
      {link && (
        <div className="flex flex-col gap-3 pl-7">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-href`} className="text-sm font-medium">
              {lw.address}
            </label>
            <input
              id={`${id}-href`}
              value={link.href}
              maxLength={2000}
              spellCheck={false}
              placeholder={lw.placeholder}
              aria-invalid={Boolean(problem)}
              aria-describedby={`${id}-href-hint`}
              onChange={(event) => onChange({ ...link, href: event.target.value })}
              className="min-h-10 rounded-md border border-border bg-background px-3 text-sm font-normal aria-invalid:border-red-700"
            />
            <span
              id={`${id}-href-hint`}
              className={`text-xs font-normal ${problem ? "text-red-700 dark:text-red-400" : "text-muted"}`}
            >
              {problem ?? lw.addressHint}
            </span>
          </div>
          <label htmlFor={`${id}-label`} className="flex flex-col gap-1 text-sm font-medium">
            <span>
              {lw.description} <span className="font-normal text-muted">({lw.descriptionHint})</span>
            </span>
            <input
              id={`${id}-label`}
              value={link.label}
              maxLength={200}
              placeholder={lw.descriptionPlaceholder}
              onChange={(event) => onChange({ ...link, label: event.target.value })}
              className="min-h-10 rounded-md border border-border bg-background px-3 text-sm font-normal"
            />
          </label>
        </div>
      )}
    </div>
  );
}



const SHAPE_PICTURES: Record<ImageShape | "original", string> = {
  original: "h-4 w-6 rounded-sm border-dashed",
  landscape: "h-[18px] w-6 rounded-sm",
  portrait: "h-6 w-[18px] rounded-sm",
  panorama: "h-2.5 w-7 rounded-sm",
  square: "size-5 rounded-sm",
  circle: "size-5 rounded-full",
};

/** How a picture is cropped (D48). */
export function ShapeChoice({ value, onChange }: { value: ImageShape | undefined; onChange: (shape: ImageShape | undefined) => void }) {
  const fw = useAdminText("builder").fields;
  const options = (["original", ...(Object.keys(IMAGE_SHAPES) as ImageShape[])] as const).map((shape) => ({
    value: shape,
    label: fw.shapes[shape],
    picture: <span aria-hidden className={`inline-block border-2 border-current ${SHAPE_PICTURES[shape]}`} />,
  }));
  return (
    <Choices
      legend={fw.shape}
      hint={fw.shapeHint}
      options={options}
      value={value ?? "original"}
      onChange={(shape) => onChange(shape === "original" ? undefined : shape)}
    />
  );
}

/** A part's own id and classes, for the site (D48). */
export function AdvancedFields({
  part,
  taken,
  onChange,
}: {
  part: PartBase;
  /** The ids other parts of the page use. */
  taken: Set<string>;
  onChange: (patch: Partial<PartBase>) => void;
}) {
  const id = useId();
  const aw = useAdminText("builder").advanced;
  const htmlId = part.htmlId?.trim() ?? "";
  const idProblem = htmlId
    ? (htmlIdProblem(htmlId) ?? (taken.has(htmlId) ? aw.idTaken : null))
    : null;
  const classProblem = classNameProblem(part.className ?? "");
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{aw.siteOnly}</p>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-id`} className="text-sm font-medium">
          {aw.id}
        </label>
        <input
          id={`${id}-id`}
          value={part.htmlId ?? ""}
          maxLength={HTML_ID_MAX}
          spellCheck={false}
          autoCapitalize="off"
          aria-invalid={Boolean(idProblem)}
          aria-describedby={`${id}-id-hint`}
          onChange={(event) => onChange({ htmlId: event.target.value || undefined })}
          className="min-h-10 rounded-md border border-border bg-background px-3 font-mono text-sm font-normal aria-invalid:border-red-700"
        />
        <span id={`${id}-id-hint`} className={`text-xs font-normal ${idProblem ? "text-red-700 dark:text-red-400" : "text-muted"}`}>
          {idProblem ??
            (htmlId ? fillWords(aw.idLink, { id: htmlId }) : aw.idHint)}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-classes`} className="text-sm font-medium">
          {aw.classes}
        </label>
        <input
          id={`${id}-classes`}
          value={part.className ?? ""}
          maxLength={400}
          spellCheck={false}
          autoCapitalize="off"
          aria-invalid={Boolean(classProblem)}
          aria-describedby={`${id}-classes-hint`}
          onChange={(event) => onChange({ className: event.target.value || undefined })}
          className="min-h-10 rounded-md border border-border bg-background px-3 font-mono text-sm font-normal aria-invalid:border-red-700"
        />
        <span
          id={`${id}-classes-hint`}
          className={`text-xs font-normal ${classProblem ? "text-red-700 dark:text-red-400" : "text-muted"}`}
        >
          {classProblem ?? aw.classesHint}
        </span>
      </div>
    </div>
  );
}

/** Four sides in pixels, for a border's width (D49). */
function SidesFields({
  legend,
  hint,
  value,
  max,
  onChange,
}: {
  legend: string;
  hint: string;
  value: Sides;
  max: number;
  onChange: (sides: Sides) => void;
}) {
  const id = useId();
  const fw = useAdminText("builder").fields;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">
        {legend} <span className="font-normal text-muted">({hint})</span>
      </legend>
      <div className="grid grid-cols-4 gap-2">
        {SIDES.map((side) => (
          <label key={side} htmlFor={`${id}-${side}`} className="flex flex-col gap-1 text-xs text-muted">
            {fw.sides[side]}
            <input
              id={`${id}-${side}`}
              type="number"
              inputMode="numeric"
              min={0}
              max={max}
              value={value[side]}
              onChange={(event) =>
                onChange({ ...value, [side]: Math.max(0, Math.min(max, Math.round(Number(event.target.value) || 0))) })
              }
              className="min-h-10 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground"
            />
            <PixelRange value={value[side]} min={0} max={max} label={fillWords(fw.sideSlider, { what: legend, side: fw.sides[side].toLowerCase() })} onChange={(next) => onChange({ ...value, [side]: next })} />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function NumberField({
  label,
  hint,
  value,
  max,
  min = 0,
  onChange,
  mark,
  muted = "",
}: {
  label: string;
  hint: string;
  value: number;
  max: number;
  min?: number;
  onChange: (value: number) => void;
  /** Beside the label: a setting that can differ by screen size has its device icon and where its value comes from (D179). */
  mark?: ReactNode;
  muted?: string;
}) {
  const id = useId();
  const rw = useAdminText("builder").row;
  return (
    <div className={`flex flex-col gap-1 ${muted}`}>
      <div className="flex flex-wrap items-center gap-1">
        <label htmlFor={id} className="text-sm font-medium">
          {label} <span className="font-normal text-muted">({hint})</span>
        </label>
        {mark}
      </div>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Math.max(min, Math.min(max, Math.round(Number(event.target.value) || 0))))}
        className="min-h-10 w-28 rounded-md border border-border bg-background px-2 text-sm"
      />
      {/pixel|piksel/i.test(hint) && max > min && (
        <PixelRange value={value} min={min} max={max} step={max - min > 400 ? 4 : 1} label={fillWords(rw.slider, { what: label })} onChange={onChange} className="max-w-64" />
      )}
    </div>
  );
}

/** A border (its line, width on each side and colour), rounded corners and a shadow (D49). */
export function FrameFields({
  value,
  onChange,
  what,
  sized,
}: {
  /** Whose, when a dialog has two sets, such as a content grid's tiles. */
  what?: string;
  /** What is shown: the part's own, or at a size its values there (`viewAt()`). */
  value: Pick<PartBase, "border" | "radius" | "shadow" | "shadowOpacity">;
  onChange: (patch: Partial<PartBase>) => void;
  /** A part's frame differs by screen size (D179): the part, for where each value comes from, and how to give one back. */
  sized?: { part: PartBase; onPatch: (patch: Partial<PartBase>) => void };
}) {
  const { size } = useSizeEdit();
  const fw = useAdminText("builder").frameFields;
  const border = value.border;
  const name = (label: string) => (what ? `${what} ${label.toLowerCase()}` : label);
  const mark = (field: "border" | "radius" | "shadow" | "shadowOpacity", label: string) =>
    sized ? { mark: <SizeMark part={sized.part} field={field} label={label} onPatch={sized.onPatch} />, muted: inheritedClass(sizeSource(sized.part, size, field), size) } : {};
  const atSize = Boolean(sized) && size !== "xl";
  return (
    <div className="flex flex-col gap-4 border-t border-border pt-4">
      <Choices
        {...mark("border", fw.border)}
        legend={name(fw.border)}
        options={[
          { value: "none", label: fw.none },
          ...(Object.keys(BORDER_STYLES) as BorderStyle[]).map((style) => ({ value: style, label: fw.borderStyles[style] })),
        ]}
        value={border?.style ?? "none"}
        onChange={(style) =>
          onChange({
            border:
              style === "none"
                ? undefined
                : { width: border?.width ?? { top: 1, right: 1, bottom: 1, left: 1 }, color: border?.color ?? "#d1d5db", style },
          })
        }
      />
      {border && (
        <>
          <SidesFields
            legend={name(fw.borderWidth)}
            hint={fw.inPixels}
            value={border.width}
            max={BORDER_MAX}
            onChange={(width) => onChange({ border: { ...border, width } })}
          />
          <ColorField key={size} label={name(fw.borderColour)} value={border.color} onChange={(color) => onChange({ border: { ...border, color } })} />
        </>
      )}
      <NumberField
        {...mark("radius", fw.radius)}
        label={name(fw.radius)}
        hint={fw.radiusHint}
        value={value.radius ?? 0}
        max={RADIUS_MAX}
        // Square at a smaller size, under a rounded larger one, is kept as 0 there.
        onChange={(radius) => onChange({ radius: atSize ? radius : radius || undefined })}
      />
      <Choices
        {...mark("shadow", fw.shadow)}
        legend={name(fw.shadow)}
        options={[
          { value: "none", label: fw.none },
          ...(Object.keys(SHADOWS) as Shadow[]).map((shadow) => ({ value: shadow, label: fw.shadows[shadow] })),
        ]}
        value={value.shadow ?? "none"}
        // A shadow's opacity is of that shadow (D262): another shadow, or none, starts from its own again.
        onChange={(shadow) => onChange({ shadow: shadow === "none" ? undefined : shadow, shadowOpacity: undefined })}
      />
      {value.shadow && <ShadowOpacityField shadow={value.shadow} value={value.shadowOpacity} label={name(fw.shadowOpacity)} {...mark("shadowOpacity", fw.shadowOpacity)} onChange={(shadowOpacity) => onChange({ shadowOpacity })} />}
    </div>
  );
}

/** How dark a shadow is (D262): a slider from none to solid, at the shadow's own opacity until it is moved, with a way back to it. */
function ShadowOpacityField({
  shadow,
  value,
  label,
  mark,
  muted = "",
  onChange,
}: {
  shadow: Shadow;
  value: number | undefined;
  label: string;
  mark?: ReactNode;
  muted?: string;
  onChange: (value: number | undefined) => void;
}) {
  const own = shadowOpacityOf(shadow);
  const shown = value ?? own;
  const fw = useAdminText("builder").frameFields;
  return (
    <div className={`flex flex-col gap-1 ${muted}`}>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-sm font-medium">
          {label} <span className="font-normal text-muted">({shown}%)</span>
        </span>
        {mark}
      </div>
      <PixelRange value={shown} min={0} max={100} unit="%" label={label} onChange={onChange} className="max-w-64" />
      {value !== undefined && value !== own && (
        <button type="button" onClick={() => onChange(undefined)} className="self-start text-xs text-muted underline underline-offset-2">
          {fillWords(fw.shadowBack, { n: own })}
        </button>
      )}
    </div>
  );
}


const LEVELS = [1, 2, 3, 4, 5, 6] as const;

/** A heading's text and level (D49). */
export function HeadingFields({
  block,
  otherMainHeading = false,
  onChange,
}: {
  block: HeadingBlock;
  /** Whether another heading on the page is at level 1. */
  otherMainHeading?: boolean;
  onChange: (block: HeadingBlock) => void;
}) {
  const id = useId();
  const words = useAdminText("builder");
  const hw = words.heading;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-text`} className="text-sm font-medium">
          {hw.heading}
        </label>
        {/* Its words as they look, text styles and all (D393); no tag to type. */}
        <MarkupInput id={`${id}-text`} label={hw.heading} value={block.text} max={HEADING_MAX} className="text-base font-medium" onChange={(text) => onChange({ ...block, text })} />
      </div>
      {/* A dual heading (D425): words after the first, each part with its own look (Style, Typography). */}
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-second`} className="text-sm font-medium">
          {hw.second}
        </label>
        <MarkupInput
          id={`${id}-second`}
          label={hw.second}
          value={block.second ?? ""}
          max={HEADING_MAX}
          className="text-base font-medium"
          onChange={(second) => onChange({ ...block, second: second || undefined })}
        />
        <p className="text-xs text-muted">
          {hw.secondHint}
        </p>
      </div>
      {isDualHeading(block) && <HeadingStackField block={block} onChange={onChange} />}
      <div className="flex flex-col gap-1">
        <Choices
          legend={hw.level}
          hint={hw.levelHint}
          options={LEVELS.map((level) => ({ value: String(level), label: `H${level}` }))}
          value={String(block.level)}
          onChange={(level) => onChange({ ...block, level: Number(level) as HeadingLevel })}
        />
        <p className={`text-xs ${block.level === 1 && otherMainHeading ? "text-red-700 dark:text-red-400" : "text-muted"}`}>
          {block.level === 1 ? (otherMainHeading ? hw.twoMain : hw.main) : hw.levels}
        </p>
      </div>
    </div>
  );
}

/** A dual heading's two parts one under the other, at the size edited (D425, D179). */
function HeadingStackField({ block, onChange }: { block: HeadingBlock; onChange: (block: HeadingBlock) => void }) {
  const { size } = useSizeEdit();
  const hw = useAdminText("builder").heading;
  return (
    <div className={`flex flex-wrap items-start gap-1 ${inheritedClass(sizeSource(block, size, "stack"), size)}`}>
      <Check
        label={hw.stack}
        hint={hw.stackHint}
        checked={valueAt(block, "stack", size) === true}
        onChange={(on) => onChange({ ...block, ...setAt(block, size, { stack: size === "xl" ? on || undefined : on }) })}
      />
      <SizeMark part={block} field="stack" label={hw.stack} onPatch={(patch) => onChange({ ...block, ...patch })} />
    </div>
  );
}

/** A button's text, address and whether it opens a new tab (D49). */
export function ButtonFields({ block, onChange }: { block: ButtonBlock; onChange: (block: ButtonBlock) => void }) {
  const id = useId();
  const w = useAdminText("builder");
  const bw = w.button;
  const href = block.href.trim();
  const problem = href === "" ? bw.needsAddress : isLinkAddress(href) ? null : w.link.badAddress;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-label`} className="text-sm font-medium">
          {bw.text}
        </label>
        <MarkupInput id={`${id}-label`} label={bw.text} value={block.label} max={BUTTON_LABEL_MAX} placeholder={bw.placeholder} onChange={(label) => onChange({ ...block, label })} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-href`} className="text-sm font-medium">
          {w.link.address}
        </label>
        <input
          id={`${id}-href`}
          value={block.href}
          maxLength={2000}
          spellCheck={false}
          placeholder={w.link.placeholder}
          aria-invalid={Boolean(problem && href)}
          aria-describedby={`${id}-href-hint`}
          onChange={(event) => onChange({ ...block, href: event.target.value })}
          className="min-h-10 rounded-md border border-border bg-background px-3 text-sm aria-invalid:border-red-700"
        />
        <span
          id={`${id}-href-hint`}
          className={`text-xs ${problem && href ? "text-red-700 dark:text-red-400" : "text-muted"}`}
        >
          {problem ?? w.link.addressHint}
        </span>
      </div>
      <Check
        label={w.image.newTab}
        hint={w.image.newTabHint}
        checked={Boolean(block.newTab)}
        onChange={(newTab) => onChange({ ...block, newTab: newTab || undefined })}
      />
    </div>
  );
}

/** A button's look: kind, size, corners, width, place and colours (D49); its weight and font are its typography (D179). */
export function ButtonStyleFields({ block, onChange }: { block: ButtonBlock; onChange: (patch: BlockPatch<ButtonBlock>) => void }) {
  const w = useAdminText("builder");
  return (
    <div className="flex flex-col gap-4">
      <ButtonLookFields look={block} onChange={onChange} />
      <ButtonHoverField value={block.hover} onChange={(hover) => onChange({ hover })} />
      <Check
        label={w.button.fullWidth}
        hint={w.button.fullWidthHint}
        checked={Boolean(block.fullWidth)}
        onChange={(fullWidth) => onChange({ fullWidth })}
      />
      <TextAlignFields what={w.dialogs.position} value={block} onChange={onChange} />
    </div>
  );
}


/** Merges settings into an optional object; ones set to undefined go, and an empty object goes too. */
function mergeOptional<T extends object>(current: T | undefined, patch: Partial<T>): T | undefined {
  const next: Record<string, unknown> = { ...current, ...patch };
  for (const [key, value] of Object.entries(next)) if (value === undefined) delete next[key];
  return Object.keys(next).length > 0 ? (next as T) : undefined;
}

/**
 * A content grid on the canvas (D51): its items as the site will show them,
 * asked of the server again when what it shows changes (not its look).
 */
export function GridPreview({ block, grid, lang }: { block: ContentGridBlock; grid: GridContext; lang: string | undefined }) {
  const pageId = grid.pageId;
  const custom = !sourceTraits(block.source).lookedUp;
  // A grid of custom items (D155) is its block's own items: drawn here as they are typed, with no trip to the server.
  const key = JSON.stringify(custom ? [block.source, block.items, block.limit] : [block.source, block.categories, block.tags, block.sort, block.limit]);
  const [result, setResult] = useState<{ key: string; data: GridData | { problem: string } } | null>(null);
  const load = useEffectEvent((forKey: string) => {
    if (custom) return;
    void grid.actions.gridPreview(block, pageId).then((data) => setResult({ key: forKey, data }));
  });
  useEffect(() => load(key), [key]);
  const own = custom ? { key, data: customGridData(block, { base: grid.owner ? "" : null, lang: lang ?? "en", locale: lang ?? "en-GB" }) } : null;

  const gw = useAdminText("builder").grid;
  const note = (text: string) => <p className="rounded-md bg-surface p-3 text-sm text-muted">{text}</p>;
  const shown = own ?? result;
  if (!shown) return note(gw.finding);
  const data = shown.data;
  if ("problem" in data) return note(fillWords(gw.problem, { problem: data.problem }));
  const stale = shown.key !== key;
  if (data.items.length === 0) {
    return note(custom ? gw.noItems : block.emptyText ? fillWords(gw.nothingShows, { text: block.emptyText }) : gw.nothing);
  }
  const m = t(data.lang);
  return (
    <div className={stale ? "opacity-60 transition-opacity" : undefined}>
      {/* The site's controls over a grid shoppers filter (D83), as they will look; they work on the site. */}
      {block.filters && sourceTraits(block.source).products && (
        <div aria-hidden className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">{m.listing.count(data.items.length)}</p>
          <span className="inline-flex min-h-11 items-center gap-2 rounded-button border border-border px-4 text-sm font-medium">
            {m.listing.open}
          </span>
        </div>
      )}
      <ContentGridView block={block} data={data} />
    </div>
  );
}

/** Categories and tags to show, as checkboxes: none chosen shows all. */
function TermChecks({
  terms,
  value,
  onChange,
}: {
  terms: Term[];
  value: { categories: string[]; tags: string[] };
  onChange: (value: { categories: string[]; tags: string[] }) => void;
}) {
  const tree = categoryTree(terms);
  const gw = useAdminText("builder").grid;
  const tags = terms.filter((t) => t.kind === "tag").sort(byName);
  const toggle = (key: "categories" | "tags", id: string, on: boolean) => {
    const ids = value[key].filter((x) => x !== id);
    onChange({ ...value, [key]: on ? [...ids, id] : ids });
  };
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {(
        [
          ["categories", gw.categories, tree],
          ["tags", gw.tags, tags.map((t) => ({ ...t, depth: 0 }))],
        ] as const
      ).map(([key, legend, list]) => (
        <fieldset key={key} className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-medium">{legend}</legend>
          {list.length === 0 ? (
            <p className="text-sm text-muted">{gw.noneYet}</p>
          ) : (
            list.map((term) => (
              <label key={term.id} className="flex min-h-8 items-center gap-2 text-sm" style={{ paddingLeft: `${term.depth * 1.25}rem` }}>
                <input
                  type="checkbox"
                  checked={value[key].includes(term.id)}
                  onChange={(event) => toggle(key, term.id, event.target.checked)}
                  className="size-4"
                />
                {term.name}
              </label>
            ))
          )}
        </fieldset>
      ))}
    </div>
  );
}

/**
 * How many tiles side by side at the size edited (D179): a grid's, related products' (two on Small and four above until
 * set); at Extra large the part's own, below it an override of the size.
 */
export function ColumnsFields<T extends { columns?: number; at?: PageBlock["at"] }>({
  part,
  fallback,
  onChange,
}: {
  part: T;
  /** What the size shows with nothing set. */
  fallback: (size: Size) => number;
  onChange: (patch: Partial<T>) => void;
}) {
  const { size } = useSizeEdit();
  const value = valueAt(part, "columns", size) ?? fallback(size);
  const gw = useAdminText("builder").grid;
  return (
    <Choices
      legend={gw.columns}
      hint={gw.columnsHint}
      mark={<SizeMark part={part} field="columns" label={gw.columns} onPatch={(patch) => onChange(patch as Partial<T>)} />}
      muted={inheritedClass(sizeSource(part, size, "columns"), size)}
      options={Array.from({ length: GRID_COLUMNS_MAX.desktop }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
      value={String(value)}
      onChange={(n) => onChange(setAt(part, size, { columns: Number(n) } as Partial<T>))}
    />
  );
}

/**
 * A content grid shown as a grid or a carousel at the size edited (D155, D179: a carousel on Small only is a carousel
 * there and a grid above), and its columns.
 */
function GridDisplayFields({ block, onChange }: { block: ContentGridBlock; onChange: (patch: BlockPatch<ContentGridBlock>) => void }) {
  const { size } = useSizeEdit();
  const carousel = carouselAt(block, size);
  const gw = useAdminText("builder").grid;
  return (
    <>
      <Choices
        legend={gw.showAs}
        mark={<SizeMark part={block} field="display" label={gw.showAs} onPatch={onChange} />}
        muted={inheritedClass(sizeSource(block, size, "display"), size)}
        options={[
          { value: "grid", label: gw.grid },
          { value: "carousel", label: gw.carousel },
        ]}
        value={carousel ? "carousel" : "grid"}
        onChange={(display) => {
          const patch = setAt(block, size, { display: display === "carousel" ? "carousel" : size === "xl" ? undefined : "grid" } as Partial<ContentGridBlock>);
          // A grid at every size keeps no carousel setting of its own.
          const after = { ...block, ...patch } as ContentGridBlock;
          onChange(carouselAnywhere(after) ? patch : { ...patch, peek: undefined });
        }}
      />
      {carouselAnywhere(block) && (
        <>
          <p className="text-xs text-muted">
            {carousel ? gw.carouselHint : gw.carouselElsewhere}
          </p>
          <Check label={gw.peek} checked={block.peek === true} onChange={(peek) => onChange({ peek: peek || undefined })} />
          <CarouselFields value={block.carousel} onChange={(carousel) => onChange({ carousel })} />
        </>
      )}
      <ColumnsFields part={block} fallback={() => block.columns} onChange={onChange} />
    </>
  );
}

const gridField = "min-h-10 rounded-md border border-border bg-background px-3 text-sm";

/** What a content grid shows and how many to a row (D51). */
export function ContentGridFields({
  block,
  grid,
  upload,
  onChange,
}: {
  block: ContentGridBlock;
  grid: GridContext;
  /** Uploads a custom item's picture into the media library (D155); null where uploads are not set up. */
  upload: Upload | null;
  onChange: (patch: BlockPatch<ContentGridBlock>) => void;
}) {
  const id = useId();
  const source = block.source;
  // On a store's page (D53) its own products, in the shopper's market.
  const own = grid.owner !== null;
  const storeId = source.type === "products" ? (grid.owner ?? source.storeId ?? null) : null;
  const [storeTerms, setStoreTerms] = useState<{ storeId: string; terms: Term[] } | null>(null);
  const loadTerms = useEffectEvent((forStore: string) => {
    void grid.actions.gridTerms(forStore).then((terms) => setStoreTerms({ storeId: forStore, terms }));
  });
  useEffect(() => {
    if (storeId) loadTerms(storeId);
  }, [storeId]);
  const traits = sourceTraits(source);
  const custom = !traits.lookedUp;
  const terms =
    source.type === "pages"
      ? grid.pageTerms
      : source.type === "articles"
        ? grid.articleTerms
        : storeId && storeTerms?.storeId === storeId
          ? storeTerms.terms
          : [];
  const store = source.type === "products" ? grid.stores.find((s) => s.id === source.storeId) : undefined;
  const products = traits.products;
  const recommend = source.type === "products" ? source.recommend : undefined;
  const entries = source.type === "entries";
  const contentTypes = grid.contentTypes ?? [];
  const entryType = source.type === "entries" ? contentTypes.find((type) => type.key === source.contentType) : undefined;
  // Entries sort by date, title or the owner's own order of the type (D326); prices are products' alone.
  const sorts = (Object.keys(GRID_SORTS) as GridSort[]).filter((sort) =>
    products ? true : entries ? !PRICE_SORTS.includes(sort) : !PRODUCT_SORTS.includes(sort),
  );
  const productsOf = (s: GridStore | undefined): GridSource => ({
    type: "products",
    storeId: s?.id ?? "",
    market: s?.markets[0]?.code ?? "",
  });
  const gw = useAdminText("builder").grid;

  return (
    <div className="flex flex-col gap-5">
      <Choices
        legend={gw.show}
        // A website's grids (D178 step 5: the online shop off) show pages, articles or the owner's own items; one of products keeps its choice.
        options={(Object.keys(GRID_CONTENT) as GridContent[])
          .filter((type) => type !== "products" || source.type === "products" || partFeatureOn({ type: "contentGrid", source: { type: "products" } }, grid.features))
          .filter((type) => type !== "entries" || entries || contentTypes.length > 0)
          .map((type) => ({ value: type, label: gw.content[type] }))}
        value={source.type}
        onChange={(type) => onChange(sourceChoice(block, type, own ? { type: "products" } : productsOf(grid.stores[0]), contentTypes[0]?.key))}
      />
      {source.type === "entries" && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-type`} className="text-sm font-medium">
            {gw.contentType}
          </label>
          <select
            id={`${id}-type`}
            aria-describedby={`${id}-type-hint`}
            value={entryType?.key ?? ""}
            onChange={(event) => onChange({ source: { type: "entries", contentType: event.target.value }, tileFields: undefined })}
            className={gridField}
          >
            {!entryType && <option value="">{gw.chooseContentType}</option>}
            {contentTypes.map((type) => (
              <option key={type.key} value={type.key}>
                {type.name}
              </option>
            ))}
          </select>
          <p id={`${id}-type-hint`} className="text-xs text-muted">
            {gw.contentTypeHint}
          </p>
        </div>
      )}
      {custom && (
        <CustomItemsEditor
          items={block.items ?? []}
          onChange={(items) => onChange({ items })}
          upload={upload}
          linkTargets={grid.actions.linkTargets}
        />
      )}
      {!custom && (
        <CopyCurrentItems
          block={block}
          platform={!own}
          load={() => grid.actions.gridPreview(block, grid.pageId)}
          onCopied={(items) => onChange(copiedItems(items))}
        />
      )}
      {products && own && (
        <p className="text-sm text-muted">
          {gw.ownProducts}
        </p>
      )}
      {products &&
        !own &&
        (grid.stores.length === 0 ? (
          <p className="text-sm text-muted">{gw.noStore}</p>
        ) : (
          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-store`} className="text-sm font-medium">
                {gw.store}
              </label>
              <select
                id={`${id}-store`}
                value={store?.id ?? ""}
                onChange={(event) => onChange({ source: productsOf(grid.stores.find((s) => s.id === event.target.value)), categories: [], tags: [] })}
                className={gridField}
              >
                {!store && <option value="">{gw.chooseStore}</option>}
                {grid.stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-market`} className="text-sm font-medium">
                {gw.market} <span className="font-normal text-muted">({gw.marketHint})</span>
              </label>
              <select
                id={`${id}-market`}
                value={source.type === "products" ? source.market : ""}
                onChange={(event) => onChange({ source: { type: "products", storeId: store?.id ?? "", market: event.target.value } })}
                className={gridField}
              >
                {store?.markets.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.code} · {m.currency}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ))}
      {source.type === "pages" && (
        <div className="flex flex-col gap-1 border-t border-border pt-4">
          <label htmlFor={`${id}-parent`} className="text-sm font-medium">
            {gw.under}
          </label>
          <select
            id={`${id}-parent`}
            value={source.parent ?? ""}
            onChange={(event) => onChange({ source: event.target.value ? { type: "pages", parent: event.target.value } : { type: "pages" } })}
            className={gridField}
          >
            <option value="">{gw.anyPage}</option>
            <option value="@this">{gw.thisPage}</option>
            {source.parent && source.parent !== "@this" && !(grid.pageChoices ?? []).some((p) => p.slug === source.parent) && (
              <option value={source.parent}>/{source.parent}</option>
            )}
            {(grid.pageChoices ?? []).map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.title} (/{p.slug})
              </option>
            ))}
          </select>
          <p className="text-xs text-muted">{gw.underHint}</p>
        </div>
      )}
      {traits.terms && (
      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <p className="text-sm font-medium">{gw.onlyThese}</p>
        <p className="text-xs text-muted">{gw.onlyTheseHint}</p>
        <TermChecks terms={terms} value={{ categories: block.categories, tags: block.tags }} onChange={(ids) => onChange(ids)} />
      </div>
      )}
      {!custom && (
      <div className="flex flex-wrap items-end gap-4 border-t border-border pt-4">
        {!recommend && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-sort`} className="text-sm font-medium">
            {gw.order}
          </label>
          <select
            id={`${id}-sort`}
            value={block.sort}
            onChange={(event) => onChange({ sort: event.target.value as GridSort })}
            className={gridField}
          >
            {sorts.map((sort) => (
              <option key={sort} value={sort}>
                {entries && sort === "manual" ? gw.typeOrder : gw.sorts[sort]}
              </option>
            ))}
          </select>
        </div>
        )}
        <NumberField
          label={gw.howMany}
          hint={fillWords(gw.atMost, { max: GRID_LIMIT_MAX })}
          value={block.limit}
          max={GRID_LIMIT_MAX}
          onChange={(limit) => onChange({ limit: Math.max(1, limit) })}
        />
      </div>
      )}
      {products && own && source.type === "products" && (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <Check
            label={gw.recommend}
            checked={Boolean(recommend)}
            onChange={(on) =>
              onChange(
                on
                  ? { source: { ...source, recommend: DEFAULT_GRID_RECOMMEND }, filters: undefined }
                  : { source: { type: "products", ...(source.storeId && { storeId: source.storeId }), ...(source.market && { market: source.market }) } },
              )
            }
          />
          <p className="text-xs text-muted">{gw.recommendHint}</p>
          {recommend && (
            <>
              <fieldset className="flex flex-wrap gap-x-6 gap-y-2">
                <legend className="mb-1 w-full text-sm font-medium">{gw.mix}</legend>
                <Check label={gw.upsell} checked={recommend.mix.upsell} onChange={(upsell) => onChange({ source: { ...source, recommend: { ...recommend, mix: { ...recommend.mix, upsell } } } })} />
                <Check label={gw.crossSell} checked={recommend.mix.crossSell} onChange={(crossSell) => onChange({ source: { ...source, recommend: { ...recommend, mix: { ...recommend.mix, crossSell } } } })} />
                <Check label={gw.complement} checked={recommend.mix.complement} onChange={(complement) => onChange({ source: { ...source, recommend: { ...recommend, mix: { ...recommend.mix, complement } } } })} />
              </fieldset>
              <Check
                label={gw.explain}
                checked={recommend.explain}
                onChange={(explain) => onChange({ source: { ...source, recommend: { ...recommend, explain } } })}
              />
            </>
          )}
        </div>
      )}
      {products && own && !recommend && (
        <label className="flex items-start gap-2 border-t border-border pt-4 text-sm">
          <input
            type="checkbox"
            checked={block.filters === true}
            onChange={(event) => onChange({ filters: event.target.checked || undefined })}
            className="mt-0.5 size-4"
          />
          <span>
            <span className="font-medium">{gw.filters}</span>
            <span className="block text-xs text-muted">{gw.filtersHint}</span>
          </span>
        </label>
      )}
      <div className="flex flex-col gap-4 border-t border-border pt-4">
        <GridDisplayFields block={block} onChange={onChange} />
      </div>
      <fieldset className="flex flex-col gap-2 border-t border-border pt-4">
        <legend className="float-left mb-2 w-full text-sm font-medium">{gw.inEachTile}</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {(Object.keys(GRID_ELEMENTS) as GridElement[])
            .filter((element) => element !== "price" || products || custom)
            .map((element) => (
              <label key={element} className="flex min-h-8 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={block.show[element]}
                  onChange={(event) => onChange({ show: { ...block.show, [element]: event.target.checked } })}
                  className="size-4"
                />
                {custom && element === "price" ? gw.priceText : gw.elements[element]}
              </label>
            ))}
        </div>
      </fieldset>
      {products && own && (
        // The stock left and a quantity chooser on the tiles (D557): the store's setting unless this grid says otherwise.
        <fieldset className="flex flex-col gap-3 border-t border-border pt-4" data-shop-tiles="">
          <legend className="float-left mb-1 w-full text-sm font-medium">{gw.shopTiles.legend}</legend>
          <p className="text-xs text-muted">{gw.shopTiles.hint}</p>
          {(["stock", "quantity"] as const).map((key) => (
            <label key={key} className="flex flex-col gap-1 text-sm font-medium">
              {gw.shopTiles[key]}
              <select
                value={block.shopTiles?.[key] ?? "store"}
                onChange={(event) => {
                  const value = event.target.value;
                  const next = { ...block.shopTiles, [key]: value === "show" || value === "hide" ? value : undefined };
                  onChange({ shopTiles: next.stock || next.quantity ? next : undefined });
                }}
                className="min-h-10 rounded-md border border-border bg-background px-3 text-sm font-normal"
              >
                <option value="store">{gw.shopTiles.store}</option>
                <option value="show">{gw.shopTiles.show}</option>
                <option value="hide">{gw.shopTiles.hide}</option>
              </select>
            </label>
          ))}
        </fieldset>
      )}
      {tileEntity(block.source) && (
        <TileFieldsPicker
          entity={tileEntity(block.source)!}
          value={block.tileFields ?? []}
          onChange={(tileFields) => onChange({ tileFields })}
        />
      )}
      {entryType && (
        <TileFieldsPicker
          entity={null}
          groups={[typeAsGroup({ id: entryType.key, name: entryType.name, slug: entryType.key, fields: entryType.fields })]}
          value={block.tileFields ?? []}
          onChange={(tileFields) => onChange({ tileFields })}
        />
      )}
      {block.show.button && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-button`} className="text-sm font-medium">
            {gw.buttonText}
          </label>
          <input
            id={`${id}-button`}
            value={block.buttonLabel}
            maxLength={BUTTON_LABEL_MAX}
            placeholder={products ? gw.viewProduct : gw.readMore}
            // Custom items can also have a button text each (D155): this one is for those that do not.
            onChange={(event) => onChange({ buttonLabel: event.target.value })}
            className={gridField}
          />
        </div>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-empty`} className="text-sm font-medium">
          {gw.whenNothing}
        </label>
        <MarkupInput id={`${id}-empty`} label={gw.whenNothing} value={block.emptyText} max={300} placeholder={gw.showNothing} onChange={(emptyText) => onChange({ emptyText })} />
      </div>
    </div>
  );
}

const GRID_LEVELS = [2, 3, 4, 5, 6] as const;

/** How a content grid's tiles look (D51): picture, heading, excerpt, button and the tile itself. */
export function GridStyleFields({ block, onChange }: { block: ContentGridBlock; onChange: (patch: BlockPatch<ContentGridBlock>) => void }) {
  const tile = block.tile;
  const { size } = useSizeEdit();
  const w = useAdminText("builder");
  const gw = w.grid;
  return (
    <div className="flex flex-col gap-4">
      <Choices
        legend={gw.pictures}
        hint={gw.picturesHint}
        options={[
          // Products can follow the store theme's product cards (D60), their default.
          ...(sourceTraits(block.source).products ? [{ value: "theme" as const, label: gw.themeCards }] : []),
          ...(["original", ...(Object.keys(IMAGE_SHAPES) as ImageShape[])] as const).map((shape) => ({
            value: shape,
            label: w.fields.shapes[shape],
            picture: <span aria-hidden className={`inline-block border-2 border-current ${SHAPE_PICTURES[shape]}`} />,
          })),
        ]}
        value={gridImageShape(block) === "theme" && !sourceTraits(block.source).products ? "landscape" : gridImageShape(block)}
        onChange={(shape) => onChange({ imageShape: shape === gridImageShape({ source: block.source }) ? undefined : shape })}
      />
      <Choices
        legend={gw.headingLevel}
        hint={gw.headingLevelHint}
        options={GRID_LEVELS.map((level) => ({ value: String(level), label: `H${level}` }))}
        value={String(block.headingLevel)}
        onChange={(level) => onChange({ headingLevel: Number(level) as ContentGridBlock["headingLevel"] })}
      />
      <NumberField
        label={gw.excerpt}
        hint={gw.excerptHint}
        value={block.excerptLines}
        max={6}
        onChange={(lines) => onChange({ excerptLines: Math.max(1, lines) })}
      />
      <div className="flex flex-col gap-4 border-t border-border pt-4">
        <p className="text-sm font-medium">{gw.buttons}</p>
        <ButtonLookFields look={block.button ?? {}} onChange={(patch) => onChange({ button: mergeOptional(block.button, patch) })} />
      </div>
      <div className="flex flex-col gap-4 border-t border-border pt-4">
        <p className="text-sm font-medium">{gw.cards}</p>
        <NumberField
          label={gw.cardGap}
          hint={fillWords(w.row.upTo, { max: GRID_GAP_MAX })}
          value={valueAt(block, "gap", size) ?? block.gap}
          max={GRID_GAP_MAX}
          mark={<SizeMark part={block} field="gap" label={gw.tileGap} onPatch={onChange} />}
          muted={inheritedClass(sizeSource(block, size, "gap"), size)}
          onChange={(gap) => onChange(setAt(block, size, { gap }))}
        />
        <OptionalColor
          label={gw.cardBackground}
          hint={gw.cardBackgroundHint}
          value={tile?.background}
          fallback="#f5f5f4"
          onChange={(background) => onChange({ tile: mergeOptional(tile, { background }) })}
        />
        <OptionalColor
          label={gw.cardText}
          hint={gw.cardTextHint}
          value={tile?.color}
          fallback="#111827"
          onChange={(color) => onChange({ tile: mergeOptional(tile, { color }) })}
        />
        <NumberField
          label={gw.cardPadding}
          hint={gw.cardPaddingHint}
          value={tile?.padding ?? 0}
          max={SPACING_MAX}
          onChange={(padding) => onChange({ tile: mergeOptional(tile, { padding: padding || undefined }) })}
        />
        <SidesFields
          legend={gw.wordsPadding}
          hint={gw.wordsPaddingHint}
          value={contentSides(tile?.contentPadding) ?? { top: 0, right: 0, bottom: 0, left: 0 }}
          max={SPACING_MAX}
          onChange={(sides) => onChange({ tile: mergeOptional(tile, { contentPadding: contentSides(sides) ? sides : undefined }) })}
        />
        <FrameFields what={gw.card} value={tile ?? {}} onChange={(patch) => onChange({ tile: mergeOptional(tile, patch) })} />
      </div>
    </div>
  );
}

export const field = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm";
