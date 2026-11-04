"use client";

import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { DOCS_GUIDE_STORAGE_KEY, GUIDE_MESSAGE_MAX, type GuideLang } from "@/lib/docs-guide-shape";
import { DOCS_ASK_EVENT } from "@/lib/docs-search";
import type { PlatformMessages } from "@/lib/platform-text";

/** The guide's words, in the page's language. */
export type DocsGuideWords = PlatformMessages["docs"]["guide"];

/** The panel itself: its code is fetched only when a reader opens the guide, so a docs page loads none of it first (D336). */
const DocsGuidePanel = lazy(() => import("./docs-guide-panel"));

const never = () => () => {};

/** Whether the tab left the guide open on the page before (a link it followed, a page it opened), so it opens again here. */
function leftOpen(): boolean {
  try {
    const stored = JSON.parse(sessionStorage.getItem(DOCS_GUIDE_STORAGE_KEY) ?? "null") as { open?: unknown } | null;
    return stored?.open === true;
  } catch {
    return false;
  }
}

/**
 * The docs guide's button in the top bar (wave 14 unit E5, D444). It opens the guide's panel, as does a search that found nothing (*Ask the
 * AI guide*, `DOCS_ASK_EVENT` with the question, from the search dialog) and the front page's `?ask=` (the search page's offer, which works
 * without the dialog); the question is filled in, never sent for the reader. The panel's code loads when it first opens. Without JavaScript
 * the guide cannot answer, so the button is shown switched off until the page's script runs.
 */
export function DocsGuide({
  lang,
  homeHref,
  searchHref,
  supportHref,
  words,
}: {
  lang: GuideLang;
  homeHref: string;
  searchHref: string;
  /** Kaizena Flow's support in the admin, offered when the guide is not answering. */
  supportHref: string;
  words: DocsGuideWords;
}) {
  const enhanced = useSyncExternalStore(never, () => true, () => false);
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState<{ question: string; n: number }>({ question: "", n: 0 });
  const button = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const show = (question: string) => {
      if (document.activeElement instanceof HTMLElement && !document.activeElement.closest("[data-docs-guide-panel]")) opener.current = document.activeElement;
      setAsk((current) => ({ question: question.slice(0, GUIDE_MESSAGE_MAX), n: current.n + 1 }));
      setOpen(true);
    };
    const onAsk = (event: Event) => {
      const detail = (event as CustomEvent<{ question?: unknown }>).detail;
      show(typeof detail?.question === "string" ? detail.question : "");
    };
    window.addEventListener(DOCS_ASK_EVENT, onAsk);
    // The search page's offer (`?ask=`, without the dialog) and a guide left open on the page before. The address keeps no question.
    const params = new URLSearchParams(window.location.search);
    const asked = params.get("ask");
    if (asked !== null) {
      params.delete("ask");
      const rest = params.toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
      show(asked);
    } else if (leftOpen()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the tab's own record, read only in the browser, opens the guide again.
      setOpen(true);
    }
    return () => window.removeEventListener(DOCS_ASK_EVENT, onAsk);
  }, []);

  const close = () => {
    setOpen(false);
    // Back where the reader was; when that is gone (the search dialog that asked closes), to the guide's own button.
    (opener.current?.isConnected ? opener.current : button.current)?.focus();
    opener.current = null;
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        disabled={!enhanced}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          opener.current = button.current;
          setOpen((now) => !now);
        }}
        className="flex min-h-10 items-center rounded-full border border-border px-3 text-sm hover:bg-surface disabled:opacity-60 print:hidden"
      >
        {words.open}
      </button>
      {open && (
        <Suspense
          fallback={
            <p role="status" className="fixed right-4 bottom-4 z-50 rounded-full border border-border bg-background px-4 py-2 text-sm shadow-lg">
              {words.loading}
            </p>
          }
        >
          <DocsGuidePanel lang={lang} homeHref={homeHref} searchHref={searchHref} supportHref={supportHref} words={words} ask={ask} onClose={close} />
        </Suspense>
      )}
    </>
  );
}
