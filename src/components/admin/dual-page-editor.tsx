"use client";

import { ArrowLeftRight, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ComponentProps } from "react";

import {
  closeHalf,
  dualHref,
  followScroll,
  followScrollShare,
  formatDualSecond,
  openIn,
  otherSide,
  shownAt,
  type DualChoice,
  type DualKind,
  type DualLayout,
  type DualSide,
  type DualWith,
} from "@/lib/dual-page";
import { issueId, type PageIssue } from "@/lib/page-a11y";
import type { SavedPart } from "@/lib/saved-parts";
import { fillWords } from "@/lib/admin-fill";

import { useAdminText } from "./admin-text";
import { CssPanel } from "./css-panel";
import { DualCreateDialog, DualOpenDialog } from "./dual-page-dialogs";
import { DualFrame, DualHalf } from "./page-builder";
import { PageEditor, type DualEditorHandle, type DualEditorState } from "./page-editor";
import { PublishWithIssuesDialog } from "./page-issues-panel";
import { PAGE_TYPE_COPY } from "./page-type-copy";

type EditorProps = Omit<ComponentProps<typeof PageEditor>, "dual">;

/** One of the two documents: its editor's props, what the address calls it, and how the frame names its kind. */
export type DualDoc = {
  props: EditorProps;
  /** The document as the address holds it: its kind and id (null while it is new). */
  doc: DualWith;
  kindName: string;
};

