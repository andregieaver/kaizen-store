"use client";

import { useId, useState, useTransition, type ReactNode } from "react";

import { FontLinks } from "@/components/font-links";
import { fillWords } from "@/lib/admin-fill";
import { BREAKPOINT_GAP, BREAKPOINT_MAX, BREAKPOINT_MIN, DEFAULT_BREAKPOINTS, breakpointsOf, breakpointsProblem, type Breakpoints } from "@/lib/breakpoints";
import { fontClass, siteFontFamilies } from "@/lib/fonts";
import {
  HEADING_WEIGHTS,
  PALETTE_KEYS,
  THEME_TEMPLATES,
  THEME_TEMPLATE_KEYS,
  darkBehindLogo,
  templateSettings,
  themeAttributes,
  themeCss,
  themeWarnings,
  type ButtonCorners,
  type CheckoutBackground,
  type CheckoutFields,
  type CheckoutLook,
  type Palette,
  type StoreTheme,
  type ThemeSettings,
} from "@/lib/theme";
import { checkoutLookOf, checkoutLookOwn, followTheme, patchCheckoutLook } from "@/lib/checkout-look";
import type { SavedTheme } from "@/server/themes";

import { useAdminText } from "./admin-text";
import { FontPicker, type InstallFont } from "./font-picker";

type Result<T> = { ok: true } & T;
type Failure = { ok: false; problems: string[] };

export type ThemeActions = {
  save: (payload: string) => Promise<Result<{ theme: StoreTheme }> | Failure>;
  /** Absent where no saved themes are kept (Kaizena Flow's own installs, D252): *Save as new theme* is not offered. */
  saveSaved?: (payload: string) => Promise<Result<{ theme: SavedTheme }> | Failure>;
  removeSaved?: (id: string) => Promise<{ ok: boolean }>;
  installFont: InstallFont;
};

