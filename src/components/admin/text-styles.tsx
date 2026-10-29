"use client";

import dynamic from "next/dynamic";
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { fillWords } from "@/lib/admin-fill";
import {
  FONT_WEIGHTS,
  GALLERY_KINDS,
  HIGHLIGHT_HEIGHTS,
  TEXT_STYLE_CSS_MAX,
  UNDERLINE_STYLES,
  starterSettings,
  styleCssProblem,
  textStyleClass,
  textStyleDeclarations,
  textStyleRule,
  textStylesCss,
  type TextStyle,
  type TextStyleKind,
  type TextStyleSettings,
} from "@/lib/text-styles";

import { useAdminText } from "./admin-text";
import { ColorField } from "./colour-field";

/** The CSS code editor (D394), fetched when a style's own CSS is opened; the plain field it hands down until then and if it cannot load. */
const PlainCss = createContext<ReactNode>(null);
function PlainCssField() {
  return <>{useContext(PlainCss)}</>;
}
const StyleCssEditor = dynamic(() => import("./css-code-editor").catch(() => PlainCssField), { ssr: false, loading: PlainCssField });
import { Modal } from "./modal";
import type { TextStylesContext } from "./page-context";

/**
 * Text styles in the page builder (D393, `docs/text-styles.md`): the site's library as the editor holds it, the *Style* menu that puts
 * one on the selected words, the dialog that makes or changes one (a gallery look and its settings, or its own CSS under Advanced) and
 * the library's list. A style being made or changed is drawn on the canvas as it is edited (`draft`), before it is saved.
 */

export type TextStylesValue = {
  styles: TextStyle[];
  /** The stylesheet the canvas draws: the library with the style being edited as it now stands. */
  css: string;
  /** Opens the dialog for a new style; `then` gets its slug once saved (the menu puts it on the selection). None on the live site. */
  makeNew?: (then?: (slug: string) => void) => void;
  manage?: () => void;
  /** Takes the library as the server now has it, after something placed on the page brought styles with it (a template). */
  adopt?: (styles: TextStyle[]) => void;
};

const TextStyles = createContext<TextStylesValue | null>(null);

/** The library in the builder, or null where the owner keeps none. */
export const useTextStyles = (): TextStylesValue | null => useContext(TextStyles);

type Editing = { style: TextStyle | null; then?: (slug: string) => void };

/** The library as the editor holds it: the saved styles and the one being changed, if any. */
export function useTextStylesState(value: TextStylesContext | null | undefined) {
  const [styles, setStyles] = useState<TextStyle[]>(value?.styles ?? []);
  const [draft, setDraft] = useState<TextStyle | null>(null);
  const css = useMemo(() => {
    const shown = draft ? [...styles.filter((s) => s.slug !== draft.slug), draft] : styles;
    return textStylesCss(shown);
  }, [styles, draft]);
  return { styles, setStyles, setDraft, css };
}

/** Holds the library for the editor and the builder inside it (`state` from `useTextStylesState()`, which the editor keeps). */
export function TextStylesProvider({
  value,
  state,
  starter,
  children,
}: {
  value: TextStylesContext | null | undefined;
  state: ReturnType<typeof useTextStylesState>;
  /** The theme's colours a new style starts from. */
  starter: { accent: string; text: string };
  children: ReactNode;
}) {
  const { styles, setStyles, setDraft, css } = state;
  const [editing, setEditing] = useState<Editing | null>(null);
  const [managing, setManaging] = useState(false);
  const context = useMemo<TextStylesValue | null>(
    () =>
      value
        ? {
            styles,
            css,
            makeNew: (then) => setEditing({ style: null, then }),
            manage: () => setManaging(true),
            adopt: setStyles,
          }
        : null,
    [value, styles, css, setStyles],
  );
  if (!value) return <>{children}</>;
  return (
    <TextStyles.Provider value={context}>
      {children}
      {/* The menus' previews: each style drawn in its own look inside the admin, scoped to the preview boxes. */}
      <style>{textStylesCss(styles, "[data-ts-preview]")}</style>
      {editing && (
        <StyleDialog
          key={editing.style?.slug ?? "new"}
          style={editing.style}
          starter={starter}
          onDraft={setDraft}
          onClose={() => {
            setDraft(null);
            setEditing(null);
          }}
          save={async (input) => {
            const result = await value.save(JSON.stringify(input));
            if (!result.ok) return { problems: result.problems, dropped: [] };
            setStyles(result.styles);
            setDraft(null);
            setEditing(null);
            editing.then?.(result.style.slug);
            return { problems: [], dropped: result.dropped };
          }}
          applies={Boolean(editing.then)}
        />
      )}
      {managing && (
        <StyleLibrary
          styles={styles}
          onClose={() => setManaging(false)}
          onEdit={(style) => setEditing({ style })}
          onNew={() => setEditing({ style: null })}
          remove={async (slug, confirmed) => {
            const result = await value.remove(slug, confirmed);
            if (result.ok) setStyles(result.styles);
            return result.ok ? null : { problems: result.problems, uses: result.uses ?? [] };
          }}
        />
      )}
    </TextStyles.Provider>
  );
}

