"use client";

import { useDeferredValue, useEffect, useId, useState, type ReactNode } from "react";

import { FontLinks } from "@/components/font-links";
import { countWords } from "@/lib/admin-fill";
import { catalogFont, fontClass, fontSlug, FONT_CATEGORIES, type CatalogFont, type CatalogRow, type FontCategory } from "@/lib/fonts";

import { useAdminText } from "./admin-text";
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
  mark,
}: {
  label: string;
  value: string | undefined;
  onChange: (family: string | undefined) => void;
  install: InstallFont;
  /** What no choice means, e.g. "The site's body font". */
  defaultLabel: string;
  /** Beside the label: a setting that can differ by screen size has its device icon and where its value comes from (D179). */
  mark?: ReactNode;
}) {
  const w = useAdminText("design").fonts;
  const [open, setOpen] = useState(false);
  const labelId = useId();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        <span id={labelId} className="text-sm font-medium">
          {label}
        </span>
        {mark}
      </div>
      <FontLinks families={[value]} />
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-labelledby={labelId}
        aria-describedby={`${labelId}-value`}
        aria-haspopup="dialog"
        className="flex min-h-11 items-center justify-between gap-3 rounded-pill border border-edge bg-card px-3 text-left"
      >
        <span id={`${labelId}-value`} className={value ? `${fontClass(value)} text-lg` : "text-sm text-muted"}>
          {value ?? defaultLabel}
        </span>
        <span className="shrink-0 text-sm underline">{w.change}</span>
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
  const w = useAdminText("design").fonts;
  const kindName = (category: FontCategory) => w.categories[category] ?? FONT_CATEGORIES[category];
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
            {w.search}
            <input
              type="search"
              value={query}
              autoFocus
              onChange={(event) => {
                setQuery(event.target.value);
                setShown(SHOWN);
              }}
              placeholder={w.placeholder}
              className="min-h-10 rounded-md border border-line bg-card px-3 text-sm font-normal"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {w.kind}
            <select
              value={category}
              onChange={(event) => {
                setCategory(event.target.value as FontCategory | "all");
                setShown(SHOWN);
              }}
              className="min-h-10 rounded-md border border-line bg-card px-3 text-sm font-normal"
            >
              <option value="all">{w.allKinds}</option>
              {(Object.keys(FONT_CATEGORIES) as FontCategory[]).map((key) => (
                <option key={key} value={key}>
                  {kindName(key)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="text-sm text-muted">
          {w.copied}
        </p>
        {problem && (
          <p role="alert" className="text-sm text-danger-text">
            {problem}
          </p>
        )}

        <button
          type="button"
          onClick={() => onChoose(undefined)}
          aria-pressed={value === undefined}
          className="flex min-h-11 items-center rounded-pill border border-edge px-3 text-left text-sm aria-pressed:border-brand aria-pressed:font-medium"
        >
          {defaultLabel}
        </button>

        {failed ? (
          <p role="alert" className="text-sm text-danger-text">
            {w.failed}
          </p>
        ) : !fonts ? (
          <p className="text-sm text-muted">{w.loading}</p>
        ) : (
          <>
            <p className="text-sm text-muted" aria-live="polite">
              {matches.length === 0 ? w.noMatch : countWords(matches.length, w.count)}
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
                    className="flex min-h-14 w-full flex-col items-start justify-center rounded-pill border border-edge px-3 py-2 text-left hover:bg-sunken disabled:opacity-60 aria-pressed:border-brand"
                  >
                    <span className="text-xl leading-tight" style={{ fontFamily: `"kp-${fontSlug(f.family)}", ${fallback(f.category)}` }}>
                      {f.family}
                    </span>
                    <span className="text-xs text-muted">
                      {busy === f.family ? w.gettingReady : countWords(f.weights.length, w.weights, { kind: kindName(f.category) })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {matches.length > shown && (
              <button
                type="button"
                onClick={() => setShown((n) => n + SHOWN)}
                className="min-h-10 self-center rounded-pill border border-edge px-4 text-sm"
              >
                {w.showMore}
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
