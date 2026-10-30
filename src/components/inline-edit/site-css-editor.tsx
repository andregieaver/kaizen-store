"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { createContext, useContext, useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { CSS_MAX, cssProblem, siteCss } from "@/lib/custom-css";
import { PANEL_EDGES, fitBox, movedBox, readBox, resizedBox, usualSiteBox, type PanelBox, type PanelEdge } from "@/lib/panel-box";

/** The page builder's code editor (D394), fetched when the panel opens; until it arrives, and if it cannot, the plain field. */
const PlainField = createContext<ReactNode>(null);
function Plain() {
  return <>{useContext(PlainField)}</>;
}
const CodeEditor = dynamic(() => import("@/components/admin/css-code-editor").catch(() => Plain), { ssr: false, loading: Plain });

/** Where the panel was moved and how big it was made, kept in this browser (`KNOWN_COOKIES`). */
const BOX_KEY = "kaizen_site_css_panel";
/** From this width the panel floats where it was put; narrower, it is a sheet at the bottom of the screen. */
const WIDE = "(min-width: 768px)";

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

function keptBox(): PanelBox {
  let kept: PanelBox | null = null;
  try {
    kept = readBox(window.localStorage.getItem(BOX_KEY));
  } catch {
    /* none kept */
  }
  return kept ? fitBox(kept, viewport()) : usualSiteBox(viewport());
}

function keepBox(box: PanelBox | null): void {
  try {
    if (box) window.localStorage.setItem(BOX_KEY, JSON.stringify(box));
    else window.localStorage.removeItem(BOX_KEY);
  } catch {
    /* kept for this page only */
  }
}

/** Each edge's and corner's handle: where it sits and the pointer it shows. */
const EDGE_CLASS: Record<PanelEdge, string> = {
  n: "inset-x-3 -top-1 h-2 cursor-ns-resize",
  s: "inset-x-3 -bottom-1 h-2 cursor-ns-resize",
  e: "inset-y-3 -right-1 w-2 cursor-ew-resize",
  w: "inset-y-3 -left-1 w-2 cursor-ew-resize",
  ne: "-top-1 -right-1 size-4 cursor-nesw-resize",
  sw: "-bottom-1 -left-1 size-4 cursor-nesw-resize",
  nw: "-top-1 -left-1 size-4 cursor-nwse-resize",
  se: "-right-1 -bottom-1 size-4 cursor-nwse-resize",
};

/** Follows the pointer from a press until it is let go: each move is the travel since the press. */
function follow(event: ReactPointerEvent<HTMLElement>, onMove: (dx: number, dy: number) => void, onEnd: () => void) {
  if (event.button !== 0) return;
  event.preventDefault();
  const target = event.currentTarget;
  target.setPointerCapture(event.pointerId);
  const startX = event.clientX;
  const startY = event.clientY;
  const move = (moving: PointerEvent) => onMove(moving.clientX - startX, moving.clientY - startY);
  const end = () => {
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", end);
    target.removeEventListener("pointercancel", end);
    onEnd();
  };
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", end);
  target.addEventListener("pointercancel", end);
}

