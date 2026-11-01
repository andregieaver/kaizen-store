"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ComponentProps } from "react";

import { followScroll, formatDualWith, otherSide, type DualSide, type DualWith } from "@/lib/dual-page";
import { issueId, type PageIssue } from "@/lib/page-a11y";
import type { SavedPart } from "@/lib/saved-parts";
import { fillWords } from "@/lib/admin-fill";

import { useAdminText } from "./admin-text";
import { CssPanel } from "./css-panel";
import { DualFrame } from "./page-builder";
import { PageEditor, type DualEditorHandle, type DualEditorState } from "./page-editor";
import { PublishWithIssuesDialog } from "./page-issues-panel";

type EditorProps = Omit<ComponentProps<typeof PageEditor>, "dual">;

/** One of the two documents: its editor's props, what the address calls it, and how the frame names its kind. */
export type DualDoc = {
  props: EditorProps;
  /** The document as the address holds it: its kind and id (null while it is new). */
  doc: DualWith;
  kindName: string;
};

/** The bar's last word: both done, or which page was refused and why. */
type Outcome = { ok: boolean; text: string; problems: string[] };

/** Scrolling together or apart, kept per browser (together where nothing is kept). */
const SCROLL_KEY = "kz-dual-scroll";
const scrollListeners = new Set<() => void>();
const readScroll = () => {
  try {
    return window.localStorage.getItem(SCROLL_KEY) !== "apart";
  } catch {
    return true;
  }
};
const subscribeScroll = (listener: () => void) => {
  scrollListeners.add(listener);
  return () => {
    scrollListeners.delete(listener);
  };
};
const keepScroll = (together: boolean) => {
  try {
    window.localStorage.setItem(SCROLL_KEY, together ? "together" : "apart");
  } catch {
    // A browser that keeps nothing scrolls together each time.
  }
  for (const listener of scrollListeners) listener();
};

/**
 * Dual page (D412, `docs/dual-page.md`): two of the builder's documents side by side, each in its own editor, inside one frame with
 * one drag and drop. Save both and Publish both act on the two; the sidebars, the bar, undo and the rest act on the page last
 * pointed at. Publishing saves both as drafts first, so either one's refusal leaves nothing published.
 */
