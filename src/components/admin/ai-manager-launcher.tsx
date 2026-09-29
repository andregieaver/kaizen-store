"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { ConversationSummary } from "@/server/owner-assistant";

import { AiManagerChat, type Abilities, type AiManagerActions } from "./ai-manager";

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
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState<Awaited<ReturnType<AiManagerStart>> | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const onItsPage = pathname === base;

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
          document.querySelector<HTMLTextAreaElement>("textarea[placeholder^='Ask or tell']")?.focus();
          return;
        }
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
        aria-label="AI manager"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            toggle(false);
            buttonRef.current?.focus();
          }
        }}
        className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-background shadow-2xl sm:w-[28rem]"
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Spark className="size-5" />
          <h2 className="font-semibold">AI manager</h2>
          <span className="truncate text-sm text-muted">{siteName}</span>
          <button
            type="button"
            onClick={() => {
              toggle(false);
              buttonRef.current?.focus();
            }}
            className="ml-auto flex size-9 items-center justify-center rounded-md hover:bg-surface"
            aria-label="Close the AI manager"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
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
          />
        ) : (
          <p className="p-4 text-sm text-muted" role="status">
            Loading …
          </p>
        )}
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
        title="AI manager (⌘K / Ctrl+K)"
        className="inline-flex min-h-9 items-center gap-2 rounded-full bg-foreground px-3 text-sm font-medium text-background hover:opacity-90"
      >
        <Spark className="size-4" />
        <span className="sr-only sm:not-sr-only">AI manager</span>
        <kbd className="hidden rounded border border-background/30 px-1 font-sans text-xs opacity-80 md:inline">⌘K</kbd>
      </button>
      {/* Only open after a click, so only in the browser: drawn over the page from the body. */}
      {panel ? createPortal(panel, document.body) : null}
    </>
  );
}
