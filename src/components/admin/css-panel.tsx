"use client";

import dynamic from "next/dynamic";
import { createContext, useContext, useEffect, useId, useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from "react";

import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { cssLineChanges, type CssVersionActions, type CssVersionItem } from "@/lib/css-versions";
import { CSS_MAX, cssProblem } from "@/lib/custom-css";

import { useAdminLang, useAdminText } from "./admin-text";

/**
 * The code editor (D394), fetched the first time a panel opens; until it arrives, and if it cannot, the plain field the panel hands
 * down is drawn in its place.
 */
const PlainField = createContext<ReactNode>(null);
function Plain() {
  return <>{useContext(PlainField)}</>;
}
const CodeEditor = dynamic(() => import("./css-code-editor").catch(() => Plain), { ssr: false, loading: Plain });

type Nouned = { layout: string; header: string; footer: string; version: string; article: string; page: string };

/** A word for what is being edited, `page` when it is none of the others. */
const byNoun = (words: Nouned, noun: string) => (noun in words ? words[noun as keyof Nouned] : words.page);

/**
 * The page builder's CSS panel (D100): a side panel over the editor's right
 * column, so the canvas stays in view and shows the CSS as it is typed. Its
 * first tab is the page's own (saved with the page, live when published),
 * its second the whole site's (live when saved here), with its earlier saves
 * one press away (D385).
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
  versions,
  classNames = [],
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
  /** The site CSS's earlier saves (D385); none shows no Versions. */
  versions?: CssVersionActions;
  /** The classes the page's parts and the site's text styles have, offered after a `.` (`knownClassNames()`). */
  classNames?: readonly string[];
}) {
  const id = useId();
  const [tab, setTab] = useState<"page" | "site">("page");
  const [savedSite, setSavedSite] = useState(siteCss);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, start] = useTransition();
  const panel = useRef<HTMLDivElement>(null);
  const w = useAdminText("builder").css;
  const tabs = { page: byNoun(w.thisTab, noun), site: w.global } as const;

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
        setStatus({ ok: true, text: fillWords(w.saved, { site: siteName }) });
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
        // Escape in the code editor is the editor's (closing its suggestions, or letting Tab leave it); elsewhere it closes the panel.
        if (event.key !== "Escape" || event.defaultPrevented) return;
        if (event.target instanceof Element && event.target.closest("[data-css-editor]")) return;
        onClose();
      }}
      className="fixed inset-y-0 right-0 z-30 flex w-full max-w-md flex-col border-l border-line bg-card shadow-2xl"
    >
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 id={`${id}-title`} className="text-title text-ink">
          {w.title}
        </h2>
        <button type="button" onClick={onClose} className="min-h-9 rounded-pill px-3 text-sm hover:bg-sunken" aria-label={w.closeLabel}>
          {w.close}
        </button>
      </div>
      <div role="tablist" aria-label={w.where} className="flex gap-1 border-b border-line px-3">
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
            className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm aria-selected:border-brand aria-selected:font-medium"
          >
            {tabs[key]}
            {key === "site" && siteChanged && <span className="text-muted"> •</span>}
          </button>
        ))}
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${tab}`} className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <p className="text-xs text-muted">
          {tab === "page"
            ? byNoun(w.pageHint, noun)
            : fillWords(byNoun(w.siteHint, noun), { site: siteName })}
        </p>
        <label id={`${id}-label`} htmlFor={`${id}-css`} className="sr-only">
          {tab === "page" ? byNoun(w.pageField, noun) : fillWords(w.siteField, { site: siteName })}
        </label>
        <PlainField.Provider
          value={
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
              placeholder={placeholderOf(tab)}
              aria-describedby={`${id}-help`}
              aria-invalid={problem ? true : undefined}
              className="min-h-0 w-full flex-1 resize-none rounded-md border border-line bg-sunken p-3 font-mono text-[13px] leading-relaxed"
            />
          }
        >
          <CodeEditor
            key={tab}
            id={`${id}-css`}
            value={value}
            onChange={(css: string) => {
              setStatus(null);
              (tab === "page" ? onPageCss : onSiteCss)(css);
            }}
            max={CSS_MAX}
            placeholderText={placeholderOf(tab)}
            labelledBy={`${id}-label`}
            describedBy={`${id}-help ${id}-keys`}
            invalid={problem !== null}
            classNames={classNames}
          />
        </PlainField.Provider>
        <div id={`${id}-help`} className="flex flex-col gap-1 text-xs">
          {problem ? (
            <p role="alert" className="text-danger-text">
              {problem}{" "}
              {tab === "page" ? byNoun(w.pageBroken, noun) : w.siteBroken}
            </p>
          ) : (
            <p className="text-muted">
              {w.help}
            </p>
          )}
          <p id={`${id}-keys`} className="text-muted">
            {w.keys}
          </p>
        </div>
        {tab === "site" && versions && (
          <CssVersions
            versions={versions}
            current={siteCss}
            onUse={(css) => {
              onSiteCss(css);
              setStatus({ ok: true, text: w.versionUsed });
            }}
          />
        )}
        {tab === "site" && (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={saving || !siteChanged || problem !== null}
              className="min-h-10 rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink disabled:opacity-40"
            >
              {saving ? w.saving : w.save}
            </button>
            <p role="status" aria-live="polite" className={`text-sm ${status && !status.ok ? "text-danger-text " : ""}`}>
              {status?.text ?? (siteChanged ? w.notSaved : "")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

const placeholderOf = (tab: "page" | "site") => (tab === "page" ? ".hero h1 {\n  letter-spacing: -0.02em;\n}" : "h2 {\n  text-wrap: balance;\n}");

const when = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/**
 * The site CSS's earlier saves (D385), folded away until asked for: each with when and who, and how it differs from what the panel holds
 * in lines. *Use this version* puts it in the panel unsaved; it reaches the site only through Save.
 */
function CssVersions({ versions, current, onUse }: { versions: CssVersionActions; current: string; onUse: (css: string) => void }) {
  const w = useAdminText("builder").css;
  const locale = ADMIN_LANG_FACTS[useAdminLang()].locale;
  const [items, setItems] = useState<CssVersionItem[] | null>(null);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const load = () =>
    start(async () => {
      const list = await versions.list();
      setItems(list);
      const read = await Promise.all(list.slice(0, 10).map(async (item) => [item.id, await versions.read(item.id)] as const));
      setTexts(Object.fromEntries(read.flatMap(([id, r]) => (r.ok ? [[id, r.css]] : []))));
    });
  const use = (item: CssVersionItem) =>
    start(async () => {
      const known = texts[item.id];
      if (known !== undefined) return onUse(known);
      const read = await versions.read(item.id);
      if (read.ok) onUse(read.css);
      else setProblem(read.problem);
    });
  return (
    <details
      className="rounded-panel border border-line"
      onToggle={(event) => {
        if ((event.currentTarget as HTMLDetailsElement).open && items === null) load();
      }}
    >
      <summary className="cursor-pointer px-3 py-2 text-sm">{w.versions}</summary>
      <div className="flex max-h-64 flex-col gap-2 overflow-y-auto border-t border-line p-3" aria-busy={busy}>
        <p className="text-xs text-muted">{w.versionsHint}</p>
        {items === null ? (
          <p className="text-sm text-muted">{w.versionsLoading}</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted">{w.versionsNone}</p>
        ) : (
          <ul aria-label={w.versionsTitle} className="flex flex-col divide-y divide-line">
            {items.map((item) => {
              const text = texts[item.id];
              const changes = text === undefined ? null : cssLineChanges(current, text);
              return (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="flex flex-col">
                    <span>{item.by ? fillWords(w.versionBy, { when: when(item.at, locale), by: item.by }) : fillWords(w.versionAt, { when: when(item.at, locale) })}</span>
                    {changes && (
                      <span className="text-xs text-muted">
                        {changes.added === 0 && changes.removed === 0 ? w.versionSame : fillWords(w.versionChanges, { added: changes.added, removed: changes.removed })}
                      </span>
                    )}
                  </span>
                  <button type="button" disabled={busy} onClick={() => use(item)} className="min-h-9 rounded-pill border border-edge px-3 text-sm hover:bg-sunken disabled:opacity-50">
                    {w.useVersion}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {problem && (
          <p role="alert" className="text-sm text-danger-text">
            {problem}
          </p>
        )}
      </div>
    </details>
  );
}
