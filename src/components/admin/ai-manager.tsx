"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";

import { AI_COMPOSER_ATTRIBUTE } from "@/lib/ai-composer";
import { alreadySaid, answerToAnnounce } from "@/lib/answer-announce";
import { matchPath } from "@/lib/admin-map";
import { TOOL_WORDS } from "@/lib/manager-tools";
import { fillWords } from "@/lib/admin-fill";
import { PAGES_NB } from "@/lib/admin-messages/pages.nb";

import { useAdminLang, useAdminText } from "./admin-text";

import { SkillForm, type SaveSkill } from "./ai-skills";
import { useLiveVoice, type LiveState } from "./live-voice";
import { useVoice, type VoiceStatus } from "./voice-mode";
import type { Approval, AssistantEvent, AssistantMessage, Conversation, ConversationSummary } from "@/server/owner-assistant";

type Result<T> = ({ ok: true } & T) | { ok: false; problem: string };

export type Abilities = { text: boolean; hear: boolean; speak: boolean; live: boolean };

export type AiManagerActions = {
  decide: (approvalId: string, approve: boolean) => Promise<Approval | null>;
  remove: (conversationId: string) => Promise<boolean>;
  load: (conversationId: string) => Promise<Conversation | null>;
  rate: (messageId: string, value: 1 | -1 | null) => Promise<boolean>;
  hear: ((form: FormData) => Promise<Result<{ text: string }>>) | null;
  /** *Save as skill* on a request (D350); none where skills cannot be saved. */
  saveSkill?: SaveSkill;
};

const button = "inline-flex min-h-10 items-center justify-center rounded-md px-4 text-sm font-medium disabled:opacity-50";
const primary = `${button} bg-brand text-brand-ink`;
const secondary = `${button} border border-edge hover:bg-sunken`;
const chip = "rounded-full border border-edge px-3 py-1.5 text-left text-sm hover:bg-sunken";

/** Text with the admin's own paths and web addresses as links; the rest stays text, never HTML. */
function Linked({ text, onOpen }: { text: string; onOpen?: () => void }) {
  const parts: ReactNode[] = [];
  const pattern = /(\/admin\/[A-Za-z0-9/_-]+|https:\/\/[^\s)]+)/g;
  let at = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > at) parts.push(text.slice(at, index));
    const href = match[0].replace(/[.,;:]+$/, "");
    parts.push(
      href.startsWith("/") ? (
        <Link key={index} href={href} className="underline" onClick={onOpen}>
          {href}
        </Link>
      ) : (
        <a key={index} href={href} target="_blank" rel="noopener noreferrer" className="underline">
          {href}
        </a>
      ),
    );
    at = index + href.length;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

/**
 * The AI manager's conversation (D94, D103): the site's AI working for the
 * person in the admin, as a full page or as the panel the launcher opens on
 * every admin page. They type or talk; the answer streams in as it is
 * written, with a line saying what it is doing. It can open admin pages for
 * them (in the panel, at once; on its own page, as a link). Changes that
 * send, publish or cost money come as cards to approve or decline, and
 * answers take a thumb up or down, which it learns from.
 */
