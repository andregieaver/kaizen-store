"use client";

import { useEffect, useId, useRef, useState, useTransition, type KeyboardEvent } from "react";

import { CSS_MAX, cssProblem } from "@/lib/custom-css";

/**
 * The page builder's CSS panel (D100): a side panel over the editor's right
 * column, so the canvas stays in view and shows the CSS as it is typed. Its
 * first tab is the page's own (saved with the page, live when published),
 * its second the whole site's (live when saved here).
 */
export function CssPanel({
  open,
  onClose,
  noun,
  siteName,
  pageCss,
  onPageCss,
  siteCss,
  onSiteCss,
  saveSiteCss,
}: {
  open: boolean;
  onClose: () => void;
  /** What is being edited: page, article, header, footer or layout. */
  noun: string;
  /** Whose site: "your store", "Kaizen's site". */
  siteName: string;
  pageCss: string;
  onPageCss: (css: string) => void;
  /** The site's CSS as written in the panel (shown on the canvas before it is saved). */
  siteCss: string;
  onSiteCss: (css: string) => void;
  saveSiteCss: (css: string) => Promise<{ ok: true } | { ok: false; problems: string[] }>;
}) {
  const id = useId();
  const [tab, setTab] = useState<"page" | "site">("page");
  const [savedSite, setSavedSite] = useState(siteCss);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, start] = useTransition();
  const panel = useRef<HTMLDivElement>(null);
  const tabs = { page: `This ${noun}`, site: "Global" } as const;

  // Opened, the panel takes the focus; Escape closes it.
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>("[role=tab][aria-selected=true]")?.focus();
  }, [open]);

  if (!open) return null;

  const value = tab === "page" ? pageCss : siteCss;
  const problem = value.trim() ? cssProblem(value) : null;
  const siteChanged = siteCss.trim() !== savedSite.trim();

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next = event.key === "Home" ? "page" : event.key === "End" ? "site" : tab === "page" ? "site" : "page";
    setTab(next);
    panel.current?.querySelector<HTMLElement>(`#${CSS.escape(`${id}-tab-${next}`)}`)?.focus();
  };

  const save = () =>
    start(async () => {
      const result = await saveSiteCss(siteCss);
      if (result.ok) {
        setSavedSite(siteCss);
        setStatus({ ok: true, text: `Saved. Every page of ${siteName} has it now.` });
      } else {
        setStatus({ ok: false, text: result.problems.join(" ") });
      }
    });

  return (
    <div
      ref={panel}
      id="css-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby={`${id}-title`}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
      className="fixed inset-y-0 right-0 z-30 flex w-full max-w-md flex-col border-l border-border bg-background shadow-2xl"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 id={`${id}-title`} className="font-medium">
          Custom CSS
        </h2>
        <button type="button" onClick={onClose} className="min-h-9 rounded-md px-3 text-sm hover:bg-surface" aria-label="Close custom CSS">
          Close
        </button>
      </div>
      <div role="tablist" aria-label="Where the CSS applies" className="flex gap-1 border-b border-border px-3">
        {(Object.keys(tabs) as (keyof typeof tabs)[]).map((key) => (
          <button
            key={key}
            id={`${id}-tab-${key}`}
            type="button"
            role="tab"
            aria-selected={tab === key}
            aria-controls={`${id}-panel`}
            tabIndex={tab === key ? 0 : -1}
            onClick={() => setTab(key)}
            onKeyDown={onTabKey}
            className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm aria-selected:border-foreground aria-selected:font-medium"
          >
            {tabs[key]}
            {key === "site" && siteChanged && <span className="text-muted"> •</span>}
          </button>
        ))}
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${tab}`} className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <p className="text-xs text-muted">
          {tab === "page"
            ? `Only on this ${noun}. Saved with it, and on the site once it is published. The canvas shows it as you type where it can; Preview draft shows it exactly.`
            : `On every page of ${siteName}, its headers and footers too. It goes live when you save it here, not with this ${noun}.`}
        </p>
        <label htmlFor={`${id}-css`} className="sr-only">
          {tab === "page" ? `CSS for this ${noun}` : `CSS for every page of ${siteName}`}
        </label>
        <textarea
          key={tab}
          id={`${id}-css`}
          value={value}
          onChange={(event) => {
            setStatus(null);
            (tab === "page" ? onPageCss : onSiteCss)(event.target.value);
          }}
          maxLength={CSS_MAX}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder={tab === "page" ? ".hero h1 {\n  letter-spacing: -0.02em;\n}" : "h2 {\n  text-wrap: balance;\n}"}
          aria-describedby={`${id}-help`}
          aria-invalid={problem ? true : undefined}
          className="min-h-0 w-full flex-1 resize-none rounded-md border border-border bg-surface p-3 font-mono text-[13px] leading-relaxed"
        />
        <div id={`${id}-help`} className="flex flex-col gap-1 text-xs">
          {problem ? (
            <p role="alert" className="text-red-700 dark:text-red-400">
              {problem}{" "}
              {tab === "page" ? `Until it is fixed, the canvas leaves it out and the ${noun} cannot be saved.` : "Until it is fixed, it cannot be saved."}
            </p>
          ) : (
            <p className="text-muted">
              Style parts by the classes and ids you give them under Advanced. Pictures and fonts come from your site or media
              library only.
            </p>
          )}
        </div>
        {tab === "site" && (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={saving || !siteChanged || problem !== null}
              className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-40"
            >
              {saving ? "Saving …" : "Save global CSS"}
            </button>
            <p role="status" aria-live="polite" className={`text-sm ${status && !status.ok ? "text-red-700 dark:text-red-400" : ""}`}>
              {status?.text ?? (siteChanged ? "Not saved yet." : "")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