/** What a half with no document offers (D424): the site's documents by kind, what can be made, and the saved templates. */
export type DualPick = {
  kinds: readonly DualKind[];
  create: readonly DualKind[];
  choices: (kind: DualKind) => Promise<DualChoice[]>;
  templates: readonly { id: string; name: string }[];
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

/** What scrolls a half's page: a device's screen in responsive mode (D179), where the page scrolls inside it, else the half itself. */
const scrollerOf = (half: HTMLElement) => half.querySelector<HTMLElement>("[data-builder-frame]") ?? half;

const BOTH: readonly DualSide[] = ["left", "right"];

/**
 * Dual page (D412, D424, `docs/dual-page.md`): two of the builder's documents side by side, each in its own editor, inside one frame with
 * one drag and drop; or one document drawn twice, at two screen sizes, in one editor. Save both and Publish both act on what is open; the
 * sidebars, the bar, undo and the rest act on the page last pointed at. Publishing saves both as drafts first, so either one's refusal
 * leaves nothing published. Either half can be closed, and another document opened in it; the halves can be swapped and their widths
 * dragged, all kept in the address.
 */
export function DualPageEditor({
  left,
  right,
  layout: asked,
  root,
  pick,
  site,
}: {
  /** The address's own document. */
  left: DualDoc;
  /** The second document; null where the second half is empty or draws the first again. */
  right: DualDoc | null;
  /** What the address asked to show (D424). */
  layout: DualLayout;
  /** The site's admin (`/admin/{store}`, `/admin/platform`): each kind's editor is under it. */
  root: string;
  pick: DualPick;
  /** The site's CSS, one for both pages (the same site), and how its panel saves it. */
  site: { css: string; name: string; save: ComponentProps<typeof CssPanel>["saveSiteCss"]; versions: ComponentProps<typeof CssPanel>["versions"] };
}) {
  const w = useAdminText("builder");
  const dw = w.dual;
  const router = useRouter();
  const base = useCallback((kind: DualKind) => `${root}/${PAGE_TYPE_COPY[kind].segment}`, [root]);
  // What is shown, as the address asked; a new address (another document opened in a half) asks again.
  const [layout, setLayout] = useState(asked);
  const askedHref = dualHref(base, asked);
  const [seen, setSeen] = useState(askedHref);
  if (askedHref !== seen) {
    setSeen(askedHref);
    setLayout(asked);
  }
  const mirror = layout.second === "mirror";
  const open: Record<DualSide, boolean> = { left: layout.firstOpen, right: typeof layout.second === "object" && right !== null };
  const [active, setActive] = useState<DualSide>(layout.firstOpen ? "left" : "right");
  const shownActive: DualSide = open[active] ? active : otherSide(active);
  // Each open editor's way in (save, checker, CSS), as it registers itself; read only in handlers, never while drawing.
  const [handles] = useState(() => new Map<DualSide, DualEditorHandle>());
  const [states, setStates] = useState<Partial<Record<DualSide, DualEditorState>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [asking, setAsking] = useState<{ side: DualSide; issues: PageIssue[] }[] | null>(null);
  // The checker's problems the person chose to publish with, per page, kept while the frame is open (asked once each).
  const acknowledged = useRef<Record<DualSide, string[]>>({ left: [], right: [] });
  const together = useSyncExternalStore(subscribeScroll, readScroll, () => true);
  const [cssSide, setCssSide] = useState<DualSide | null>(null);
  const [siteCss, setSiteCss] = useState(site.css);
  // A half with no document, asked to open one: by choosing one, or by making a new one.
  const [picking, setPicking] = useState<{ side: DualSide; how: "open" | "create" } | null>(null);
  const openSides = BOTH.filter((side) => open[side]);

  const register = useCallback(
    (side: DualSide, handle: DualEditorHandle) => {
      handles.set(side, handle);
      return () => {
        if (handles.get(side) === handle) handles.delete(side);
      };
    },
    [handles],
  );
  const onState = useCallback((side: DualSide, state: DualEditorState) => setStates((now) => ({ ...now, [side]: state })), []);
  const onParts = useCallback((side: DualSide, next: SavedPart[]) => handles.get(otherSide(side))?.takeParts(next), [handles]);
  // Named by where it is drawn, which changes with a swap.
  const placeName = (side: DualSide) => (shownAt(side, layout.swap) === "left" ? dw.leftPage : dw.rightPage);
  const name = (side: DualSide) => states[side]?.name ?? placeName(side);

  // The address keeps what is shown (D412, D424): a new page saved for the first time is written in with its id, without leaving.
  const onCreated = useCallback((side: DualSide, id: string) => {
    setLayout((now) => {
      if (side === "left") return { ...now, first: { ...now.first, id } };
      return typeof now.second === "object" && now.second.kind !== "template" ? { ...now, second: { ...now.second, id } } : now;
    });
  }, []);
  // Written with the router's own history state, so the router stays on the route it drew (a save's refresh draws that route again, never
  // the new address's, which would draw both editors afresh mid-save); after each refresh the router writes back the address it drew, so
  // the frame writes its own again, once the server has drawn the frame again (`asked` is new then).
  useEffect(() => {
    const next = dualHref(base, layout);
    if (`${window.location.pathname}${window.location.search}` !== next) window.history.replaceState(window.history.state, "", next);
  }, [base, layout, asked]);

  // Scrolling together (D412): the other half follows by pixels from the top, or, where either page scrolls inside a device's screen or
  // one document is drawn twice at two sizes (D424), by how far through its page it is. A scroll the frame made itself is not followed.
  useEffect(() => {
    if (!together) return;
    const frame = document.querySelector<HTMLElement>("[data-dual-page]");
    if (!frame) return;
    let echo: Element | null = null;
    const onScroll = (event: Event) => {
      const from = event.target;
      if (!(from instanceof HTMLElement)) return;
      const half = from.closest<HTMLElement>("[data-dual-side]");
      const side = half?.dataset.dualSide;
      if (!half || (side !== "left" && side !== "right") || scrollerOf(half) !== from) return;
      if (echo === from) {
        echo = null;
        return;
      }
      const otherHalf = frame.querySelector<HTMLElement>(`[data-dual-side="${otherSide(side)}"]`);
      if (!otherHalf) return;
      const other = scrollerOf(otherHalf);
      const byShare = mirror || from !== half || other !== otherHalf;
      const top = byShare ? followScrollShare(from, other) : followScroll(from.scrollTop, other);
      if (Math.abs(other.scrollTop - top) < 1) return;
      echo = other;
      other.scrollTop = top;
    };
    frame.addEventListener("scroll", onScroll, true);
    return () => frame.removeEventListener("scroll", onScroll, true);
  }, [together, mirror]);

  const saveBoth = async () => {
    setBusy(true);
    setOutcome(null);
    try {
      for (const side of openSides) {
        const result = await handles.get(side)?.save(false);
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
      const asks = openSides.map((side) => ({ side, issues: handles.get(side)?.blocking() ?? [] })).filter((ask) => ask.issues.length > 0);
      if (asks.length > 0) {
        setAsking(asks);
        return;
      }
    }
    setBusy(true);
    setOutcome(null);
    try {
      for (const side of openSides) {
        const draft = await handles.get(side)?.save(false);
        if (draft && !draft.ok) {
          setOutcome({ ok: false, text: fillWords(dw.notPublished, { page: name(side) }), problems: draft.problems });
          return;
        }
      }
      let published: DualSide | null = null;
      for (const side of openSides) {
        const result = await handles.get(side)?.save(true, acknowledged?.[side]);
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

  const dirtyAny = openSides.some((side) => states[side]?.dirty);
  /** A half's document is gone from the frame: what it said of itself goes with it. */
  const forget = (sides: readonly DualSide[]) =>
    setStates((now) => {
      const next = { ...now };
      for (const side of sides) delete next[side];
      return next;
    });

  // A half closed (D424): empty, for another document. One document drawn twice stays, once; a closed document's changes are asked about.
  const close = (side: DualSide) => {
    if (!mirror && states[side]?.dirty && !window.confirm(dw.closeUnsaved)) return;
    setLayout((now) => closeHalf(now, side));
    if (!mirror) {
      forget([side]);
      setActive(otherSide(side));
    }
    setOutcome(null);
  };
  const closeBoth = () => {
    if (dirtyAny && !window.confirm(dw.closeBothUnsaved)) return;
    setLayout((now) => ({ ...now, firstOpen: false, second: "empty" }));
    forget(BOTH);
    setOutcome(null);
  };

  /**
   * Another layout, where opening a document needs the server: the address is asked for. A document still in place keeps what it holds
   * (the address's own, where it stays the address's own); one that goes or is drawn afresh asks first about changes not saved.
   */
  const go = (next: DualLayout | null) => {
    if (!next) return;
    const href = dualHref(base, next);
    if (next.second === "mirror" && layout.firstOpen && next.first.id === layout.first.id && next.first.kind === layout.first.kind) {
      // The first document drawn again: nothing to load.
      setLayout(next);
      return;
    }
    // Against the address the server drew (`seen`): a new page saved meanwhile has its id in the address, but is still drawn as new.
    const samePath = href.split("?")[0] === seen.split("?")[0];
    const secondChanges = formatDualSecond(next.second) !== formatDualSecond(layout.second);
    const losing = samePath ? Boolean(secondChanges && open.right && states.right?.dirty) : dirtyAny;
    if (losing && !window.confirm(dw.leaveUnsaved)) return;
    router.push(href);
  };
  const place = (side: DualSide, doc: DualWith | "mirror") => {
    setPicking(null);
    go(openIn(layout, side, doc));
  };
  // The editor's own *Open beside* and *Create new, side by side*: the second document replaced.
  const openSecond = (doc: DualWith) => place("right", doc);

  /** The document in the other half, where it is a page that can be drawn twice or worked on alone (not a saved template). */
  const pageIn = (side: DualSide): { kind: DualKind; id: string | null } | null => {
    if (side === "left") return layout.firstOpen ? layout.first : null;
    const second = layout.second;
    return typeof second === "object" && second.kind !== "template" && open.right ? second : null;
  };
  const alone = (side: DualSide) => {
    const doc = pageIn(side);
    if (!doc) return;
    if (dirtyAny && !window.confirm(dw.leaveUnsaved)) return;
    router.push(`${base(doc.kind)}/${doc.id ?? "new"}`);
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
        {dw.editing}: <strong className="font-medium text-ink">{name(shownActive)}</strong>
      </span>
    </>
  );

  const editorDual = (side: DualSide) => ({
    side,
    active: shownActive === side,
    onActivate: () => setActive(side),
    onClose: () => close(side),
    mirror: side === "left" && mirror ? { onClose: () => close("right") } : null,
    barStart,
    saveBoth: () => void saveBoth(),
    openCss: () => setCssSide(side),
    siteCss,
    register,
    onState,
    onCreated,
    onParts,
    kindName: (side === "left" ? left : (right ?? left)).kindName,
    openSecond,
    dirtyAny,
    ids: [layout.firstOpen ? layout.first.id : null, typeof layout.second === "object" && open.right ? layout.second.id : null],
  });

  const tool = "inline-flex min-h-9 items-center gap-2 rounded-pill border border-edge px-3 text-sm hover:bg-sunken";
  const cssState = cssSide ? states[cssSide] : undefined;
  const pickingBeside = picking ? pageIn(otherSide(picking.side)) : null;
  return (
    <DualFrame
      active={shownActive}
      swap={layout.swap}
      mirror={mirror}
      bare={openSides.length === 0}
      toolbar={
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div role="toolbar" aria-label={dw.frame} className="flex flex-wrap items-center gap-2">
            <button type="button" role="switch" aria-checked={together} onClick={() => keepScroll(!together)} className={`${tool} aria-checked:border-brand aria-checked:bg-sunken`} data-dual-scroll="">
              <span aria-hidden className={`flex h-4 w-7 items-center rounded-full p-0.5 ${together ? "justify-end bg-brand" : "justify-start bg-line"}`}>
                <span className="size-3 rounded-full bg-card" />
              </span>
              {dw.scrollTogether}
            </button>
            <button type="button" onClick={() => setLayout((now) => ({ ...now, swap: !now.swap }))} className={tool} data-dual-swap="">
              <ArrowLeftRight aria-hidden className="size-4" />
              {dw.swap}
            </button>
            {(open.left || open.right || mirror) && (
              <button type="button" onClick={closeBoth} className={tool} data-dual-close-both="">
                <X aria-hidden className="size-4" />
                {dw.closeBoth}
              </button>
            )}
          </div>
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
      {layout.firstOpen ? <PageEditor {...left.props} dual={editorDual("left")} /> : null}
      {open.right && right ? <PageEditor key={`${right.doc.kind}:${right.doc.id ?? "new"}`} {...right.props} dual={editorDual("right")} /> : null}
      {BOTH.filter((side) => !open[side] && !(side === "right" && mirror)).map((side) => {
        const beside = pageIn(otherSide(side));
        const besideName = beside ? name(otherSide(side)) : "";
        return (
          <DualHalf key={side} side={side}>
            <div
              className="flex min-w-0 flex-col items-center justify-center gap-4 rounded-panel border-2 border-dashed border-line px-6 py-12 text-center lg:h-full"
              data-dual-empty={side}
            >
              <h2 className="text-title text-ink">{dw.emptyTitle}</h2>
              <p className="max-w-sm text-sm text-muted">{dw.emptyText}</p>
              <div className="flex w-full max-w-xs flex-col gap-2">
                <button type="button" onClick={() => setPicking({ side, how: "open" })} aria-haspopup="dialog" className="min-h-11 rounded-pill bg-brand px-5 font-medium text-brand-ink">
                  {dw.openHere}
                </button>
                <button type="button" onClick={() => setPicking({ side, how: "create" })} aria-haspopup="dialog" className="min-h-11 rounded-pill border border-edge px-5 font-medium">
                  {dw.createHere}
                </button>
                {beside && (
                  <button type="button" onClick={() => place(side, "mirror")} className="min-h-11 rounded-pill border border-edge px-5 font-medium" data-dual-mirror-here="">
                    {fillWords(dw.mirrorHere, { page: besideName })}
                  </button>
                )}
                {beside && (
                  <button type="button" onClick={() => alone(otherSide(side))} className="min-h-11 px-5 text-sm underline">
                    {fillWords(dw.alone, { page: besideName })}
                  </button>
                )}
              </div>
            </div>
          </DualHalf>
        );
      })}
      <DualOpenDialog
        open={picking?.how === "open"}
        onClose={() => setPicking(null)}
        title={dw.openHereTitle}
        kinds={pick.kinds}
        choices={pick.choices}
        // The other half's document opens again at another size, with *… on a phone*; a second saved template cannot be opened.
        current={pickingBeside ? [pickingBeside.id] : []}
        onOpen={(doc) => picking && place(picking.side, doc)}
        templates={picking && typeof layout.second === "object" && layout.second.kind === "template" ? [] : pick.templates}
      />
      <DualCreateDialog
        open={picking?.how === "create"}
        onClose={() => setPicking(null)}
        kinds={pick.create}
        onSideBySide={(kind) => picking && place(picking.side, { kind, id: null })}
      />
      {cssSide && cssState && (
        <CssPanel
          open
          onClose={() => setCssSide(null)}
          noun={cssState.noun}
          siteName={site.name}
          pageCss={cssState.css}
          onPageCss={(css) => handles.get(cssSide)?.setCss(css)}
          siteCss={siteCss}
          onSiteCss={setSiteCss}
          saveSiteCss={site.save}
          versions={site.versions}
          classNames={cssState.classNames}
          pageSide={
            openSides.length === 2
              ? {
                  value: shownAt(cssSide, layout.swap),
                  onChange: (place) => setCssSide(shownAt(place, layout.swap)),
                  label: dw.whichPage,
                  left: dw.leftPage,
                  right: dw.rightPage,
                }
              : undefined
          }
        />
      )}
      {asking && (
        <PublishWithIssuesDialog
          issues={asking.flatMap(({ side, issues }) => issues.map((issue) => ({ ...issue, where: `${name(side)}: ${issue.where}` })))}
          busy={busy}
          onFixFirst={() => setAsking(null)}
          onPublishAnyway={() => {
            const seenIds = { ...acknowledged.current };
            for (const { side, issues } of asking) seenIds[side] = [...new Set([...seenIds[side], ...issues.map(issueId)])];
            acknowledged.current = seenIds;
            setAsking(null);
            void publishBoth(seenIds);
          }}
        />
      )}
    </DualFrame>
  );
}