export function AiManagerChat({
  area,
  base,
  siteName,
  settingsHref,
  abilities,
  conversations: initialList,
  conversation,
  actions,
  variant,
  inputRef: givenInputRef,
  onNavigate,
  startVoice = 0,
  ask,
}: {
  area: "store" | "platform";
  /** The AI manager's page; its turn route is `{base}/turn`. */
  base: string;
  siteName: string;
  settingsHref: string;
  abilities: Abilities;
  conversations: ConversationSummary[];
  conversation: Conversation | null;
  actions: AiManagerActions;
  variant: "page" | "panel";
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  /** The panel closes on phones when it opens a page. */
  onNavigate?: () => void;
  /** Asked to talk (the launcher's microphone, counted per click): voice mode starts. */
  startVoice?: number;
  /** A first message handed over from the page (an alert's *Ask the AI manager*, D348), counted per press: it is sent once each time. */
  ask?: { text: string; n: number };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const lang = useAdminLang();
  const words = useAdminText("assistant");
  const w = words.chat;
  const inputId = useId();
  const ownInputRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = givenInputRef ?? ownInputRef;
  const [list, setList] = useState(initialList);
  const [showList, setShowList] = useState(false);
  const [conversationId, setConversationId] = useState(conversation?.id ?? null);
  const [messages, setMessages] = useState<AssistantMessage[]>(conversation?.messages ?? []);
  const [approvals, setApprovals] = useState<Approval[]>(conversation?.approvals ?? []);
  const [opened, setOpened] = useState<{ href: string; label: string }[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState("");
  const [working, setWorking] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aloud, setAloud] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // A screen reader hears an answer once it is finished, not each streamed word (PSI ACC-08); one open already counts as heard.
  const [announced, setAnnounced] = useState<{ id: string | null; text: string }>(() => ({ id: alreadySaid(conversation?.messages ?? []), text: "" }));
  // Set while drawing, as React advises for state that follows other state: the next drawing finds it said and stops.
  const toAnnounce = answerToAnnounce(messages, announced.id, Boolean(streaming));
  if (toAnnounce) setAnnounced(toAnnounce);
  const sendRef = useRef<(text: string) => void>(() => undefined);
  const panel = variant === "panel";
  const canTalk = abilities.hear && abilities.speak && actions.hear !== null;
  const voice = useVoice({
    words: words.voice,
    speakUrl: `${base}/speak`,
    hear: actions.hear,
    onUtterance: (text) => {
      // Still answering the last one: listen again rather than talk over it.
      if (busyRef.current) return voice.finish();
      sendRef.current(text);
    },
    onProblem: setProblem,
  });
  const speaking = voice.active || aloud;
  // A live voice call (D105), where the site has a live voice model: preferred for voice mode.
  const live = useLiveVoice({
    words: words.voice,
    base,
    onDelegated: ({ navigate, approvals: kept }) => {
      if (kept.length) {
        setApprovals((current) => {
          const next = current.filter((a) => !kept.some((k) => k.id === a.id));
          return [...next, ...kept];
        });
      }
      for (const page of navigate) {
        setOpened((current) => [...current, page]);
        if (panel) router.push(page.href);
      }
    },
    onEnded: (id) => {
      if (id) void open(id, true);
    },
  });
  const canCall = abilities.live;
  const talking = voice.active || live.active;

  function startTalking() {
    if (canCall) void live.start(conversationId);
    else if (canTalk) void voice.start();
  }

  // Opened from the launcher's microphone: start talking.
  const startRef = useRef(startTalking);
  useEffect(() => {
    startRef.current = startTalking;
  });
  useEffect(() => {
    if (startVoice > 0) startRef.current();
  }, [startVoice]);

  // An alert handed over from the page (D348): sent as the person's message, once per press.
  const askedRef = useRef(0);
  useEffect(() => {
    if (!ask || ask.n <= askedRef.current) return;
    askedRef.current = ask.n;
    sendRef.current(ask.text);
  }, [ask]);

  // Escape ends voice mode and calls.
  const { stop: stopVoiceMode } = voice;
  const { stop: stopCall } = live;
  useEffect(() => {
    if (!talking) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      stopVoiceMode();
      stopCall();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [talking, stopVoiceMode, stopCall]);

  useEffect(() => {
    const box = scrollRef.current;
    if (box && panel) box.scrollTop = box.scrollHeight;
    else if (box) box.lastElementChild?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages, approvals, streaming, working, panel]);

  function remember(id: string | null) {
    if (!panel) window.history.replaceState(window.history.state, "", id ? `${base}?c=${id}` : base);
  }

  function startNew() {
    abortRef.current?.abort();
    setConversationId(null);
    setMessages([]);
    setApprovals([]);
    setOpened([]);
    setProblem(null);
    setShowList(false);
    remember(null);
    inputRef.current?.focus();
  }

  async function open(id: string, afterCall = false) {
    setShowList(false);
    const found = await actions.load(id);
    if (!found) return setProblem(w.gone);
    if (afterCall) setList((current) => (current.some((c) => c.id === found.id) ? current : [{ id: found.id, title: found.title, updatedAt: new Date().toISOString() }, ...current]));
    setConversationId(found.id);
    setMessages(found.messages);
    setApprovals(found.approvals);
    setOpened([]);
    setProblem(null);
    remember(found.id);
  }

  async function send(text: string) {
    const words = text.trim();
    if (!words || busyRef.current) return;
    setDraft("");
    setProblem(null);
    busyRef.current = true;
    setBusy(true);
    if (speaking) voice.expectAnswer();
    setStreaming("");
    setOpened([]);
    setWorking(w.thinking);
    setMessages((current) => [...current, { id: `local-${Date.now()}`, role: "user", content: words, tools: [], feedback: null, createdAt: new Date().toISOString() }]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch(`${base}/turn`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, message: words, path: window.location.pathname, voice: voice.active }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error((await response.json().catch(() => null))?.error ?? w.unreachable);
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) handle(JSON.parse(line) as AssistantEvent);
      }
    } catch (error) {
      if (!controller.signal.aborted) setProblem(error instanceof Error ? error.message : w.unreachable);
    } finally {
      abortRef.current = null;
      busyRef.current = false;
      // The rest of the answer is spoken; in voice mode it then listens again.
      if (speaking) voice.finish();
      setBusy(false);
      setWorking(null);
      setStreaming("");
    }
  }
  sendRef.current = (text) => void send(text);

  function handle(event: AssistantEvent) {
    switch (event.type) {
      case "conversation":
        setConversationId(event.id);
        setList((current) => [{ id: event.id, title: event.title, updatedAt: new Date().toISOString() }, ...current]);
        remember(event.id);
        return;
      case "text":
        setWorking(null);
        setStreaming((current) => current + event.delta);
        if (speaking) voice.feed(event.delta);
        return;
      case "round":
        setStreaming("");
        setWorking(event.tools.map((name) => words.tools[name] ?? TOOL_WORDS[name] ?? w.working).filter((v, i, all) => all.indexOf(v) === i).join(" · "));
        return;
      case "navigate":
        setOpened((current) => [...current, { href: event.href, label: event.label }]);
        // In the panel the page opens behind it; its own page offers a link instead of leaving the conversation.
        if (panel) {
          router.push(event.href);
          // On phones the panel steps aside for the page, unless they are talking to it.
          if (!talking) onNavigate?.();
        }
        return;
      case "approval":
        // New, or one answered in words during the turn.
        setApprovals((current) =>
          current.some((a) => a.id === event.approval.id) ? current.map((a) => (a.id === event.approval.id ? event.approval : a)) : [...current, event.approval],
        );
        return;
      case "done":
        setMessages((current) => [...current, event.message]);
        setStreaming("");
        return;
      case "error":
        setProblem(event.message);
        return;
    }
  }

  async function decide(approval: Approval, approve: boolean) {
    setApprovals((current) => current.map((a) => (a.id === approval.id ? { ...a, status: approve ? "done" : "declined", outcome: approve ? w.workingOn : null } : a)));
    const decided = await actions.decide(approval.id, approve);
    if (!decided) {
      setProblem(w.decided);
      return;
    }
    setApprovals((current) => current.map((a) => (a.id === decided.id ? decided : a)));
    router.refresh();
  }

  async function rate(message: AssistantMessage, value: 1 | -1) {
    const next = message.feedback === value ? null : value;
    setMessages((current) => current.map((m) => (m.id === message.id ? { ...m, feedback: next } : m)));
    if (!(await actions.rate(message.id, next))) setMessages((current) => current.map((m) => (m.id === message.id ? message : m)));
  }

  async function removeConversation(id: string) {
    if (!window.confirm(w.confirmDelete)) return;
    if (!(await actions.remove(id))) return;
    setList((current) => current.filter((c) => c.id !== id));
    if (id === conversationId) startNew();
  }

  if (!abilities.text) {
    return (
      <p className="m-4 rounded-panel border border-line p-4 text-sm">
        {area === "store" ? w.noModelStore : w.noModelPlatform}{" "}
        <Link href={settingsHref} className="underline" onClick={onNavigate}>
          {w.setUp}
        </Link>
        .
      </p>
    );
  }

  // Suggestions: about the page they are on, then the usual ones.
  const here = matchPath(pathname);
  const onPage = here && here.page.id !== "assistant" && (here.page.area === area || here.page.area === "account") ? here.page : null;
  const starters = [...(onPage ? [fillWords(w.helpHere, { page: ((lang === "nb" ? PAGES_NB[`${onPage.area}:${onPage.id}`]?.title : undefined) ?? onPage.title).toLowerCase() })] : []), ...w.starters[area]];

  // Messages in order, each approval under the answer of the turn that asked for it (saved after it).
  const thread: ReactNode[] = [];
  const shown = new Set<string>();
  for (const message of messages) {
    thread.push(<Bubble key={message.id} message={message} onRate={rate} onOpen={onNavigate} saveSkill={actions.saveSkill} canShare={area === "store"} />);
    if (message.role !== "assistant" || !message.createdAt) continue;
    for (const approval of approvals) {
      if (shown.has(approval.id) || approval.createdAt > message.createdAt) continue;
      shown.add(approval.id);
      thread.push(<ApprovalCard key={approval.id} approval={approval} onDecide={decide} />);
    }
  }
  // Asked for in the turn still being answered.
  const waiting = approvals.filter((a) => !shown.has(a.id));

  const history = (
    <ul className="flex flex-col gap-1">
      {list.length === 0 && <li className="px-2 py-2 text-sm text-muted">{w.none}</li>}
      {list.map((c) => (
        <li key={c.id} className={`flex items-center gap-1 rounded-md ${c.id === conversationId ? "bg-sunken" : ""}`}>
          <button
            type="button"
            onClick={() => void open(c.id)}
            className="min-w-0 flex-1 truncate px-2 py-2 text-left text-sm"
            aria-current={c.id === conversationId ? "true" : undefined}
          >
            {c.title || w.untitled}
          </button>
          <button type="button" onClick={() => void removeConversation(c.id)} className="px-2 text-sm text-muted hover:text-ink" aria-label={fillWords(w.deleteOne, { title: c.title })}>
            ×
          </button>
        </li>
      ))}
    </ul>
  );

  const conversationView = (
    <section aria-label={w.region} className={`flex min-h-0 flex-col ${panel ? "flex-1" : "min-h-[60dvh] gap-4"}`}>
      {panel && (
        <div className="flex items-center gap-2 border-b border-line px-4 py-2 text-sm">
          <button type="button" className="rounded px-2 py-1 hover:bg-sunken" onClick={startNew}>
            {w.new}
          </button>
          <button type="button" className="rounded px-2 py-1 hover:bg-sunken" aria-expanded={showList} onClick={() => setShowList((v) => !v)}>
            {w.earlier}
          </button>
          <Link href={conversationId ? `${base}?c=${conversationId}` : base} className="ml-auto rounded px-2 py-1 text-muted hover:bg-sunken" onClick={onNavigate}>
            {w.fullPage}
          </Link>
        </div>
      )}
      {panel && showList ? (
        <nav aria-label={w.earlierLabel} className="flex-1 overflow-y-auto p-2">
          {history}
        </nav>
      ) : (
        <div ref={scrollRef} className={`flex flex-1 flex-col gap-3 ${panel ? "overflow-y-auto p-4" : ""}`}>
          {thread.length === 0 && !busy && (
            <div className="flex flex-col gap-3 rounded-panel border border-line p-4">
              <p className="text-sm">
                {area === "store"
                  ? `I know every part of ${siteName}'s admin, can look at orders, products, customers and sales, and can take you to the right page. Changes that email customers, change the site or cost money wait for your yes.`
                  : "I know every part of Kaizena Flow's admin, can look at requests, stores, plans and emails, and can take you to the right page. Approvals and emails wait for your yes."}
              </p>
              <div className="flex flex-wrap gap-2">
                {starters.map((s) => (
                  <button key={s} type="button" className={chip} onClick={() => void send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {announced.text}
          </p>
          {thread}
          {streaming && <Bubble message={{ id: "streaming", role: "assistant", content: streaming, tools: [], feedback: null, createdAt: "" }} />}
          {/* The call as it is said; kept in the conversation when it ends. */}
          {live.active &&
            live.turns.map((turn, i) => (
              <Bubble key={`live-${i}`} message={{ id: `live-${i}`, role: turn.role, content: turn.text, tools: [], feedback: null, createdAt: "" }} />
            ))}
          {waiting.map((approval) => (
            <ApprovalCard key={approval.id} approval={approval} onDecide={decide} />
          ))}
          {opened.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {opened.map((o) => (
                <Link key={o.href} href={o.href} className={chip} onClick={onNavigate}>
                  {panel ? `Opened ${o.label}` : `Go to ${o.label} →`}
                </Link>
              ))}
            </div>
          )}
          {working && (
            <p className="text-sm text-muted" role="status">
              {working} …
            </p>
          )}
          {problem && (
            <p role="alert" className="text-sm text-danger-text">
              {problem}
            </p>
          )}
          {live.error && !live.active && (
            <p role="alert" className="text-sm text-danger-text">
              {live.error}
            </p>
          )}
          {startVoice > 0 && !canTalk && !canCall && (
            <p role="status" className="text-sm">
              Voice mode needs a speech-to-text model and a voice.{" "}
              <Link href={settingsHref} className="underline" onClick={onNavigate}>
                Set them up under AI
              </Link>
              .
            </p>
          )}
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
        className={`flex flex-col gap-2 border-t border-line bg-card ${panel ? "p-3" : "sticky bottom-0 pt-3"}`}
      >
        {live.active && (
          <CallBar state={live.state} working={live.working} muted={live.muted} onMute={live.toggleMute} onEnd={live.stop} />
        )}
        {voice.active && (
          <VoiceBar status={voice.status} level={voice.level} muted={voice.muted} onMute={voice.toggleMute} onInterrupt={voice.interrupt} onEnd={voice.stop} />
        )}
        <label htmlFor={inputId} className="sr-only">
          Message to the AI manager
        </label>
        <textarea
          id={inputId}
          ref={inputRef}
          {...{ [AI_COMPOSER_ATTRIBUTE]: "" }}
          value={draft}
          rows={2}
          maxLength={4000}
          placeholder={w.placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send(draft);
            }
          }}
          className="w-full rounded-md border border-line bg-card px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap items-center gap-2">
          {busy ? (
            <button type="button" className={secondary} onClick={() => abortRef.current?.abort()}>
              {w.stop}
            </button>
          ) : (
            <button type="submit" className={primary} disabled={!draft.trim()}>
              {w.send}
            </button>
          )}
          {(canCall || canTalk) && !talking && (
            <button
              type="button"
              className={secondary}
              onClick={startTalking}
              title={canCall ? w.callTitle : w.talkTitle}
            >
              <MicIcon className="mr-1.5 size-4" />
              {w.voiceMode}
            </button>
          )}
          {abilities.speak && !talking && (
            <label className="ml-auto flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={aloud}
                onChange={(event) => {
                  setAloud(event.target.checked);
                  if (!event.target.checked) voice.stopSpeaking();
                }}
                className="size-4"
              />
              {w.readAloud}
            </label>
          )}
        </div>
      </form>
    </section>
  );

  if (panel) return conversationView;
  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
      <nav aria-label={words.page.conversations} className="flex flex-col gap-2">
        <button type="button" onClick={startNew} className={secondary}>
          {w.newConversation}
        </button>
        <div className="max-h-[60dvh] overflow-y-auto">{history}</div>
      </nav>
      {conversationView}
    </div>
  );
}

export function MicIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

/** Voice mode's state (D104): a circle that follows the microphone, what it is doing, and its controls. */
function VoiceBar({
  status,
  level,
  muted,
  onMute,
  onInterrupt,
  onEnd,
}: {
  status: VoiceStatus;
  level: number;
  muted: boolean;
  onMute: () => void;
  onInterrupt: () => void;
  onEnd: () => void;
}) {
  const v = useAdminText("assistant").voice;
  const words = muted && (status === "listening" || status === "hearing") ? v.muted : status === "off" ? { label: "", hint: "" } : v[status];
  const busy = status === "thinking" || status === "starting";
  return (
    <div className="flex items-center gap-3 rounded-panel border border-line p-2" aria-label={v.region}>
      <span aria-hidden="true" className="relative flex size-11 shrink-0 items-center justify-center">
        <span
          className="absolute inset-0 rounded-full bg-inverse/15 transition-transform duration-75"
          style={{ transform: `scale(${status === "speaking" ? 1.15 : 0.8 + level * 0.9})` }}
        />
        <span className={`size-6 rounded-full bg-brand ${busy || status === "speaking" ? "animate-pulse" : ""} ${muted ? "opacity-30" : ""}`} />
      </span>
      <div className="min-w-0 flex-1" role="status" aria-live="polite">
        <p className="text-sm font-medium">{words.label} …</p>
        <p className="truncate text-xs text-muted">{words.hint}</p>
      </div>
      {status === "speaking" && (
        <button type="button" onClick={onInterrupt} className="rounded-pill border border-edge px-2 py-1 text-xs hover:bg-sunken">
          {v.interrupt}
        </button>
      )}
      <button type="button" onClick={onMute} aria-pressed={muted} className="rounded-pill border border-edge px-2 py-1 text-xs hover:bg-sunken">
        {muted ? v.unmute : v.mute}
      </button>
      <button type="button" onClick={onEnd} className="rounded-pill bg-brand px-2 py-1 text-xs text-brand-ink" title={v.endTitle}>
        {v.end}
      </button>
    </div>
  );
}

/** A live call's state (D105): connecting, then a circle that breathes while the call is on. */
function CallBar({ state, working, muted, onMute, onEnd }: { state: LiveState; working: boolean; muted: boolean; onMute: () => void; onEnd: () => void }) {
  const on = state === "live";
  const v = useAdminText("assistant").voice;
  return (
    <div className="flex items-center gap-3 rounded-panel border border-line p-2" aria-label={v.call}>
      <span aria-hidden="true" className="relative flex size-11 shrink-0 items-center justify-center">
        <span className={`absolute inset-0 rounded-full bg-inverse/15 ${on && !muted ? "animate-ping [animation-duration:2s]" : ""}`} />
        <span className={`size-6 rounded-full bg-brand ${working || !on ? "animate-pulse" : ""} ${muted ? "opacity-30" : ""}`} />
      </span>
      <div className="min-w-0 flex-1" role="status" aria-live="polite">
        <p className="text-sm font-medium">{!on ? v.connecting : muted ? v.muted.label : working ? v.looking : v.onCall}</p>
        <p className="truncate text-xs text-muted">{on ? v.callHint : v.allowMic}</p>
      </div>
      <button type="button" onClick={onMute} aria-pressed={muted} disabled={!on} className="rounded-pill border border-edge px-2 py-1 text-xs hover:bg-sunken disabled:opacity-50">
        {muted ? v.unmute : v.mute}
      </button>
      <button type="button" onClick={onEnd} className="rounded-pill bg-brand px-2 py-1 text-xs text-brand-ink" title={v.endCall}>
        {v.end}
      </button>
    </div>
  );
}

function Bubble({
  message,
  onRate,
  onOpen,
  saveSkill,
  canShare = false,
}: {
  message: AssistantMessage;
  onRate?: (message: AssistantMessage, value: 1 | -1) => void;
  onOpen?: () => void;
  saveSkill?: SaveSkill;
  canShare?: boolean;
}) {
  const mine = message.role === "user";
  const w = useAdminText("assistant").chat;
  const sw = useAdminText("assistant").skills;
  const [saving, setSaving] = useState<"form" | "saved" | null>(null);
  const savable = mine && saveSkill && !message.id.startsWith("local-") && message.content.trim().length >= 10;
  const rateable = !mine && onRate && !message.id.startsWith("local-") && message.id !== "streaming";
  // The last report the answer ran (D346), opened on its page, where Save keeps it.
  const report = message.tools.findLast((t) => t.report)?.report;
  return (
    <div className={`flex flex-col gap-1 ${mine ? "items-end" : "items-start"}`}>
      <p className={`max-w-[46rem] whitespace-pre-wrap wrap-anywhere rounded-lg px-3 py-2 text-sm ${mine ? "bg-brand text-brand-ink" : "bg-sunken"}`}>
        {mine ? message.content : <Linked text={message.content} onOpen={onOpen} />}
      </p>
      {savable && saving === null && (
        <button type="button" onClick={() => setSaving("form")} className="rounded-pill px-2 py-0.5 text-xs text-muted hover:bg-sunken hover:text-ink" data-save-skill>
          {sw.saveAs}
        </button>
      )}
      {savable && saving === "saved" && (
        <p className="text-xs text-muted" role="status">
          {sw.saved}
        </p>
      )}
      {savable && saving === "form" && (
        <div className="w-full max-w-[46rem] rounded-panel border border-line bg-card p-3" role="group" aria-label={sw.saveAsTitle}>
          <SkillForm
            start={{ title: message.content.replace(/\s+/g, " ").trim().slice(0, 60), when: "", steps: message.content.trim().slice(0, 2000) }}
            save={saveSkill}
            canShare={canShare}
            onDone={() => setSaving("saved")}
            onCancel={() => setSaving(null)}
          />
        </div>
      )}
      {report && (
        <Link href={report} onClick={onOpen} className="rounded-pill border border-line px-3 py-1 text-xs text-ink hover:bg-sunken" data-save-report>
          {w.saveReport}
        </Link>
      )}
      {(message.tools.length > 0 || rateable) && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          {message.tools.length > 0 && (
            <span>
              {fillWords(w.used, { tools: [...new Set(message.tools.map((t) => t.name.replaceAll("_", " ")))].join(", ") })}
              {message.tools.some((t) => !t.ok) ? w.someProblem : ""}
            </span>
          )}
          {rateable && (
            <span className="flex gap-1">
              <button
                type="button"
                aria-pressed={message.feedback === 1}
                aria-label={w.good}
                title={w.good}
                onClick={() => onRate(message, 1)}
                className={`rounded px-1.5 py-0.5 hover:bg-sunken ${message.feedback === 1 ? "bg-sunken text-ink" : ""}`}
              >
                👍
              </button>
              <button
                type="button"
                aria-pressed={message.feedback === -1}
                aria-label={w.notHelpful}
                title={w.notHelpful}
                onClick={() => onRate(message, -1)}
                className={`rounded px-1.5 py-0.5 hover:bg-sunken ${message.feedback === -1 ? "bg-sunken text-ink" : ""}`}
              >
                👎
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function ApprovalCard({ approval, onDecide }: { approval: Approval; onDecide: (approval: Approval, approve: boolean) => void }) {
  const a = useAdminText("assistant").approval;
  return (
    <div className="flex max-w-[46rem] flex-col gap-2 rounded-panel border border-line p-3" role="group" aria-label={a.region}>
      <p className="text-eyebrow text-muted uppercase">{a.gates[approval.category]}</p>
      <p className="text-sm whitespace-pre-wrap wrap-anywhere">{approval.summary}</p>
      {approval.status === "pending" ? (
        <div className="flex gap-2">
          <button type="button" className={primary} onClick={() => onDecide(approval, true)}>
            {a.approve}
          </button>
          <button type="button" className={secondary} onClick={() => onDecide(approval, false)}>
            {a.decline}
          </button>
        </div>
      ) : (
        <p className="text-sm text-muted">
          {approval.status === "declined" ? a.declined : approval.status === "expired" ? a.expired : approval.status === "failed" ? fillWords(a.failed, { problem: approval.outcome ?? "" }) : (approval.outcome ?? a.done)}
        </p>
      )}
    </div>
  );
}
