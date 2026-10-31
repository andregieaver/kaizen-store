"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { focusAiComposer } from "@/lib/ai-composer";
import { pageName, parseRecent, rememberPage } from "@/lib/recent-pages";
import type { ConversationSummary } from "@/server/owner-assistant";

import { AiManagerChat, MicIcon, type Abilities, type AiManagerActions } from "./ai-manager";
import { unlockVoiceAudio } from "./voice-mode";
import { useAdminText } from "./admin-text";
import { ASK_AI_MANAGER_EVENT, type AskDetail } from "@/lib/alert-ask";

import { NoticeBadge, NoticeList, useNoticeCount } from "./ai-notices";

export type AiManagerStart = () => Promise<{ abilities: Abilities; conversations: ConversationSummary[] }>;

function Spark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
    </svg>
  );
}

/**
 * The AI manager's launcher (D103): a button in the admin's header and
 * ⌘K / Ctrl+K anywhere in the admin open the AI manager as a panel at the
 * side. The panel is not modal: the page stays usable beside it, pages the
 * AI manager opens load behind it, and the conversation carries on across
 * pages. Escape closes it.
 */
export function AiManagerLauncher({
  area,
  base,
  siteName,
  settingsHref,
  start,
  actions,
}: {
  area: "store" | "platform";
  base: string;
  siteName: string;
  settingsHref: string;
  start: AiManagerStart;
  actions: AiManagerActions;
}) {
  const pathname = usePathname();
  const w = useAdminText("assistant");
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState<Awaited<ReturnType<AiManagerStart>> | null>(null);
  /** Counts the microphone's clicks: each asks the panel to start voice mode. */
  const [talk, setTalk] = useState(0);
  /** An alert handed over (D348): its first message, counted per press so the same one can be asked again. */
  const [ask, setAsk] = useState<{ text: string; n: number } | undefined>(undefined);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const onItsPage = pathname === base;
  // The pages opened last in this level (PSI UX-06), kept in this browser only: offered at the top of the panel.
  const recentKey = `kz-recent:${base}`;
  useEffect(() => {
    // The title follows the page a moment after the address does.
    const timer = window.setTimeout(() => {
      try {
        const kept = parseRecent(window.localStorage.getItem(recentKey));
        window.localStorage.setItem(recentKey, JSON.stringify(rememberPage(kept, { path: pathname, title: pageName(document.title) })));
      } catch {
        // No storage (a private window, blocked site data): nothing is kept.
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [pathname, recentKey]);
  // What it finished or waits on while the person was away (D350): this place's notices, counted on the button and listed in the panel.
  const place = base.split("/")[2] ?? "platform";
  const [unread, recount] = useNoticeCount(place);
  const [showNotices, setShowNotices] = useState(false);

  const openRef = useRef(false);
  const startedRef = useRef(false);
  const toggle = useCallback(
    (next?: boolean) => {
      const value = next ?? !openRef.current;
      openRef.current = value;
      setOpen(value);
      if (value && !startedRef.current) {
        startedRef.current = true;
        start()
          .then(setReady)
          .catch(() => {
            startedRef.current = false;
          });
      }
    },
    [start],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (onItsPage) {
          focusAiComposer();
          return;
        }
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, onItsPage]);

  // An alert's *Ask the AI manager* (D348): the page is marked while the launcher is on it, and a press opens the panel with the alert's message.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.aiManager = "on";
    const onAsk = (event: Event) => {
      const message = (event as CustomEvent<AskDetail>).detail?.message;
      if (typeof message !== "string" || !message.trim()) return;
      setAsk((prev) => ({ text: message, n: (prev?.n ?? 0) + 1 }));
      if (onItsPage) {
        focusAiComposer();
        return;
      }
      toggle(true);
    };
    window.addEventListener(ASK_AI_MANAGER_EVENT, onAsk);
    return () => {
      window.removeEventListener(ASK_AI_MANAGER_EVENT, onAsk);
      delete root.dataset.aiManager;
    };
  }, [toggle, onItsPage]);

  // Focus the message box when the panel opens.
  useEffect(() => {
    if (open && ready) inputRef.current?.focus();
  }, [open, ready]);

  const closeOnPhones = () => {
    if (window.matchMedia("(max-width: 639px)").matches) toggle(false);
  };

  const panel =
    open && !onItsPage ? (
      <aside
        aria-label={w.name}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            toggle(false);
            buttonRef.current?.focus();
          }
        }}
        className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-card shadow-2xl sm:w-[28rem]"
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Spark className="size-5" />
          <h2 className="text-title text-ink">{w.name}</h2>
          <span className="truncate text-sm text-muted">{siteName}</span>
          <button
            type="button"
            onClick={() => setShowNotices((on) => !on)}
            aria-pressed={showNotices}
            className="ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-pill px-3 text-sm hover:bg-sunken aria-pressed:bg-sunken"
          >
            {w.notices.button}
            <NoticeBadge count={unread} />
          </button>
          <button
            type="button"
            onClick={() => {
              toggle(false);
              buttonRef.current?.focus();
            }}
            className="flex size-9 items-center justify-center rounded-pill hover:bg-sunken"
            aria-label={w.launcher.close}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {showNotices && (
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <NoticeList
              place={place}
              onChange={recount}
              onOpen={() => {
                setShowNotices(false);
                closeOnPhones();
              }}
            />
          </div>
        )}
        <div className={showNotices ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
        <RecentPages storageKey={recentKey} current={pathname} label={w.launcher.recent} onOpen={closeOnPhones} />
        {ready ? (
          <AiManagerChat
            area={area}
            base={base}
            siteName={siteName}
            settingsHref={settingsHref}
            abilities={ready.abilities}
            conversations={ready.conversations}
            conversation={null}
            actions={actions}
            variant="panel"
            inputRef={inputRef}
            onNavigate={closeOnPhones}
            startVoice={talk}
            ask={ask}
          />
        ) : (
          <p className="p-4 text-sm text-muted" role="status">
            {w.launcher.loading}
          </p>
        )}
        </div>
      </aside>
    ) : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => toggle()}
        aria-expanded={open && !onItsPage}
        aria-keyshortcuts="Meta+K Control+K"
        title={w.launcher.title}
        className="inline-flex min-h-9 items-center gap-2 rounded-full bg-brand px-3 text-sm font-medium text-brand-ink hover:opacity-90"
      >
        <Spark className="size-4" />
        <span className="sr-only sm:not-sr-only">{w.name}</span>
        <NoticeBadge count={unread} />
        <kbd className="hidden rounded border border-card/30 px-1 font-sans text-xs opacity-80 md:inline">⌘K</kbd>
      </button>
      {!onItsPage && (
        <button
          type="button"
          onClick={() => {
            // Sound is allowed only from a click: unlock it now, before the panel loads.
            unlockVoiceAudio();
            setTalk((n) => n + 1);
            toggle(true);
          }}
          title={w.launcher.talkTitle}
          aria-label={w.launcher.talk}
          className="inline-flex size-9 items-center justify-center rounded-full border border-edge hover:bg-sunken"
        >
          <MicIcon className="size-4" />
        </button>
      )}
      {/* Only open after a click, so only in the browser: drawn over the page from the body. */}
      {panel ? createPortal(panel, document.body) : null}
    </>
  );
}

/** The pages opened last, the one on screen left out: read from this browser when the panel is drawn (only ever after a click). */
function RecentPages({ storageKey, current, label, onOpen }: { storageKey: string; current: string; label: string; onOpen: () => void }) {
  let pages: { path: string; title: string }[] = [];
  try {
    pages = parseRecent(window.localStorage.getItem(storageKey)).filter((page) => page.path !== current);
  } catch {
    pages = [];
  }
  if (pages.length === 0) return null;
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2 text-sm">
      <span className="text-muted">{label}:</span>
      {pages.map((page) => (
        <Link key={page.path} href={page.path} onClick={onOpen} className="inline-flex min-h-8 items-center rounded-pill px-2.5 hover:bg-sunken">
          {page.title}
        </Link>
      ))}
    </nav>
  );
}
