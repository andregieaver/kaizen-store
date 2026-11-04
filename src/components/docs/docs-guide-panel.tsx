"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

import { fillWords } from "@/lib/admin-fill";
import { avatarFrameStyle, cleanAvatarStyle } from "@/lib/chat-avatar";
import {
  DOCS_GUIDE_ENDPOINT,
  DOCS_GUIDE_STORAGE_KEY,
  GUIDE_MESSAGE_MAX,
  type GuideConversationRef,
  type GuideLang,
  type GuideMessage,
  type GuideProfile,
  type GuideTurnAnswer,
} from "@/lib/docs-guide-shape";

import type { DocsGuideWords } from "./docs-guide";

/** What the tab keeps of its conversation (sessionStorage): its reference, what it has shown, and whether the guide is open. */
type Stored = { v: 1; ref: GuideConversationRef | null; messages: GuideMessage[]; open: boolean };

const EMPTY: Stored = { v: 1, ref: null, messages: [], open: false };
/** Messages the tab keeps to draw again after a page change. */
const KEPT = 40;

function readStored(): Stored {
  try {
    const value = JSON.parse(sessionStorage.getItem(DOCS_GUIDE_STORAGE_KEY) ?? "null") as Partial<Stored> | null;
    if (!value || value.v !== 1 || !Array.isArray(value.messages)) return EMPTY;
    const ref = value.ref && typeof value.ref.id === "string" && typeof value.ref.token === "string" ? value.ref : null;
    return { v: 1, ref, messages: value.messages.slice(-KEPT), open: value.open === true };
  } catch {
    return EMPTY;
  }
}

function writeStored(stored: Stored): void {
  try {
    sessionStorage.setItem(DOCS_GUIDE_STORAGE_KEY, JSON.stringify({ ...stored, messages: stored.messages.slice(-KEPT) }));
  } catch {
    // A tab that keeps nothing still talks; it only forgets on the next page.
  }
}

/** The docs page this is, as the guide names it (`owners/…/slug`), from the address and where the docs start on this host. */
function pageOf(homeHref: string): string {
  const base = homeHref.replace(/\/+$/, "");
  const path = window.location.pathname.replace(/\/+$/, "");
  const rest = path.startsWith(base) ? path.slice(base.length) : path;
  const page = rest.replace(/^\/+/, "");
  return /^(?:[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*){0,4})?$/.test(page) ? page : "";
}

const merge = (now: readonly GuideMessage[], more: readonly GuideMessage[]) => {
  const bySeq = new Map(now.map((m) => [m.seq, m]));
  for (const m of more) bySeq.set(m.seq, m);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
};

/**
 * The docs guide's panel (wave 14 unit E5, D444), loaded only when a reader opens the guide: a dialog beside the page (not modal, so the
 * page stays readable and its links work), in the docs' own look, light and dark. It says first that an AI answers from the docs and how long
 * the conversation is kept; its messages are a polite live log; the guide's words are drawn as text, never as HTML, with the pages it used as
 * links under them and Kaizena Flow's support when the docs do not cover a question, both drawn from data. Esc or the close button closes it
 * and the focus goes back. The tab keeps the conversation's reference and a copy, so the guide opens again where it was after a page change.
 */