/**
 * The site's styles to choose from where they are only applied, never made or changed (*Edit text* on the live site, D393 step 2): the
 * page already draws them, so only the menu's previews are added.
 */
export function TextStylesView({ styles, children }: { styles: TextStyle[]; children: ReactNode }) {
  const value = useMemo<TextStylesValue>(() => ({ styles, css: "" }), [styles]);
  return (
    <TextStyles.Provider value={value}>
      {children}
      <style>{textStylesCss(styles, "[data-ts-preview]")}</style>
    </TextStyles.Provider>
  );
}

/** A style's name drawn in its own look, for the menu and the library. */
function StyleSwatch({ style, label }: { style: Pick<TextStyle, "slug" | "name">; label?: string }) {
  return (
    <span data-ts-preview="" className="text-base">
      <span className={textStyleClass(style.slug)}>{label ?? style.name}</span>
    </span>
  );
}

/**
 * The *Style* button and its menu (D393): every style drawn in its own look, *No style*, *New style…* (which puts the new style on the
 * selection when saved) and *Manage styles…*. `active` is the style on the selection now; `apply` puts one on (or takes it off, null).
 */
export function StyleMenu({ active, hasSelection, apply }: { active: string | null; hasSelection: boolean; apply: (slug: string | null) => void }) {
  const library = useTextStyles();
  const w = useAdminText("builder").textStyles;
  const [open, setOpen] = useState(false);
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  if (!library) return null;
  const item = "flex min-h-9 w-full items-center gap-2 rounded px-2 text-left text-sm hover:bg-sunken disabled:opacity-50";
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        title={w.menuLabel}
        aria-label={w.menuLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-pressed={Boolean(active)}
        // Keep the words selected while the menu is used.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((was) => !was)}
        className="flex min-h-9 items-center gap-1 rounded px-2 text-sm hover:bg-sunken aria-pressed:bg-inverse aria-pressed:text-inverse-ink"
      >
        <BrushIcon />
        {w.menu}
      </button>
      {open && (
        <div id={id} role="menu" aria-label={w.menuLabel} className="absolute left-0 top-full z-30 mt-1 flex w-64 flex-col gap-0.5 rounded-panel border border-line bg-card p-1 shadow-lg">
          {!hasSelection && !active && <p className="px-2 py-1.5 text-caption text-muted">{w.selectFirst}</p>}
          {library.styles.length === 0 && <p className="px-2 py-1.5 text-caption text-muted">{w.empty}</p>}
          {library.styles.map((style) => (
            <button
              key={style.slug}
              type="button"
              role="menuitemradio"
              aria-checked={active === style.slug}
              disabled={!hasSelection && !active}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                apply(style.slug);
                setOpen(false);
              }}
              className={`${item} aria-checked:bg-sunken`}
            >
              <StyleSwatch style={style} />
            </button>
          ))}
          {active && (
            <button
              type="button"
              role="menuitem"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                apply(null);
                setOpen(false);
              }}
              className={item}
            >
              {w.none}
            </button>
          )}
          {library.makeNew && library.manage && (
            <>
              <span aria-hidden className="my-0.5 h-px bg-line" />
              <button
                type="button"
                role="menuitem"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setOpen(false);
                  library.makeNew?.(hasSelection ? (slug) => apply(slug) : undefined);
                }}
                className={item}
              >
                {w.newStyle}
              </button>
              <button
                type="button"
                role="menuitem"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setOpen(false);
                  library.manage?.();
                }}
                className={item}
              >
                {w.manage}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const DRAFT_SLUG = "draft-preview";