/**
 * "Custom CSS" on the live site (D306): the page builder's CSS panel for staff looking at a published page, beside "Edit text". Its tabs
 * are this page's CSS and the whole site's (the second only for those who may change the website). While it is open the page shows the
 * CSS as typed: the site's own `<CustomCss>` styles for it are switched off and the typed CSS is drawn in their place, checked as the
 * builder checks it; closing without saving gives the page back what it had. Loaded only when the person opens it, so visitors never
 * fetch it, and saved through `/api/platform/editor/css` with the revision it was read at. On a computer it floats above the site's header
 * and chat (D394): moved by its title bar, resized from any edge or corner (or with the arrow keys on its grip), where it was put kept in
 * this browser; on a phone it is a sheet at the bottom. The words are typed in the page builder's code editor.
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
  // Loaded only in the browser (`ssr: false`), so the window is there to read.
  const [box, setBox] = useState<PanelBox>(keptBox);
  const [wide, setWide] = useState(() => window.matchMedia(WIDE).matches);
  const latest = useRef(box);
  useEffect(() => {
    latest.current = box;
  });

  // A window made smaller, or turned, keeps the panel whole on the screen.
  useEffect(() => {
    const media = window.matchMedia(WIDE);
    const changed = () => {
      setWide(media.matches);
      setBox((current) => fitBox(current, viewport()));
    };
    media.addEventListener("change", changed);
    window.addEventListener("resize", changed);
    return () => {
      media.removeEventListener("change", changed);
      window.removeEventListener("resize", changed);
    };
  }, []);

  const drag = (event: ReactPointerEvent<HTMLElement>, edge: PanelEdge | null) => {
    const start = latest.current;
    follow(
      event,
      (dx, dy) => setBox(edge ? resizedBox(start, edge, dx, dy, viewport()) : movedBox(start, dx, dy, viewport())),
      () => keepBox(latest.current),
    );
  };
  const nudge = (dx: number, dy: number, size: boolean) => {
    const next = size ? resizedBox(box, "se", dx, dy, viewport()) : movedBox(box, dx, dy, viewport());
    setBox(next);
    keepBox(next);
  };
  const putBack = () => {
    const usual = usualSiteBox(viewport());
    setBox(usual);
    keepBox(null);
  };

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

  // The plain field takes the focus where the code editor has not come (the code editor takes it itself, `autoFocus`).
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
  // In the body, not where the edit buttons are: a page wrapped for the footer reveal (`over-footer`, `z-10`) makes its own layer, and
  // the panel inside it would fall under a sticky header whatever its own z-index.
  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-modal="false"
      aria-labelledby={`${id}-title`}
      lang="en"
      data-staff-tools=""
      onKeyDown={(event) => {
        // Escape in the code editor is the editor's (closing its suggestions, or letting Tab leave it); elsewhere it closes the panel.
        const inEditor = event.target instanceof Element && event.target.closest("[data-css-editor]") !== null;
        if (event.key === "Escape" && !event.defaultPrevented && !inEditor) close();
        if ((event.metaKey || event.ctrlKey) && (event.key === "Enter" || event.key.toLowerCase() === "s")) {
          event.preventDefault();
          void save();
        }
      }}
      data-site-css-panel=""
      style={wide ? { left: box.x, top: box.y, width: box.width, height: box.height } : undefined}
      // Above the site's header, its chat (`z-[90]`) and the cart's drawer; below the text editor's floating bar.
      className={`fixed z-[200] flex flex-col rounded-lg border border-border bg-background text-foreground shadow-2xl print:hidden ${wide ? "" : "inset-x-2 bottom-2 h-[70vh]"}`}
    >
      {wide &&
        PANEL_EDGES.map((edge) => (
          <div key={edge} aria-hidden data-panel-edge={edge} onPointerDown={(event) => drag(event, edge)} className={`absolute z-10 touch-none ${EDGE_CLASS[edge]}`} />
        ))}
      <div
        onPointerDown={(event) => {
          if (wide && !(event.target instanceof Element && event.target.closest("button"))) drag(event, null);
        }}
        onDoubleClick={(event) => {
          if (wide && !(event.target instanceof Element && event.target.closest("button"))) putBack();
        }}
        data-panel-title=""
        className={`flex items-center gap-2 rounded-t-lg border-b border-border px-3 py-2 ${wide ? "cursor-move touch-none select-none" : ""}`}
      >
        {wide && (
          <button
            type="button"
            aria-label="Move or resize the panel: arrow keys move it, Shift and the arrow keys change its size, Home puts it back"
            title="Drag the title bar to move the panel and any edge to resize it. Double-click the title bar to put it back."
            onKeyDown={(event) => {
              const by = event.altKey ? 4 : 24;
              const keys: Record<string, [number, number]> = { ArrowLeft: [-by, 0], ArrowRight: [by, 0], ArrowUp: [0, -by], ArrowDown: [0, by] };
              const step = keys[event.key];
              if (step) nudge(step[0], step[1], event.shiftKey);
              else if (event.key === "Home") putBack();
              else return;
              event.preventDefault();
            }}
            className="flex size-7 shrink-0 cursor-move items-center justify-center rounded text-muted hover:text-foreground"
          >
            <svg aria-hidden viewBox="0 0 16 16" className="size-4" fill="currentColor">
              <circle cx="5" cy="4" r="1.2" />
              <circle cx="11" cy="4" r="1.2" />
              <circle cx="5" cy="8" r="1.2" />
              <circle cx="11" cy="8" r="1.2" />
              <circle cx="5" cy="12" r="1.2" />
              <circle cx="11" cy="12" r="1.2" />
            </svg>
          </button>
        )}
        <h2 id={`${id}-title`} className="text-sm font-medium">
          Custom CSS
        </h2>
        <span className="truncate text-xs text-muted">Shown on the page as you type</span>
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
          <label id={`${id}-label`} htmlFor={`${id}-css`} className="sr-only">
            {tab === "page" ? "This page's CSS" : "The whole site's CSS"}
          </label>
          <div className="flex min-h-0 flex-1 flex-col p-2">
            <PlainField.Provider
              value={
                <textarea
                  key={tab}
                  id={`${id}-css`}
                  value={value}
                  onChange={(event) => (tab === "page" ? setPageCss(event.target.value) : setSite(event.target.value))}
                  maxLength={CSS_MAX}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  aria-describedby={`${id}-status`}
                  className="min-h-0 flex-1 resize-none rounded-md border border-border bg-surface p-3 font-mono text-xs leading-relaxed outline-none"
                  placeholder={placeholderOf(tab)}
                />
              }
            >
              <CodeEditor
                key={tab}
                id={`${id}-css`}
                value={value}
                onChange={(css: string) => (tab === "page" ? setPageCss(css) : setSite(css))}
                max={CSS_MAX}
                placeholderText={placeholderOf(tab)}
                labelledBy={`${id}-label`}
                describedBy={`${id}-status ${id}-keys`}
                invalid={typing !== null}
                classNames={[]}
                autoFocus
              />
            </PlainField.Provider>
            <p id={`${id}-keys`} className="sr-only">
              Tab indents. Suggestions show as you type; Enter takes one. Press Escape, then Tab, to leave the editor.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-b-lg border-t border-border p-2 text-sm">
            <button type="button" onClick={() => void save()} disabled={saving || typing !== null} className="min-h-9 rounded bg-foreground px-3 font-medium text-background disabled:opacity-60">
              {saving ? "Saving…" : "Save"}
            </button>
            <span id={`${id}-status`} role="status" aria-live="polite" className={typing || problem ? "max-w-72 text-red-700 dark:text-red-400" : "text-muted"}>
              {typing ?? problem ?? (tab === "page" ? "Saved into the page as it is published." : "For every page of the site.")}
            </span>
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}

const placeholderOf = (tab: "page" | "site") => (tab === "page" ? ".hero h1 {\n  letter-spacing: 0.02em;\n}" : "a {\n  text-underline-offset: 3px;\n}");