export default function DocsGuidePanel({
  lang,
  homeHref,
  searchHref,
  supportHref,
  words,
  ask,
  onClose,
}: {
  lang: GuideLang;
  homeHref: string;
  searchHref: string;
  /** Kaizena Flow's support in the admin, offered when the guide is not answering. */
  supportHref: string;
  words: DocsGuideWords;
  ask: { question: string; n: number };
  onClose: () => void;
}) {
  const ids = { title: useId(), field: useId(), notice: useId() };
  const [profile, setProfile] = useState<GuideProfile | null | "failed">(null);
  const [stored, setStored] = useState<Stored>(EMPTY);
  const [draft, setDraft] = useState(ask.question);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLOListElement>(null);
  const asked = useRef(ask.n);

  const keep = useCallback((next: Stored) => {
    setStored(next);
    writeStored(next);
  }, []);

  // The tab's copy, read in the browser only, and the guide's profile.
  useEffect(() => {
    const kept = { ...readStored(), open: true };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the tab's own copy exists only in the browser.
    keep(kept);
    let live = true;
    fetch(`${DOCS_GUIDE_ENDPOINT}?lang=${lang}`, { headers: { accept: "application/json" } })
      .then((response) => (response.ok ? (response.json() as Promise<GuideProfile>) : Promise.reject(new Error(String(response.status)))))
      .then((value) => live && setProfile(value))
      .catch(() => live && setProfile("failed"));
    field.current?.focus();
    return () => {
      live = false;
    };
  }, [keep, lang]);

  // A question asked again while the panel is open (another search that found nothing) is filled in.
  useEffect(() => {
    if (ask.n === asked.current) return;
    asked.current = ask.n;
    setDraft(ask.question);
    field.current?.focus();
  }, [ask]);

  useEffect(() => {
    log.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [stored.messages.length]);

  const close = () => {
    writeStored({ ...stored, open: false });
    onClose();
  };

  const startOver = () => {
    keep({ v: 1, ref: null, messages: [], open: true });
    setStatus("");
    field.current?.focus();
  };

  const send = async () => {
    const message = draft.trim().slice(0, GUIDE_MESSAGE_MAX);
    if (!message || busy) return;
    setBusy(true);
    setStatus(words.thinking);
    const after = stored.messages.at(-1)?.seq ?? 0;
    try {
      const response = await fetch(DOCS_GUIDE_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ message, lang, page: pageOf(homeHref), after: stored.ref ? after : 0, ...(stored.ref && { conversation: stored.ref }) }),
      });
      const body = (await response.json().catch(() => ({}))) as Partial<GuideTurnAnswer> & { error?: string };
      if (body.conversation && Array.isArray(body.messages)) {
        const ref = body.conversation.token ? { id: body.conversation.id, token: body.conversation.token } : stored.ref;
        const messages = body.conversation.token ? body.messages : merge(stored.messages, body.messages);
        keep({ v: 1, ref, messages, open: true });
        setDraft("");
        const action = messages.at(-1)?.author === "ai" ? messages.at(-1)?.action : undefined;
        setStatus(response.ok ? (body.removedSecret ? words.removed : "") : words.sorry);
        // The page the guide opened: the panel opens again there, with the conversation.
        if (response.ok && action) window.setTimeout(() => window.location.assign(action.href), 300);
      } else {
        setStatus(response.status === 429 ? (body.error ?? words.busy) : response.status === 404 ? words.off : response.status === 409 ? words.full : words.sorry);
        if (response.status === 409) keep({ v: 1, ref: null, messages: stored.messages, open: true });
      }
    } catch {
      setStatus(words.sorry);
    } finally {
      setBusy(false);
      field.current?.focus();
    }
  };

  const on = profile !== null && profile !== "failed" && profile.on;
  const name = profile && profile !== "failed" ? profile.name : "";
  const greeting = profile && profile !== "failed" ? profile.greeting || (name ? fillWords(words.greetingNamed, { name }) : words.greeting) : "";
  const kept = profile && profile !== "failed" ? (profile.keptDays === 1 ? words.day : fillWords(words.days, { n: profile.keptDays })) : "";
  const style = profile && profile !== "failed" ? cleanAvatarStyle(profile.avatarStyle) : null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby={ids.title}
      aria-describedby={ids.notice}
      data-docs-guide-panel=""
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          close();
        }
      }}
      className="fixed inset-x-2 bottom-2 z-50 flex max-h-[min(44rem,calc(100dvh-1rem))] flex-col rounded-xl border border-border bg-background text-foreground shadow-xl sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[27rem] print:hidden"
    >
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        {profile && profile !== "failed" && profile.avatar && (
          // eslint-disable-next-line @next/next/no-img-element -- the guide's picture as the platform's admins uploaded it
          <img
            src={profile.avatar.url}
            alt=""
            width={40}
            height={40}
            style={style ? avatarFrameStyle(style) : undefined}
            className="box-border size-10 shrink-0 rounded-full object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <h2 id={ids.title} className="truncate font-semibold">
            {name || words.title}
          </h2>
          <p className="text-sm text-muted">{profile && profile !== "failed" && profile.occupation ? `${profile.occupation} · ${words.aiAssistant}` : words.aiAssistant}</p>
        </div>
        {stored.messages.length > 0 && (
          <button type="button" onClick={startOver} className="inline-flex min-h-10 items-center rounded-full px-3 text-sm hover:bg-surface">
            {words.newConversation}
          </button>
        )}
        <button type="button" onClick={close} aria-label={words.close} className="inline-flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-surface">
          <span aria-hidden="true">✕</span>
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        <p id={ids.notice} className="text-sm text-muted">
          {profile === null ? words.loading : profile === "failed" ? words.aiAssistant : fillWords(words.notice, { days: kept })}
        </p>
        {(profile === "failed" || (profile !== null && !on)) && (
          <div className="flex flex-col gap-2 text-sm">
            <p>{words.off}</p>
            <p className="flex flex-wrap gap-x-4 gap-y-1">
              <a href={searchHref} className="inline-flex min-h-6 items-center underline underline-offset-2 hover:no-underline">
                {words.searchInstead}
              </a>
              <a href={supportHref} className="inline-flex min-h-6 items-center underline underline-offset-2 hover:no-underline">
                {words.supportAdmin}
              </a>
            </p>
          </div>
        )}
        <div role="log" aria-live="polite" aria-label={words.conversation}>
          <ol ref={log} className="flex flex-col gap-3">
            {on && (
              <li className="max-w-[90%] self-start rounded-lg bg-surface px-3 py-2 text-sm whitespace-pre-wrap">
                {greeting}
              </li>
            )}
            {stored.messages.map((message) => (
              <li
                key={message.seq}
                className={message.author === "reader" ? "max-w-[90%] self-end rounded-lg border border-border px-3 py-2 text-sm" : "max-w-[95%] self-start rounded-lg bg-surface px-3 py-2 text-sm"}
              >
                <p className="sr-only">{message.author === "reader" ? words.you : name || words.title}</p>
                {/* The guide's words are text, never HTML; every link below them is drawn from data. */}
                <p className="whitespace-pre-wrap break-words">{message.body}</p>
                {message.links && message.links.length > 0 && (
                  <div className="mt-2 border-t border-border pt-2">
                    <p className="text-xs font-semibold text-muted">{words.used}</p>
                    <ul className="mt-1 flex flex-col gap-1">
                      {message.links.map((link) => (
                        <li key={link.href}>
                          <a href={link.href} data-docs-guide-link="" className="inline-flex min-h-6 items-center underline underline-offset-2 hover:no-underline">
                            {link.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {message.action && (
                  <p className="mt-2">
                    <a href={message.action.href} className="inline-flex min-h-6 items-center underline underline-offset-2 hover:no-underline">
                      {fillWords(words.opened, { label: message.action.label })}
                    </a>
                  </p>
                )}
                {message.support && (
                  <div className="mt-2 border-t border-border pt-2">
                    <p>{words.support}</p>
                    <ul className="mt-1 flex flex-col gap-1">
                      <li>
                        <a href={message.support.admin} className="inline-flex min-h-6 items-center underline underline-offset-2 hover:no-underline">
                          {words.supportAdmin}
                        </a>
                      </li>
                      {message.support.email && (
                        <li>
                          <a href={`mailto:${message.support.email}`} className="inline-flex min-h-6 items-center underline underline-offset-2 hover:no-underline">
                            {fillWords(words.supportEmail, { email: message.support.email })}
                          </a>
                        </li>
                      )}
                    </ul>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
        className="flex flex-col gap-2 border-t border-border px-4 py-3"
      >
        <p role="status" aria-live="polite" className="min-h-5 text-sm text-muted">
          {status}
        </p>
        <label htmlFor={ids.field} className="sr-only">
          {words.label}
        </label>
        <div className="flex items-end gap-2">
          <textarea
            ref={field}
            id={ids.field}
            rows={2}
            maxLength={GUIDE_MESSAGE_MAX}
            value={draft}
            disabled={profile !== null && !on}
            placeholder={words.placeholder}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send();
              }
            }}
            className="min-h-11 flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={busy || !on || draft.trim() === ""}
            className="inline-flex min-h-11 items-center rounded-full bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50"
          >
            {words.send}
          </button>
        </div>
      </form>
    </div>
  );
}