/** Makes or changes a style: a gallery look and its settings, or (Advanced) its own declarations; the canvas follows as it changes. */
function StyleDialog({
  style,
  starter,
  onDraft,
  onClose,
  save,
  applies,
}: {
  style: TextStyle | null;
  starter: { accent: string; text: string };
  onDraft: (draft: TextStyle | null) => void;
  onClose: () => void;
  save: (input: { slug?: string; name: string; kind: TextStyleKind; settings: TextStyleSettings; css: string | null }) => Promise<{ problems: string[]; dropped: string[] }>;
  applies: boolean;
}) {
  const w = useAdminText("builder").textStyles;
  const [kind, setKind] = useState<TextStyleKind>(style?.kind ?? "gradient");
  const [settings, setSettings] = useState<TextStyleSettings>(style?.settings ?? starterSettings("gradient", starter));
  const [name, setName] = useState(style?.name ?? w.kinds.gradient);
  const [named, setNamed] = useState(Boolean(style));
  const [css, setCss] = useState(style?.css ?? "");
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const current: TextStyle = { slug: style?.slug ?? DRAFT_SLUG, name, kind, settings, css: kind === "custom" ? css : null };
  // The canvas draws an existing style as it is being changed (a new one has no words yet), each time its look changes.
  const look = JSON.stringify([kind, settings, css]);
  useEffect(() => {
    if (style) onDraft({ ...style, kind, settings, css: kind === "custom" ? css : null });
    // `look` stands for kind, settings and css.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [style, look]);
  const set = (patch: TextStyleSettings) => setSettings((was) => ({ ...was, ...patch }));
  const choose = (next: TextStyleKind) => {
    setKind(next);
    if (next !== "custom") setSettings(starterSettings(next, starter));
    if (!named) setName(w.kinds[next]);
  };
  const cssProblemNow = kind === "custom" && css.trim() ? styleCssProblem(css) : null;
  const cssId = useId();
  const preview = textStyleRule({ ...current, slug: DRAFT_SLUG }, "[data-ts-draft] ");
  const sample = w.sample.split(w.sampleWord);
  const colors = settings.colors ?? [];
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={style ? fillWords(w.editTitle, { name: style.name }) : w.newTitle}
      footer={
        <>
          {problems.length > 0 && (
            <p role="alert" className="mr-auto text-sm text-danger-text">
              {problems.join(" ")}
            </p>
          )}
          <button type="button" onClick={onClose} className="min-h-10 rounded-pill px-4 text-sm hover:bg-sunken">
            {w.cancel}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              const result = await save({ ...(style && { slug: style.slug }), name: name.trim(), kind, settings: kind === "custom" ? {} : settings, css: kind === "custom" ? css : null });
              setSaving(false);
              setProblems(result.problems);
            }}
            className="min-h-10 rounded-pill bg-brand px-4 text-sm text-brand-ink"
          >
            {saving ? w.saving : applies ? w.saveApply : w.save}
          </button>
        </>
      }
    >
      <style>{preview}</style>
      <div className="flex flex-col gap-5">
        <div data-ts-draft="" aria-live="polite" className="rounded-panel border border-line bg-canvas p-5 text-center text-display" aria-label={w.preview}>
          {sample.length === 2 ? (
            <>
              {sample[0]}
              <span className={textStyleClass(DRAFT_SLUG)}>{w.sampleWord}</span>
              {sample[1]}
            </>
          ) : (
            <span className={textStyleClass(DRAFT_SLUG)}>{w.sample}</span>
          )}
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{w.gallery}</legend>
          <style>{GALLERY_KINDS.map((k) => textStyleRule({ slug: `gallery-${k.toLowerCase()}`, kind: k, settings: starterSettings(k, starter), css: null }, "[data-ts-gallery] ")).join("\n")}</style>
          <div data-ts-gallery="" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {GALLERY_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => choose(k)}
                className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-panel border border-line px-2 py-2 text-sm hover:bg-sunken aria-pressed:border-brand aria-pressed:ring-2 aria-pressed:ring-brand"
              >
                <span className={`text-xl ${textStyleClass(`gallery-${k.toLowerCase()}`)}`}>{w.glyphs}</span>
                <span className="text-caption text-ink-2">{w.kinds[k]}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {w.name}
          <input
            value={name}
            maxLength={60}
            onChange={(event) => {
              setName(event.target.value);
              setNamed(true);
            }}
            className="min-h-10 rounded-md border border-line bg-card px-3"
          />
        </label>
        {kind !== "custom" && <LookFields kind={kind} settings={settings} set={set} colors={colors} />}
        <details open={kind === "custom"} className="rounded-panel border border-line p-3">
          <summary className="cursor-pointer text-sm font-medium">{w.advanced}</summary>
          <div className="mt-3 flex flex-col gap-2">
            <p className="text-caption text-muted">{w.advancedHint}</p>
            {kind !== "custom" && (
              <button
                type="button"
                onClick={() => {
                  setCss(textStyleDeclarations({ kind, settings, css: null }).map(([p, v]) => `${p}: ${v};`).join("\n"));
                  setKind("custom");
                }}
                className="self-start rounded-pill px-3 py-1.5 text-sm underline"
              >
                {w.fromLook}
              </button>
            )}
            {kind === "custom" && (
              <div className="flex flex-col gap-1">
                <label id={`${cssId}-label`} htmlFor={`${cssId}-css`} className="text-sm font-medium">
                  {w.css}
                </label>
                <div className="flex h-56 flex-col">
                  <PlainCss.Provider
                    value={
                      <textarea
                        id={`${cssId}-css`}
                        value={css}
                        maxLength={TEXT_STYLE_CSS_MAX}
                        spellCheck={false}
                        onChange={(event) => setCss(event.target.value)}
                        aria-describedby={`${cssId}-help`}
                        className="min-h-0 flex-1 resize-none rounded-md border border-line bg-card px-3 py-2 font-mono text-caption"
                      />
                    }
                  >
                    <StyleCssEditor
                      id={`${cssId}-css`}
                      value={css}
                      onChange={setCss}
                      max={TEXT_STYLE_CSS_MAX}
                      placeholderText={w.cssPlaceholder}
                      labelledBy={`${cssId}-label`}
                      describedBy={`${cssId}-help`}
                      invalid={cssProblemNow !== null}
                      classNames={[]}
                    />
                  </PlainCss.Provider>
                </div>
              </div>
            )}
            {cssProblemNow && (
              <p id={`${cssId}-help`} role="alert" className="text-caption text-danger-text">
                {cssProblemNow}
              </p>
            )}
          </div>
        </details>
      </div>
    </Modal>
  );
}