const card = "flex flex-col gap-4 rounded-lg border border-border bg-background p-5";
const button = "min-h-10 rounded-md px-4 text-sm font-medium disabled:opacity-50";
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** One of a few choices, as a row of buttons over radio buttons. */
function Choice<T extends string>({
  legend,
  options,
  value,
  onChange,
  hint,
}: {
  legend: string;
  options: Record<T, string>;
  value: T;
  onChange: (value: T) => void;
  hint?: string;
}) {
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={hint ? `${name}-hint` : undefined}>
      <legend className="float-left mb-2 w-full text-sm font-medium">{legend}</legend>
      {hint && (
        <p id={`${name}-hint`} className="-mt-1 text-sm text-muted">
          {hint}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(options) as T[]).map((key) => (
          <label
            key={key}
            className="relative flex min-h-10 cursor-pointer items-center rounded-md border border-border px-3 text-sm has-checked:border-foreground has-checked:bg-surface has-checked:font-medium has-focus-visible:outline-2"
          >
            <input type="radio" name={name} value={key} checked={value === key} onChange={() => onChange(key)} className="sr-only" />
            {options[key]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={card} aria-label={title}>
      <h2 className="font-medium">{title}</h2>
      {children}
    </section>
  );
}

/** A colour set, each colour with the browser's picker and its hex code. */
function PaletteFields({ title, value, onChange }: { title: string; value: Palette; onChange: (palette: Palette) => void }) {
  const w = useAdminText("design").editor;
  const id = useId();
  const [drafts, setDrafts] = useState<Partial<Palette>>({});
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="float-left mb-1 w-full text-sm font-medium">{title}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {PALETTE_KEYS.map((key) => {
          const text = drafts[key] ?? value[key];
          return (
            <div key={key} className="flex items-center gap-3">
              <input
                type="color"
                value={value[key]}
                aria-label={fillWords(w.pick, { colour: w.palette[key].name, set: title.toLowerCase() })}
                onChange={(event) => {
                  setDrafts((d) => ({ ...d, [key]: undefined }));
                  onChange({ ...value, [key]: event.target.value });
                }}
                className="size-10 shrink-0 cursor-pointer rounded-md border border-border bg-background p-0.5"
              />
              <label className="flex min-w-0 flex-1 flex-col text-sm">
                <span className="font-medium">{w.palette[key].name}</span>
                <input
                  id={`${id}-${key}`}
                  value={text}
                  spellCheck={false}
                  maxLength={7}
                  aria-describedby={`${id}-${key}-hint`}
                  aria-invalid={!/^#[0-9a-fA-F]{6}$/.test(text)}
                  onChange={(event) => {
                    const next = event.target.value.trim();
                    setDrafts((d) => ({ ...d, [key]: next }));
                    if (/^#[0-9a-fA-F]{6}$/.test(next)) onChange({ ...value, [key]: next.toLowerCase() });
                  }}
                  className="min-h-9 w-full rounded-md border border-border bg-background px-2 font-mono text-xs aria-invalid:border-red-700"
                />
                <span id={`${id}-${key}-hint`} className="text-xs text-muted">
                  {w.palette[key].hint}
                </span>
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * What the theme looks like, drawn with the same classes and variables
 * as the storefront, in light or dark.
 */
function Preview({ settings, storeName, mode, checkout = true }: { settings: ThemeSettings; storeName: string; mode: "light" | "dark"; checkout?: boolean }) {
  const w = useAdminText("design").editor;
  const sample = w.sample;
  const { fonts } = settings;
  const headingFont = fonts.heading ?? fonts.body;
  return (
    <div
      {...themeAttributes(settings)}
      // The colours shown, so that everything drawn by light or dark inside follows them (D99).
      data-color-mode={mode}
      data-theme-preview=""
      aria-label={fillWords(w.previewIn, { mode: w.previewModes[mode] })}
      role="img"
      className={`overflow-hidden rounded-lg border border-border bg-background text-foreground ${fonts.body ? fontClass(fonts.body) : ""}`}
    >
      <style>{themeCss(settings, "[data-theme-preview]", mode)}</style>
      <FontLinks families={siteFontFamilies(fonts)} />
      <div
        className={`flex items-center gap-3 border-b border-border px-4 py-3 ${
          settings.layout.headerBackground === "accent"
            ? "bg-accent text-accent-foreground"
            : settings.layout.headerBackground === "inverse"
              ? "bg-foreground text-background"
              : settings.layout.headerBackground === "surface"
              ? "bg-surface"
              : ""
        } ${settings.layout.headerAlign === "center" ? "justify-center" : ""}`}
      >
        <span className={`text-base font-semibold ${headingFont ? fontClass(headingFont) : ""}`}>{storeName}</span>
        {settings.layout.headerAlign === "left" && <span className="ml-auto text-xs opacity-80">{sample.menu}</span>}
      </div>
      <div className="flex flex-col gap-3 p-4">
        <p className={`font-heading text-2xl leading-tight ${headingFont ? fontClass(headingFont) : ""}`} style={settings.headings.case === "upper" ? { textTransform: "uppercase", letterSpacing: "0.06em" } : undefined}>
          {sample.heading}
        </p>
        <p className="text-sm">
          {sample.text} <span className="text-muted">{sample.delivery}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          <span className="button-primary inline-flex min-h-10 items-center px-4 text-sm font-medium">{sample.addToCart}</span>
          <span className="inline-flex min-h-10 items-center rounded-button border border-border px-4 text-sm">{sample.readMore}</span>
        </div>
        <ul className="grid grid-cols-3 gap-3">
          {sample.products.map((name, i) => (
            <li key={name} className="product-card relative flex flex-col gap-2">
              <span className="product-card-image block w-full rounded-lg bg-surface" style={{ opacity: 1 - i * 0.15 }} />
              <span className="text-xs font-medium">{name}</span>
              <span className="text-xs text-muted">{190 + i * 60} kr</span>
            </li>
          ))}
        </ul>
        <input readOnly tabIndex={-1} aria-hidden value={sample.email} className="min-h-9 rounded-md border border-border bg-background px-3 text-xs" />
        {checkout && <CheckoutSample settings={settings} />}
      </div>
      <div className="border-t border-border bg-surface px-4 py-3 text-xs text-muted">© {storeName}</div>
    </div>
  );
}

/** How a payment field is drawn in the sample, as Stripe draws it from `stripeAppearance()` (D337). */
const SAMPLE_FIELDS: Record<CheckoutFields, string> = {
  outlined: "rounded-md border border-border bg-background",
  filled: "rounded-md border border-transparent bg-surface",
  underlined: "rounded-none border-0 border-b border-border bg-transparent",
};

/** The checkout in the preview (D337): what it sits on, a payment field and the pay button, in the checkout's own colour and corners. */
function CheckoutSample({ settings }: { settings: ThemeSettings }) {
  const w = useAdminText("design").editor.checkout.sample;
  const look = checkoutLookOf(settings);
  const panel = look.background === "surface";
  // A filled field on the surface's panel is filled with the page's background, as the checkout draws it.
  const field = look.fields === "filled" && panel ? "rounded-md border border-transparent bg-background" : SAMPLE_FIELDS[look.fields];
  return (
    <div data-checkout-sample="" className={`checkout-look flex flex-col gap-2 border-t border-border pt-3 ${panel ? "rounded-lg bg-surface px-3 pb-3" : ""}`}>
      <span className="text-xs font-medium">{w.heading}</span>
      <span className={`flex min-h-9 items-center px-3 text-xs text-muted ${field}`}>{w.field}</span>
      <span className="button-primary inline-flex min-h-10 items-center justify-center px-4 text-sm font-medium">{w.pay}</span>
    </div>
  );
}

/**
 * The *Checkout look* card (D337): for Homer, a sentence saying the checkout follows the theme and one switch for the logo; for Lisa,
 * behind *Customise the checkout*, what the form sits on, the pay button's colour and corners and the payment fields' style, and a way back
 * to following the theme. Saved with the theme, as every other card here.
 */
function CheckoutLookFields({
  settings,
  hasLogo,
  onChange,
}: {
  settings: ThemeSettings;
  hasLogo: boolean;
  onChange: (checkout: CheckoutLook) => void;
}) {
  const all = useAdminText("design");
  const w = all.editor.checkout;
  const o = all.editor.options;
  const look = checkoutLookOf(settings);
  const own = checkoutLookOwn(settings);
  const patch = (change: Partial<CheckoutLook>) => onChange(patchCheckoutLook(settings.checkout, change));
  const [open, setOpen] = useState(own);
  return (
    <>
      <p className="text-sm text-muted">{w.intro}</p>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="checkoutLogo"
          checked={look.mark}
          disabled={!hasLogo && !look.mark}
          onChange={(event) => patch({ mark: event.target.checked })}
          className="mt-1"
        />
        <span>
          <span className="font-medium">{w.logo}</span>
          <span className="block text-xs text-muted">{hasLogo ? w.logoHint : w.noLogo}</span>
        </span>
      </label>
      <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary className="cursor-pointer text-sm font-medium">{w.customise}</summary>
        <div className="mt-4 flex flex-col gap-4">
          <Choice
            legend={w.background}
            options={o.checkoutBackgrounds as Record<CheckoutBackground, string>}
            value={look.background}
            onChange={(background) => patch({ background })}
          />
          <Choice
            legend={w.button}
            options={w.buttonColours as Record<"theme" | "own", string>}
            value={look.button ? "own" : "theme"}
            onChange={(choice) =>
              patch({ button: choice === "own" ? (look.button ?? { light: settings.light.accent, dark: settings.dark.accent }) : undefined })
            }
          />
          {look.button && (
            <div className="grid gap-3 sm:grid-cols-2">
              {(["light", "dark"] as const).map((scheme) => (
                <label key={scheme} className="flex items-center gap-3 text-sm font-medium">
                  <input
                    type="color"
                    name={`checkoutButton-${scheme}`}
                    value={look.button![scheme]}
                    onChange={(event) => patch({ button: { ...look.button!, [scheme]: event.target.value.toLowerCase() } })}
                    className="size-10 shrink-0 cursor-pointer rounded-md border border-border bg-background p-0.5"
                  />
                  {scheme === "light" ? w.buttonLight : w.buttonDark}
                </label>
              ))}
            </div>
          )}
          <Choice
            legend={w.corners}
            options={{ theme: w.cornersTheme, ...(o.buttonCorners as Record<ButtonCorners, string>) } as Record<"theme" | ButtonCorners, string>}
            value={look.corners ?? "theme"}
            onChange={(corners) => patch({ corners: corners === "theme" ? undefined : corners })}
          />
          <Choice
            legend={w.fields}
            options={o.checkoutFields as Record<CheckoutFields, string>}
            value={look.fields}
            onChange={(fields) => patch({ fields })}
          />
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
            {own ? null : w.following}
            {own && (
              <button type="button" onClick={() => onChange(followTheme(settings.checkout))} className={`${button} border border-border text-foreground`}>
                {w.followTheme}
              </button>
            )}
          </p>
        </div>
      </details>
    </>
  );
}

const SIZE_STARTS = ["md", "lg", "xl"] as const;

/**
 * Where the screen sizes start (D179): the widths at which a part's settings for Medium, Large and Extra large take over.
 * Typed widths are kept as typed while they are checked, and the problem is said beside them; Save waits for usable ones.
 */
export function BreakpointFields({ value, onChange }: { value: Breakpoints; onChange: (value: Breakpoints) => void }) {
  const { sizes: w, breakpoints } = useAdminText("design");
  const id = useId();
  const [draft, setDraft] = useState<Record<keyof Breakpoints, string> | null>(null);
  const shown = draft ?? { md: String(value.md), lg: String(value.lg), xl: String(value.xl) };
  const typed: Breakpoints = { md: Number(shown.md), lg: Number(shown.lg), xl: Number(shown.xl) };
  const problem = breakpointsProblem(typed, breakpoints);
  const change = (key: keyof Breakpoints, text: string) => {
    const next = { ...shown, [key]: text.replace(/[^\d]/g, "") };
    setDraft(next);
    onChange({ md: Number(next.md), lg: Number(next.lg), xl: Number(next.xl) });
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{w.intro}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {SIZE_STARTS.map((key) => (
          <label key={key} className="flex flex-col gap-1 text-sm font-medium">
            {w[key].label}
            <span className="flex items-center gap-2">
              <input
                inputMode="numeric"
                value={shown[key]}
                aria-invalid={problem !== null}
                aria-describedby={`${id}-hint`}
                onChange={(event) => change(key, event.target.value)}
                className="min-h-10 w-24 rounded-md border border-border bg-background px-3 font-normal tabular-nums aria-invalid:border-red-700"
              />
              <span className="font-normal text-muted">px</span>
            </span>
            <span className="text-xs font-normal text-muted">{w[key].hint}</span>
          </label>
        ))}
      </div>
      <p id={`${id}-hint`} role={problem ? "alert" : undefined} className={`text-xs ${problem ? "text-red-700 dark:text-red-400" : "text-muted"}`}>
        {problem ?? fillWords(w.rule, { min: BREAKPOINT_MIN, max: BREAKPOINT_MAX, gap: BREAKPOINT_GAP })}
      </p>
      <div>
        <button
          type="button"
          disabled={value.md === DEFAULT_BREAKPOINTS.md && value.lg === DEFAULT_BREAKPOINTS.lg && value.xl === DEFAULT_BREAKPOINTS.xl && draft === null}
          onClick={() => {
            setDraft(null);
            onChange(DEFAULT_BREAKPOINTS);
          }}
          className={`${button} border border-border`}
        >
          {fillWords(w.standard, { md: DEFAULT_BREAKPOINTS.md, lg: DEFAULT_BREAKPOINTS.lg, xl: DEFAULT_BREAKPOINTS.xl })}
        </button>
      </div>
    </div>
  );
}

/**
 * A store's design (D60): its themes (the built-in templates and its own
 * saved ones), every setting of the one it is editing, and a preview. Save
 * puts it on the storefront; a theme can also be saved under a name,
 * updated, deleted, or reset to its template's defaults.
 */
export function ThemeEditor({
  storeName,
  current,
  saved: initialSaved,
  actions,
  logos,
  installed,
  checkout = true,
}: {
  storeName: string;
  current: StoreTheme;
  saved: SavedTheme[];
  actions: ThemeActions;
  /** Whether the store has a logo, and one for dark backgrounds (D60). */
  logos: { logo: boolean; dark: boolean };
  /** The name of an installed theme that is not live (D244): Save keeps the settings in it, and visitors see them only once it is switched to. */
  installed?: string;
  /** The *Checkout look* card and sample (D337); false for Kaizena Flow's own site, which has no checkout. */
  checkout?: boolean;
}) {
  const all = useAdminText("design");
  const { common: c, editor: w } = all;
  const o = w.options;
  const [editingBefore, editingAfter = ""] = w.editingName.split("{name}");
  const words = installed
    ? {
        saved: fillWords(w.savedInstalled, { name: installed }),
        toSave: fillWords(w.toSaveInstalled, { name: installed }),
        inUse: w.inUseInstalled,
        unsaved: w.unsavedInstalled,
        same: w.sameInstalled,
        intro: fillWords(w.introInstalled, { name: installed }),
      }
    : { saved: w.saved, toSave: w.toSave, inUse: w.inUse, unsaved: w.unsaved, same: w.same, intro: w.intro };
  const [theme, setTheme] = useState<StoreTheme>(current);
  const [live, setLive] = useState<StoreTheme>(current);
  const [saved, setSaved] = useState(initialSaved);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string[] } | null>(null);
  const [previewMode, setPreviewMode] = useState<"light" | "dark">(current.settings.mode === "dark" ? "dark" : "light");
  const [naming, setNaming] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const { settings } = theme;
  const loaded = theme.savedId ? saved.find((s) => s.id === theme.savedId) : null;
  const sourceName = loaded?.name ?? THEME_TEMPLATES[theme.base].name;
  const sourceSettings = loaded?.settings ?? templateSettings(theme.base);
  const changedFromSource = !same(settings, sourceSettings);
  const unpublished = !same(theme, live);
  const warnings = themeWarnings(settings, all.readability);
  // Screen sizes that cannot be used are not saved (D179): the store keeps its own until they can.
  const widthsProblem = settings.breakpoints ? breakpointsProblem(settings.breakpoints, all.breakpoints) : null;
  // A logo without a light version, on a background the theme makes dark somewhere.
  const behind = [darkBehindLogo(settings, "header"), darkBehindLogo(settings, "page")];
  const logoNeedsDarkVersion = logos.logo && !logos.dark && behind.some((b) => b.light || b.dark);

  const set = (patch: Partial<ThemeSettings>) => {
    setTheme((t) => ({ ...t, settings: { ...t.settings, ...patch } }));
    setMessage(null);
  };

  /** Loads a theme into the editor, its fonts made ready first; nothing changes on the site until Save. */
  const load = (next: StoreTheme) => {
    if (unpublished && !same(next, theme) && !window.confirm(w.replaceUnsaved)) return;
    startTransition(async () => {
      for (const family of siteFontFamilies(next.settings.fonts)) {
        const ready = await actions.installFont(family);
        if (!ready.ok) {
          setMessage({ tone: "error", text: [ready.problem] });
          return;
        }
      }
      setTheme(next);
      if (next.settings.mode !== "auto") setPreviewMode(next.settings.mode);
      setMessage(null);
    });
  };

  const publish = () =>
    startTransition(async () => {
      const result = await actions.save(JSON.stringify(theme));
      if (result.ok) {
        setTheme(result.theme);
        setLive(result.theme);
        setMessage({ tone: "ok", text: [words.saved] });
      } else setMessage({ tone: "error", text: result.problems });
    });

  const saveAs = (id: string | null, name: string) =>
    startTransition(async () => {
      if (!actions.saveSaved) return;
      const result = await actions.saveSaved(JSON.stringify({ id, name, base: theme.base, settings }));
      if (!result.ok) {
        setMessage({ tone: "error", text: result.problems });
        return;
      }
      setSaved((list) => [...list.filter((s) => s.id !== result.theme.id), result.theme].sort((a, b) => a.name.localeCompare(b.name)));
      setTheme((t) => ({ ...t, savedId: result.theme.id }));
      setNaming(null);
      setMessage({
        tone: "ok",
        text: [`${fillWords(w.savedAs, { name: result.theme.name })} ${unpublished || live.savedId !== result.theme.id ? words.toSave : ""}`.trim()],
      });
    });

  const remove = (entry: SavedTheme) => {
    if (!window.confirm(fillWords(w.deleteConfirm, { name: entry.name }))) return;
    startTransition(async () => {
      if (!actions.removeSaved) return;
      const result = await actions.removeSaved(entry.id);
      if (!result.ok) return;
      setSaved((list) => list.filter((s) => s.id !== entry.id));
      setTheme((t) => (t.savedId === entry.id ? { ...t, savedId: null } : t));
      setLive((t) => (t.savedId === entry.id ? { ...t, savedId: null } : t));
      setMessage({ tone: "ok", text: [fillWords(w.deleted, { name: entry.name })] });
    });
  };

  const themeCard = (key: string, name: string, description: string, entry: StoreTheme, extra?: ReactNode) => {
    const editing = theme.base === entry.base && theme.savedId === entry.savedId;
    const inUse = live.base === entry.base && live.savedId === entry.savedId;
    const { light, fonts } = entry.settings;
    return (
      <li key={key} className={`flex flex-col gap-3 rounded-lg border p-4 ${editing ? "border-foreground" : "border-border"}`}>
        <div className="flex h-12 overflow-hidden rounded-md border border-border" aria-hidden>
          {[light.background, light.surface, light.text, light.accent].map((color, i) => (
            <span key={i} className="flex-1" style={{ backgroundColor: color }} />
          ))}
        </div>
        <div className="flex flex-col gap-1">
          <h3 className="font-medium">
            {name} {inUse && <span className="ml-1 rounded-full bg-surface px-2 py-0.5 text-xs font-normal">{words.inUse}</span>}
          </h3>
          <p className="text-xs text-muted">
            {description || (fonts.heading && fonts.body ? fillWords(w.fontsAnd, { a: fonts.heading, b: fonts.body }) : fonts.heading || fonts.body) || w.systemFonts}
          </p>
        </div>
        <div className="mt-auto flex flex-wrap gap-2">
          <button type="button" disabled={pending || editing} onClick={() => load(entry)} className={`${button} border border-border`}>
            {editing ? w.editing : c.edit}
          </button>
          {extra}
        </div>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <Section title={w.themes}>
        <p className="text-sm text-muted">
          {words.intro}
        </p>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {THEME_TEMPLATE_KEYS.map((key) =>
            themeCard(key, THEME_TEMPLATES[key].name, w.templates[key] ?? THEME_TEMPLATES[key].description, {
              base: key,
              savedId: null,
              settings: templateSettings(key),
            }),
          )}
          {saved.map((entry) =>
            themeCard(
              entry.id,
              entry.name,
              fillWords(w.yourTheme, { name: THEME_TEMPLATES[entry.base].name }),
              { base: entry.base, savedId: entry.id, settings: entry.settings },
              <button type="button" disabled={pending} onClick={() => remove(entry)} className={`${button} border border-border text-red-700 dark:text-red-400`}>
                {c.delete}
              </button>,
            ),
          )}
        </ul>
      </Section>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="flex flex-col gap-6">
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background p-3 shadow-sm">
            <p className="mr-auto text-sm" aria-live="polite">
              {editingBefore}
              <strong>{sourceName}</strong>
              {editingAfter}
              {changedFromSource ? w.changed : ""}
              {unpublished ? words.unsaved : words.same}
            </p>
            <button type="button" disabled={pending || !unpublished || widthsProblem !== null} onClick={publish} className={`${button} bg-foreground text-background`}>
              {c.save}
            </button>
            {loaded && changedFromSource && (
              <button type="button" disabled={pending} onClick={() => saveAs(loaded.id, loaded.name)} className={`${button} border border-border`}>
                {fillWords(w.update, { name: loaded.name })}
              </button>
            )}
            {actions.saveSaved && (
              <button type="button" disabled={pending} onClick={() => setNaming(loaded ? fillWords(w.copyName, { name: loaded.name }) : fillWords(w.newName, { name: THEME_TEMPLATES[theme.base].name }))} className={`${button} border border-border`}>
                {w.saveAsNew}
              </button>
            )}
            {loaded && changedFromSource && (
              <button type="button" disabled={pending} onClick={() => set(structuredClone(loaded.settings))} className={`${button} border border-border`}>
                {w.undoChanges}
              </button>
            )}
            <button
              type="button"
              disabled={pending || same(settings, templateSettings(theme.base))}
              onClick={() => {
                if (window.confirm(fillWords(w.resetConfirm, { name: THEME_TEMPLATES[theme.base].name }))) set(templateSettings(theme.base));
              }}
              className={`${button} border border-border`}
            >
              {fillWords(w.resetTo, { name: THEME_TEMPLATES[theme.base].name })}
            </button>
          </div>

          {naming !== null && (
            <form
              className={card}
              onSubmit={(event) => {
                event.preventDefault();
                saveAs(null, naming);
              }}
            >
              <label className="flex flex-col gap-1 text-sm font-medium">
                {w.nameNew}
                <input
                  value={naming}
                  autoFocus
                  maxLength={60}
                  onChange={(event) => setNaming(event.target.value)}
                  className="min-h-10 rounded-md border border-border bg-background px-3 font-normal"
                />
              </label>
              <div className="flex gap-2">
                <button type="submit" disabled={pending || !naming.trim()} className={`${button} bg-foreground text-background`}>
                  {w.saveTheme}
                </button>
                <button type="button" onClick={() => setNaming(null)} className={`${button} border border-border`}>
                  {c.cancel}
                </button>
              </div>
            </form>
          )}

          {message && (
            <div role={message.tone === "error" ? "alert" : "status"} className={`rounded-lg border p-4 text-sm ${message.tone === "error" ? "border-red-700 text-red-700 dark:text-red-400" : "border-border"}`}>
              {message.text.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          )}

          <Section title={w.colours}>
            <Choice legend={w.lightAndDark} options={o.colorModes} value={settings.mode} onChange={(mode) => {
              set({ mode });
              if (mode !== "auto") setPreviewMode(mode);
            }} />
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.visitorSwitch}
                onChange={(event) => set({ visitorSwitch: event.target.checked })}
                className="mt-1"
              />
              <span>
                <span className="font-medium">{w.visitorSwitch}</span>
                <span className="block text-xs text-muted">{w.visitorSwitchHint}</span>
              </span>
            </label>
            <PaletteFields
              title={settings.mode === "dark" && !settings.visitorSwitch ? w.lightNotShown : w.lightColours}
              value={settings.light}
              onChange={(light) => set({ light })}
            />
            <PaletteFields
              title={settings.mode === "light" && !settings.visitorSwitch ? w.darkNotShown : w.darkColours}
              value={settings.dark}
              onChange={(dark) => set({ dark })}
            />
            {warnings.length > 0 && (
              <ul className="list-disc rounded-md border border-amber-600 p-3 pl-8 text-sm" aria-label={w.readability}>
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </Section>

          <Section title={w.fonts}>
            <p className="text-sm text-muted">{w.fontsHint}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <FontPicker
                label={w.headings}
                value={settings.fonts.heading}
                onChange={(heading) => set({ fonts: { ...settings.fonts, heading } })}
                install={actions.installFont}
                defaultLabel={w.theBodyFont}
              />
              <FontPicker
                label={w.bodyText}
                value={settings.fonts.body}
                onChange={(body) => set({ fonts: { ...settings.fonts, body } })}
                install={actions.installFont}
                defaultLabel={w.systemFont}
              />
            </div>
            <Choice
              legend={w.headingWeight}
              options={o.headingWeights as Record<keyof typeof HEADING_WEIGHTS, string>}
              value={settings.headings.weight}
              onChange={(weight) => set({ headings: { ...settings.headings, weight } })}
            />
            <Choice legend={w.headingLetters} options={o.headingCases as Record<ThemeSettings["headings"]["case"], string>} value={settings.headings.case} onChange={(c) => set({ headings: { ...settings.headings, case: c } })} />
          </Section>

          <Section title={w.buttonsAndCorners}>
            <Choice legend={w.buttons} options={o.buttonStyles as Record<ThemeSettings["buttons"]["style"], string>} value={settings.buttons.style} onChange={(style) => set({ buttons: { ...settings.buttons, style } })} />
            <Choice legend={w.buttonCorners} options={o.buttonCorners as Record<ThemeSettings["buttons"]["corners"], string>} value={settings.buttons.corners} onChange={(corners) => set({ buttons: { ...settings.buttons, corners } })} />
            <Choice legend={w.cardsAndPictures} options={o.cardCorners as Record<ThemeSettings["corners"]["cards"], string>} value={settings.corners.cards} onChange={(cards) => set({ corners: { ...settings.corners, cards } })} />
            <Choice legend={w.fieldsAndMenus} options={o.fieldCorners as Record<ThemeSettings["corners"]["fields"], string>} value={settings.corners.fields} onChange={(fields) => set({ corners: { ...settings.corners, fields } })} />
          </Section>

          <Section title={w.layout}>
            <Choice legend={w.pageWidth} options={o.contentWidths as Record<ThemeSettings["layout"]["width"], string>} value={settings.layout.width} onChange={(width) => set({ layout: { ...settings.layout, width } })} />
            {settings.layout.maxWidth !== undefined && (
              <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
                {fillWords(w.maxWidth, { n: settings.layout.maxWidth })}
                <button
                  type="button"
                  onClick={() => set({ layout: { ...settings.layout, maxWidth: undefined } })}
                  className="min-h-9 rounded-md border border-border px-3 text-foreground"
                >
                  {w.useChoice}
                </button>
              </p>
            )}
            <Choice legend={w.header} options={o.headerAligns as Record<ThemeSettings["layout"]["headerAlign"], string>} value={settings.layout.headerAlign} onChange={(headerAlign) => set({ layout: { ...settings.layout, headerAlign } })} />
            <Choice
              legend={w.headerBackground}
              options={o.headerBackgrounds as Record<ThemeSettings["layout"]["headerBackground"], string>}
              value={settings.layout.headerBackground}
              onChange={(headerBackground) => set({ layout: { ...settings.layout, headerBackground } })}
              hint={
                logoNeedsDarkVersion
                  ? w.darkLogo
                  : undefined
              }
            />
          </Section>

          <Section title={w.screenSizes}>
            <BreakpointFields value={breakpointsOf(settings)} onChange={(breakpoints) => set({ breakpoints })} />
          </Section>

          <Section title={w.productCards}>
            <Choice legend={w.picture} options={o.cardImages as Record<ThemeSettings["productCards"]["image"], string>} value={settings.productCards.image} onChange={(image) => set({ productCards: { ...settings.productCards, image } })} />
            <Choice legend={w.card} options={o.cardStyles as Record<ThemeSettings["productCards"]["style"], string>} value={settings.productCards.style} onChange={(style) => set({ productCards: { ...settings.productCards, style } })} />
            <Choice legend={w.text} options={o.cardAligns as Record<ThemeSettings["productCards"]["align"], string>} value={settings.productCards.align} onChange={(align) => set({ productCards: { ...settings.productCards, align } })} />
          </Section>

          {checkout && (
            <Section title={w.checkout.title}>
              <CheckoutLookFields settings={settings} hasLogo={logos.logo} onChange={(look) => set({ checkout: look })} />
            </Section>
          )}
        </div>

        <aside className="flex flex-col gap-3 lg:sticky lg:top-4" aria-label={w.previewHeading}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-medium">{w.previewHeading}</h2>
            {(settings.mode === "auto" || settings.visitorSwitch) && (
              <div className="flex gap-1" role="group" aria-label={w.previewColours}>
                {(["light", "dark"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={previewMode === mode}
                    onClick={() => setPreviewMode(mode)}
                    className="min-h-9 rounded-md border border-border px-3 text-sm aria-pressed:border-foreground aria-pressed:font-medium"
                  >
                    {mode === "light" ? w.light : w.dark}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Preview settings={settings} storeName={storeName} checkout={checkout} mode={settings.mode === "auto" || settings.visitorSwitch ? previewMode : settings.mode} />
        </aside>
      </div>
    </div>
  );
}
