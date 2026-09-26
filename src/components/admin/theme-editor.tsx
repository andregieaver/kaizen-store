"use client";

import { useId, useState, useTransition, type ReactNode } from "react";

import { FontLinks } from "@/components/font-links";
import { fontClass, siteFontFamilies } from "@/lib/fonts";
import {
  BUTTON_CORNERS,
  BUTTON_STYLES,
  CARD_ALIGNS,
  CARD_CORNERS,
  CARD_IMAGES,
  CARD_STYLES,
  COLOR_MODES,
  CONTENT_WIDTHS,
  FIELD_CORNERS,
  HEADER_ALIGNS,
  HEADER_BACKGROUNDS,
  HEADING_CASES,
  HEADING_WEIGHTS,
  PALETTE_KEYS,
  PALETTE_LABELS,
  THEME_TEMPLATES,
  THEME_TEMPLATE_KEYS,
  darkBehindLogo,
  templateSettings,
  themeAttributes,
  themeCss,
  themeWarnings,
  type Palette,
  type StoreTheme,
  type ThemeSettings,
} from "@/lib/theme";
import type { SavedTheme } from "@/server/themes";

import { FontPicker, type InstallFont } from "./font-picker";

type Result<T> = { ok: true } & T;
type Failure = { ok: false; problems: string[] };