/** A gallery look's settings, each a field a person knows: colours, a direction, a thickness, a line. */
function LookFields({ kind, settings, set, colors }: { kind: TextStyleKind; settings: TextStyleSettings; set: (patch: TextStyleSettings) => void; colors: string[] }) {
  const w = useAdminText("builder").textStyles;
  const number = (label: string, key: "angle" | "size" | "spacing", min: number, max: number, fallback: number) => (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={settings[key] ?? fallback}
        onChange={(event) => set({ [key]: Math.min(max, Math.max(min, Math.round(Number(event.target.value) || fallback))) })}
        className="min-h-10 w-32 rounded-md border border-line bg-card px-3"
      />
    </label>
  );
  const choice = <K extends string>(label: string, value: K, options: readonly K[], words: Record<K, string>, onChange: (next: K) => void) => (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => (
          <button key={option} type="button" aria-pressed={value === option} onClick={() => onChange(option)} className="min-h-9 rounded-pill border border-line px-3 text-sm aria-pressed:bg-inverse aria-pressed:text-inverse-ink">
            {words[option]}
          </button>
        ))}
      </div>
    </fieldset>
  );
  switch (kind) {
    case "gradient":
      return (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-4">
            {colors.map((colour, index) => (
              <ColorField
                key={index}
                label={fillWords(w.colourN, { n: index + 1 })}
                value={colour}
                onChange={(next) => set({ colors: colors.map((c, i) => (i === index ? next : c)) })}
              />
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-4">
            {number(w.angle, "angle", 0, 360, 90)}
            {colors.length < 3 ? (
              <button type="button" onClick={() => set({ colors: [...colors, colors[colors.length - 1] ?? "#9333ea"] })} className="min-h-9 rounded-pill px-3 text-sm underline">
                {w.addColour}
              </button>
            ) : (
              <button type="button" onClick={() => set({ colors: colors.slice(0, 2) })} className="min-h-9 rounded-pill px-3 text-sm underline">
                {w.removeColour}
              </button>
            )}
          </div>
        </div>
      );
    case "highlight":
      return (
        <div className="flex flex-wrap items-end gap-4">
          <ColorField label={w.colour} value={settings.color ?? "#fde047"} onChange={(color) => set({ color })} />
          {choice(w.height, settings.highlight ?? "low", HIGHLIGHT_HEIGHTS, w.heights, (highlight) => set({ highlight }))}
        </div>
      );
    case "outline":
      return (
        <div className="flex flex-wrap items-end gap-4">
          <ColorField label={w.colour} value={settings.color ?? "#111111"} onChange={(color) => set({ color })} />
          {number(w.thickness, "size", 1, 4, 1)}
        </div>
      );
    case "underline":
      return (
        <div className="flex flex-wrap items-end gap-4">
          <ColorField label={w.colour} value={settings.color ?? "#2563eb"} onChange={(color) => set({ color })} />
          {choice(w.line, settings.underline ?? "solid", UNDERLINE_STYLES, w.lines, (underline) => set({ underline }))}
          {number(w.thickness, "size", 1, 8, 2)}
        </div>
      );
    case "glow":
      return (
        <div className="flex flex-wrap items-end gap-4">
          <ColorField label={w.colour} value={settings.color ?? "#2563eb"} onChange={(color) => set({ color })} />
          {number(w.glowSize, "size", 2, 30, 8)}
        </div>
      );
    case "colour":
      return (
        <div className="flex flex-wrap items-end gap-4">
          <ColorField label={w.colour} value={settings.color ?? "#2563eb"} onChange={(color) => set({ color })} />
          {choice(
            w.weight,
            String(settings.weight ?? 700),
            FONT_WEIGHTS.map(String),
            Object.fromEntries(FONT_WEIGHTS.map((weight) => [String(weight), String(weight)])),
            (weight) => set({ weight: Number(weight) as (typeof FONT_WEIGHTS)[number] }),
          )}
        </div>
      );
    case "spacedCaps":
      return number(w.spacing, "spacing", 5, 50, 12);
    default:
      return null;
  }
}

/** The library: each style in its own look, to change or delete; deleting one in use says where, and asks again. */
function StyleLibrary({
  styles,
  onClose,
  onEdit,
  onNew,
  remove,
}: {
  styles: TextStyle[];
  onClose: () => void;
  onEdit: (style: TextStyle) => void;
  onNew: () => void;
  remove: (slug: string, confirmed: boolean) => Promise<{ problems: string[]; uses: string[] } | null>;
}) {
  const w = useAdminText("builder").textStyles;
  const [asked, setAsked] = useState<{ slug: string; problems: string[]; uses: string[] } | null>(null);
  return (
    <Modal
      open
      onClose={onClose}
      title={w.library}
      footer={
        <>
          <button type="button" onClick={onNew} className="min-h-10 rounded-pill px-4 text-sm underline">
            {w.newStyle}
          </button>
          <button type="button" onClick={onClose} className="min-h-10 rounded-pill bg-brand px-4 text-sm text-brand-ink">
            {w.close}
          </button>
        </>
      }
    >
      <p className="mb-4 text-sm text-ink-2">{w.libraryIntro}</p>
      {styles.length === 0 ? (
        <p className="text-sm text-muted">{w.empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {styles.map((style) => (
            <li key={style.slug} className="flex flex-col gap-2 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="min-w-0 flex-1 text-lg">
                  <StyleSwatch style={style} />
                </span>
                <span className="text-caption text-muted">{w.kinds[style.kind]}</span>
                <button type="button" onClick={() => onEdit(style)} className="min-h-9 rounded-pill px-3 text-sm hover:bg-sunken">
                  {w.edit}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const answer = await remove(style.slug, asked?.slug === style.slug);
                    setAsked(answer ? { slug: style.slug, ...answer } : null);
                  }}
                  className="min-h-9 rounded-pill px-3 text-sm text-danger-text hover:bg-sunken"
                >
                  {asked?.slug === style.slug ? w.deleteAnyway : w.remove}
                </button>
              </div>
              {asked?.slug === style.slug && (
                <p role="alert" className="text-caption text-warning-text">
                  {asked.problems.join(" ")} {asked.uses.length > 0 && fillWords(w.usedOn, { list: asked.uses.join(", ") })}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function BrushIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 114.03 4.03l-8.06 8.08" />
      <path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 00-3-3.02z" />
    </svg>
  );
}