export function DualPageEditor({
  left,
  right,
  leftBase,
  closeHref,
  site,
}: {
  left: DualDoc;
  right: DualDoc;
  /** Where the left document's editor is (`/admin/{store}/pages`): its address is this and its id, or `/new`. */
  leftBase: string;
  /** The left document alone, where Close goes. */
  closeHref: string;
  /** The site's CSS, one for both pages (the same site), and how its panel saves it. */
  site: { css: string; name: string; save: ComponentProps<typeof CssPanel>["saveSiteCss"]; versions: ComponentProps<typeof CssPanel>["versions"] };
}) {
  const w = useAdminText("builder");
  const dw = w.dual;
  const [active, setActive] = useState<DualSide>("left");
  const handles = useRef<Partial<Record<DualSide, DualEditorHandle>>>({});
  const [states, setStates] = useState<Partial<Record<DualSide, DualEditorState>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [asking, setAsking] = useState<{ side: DualSide; issues: PageIssue[] }[] | null>(null);
  // The checker's problems the person chose to publish with, per page, kept while the frame is open (asked once each).
  const acknowledged = useRef<Record<DualSide, string[]>>({ left: [], right: [] });
  const router = useRouter();
  const together = useSyncExternalStore(subscribeScroll, readScroll, () => true);
  const [cssSide, setCssSide] = useState<DualSide | null>(null);
  const [siteCss, setSiteCss] = useState(site.css);
  // The ids of pages new when the frame opened, once saved: the address is written with them.
  const [ids, setIds] = useState<Record<DualSide, string | null>>({ left: left.doc.id, right: right.doc.id });

  const register = useCallback((side: DualSide, handle: DualEditorHandle) => {
    handles.current[side] = handle;
    return () => {
      if (handles.current[side] === handle) delete handles.current[side];
    };
  }, []);
  const onState = useCallback((side: DualSide, state: DualEditorState) => setStates((now) => ({ ...now, [side]: state })), []);
  const onParts = useCallback((side: DualSide, next: SavedPart[]) => handles.current[otherSide(side)]?.takeParts(next), []);
  const name = (side: DualSide) => states[side]?.name ?? (side === "left" ? dw.leftPage : dw.rightPage);

  // The address keeps both (D412): a new page saved for the first time is written in with its id, without leaving the frame.
  const onCreated = useCallback((side: DualSide, id: string) => setIds((now) => ({ ...now, [side]: id })), []);
  useEffect(() => {
    const leftPath = `${leftBase}/${ids.left ?? "new"}`;
    const withDoc: DualWith = right.doc.kind === "template" ? right.doc : ids.right ? { kind: right.doc.kind, id: ids.right } : { kind: right.doc.kind, id: null };
    const next = `${leftPath}?with=${encodeURIComponent(formatDualWith(withDoc))}`;
    if (`${window.location.pathname}${window.location.search}` !== next) window.history.replaceState(window.history.state, "", next);
  }, [ids, leftBase, right.doc]);

  // Scrolling together (D412): the other canvas follows by pixels from the top; a scroll the frame made itself is not followed back.
  useEffect(() => {
    if (!together) return;
    const frame = document.querySelector<HTMLElement>("[data-dual-page]");
    if (!frame) return;
    let echo: Element | null = null;
    const onScroll = (event: Event) => {
      const from = event.target;
      if (!(from instanceof HTMLElement)) return;
      const side = from.dataset.dualSide as DualSide | undefined;
      if (side !== "left" && side !== "right") return;
      if (echo === from) {
        echo = null;
        return;
      }
      const other = frame.querySelector<HTMLElement>(`[data-dual-side="${otherSide(side)}"]`);
      if (!other) return;
      const top = followScroll(from.scrollTop, other);
      if (Math.abs(other.scrollTop - top) < 1) return;
      echo = other;
      other.scrollTop = top;
    };
    frame.addEventListener("scroll", onScroll, true);
    return () => frame.removeEventListener("scroll", onScroll, true);
  }, [together]);

  const keepTogether = keepScroll;

  const saveBoth = async () => {
    setBusy(true);
    setOutcome(null);
    try {
      for (const side of ["left", "right"] as const) {
        const result = await handles.current[side]?.save(false);
        if (result && !result.ok) {
          setOutcome({ ok: false, text: fillWords(dw.notSaved, { page: name(side) }), problems: result.problems });
          return;
        }
      }
      setOutcome({ ok: true, text: dw.savedBoth, problems: [] });
    } finally {
      setBusy(false);
    }
  };

  /**
   * Publish both (D412 question 5): the checker's questions for both first, in one dialog; then both saved as drafts, which runs every
   * check the server makes, so a refusal leaves nothing published; then both published.
   */
  const publishBoth = async (acknowledged?: Record<DualSide, string[]>) => {
    if (!acknowledged) {
      const asks = (["left", "right"] as const).map((side) => ({ side, issues: handles.current[side]?.blocking() ?? [] })).filter((ask) => ask.issues.length > 0);
      if (asks.length > 0) {
        setAsking(asks);
        return;
      }
    }
    setBusy(true);
    setOutcome(null);
    try {
      for (const side of ["left", "right"] as const) {
        const draft = await handles.current[side]?.save(false);
        if (draft && !draft.ok) {
          setOutcome({ ok: false, text: fillWords(dw.notPublished, { page: name(side) }), problems: draft.problems });
          return;
        }
      }
      let published: DualSide | null = null;
      for (const side of ["left", "right"] as const) {
        const result = await handles.current[side]?.save(true, acknowledged?.[side]);
        if (result && !result.ok) {
          // A question the server found that the editor did not: asked now, for this page, while nothing is published yet.
          if (result.issues && published === null) {
            setAsking([{ side, issues: result.issues }]);
            return;
          }
          const problems = result.problems.length > 0 ? result.problems : (result.issues ?? []).map((issue) => `${issue.where}: ${issue.message}`);
          setOutcome({
            ok: false,
            text: published ? fillWords(dw.halfPublished, { published: name(published), other: name(side) }) : fillWords(dw.notPublished, { page: name(side) }),
            problems,
          });
          return;
        }
        published = side;
      }
      setOutcome({ ok: true, text: dw.publishedBoth, problems: [] });
    } finally {
      setBusy(false);
    }
  };

  const dirtyAny = Boolean(states.left?.dirty || states.right?.dirty);
  const close = () => {
    if (dirtyAny && !window.confirm(states.right?.dirty ? dw.closeUnsaved : dw.leaveUnsaved)) return;
    router.push(closeHref);
  };

  // Another second document, in place of this one: the frame is opened again with it (asking first about changes not saved).
  const openSecond = (doc: DualWith) => {
    if (dirtyAny && !window.confirm(dw.leaveUnsaved)) return;
    router.push(`${leftBase}/${ids.left ?? "new"}?with=${encodeURIComponent(formatDualWith(doc))}`);
  };

  const barStart = (
    <>
      <button
        type="button"
        onClick={() => void saveBoth()}
        disabled={busy}
        className="min-h-11 rounded-pill border border-edge px-4 font-medium disabled:opacity-50"
        data-dual-save=""
      >
        {dw.saveBoth}
      </button>
      <button
        type="button"
        onClick={() => void publishBoth()}
        disabled={busy}
        className="min-h-11 rounded-pill bg-brand px-5 font-medium text-brand-ink disabled:opacity-50"
        data-dual-publish=""
      >
        {busy ? dw.saving : dw.publishBoth}
      </button>
      <span className="text-sm text-muted">
        {dw.editing}: <strong className="font-medium text-ink">{name(active)}</strong>
      </span>
    </>
  );

  const editorDual = (side: DualSide) => ({
    side,
    active: active === side,
    onActivate: () => setActive(side),
    onClose: side === "right" ? close : null,
    barStart,
    saveBoth: () => void saveBoth(),
    openCss: () => setCssSide(side),
    siteCss,
    register,
    onState,
    onCreated,
    onParts,
    kindName: (side === "left" ? left : right).kindName,
    openSecond,
    dirtyAny,
    ids: [ids.left, ids.right],
  });

  const cssState = cssSide ? states[cssSide] : undefined;
  return (
    <DualFrame
      active={active}
      toolbar={
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={together} onChange={(event) => keepTogether(event.target.checked)} className="size-4" data-dual-scroll="" />
            {dw.scrollTogether}
          </label>
          {outcome && (
            <div role={outcome.ok ? "status" : "alert"} className={`text-sm ${outcome.ok ? "text-ink" : "text-danger-text"}`}>
              <p className="font-medium">{outcome.text}</p>
              {outcome.problems.length > 0 && (
                <ul className="list-disc pl-5">
                  {outcome.problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      }
    >
      <PageEditor {...left.props} dual={editorDual("left")} />
      <PageEditor key={`${right.doc.kind}:${right.doc.id ?? "new"}`} {...right.props} dual={editorDual("right")} />
      {cssSide && cssState && (
        <CssPanel
          open
          onClose={() => setCssSide(null)}
          noun={cssState.noun}
          siteName={site.name}
          pageCss={cssState.css}
          onPageCss={(css) => handles.current[cssSide]?.setCss(css)}
          siteCss={siteCss}
          onSiteCss={setSiteCss}
          saveSiteCss={site.save}
          versions={site.versions}
          classNames={cssState.classNames}
          pageSide={{ value: cssSide, onChange: setCssSide, label: dw.whichPage, left: dw.leftPage, right: dw.rightPage }}
        />
      )}
      {asking && (
        <PublishWithIssuesDialog
          issues={asking.flatMap(({ side, issues }) => issues.map((issue) => ({ ...issue, where: `${name(side)}: ${issue.where}` })))}
          busy={busy}
          onFixFirst={() => setAsking(null)}
          onPublishAnyway={() => {
            const seen = { ...acknowledged.current };
            for (const { side, issues } of asking) seen[side] = [...new Set([...seen[side], ...issues.map(issueId)])];
            acknowledged.current = seen;
            setAsking(null);
            void publishBoth(seen);
          }}
        />
      )}
    </DualFrame>
  );
}
