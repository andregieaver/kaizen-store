"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { cssProblem, siteCss } from "@/lib/custom-css";

/**
 * "Custom CSS" on the live site (D306): the page builder's CSS panel for staff looking at a published page, beside "Edit text". Its tabs
 * are this page's CSS and the whole site's (the second only for those who may change the website). While it is open the page shows the
 * CSS as typed: the site's own `<CustomCss>` styles for it are switched off and the typed CSS is drawn in their place, checked as the
 * builder checks it; closing without saving gives the page back what it had. Loaded only when the person opens it, so visitors never
 * fetch it, and saved through `/api/platform/editor/css` with the revision it was read at.
 */

type Read = {
  ok: true;
  pageCss: string;
  siteCss: string;
  site: boolean;
  rev: string;
  styles: { page: string; site: string };
};

const ENDPOINT = "/api/platform/editor/css";

/** The `<style>` elements React drew for a `<CustomCss name>` (`data-href` is `css-{name}-{hash}`). */
const stylesNamed = (name: string) => Array.from(document.querySelectorAll<HTMLStyleElement>(`style[data-href^="css-${CSS.escape(name)}-"]`));

export default function SiteCssEditor({ pageId, store, onClose, onNotice }: { pageId: string; store?: string; onClose: () => void; onNotice: (text: string) => void }) {
  const router = useRouter();
  const id = useId();
  const [read, setRead] = useState<Read | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [tab, setTab] = useState<"page" | "site">("page");
  const [pageCss, setPageCss] = useState("");
  const [site, setSite] = useState("");
  const [saving, setSaving] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: pageId });
    if (store) params.set("store", store);
    fetch(`${ENDPOINT}?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as (Read | { ok: false; message?: string }) | null;
        if (!body?.ok) {
          setProblem(response.status === 403 ? "You cannot change this page's CSS, or your editing has run out." : (body?.message ?? "The CSS could not be opened."));
          return;
        }
        setRead(body);
        setPageCss(body.pageCss);
        setSite(body.siteCss);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [pageId, store]);

  // The page shows what is typed: the site's own styles for it are switched off and the typed CSS stands in their place.
  useEffect(() => {
    if (!read) return;
    const own = [...stylesNamed(read.styles.page), ...stylesNamed(read.styles.site)];
    for (const style of own) style.media = "not all";
    const live = document.createElement("style");
    live.setAttribute("data-kz-live-css", "");
    document.head.appendChild(live);
    return () => {
      live.remove();
      for (const style of own) style.removeAttribute("media");
    };
  }, [read]);
  useEffect(() => {
    const live = document.querySelector<HTMLStyleElement>("style[data-kz-live-css]");
    if (!live) return;
    // A CSS with a problem is not drawn: the page keeps what it showed before it.
    const ok = (css: string) => !css.trim() || cssProblem(css) === null;
    if (ok(site) && ok(pageCss)) live.textContent = `${siteCss(site)}\n${siteCss(pageCss)}`;
  }, [read, site, pageCss]);

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("textarea")?.focus();
  }, [read, tab]);

  const value = tab === "page" ? pageCss : site;
  const typing = value.trim() ? cssProblem(value) : null;
  const changed = read !== null && (pageCss.trim() !== read.pageCss.trim() || site.trim() !== read.siteCss.trim());

  const close = () => {
    if (changed && !window.confirm("Close without saving? The page goes back to the CSS it had.")) return;
    onClose();
  };

  async function save() {
    if (!read || saving) return;
    if (!changed) return onClose();
    for (const css of [pageCss, site]) {
      const found = css.trim() ? cssProblem(css) : null;
      if (found) return setProblem(found);
    }
    setSaving(true);
    setProblem(null);
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ store: store ?? null, page: pageId, rev: read.rev, pageCss, siteCss: site }),
      });
      const body = (await response.json().catch(() => null)) as { ok?: boolean; message?: string; draftKept?: boolean } | null;
      if (response.ok && body?.ok) {
        onNotice(body.draftKept ? "Saved. The draft in the page builder has other CSS for this page and keeps it." : "CSS saved.");
        onClose();
        router.refresh();
      } else {
        setProblem(response.status === 403 && !body?.message ? "You cannot change this CSS, or your editing has run out." : (body?.message ?? "It could not be saved. Try again."));
      }
    } catch {
      setProblem("It could not be saved. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const tabs = read?.site ? (["page", "site"] as const) : (["page"] as const);
  const names = { page: "This page", site: "Whole site" } as const;
  return (
    <div
      ref={panel}
      role="dialog"
      aria-modal="false"
      aria-labelledby={`${id}-title`}
      lang="en"
      data-staff-tools=""
      onKeyDown={(event) => {
        if (event.key === "Escape") close();
        if ((event.metaKey || event.ctrlKey) && (event.key === "Enter" || event.key.toLowerCase() === "s")) {
          event.preventDefault();
          void save();
        }
      }}
      className="fixed inset-x-2 bottom-2 z-[60] flex max-h-[70vh] flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-2xl md:inset-x-auto md:top-4 md:right-4 md:bottom-4 md:max-h-none md:w-[28rem] print:hidden"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <h2 id={`${id}-title`} className="text-sm font-medium">
          Custom CSS
        </h2>
        <span className="text-xs text-muted">Shown on the page as you type</span>
        <button type="button" onClick={close} className="ml-auto min-h-9 rounded px-2 text-sm underline">
          Close
        </button>
      </div>
      {!read ? (
        <p role="status" className="p-3 text-sm">
          {problem ?? "Opening the CSS…"}
        </p>
      ) : (
        <>
          {tabs.length > 1 && (
            <div role="tablist" aria-label="Whose CSS" className="flex gap-1 border-b border-border px-2 pt-2">
              {tabs.map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  aria-controls={`${id}-css`}
                  onClick={() => setTab(key)}
                  className={`min-h-9 rounded-t px-3 text-sm ${tab === key ? "border border-b-0 border-border bg-background font-medium" : "text-muted"}`}
                >
                  {names[key]}
                </button>
              ))}
            </div>
          )}
          <label htmlFor={`${id}-css`} className="sr-only">
            {tab === "page" ? "This page's CSS" : "The whole site's CSS"}
          </label>
          <textarea
            id={`${id}-css`}
            value={value}
            onChange={(event) => (tab === "page" ? setPageCss(event.target.value) : setSite(event.target.value))}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="min-h-64 flex-1 resize-none border-0 bg-transparent p-3 font-mono text-xs leading-relaxed outline-none"
            placeholder={tab === "page" ? ".hero h1 { letter-spacing: 0.02em; }" : "a { text-underline-offset: 3px; }"}
          />
          <div className="flex flex-wrap items-center gap-2 border-t border-border p-2 text-sm">
            <button type="button" onClick={() => void save()} disabled={saving || typing !== null} className="min-h-9 rounded bg-foreground px-3 font-medium text-background disabled:opacity-60">
              {saving ? "Saving…" : "Save"}
            </button>
            <span role="status" aria-live="polite" className={typing || problem ? "max-w-72 text-red-700 dark:text-red-400" : "text-muted"}>
              {typing ?? problem ?? (tab === "page" ? "Saved into the page as it is published." : "For every page of the site.")}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