export type ThemeActions = {
  save: (payload: string) => Promise<Result<{ theme: StoreTheme }> | Failure>;
  saveSaved: (payload: string) => Promise<Result<{ theme: SavedTheme }> | Failure>;
  removeSaved: (id: string) => Promise<{ ok: boolean }>;
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
                aria-label={`${PALETTE_LABELS[key].name}, ${title.toLowerCase()}: pick`}
                onChange={(event) => {
                  setDrafts((d) => ({ ...d, [key]: undefined }));
                  onChange({ ...value, [key]: event.target.value });
                }}
                className="size-10 shrink-0 cursor-pointer rounded-md border border-border bg-background p-0.5"
              />
              <label className="flex min-w-0 flex-1 flex-col text-sm">
                <span className="font-medium">{PALETTE_LABELS[key].name}</span>
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
                  {PALETTE_LABELS[key].hint}
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
function Preview({ settings, storeName, mode }: { settings: ThemeSettings; storeName: string; mode: "light" | "dark" }) {
  const { fonts } = settings;
  const headingFont = fonts.heading ?? fonts.body;
  return (
    <div
      {...themeAttributes(settings)}
      data-theme-preview=""
      aria-label={`Preview in ${mode} colours`}
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
        {settings.layout.headerAlign === "left" && <span className="ml-auto text-xs opacity-80">Shop · About · Blog</span>}
      </div>
      <div className="flex flex-col gap-3 p-4">
        <p className={`font-heading text-2xl leading-tight ${headingFont ? fontClass(headingFont) : ""}`} style={settings.headings.case === "upper" ? { textTransform: "uppercase", letterSpacing: "0.06em" } : undefined}>
          Made slowly, by hand
        </p>
        <p className="text-sm">
          Cups and bowls thrown in our workshop. <span className="text-muted">Free delivery over 500 kr.</span>
        </p>
        <div className="flex flex-wrap gap-2">
          <span className="button-primary inline-flex min-h-10 items-center px-4 text-sm font-medium">Add to cart</span>
          <span className="inline-flex min-h-10 items-center rounded-button border border-border px-4 text-sm">Read more</span>
        </div>
        <ul className="grid grid-cols-3 gap-3">
          {["Cup", "Bowl", "Plate"].map((name, i) => (
            <li key={name} className="product-card relative flex flex-col gap-2">
              <span className="product-card-image block w-full rounded-lg bg-surface" style={{ opacity: 1 - i * 0.15 }} />
              <span className="text-xs font-medium">{name}</span>
              <span className="text-xs text-muted">{190 + i * 60} kr</span>
            </li>
          ))}
        </ul>
        <input readOnly tabIndex={-1} aria-hidden value="Email" className="min-h-9 rounded-md border border-border bg-background px-3 text-xs" />
      </div>
      <div className="border-t border-border bg-surface px-4 py-3 text-xs text-muted">© {storeName}</div>
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
}: {
  storeName: string;
  current: StoreTheme;
  saved: SavedTheme[];
  actions: ThemeActions;
  /** Whether the store has a logo, and one for dark backgrounds (D60). */
  logos: { logo: boolean; dark: boolean };
}) {
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
  const warnings = themeWarnings(settings);
  // A logo without a light version, on a background the theme makes dark somewhere.
  const behind = [darkBehindLogo(settings, "header"), darkBehindLogo(settings, "page")];
  const logoNeedsDarkVersion = logos.logo && !logos.dark && behind.some((b) => b.light || b.dark);

  const set = (patch: Partial<ThemeSettings>) => {
    setTheme((t) => ({ ...t, settings: { ...t.settings, ...patch } }));
    setMessage(null);
  };

  /** Loads a theme into the editor, its fonts made ready first; nothing changes on the site until Save. */
  const load = (next: StoreTheme) => {
    if (unpublished && !same(next, theme) && !window.confirm("Replace the changes you have not saved?")) return;
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
        setMessage({ tone: "ok", text: ["Saved. The store shows this theme now."] });
      } else setMessage({ tone: "error", text: result.problems });
    });

  const saveAs = (id: string | null, name: string) =>
    startTransition(async () => {
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
        text: [`Saved as “${result.theme.name}”. ${unpublished || live.savedId !== result.theme.id ? "Save to show it on the store." : ""}`.trim()],
      });
    });

  const remove = (entry: SavedTheme) => {
    if (!window.confirm(`Delete the theme “${entry.name}”? The store keeps its look.`)) return;
    startTransition(async () => {
      const result = await actions.removeSaved(entry.id);
      if (!result.ok) return;
      setSaved((list) => list.filter((s) => s.id !== entry.id));
      setTheme((t) => (t.savedId === entry.id ? { ...t, savedId: null } : t));
      setLive((t) => (t.savedId === entry.id ? { ...t, savedId: null } : t));
      setMessage({ tone: "ok", text: [`Deleted “${entry.name}”.`] });
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
            {name} {inUse && <span className="ml-1 rounded-full bg-surface px-2 py-0.5 text-xs font-normal">On the store</span>}
          </h3>
          <p className="text-xs text-muted">{description || [fonts.heading, fonts.body].filter(Boolean).join(" and ") || "System fonts"}</p>
        </div>
        <div className="mt-auto flex flex-wrap gap-2">
          <button type="button" disabled={pending || editing} onClick={() => load(entry)} className={`${button} border border-border`}>
            {editing ? "Editing" : "Edit"}
          </button>
          {extra}
        </div>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <Section title="Themes">
        <p className="text-sm text-muted">
          Start from a built-in theme or one of your own. Edit changes nothing on the store until you save.
        </p>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {THEME_TEMPLATE_KEYS.map((key) =>
            themeCard(key, THEME_TEMPLATES[key].name, THEME_TEMPLATES[key].description, {
              base: key,
              savedId: null,
              settings: templateSettings(key),
            }),
          )}
          {saved.map((entry) =>
            themeCard(
              entry.id,
              entry.name,
              `Your theme, from ${THEME_TEMPLATES[entry.base].name}.`,
              { base: entry.base, savedId: entry.id, settings: entry.settings },
              <button type="button" disabled={pending} onClick={() => remove(entry)} className={`${button} border border-border text-red-700 dark:text-red-400`}>
                Delete
              </button>,
            ),
          )}
        </ul>
      </Section>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="flex flex-col gap-6">
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background p-3 shadow-sm">
            <p className="mr-auto text-sm" aria-live="polite">
              Editing <strong>{sourceName}</strong>
              {changedFromSource ? " · changed" : ""}
              {unpublished ? " · not on the store yet" : " · on the store"}
            </p>
            <button type="button" disabled={pending || !unpublished} onClick={publish} className={`${button} bg-foreground text-background`}>
              Save
            </button>
            {loaded && changedFromSource && (
              <button type="button" disabled={pending} onClick={() => saveAs(loaded.id, loaded.name)} className={`${button} border border-border`}>
                Update “{loaded.name}”
              </button>
            )}
            <button type="button" disabled={pending} onClick={() => setNaming(loaded ? `${loaded.name} 2` : `My ${THEME_TEMPLATES[theme.base].name}`)} className={`${button} border border-border`}>
              Save as new theme…
            </button>
            {loaded && changedFromSource && (
              <button type="button" disabled={pending} onClick={() => set(structuredClone(loaded.settings))} className={`${button} border border-border`}>
                Undo changes
              </button>
            )}
            <button
              type="button"
              disabled={pending || same(settings, templateSettings(theme.base))}
              onClick={() => {
                if (window.confirm(`Reset every setting to ${THEME_TEMPLATES[theme.base].name}'s defaults?`)) set(templateSettings(theme.base));
              }}
              className={`${button} border border-border`}
            >
              Reset to {THEME_TEMPLATES[theme.base].name}
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
                Name of the new theme
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
                  Save theme
                </button>
                <button type="button" onClick={() => setNaming(null)} className={`${button} border border-border`}>
                  Cancel
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

          <Section title="Colours">
            <Choice legend="Light and dark" options={COLOR_MODES} value={settings.mode} onChange={(mode) => {
              set({ mode });
              if (mode !== "auto") setPreviewMode(mode);
            }} />
            <PaletteFields title={settings.mode === "dark" ? "Light colours (not shown)" : "Light colours"} value={settings.light} onChange={(light) => set({ light })} />
            <PaletteFields title={settings.mode === "light" ? "Dark colours (not shown)" : "Dark colours"} value={settings.dark} onChange={(dark) => set({ dark })} />
            {warnings.length > 0 && (
              <ul className="list-disc rounded-md border border-amber-600 p-3 pl-8 text-sm" aria-label="Readability">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Fonts">
            <p className="text-sm text-muted">Any Google Fonts family, copied to Kaizen and loaded from the store itself.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <FontPicker
                label="Headings"
                value={settings.fonts.heading}
                onChange={(heading) => set({ fonts: { ...settings.fonts, heading } })}
                install={actions.installFont}
                defaultLabel="The body font"
              />
              <FontPicker
                label="Body text"
                value={settings.fonts.body}
                onChange={(body) => set({ fonts: { ...settings.fonts, body } })}
                install={actions.installFont}
                defaultLabel="The system's font"
              />
            </div>
            <Choice
              legend="Heading weight"
              options={{ normal: "Normal", medium: "Medium", semibold: "Semibold", bold: "Bold" } satisfies Record<keyof typeof HEADING_WEIGHTS, string>}
              value={settings.headings.weight}
              onChange={(weight) => set({ headings: { ...settings.headings, weight } })}
            />
            <Choice legend="Heading letters" options={HEADING_CASES} value={settings.headings.case} onChange={(c) => set({ headings: { ...settings.headings, case: c } })} />
          </Section>

          <Section title="Buttons and corners">
            <Choice legend="Buttons" options={BUTTON_STYLES} value={settings.buttons.style} onChange={(style) => set({ buttons: { ...settings.buttons, style } })} />
            <Choice legend="Button corners" options={BUTTON_CORNERS} value={settings.buttons.corners} onChange={(corners) => set({ buttons: { ...settings.buttons, corners } })} />
            <Choice legend="Cards and pictures" options={CARD_CORNERS} value={settings.corners.cards} onChange={(cards) => set({ corners: { ...settings.corners, cards } })} />
            <Choice legend="Fields and menus" options={FIELD_CORNERS} value={settings.corners.fields} onChange={(fields) => set({ corners: { ...settings.corners, fields } })} />
          </Section>

          <Section title="Layout">
            <Choice legend="Page width" options={CONTENT_WIDTHS} value={settings.layout.width} onChange={(width) => set({ layout: { ...settings.layout, width } })} />
            <Choice legend="Header" options={HEADER_ALIGNS} value={settings.layout.headerAlign} onChange={(headerAlign) => set({ layout: { ...settings.layout, headerAlign } })} />
            <Choice
              legend="Header background"
              options={HEADER_BACKGROUNDS}
              value={settings.layout.headerBackground}
              onChange={(headerBackground) => set({ layout: { ...settings.layout, headerBackground } })}
              hint={
                logoNeedsDarkVersion
                  ? "Your logo will sit on a dark background here. If it is dark, add a logo for dark backgrounds under Header and footer."
                  : undefined
              }
            />
          </Section>

          <Section title="Product cards">
            <Choice legend="Picture" options={CARD_IMAGES} value={settings.productCards.image} onChange={(image) => set({ productCards: { ...settings.productCards, image } })} />
            <Choice legend="Card" options={CARD_STYLES} value={settings.productCards.style} onChange={(style) => set({ productCards: { ...settings.productCards, style } })} />
            <Choice legend="Text" options={CARD_ALIGNS} value={settings.productCards.align} onChange={(align) => set({ productCards: { ...settings.productCards, align } })} />
          </Section>
        </div>

        <aside className="flex flex-col gap-3 lg:sticky lg:top-4" aria-label="Preview">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-medium">Preview</h2>
            {settings.mode === "auto" && (
              <div className="flex gap-1" role="group" aria-label="Preview colours">
                {(["light", "dark"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={previewMode === mode}
                    onClick={() => setPreviewMode(mode)}
                    className="min-h-9 rounded-md border border-border px-3 text-sm aria-pressed:border-foreground aria-pressed:font-medium"
                  >
                    {mode === "light" ? "Light" : "Dark"}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Preview settings={settings} storeName={storeName} mode={settings.mode === "auto" ? previewMode : settings.mode} />
        </aside>
      </div>
    </div>
  );
}
