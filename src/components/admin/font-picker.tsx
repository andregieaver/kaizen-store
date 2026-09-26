"use client";

import { useDeferredValue, useEffect, useId, useState } from "react";

import { FontLinks } from "@/components/font-links";
import { catalogFont, fontClass, fontSlug, FONT_CATEGORIES, type CatalogFont, type CatalogRow, type FontCategory } from "@/lib/fonts";

import { Modal } from "./modal";

/** Makes a family ready on the sites (downloads it into Kaizen), before it is chosen. */
export type InstallFont = (family: string) => Promise<{ ok: true } | { ok: false; problem: string }>;

const SHOWN = 40;

let catalog: Promise<CatalogFont[]> | null = null;
/** Google Fonts' families, fetched once per visit to the admin. */
function loadCatalog(): Promise<CatalogFont[]> {
  catalog ??= fetch("/api/fonts/catalog")
    .then((response) => (response.ok ? (response.json() as Promise<CatalogRow[]>) : Promise.reject(new Error("catalogue"))))
    .then((rows) => rows.map(catalogFont))
    .catch((error) => {
      catalog = null;
      throw error;
    });
  return catalog;
}

/**
 * Each family's name drawn in itself: a few kilobytes cut by Google for
 * just those letters and passed on by Kaizen (`/api/fonts/preview`), loaded
 * only for the names on screen.
 */
function PreviewFaces({ fonts }: { fonts: CatalogFont[] }) {
  const css = fonts
    .map((f) => `@font-face{font-family:"kp-${fontSlug(f.family)}";src:url(/api/fonts/preview/${fontSlug(f.family)}) format("woff2");font-display:swap}`)
    .join("");
  return <style>{css}</style>;
}

/**
 * Chooses a Google Fonts family (D59): the whole catalogue, searched by
 * name and filtered by kind, each shown in its own letters. Choosing one
 * installs it first, so the site and the canvas can use it at once; none
 * keeps the default the label names.
 */
export function FontPicker({
  label,
  value,
  onChange,
  install,
  defaultLabel,
}: {
  label: string;
  value: string | undefined;
  onChange: (family: string | undefined) => void;
  install: InstallFont;
  /** What no choice means, e.g. "The site's body font". */
  defaultLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const labelId = useId();
  return (
    <div className="flex flex-col gap-1">
      <span id={labelId} className="text-sm font-medium">
        {label}
      </span>
      <FontLinks families={[value]} />
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-labelledby={labelId}
        aria-describedby={`${labelId}-value`}
        aria-haspopup="dialog"
        className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-border bg-background px-3 text-left"
      >
        <span id={`${labelId}-value`} className={value ? `${fontClass(value)} text-lg` : "text-sm text-muted"}>
          {value ?? defaultLabel}
        </span>
        <span className="shrink-0 text-sm underline">Change</span>
      </button>
      {open && (
        <FontDialog
          title={label}
          value={value}
          defaultLabel={defaultLabel}
          install={install}
          onClose={() => setOpen(false)}
          onChoose={(family) => {
            onChange(family);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function FontDialog({
  title,
  value,
  defaultLabel,
  install,
  onClose,
  onChoose,
}: {
  title: string;
  value: string | undefined;
  defaultLabel: string;
  install: InstallFont;
  onClose: () => void;
  onChoose: (family: string | undefined) => void;
}) {
  const [fonts, setFonts] = useState<CatalogFont[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<FontCategory | "all">("all");
  const [shown, setShown] = useState(SHOWN);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const deferred = useDeferredValue(query.trim().toLowerCase());

  useEffect(() => {
    let live = true;
    loadCatalog().then(
      (list) => live && setFonts(list),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, []);

  const matches = (fonts ?? []).filter(
    (f) => (category === "all" || f.category === category) && (!deferred || f.family.toLowerCase().includes(deferred)),
  );
  const visible = matches.slice(0, shown);

  async function choose(family: string) {
    setBusy(family);
    setProblem(null);
    const result = await install(family);
    setBusy(null);
    if (result.ok) onChoose(family);
    else setProblem(result.problem);
  }

  return (
    <Modal open onClose={onClose} title={title} wide>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
            Search Google Fonts
            <input
              type="search"
              value={query}
              autoFocus
              onChange={(event) => {
                setQuery(event.target.value);
                setShown(SHOWN);
              }}
              placeholder="Lora, Inter, Playfair…"
              className="min-h-10 rounded-md border border-border bg-background px-3 text-sm font-normal"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Kind
            <select
              value={category}
              onChange={(event) => {
                setCategory(event.target.value as FontCategory | "all");
                setShown(SHOWN);
              }}
              className="min-h-10 rounded-md border border-border bg-background px-3 text-sm font-normal"
            >
              <option value="all">All kinds</option>
              {Object.entries(FONT_CATEGORIES).map(([key, name]) => (
                <option key={key} value={key}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="text-sm text-muted">
          Fonts are copied to Kaizen when chosen and load from the site itself, so visitors&apos; browsers never contact Google.
        </p>
        {problem && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {problem}
          </p>
        )}

        <button
          type="button"
          onClick={() => onChoose(undefined)}
          aria-pressed={value === undefined}
          className="flex min-h-11 items-center rounded-md border border-border px-3 text-left text-sm aria-pressed:border-foreground aria-pressed:font-medium"
        >
          {defaultLabel}
        </button>

        {failed ? (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            The list of fonts could not be loaded. Close this and try again.
          </p>
        ) : !fonts ? (
          <p className="text-sm text-muted">Loading the fonts…</p>
        ) : (
          <>
            <p className="text-sm text-muted" aria-live="polite">
              {matches.length === 0 ? "No fonts match." : `${matches.length} ${matches.length === 1 ? "font" : "fonts"}, most popular first.`}
            </p>
            <PreviewFaces fonts={visible} />
            <ul className="grid gap-2 sm:grid-cols-2">
              {visible.map((f) => (
                <li key={f.family}>
                  <button
                    type="button"
                    onClick={() => choose(f.family)}
                    disabled={busy !== null}
                    aria-pressed={value === f.family}
                    className="flex min-h-14 w-full flex-col items-start justify-center rounded-md border border-border px-3 py-2 text-left hover:bg-surface disabled:opacity-60 aria-pressed:border-foreground"
                  >
                    <span className="text-xl leading-tight" style={{ fontFamily: `"kp-${fontSlug(f.family)}", ${fallback(f.category)}` }}>
                      {f.family}
                    </span>
                    <span className="text-xs text-muted">
                      {busy === f.family ? "Getting it ready…" : `${FONT_CATEGORIES[f.category]} · ${f.weights.length} ${f.weights.length === 1 ? "weight" : "weights"}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {matches.length > shown && (
              <button
                type="button"
                onClick={() => setShown((n) => n + SHOWN)}
                className="min-h-10 self-center rounded-md border border-border px-4 text-sm"
              >
                Show more
              </button>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

const fallback = (category: FontCategory) =>
  category === "serif" ? "serif" : category === "monospace" ? "monospace" : category === "handwriting" ? "cursive" : "sans-serif";
