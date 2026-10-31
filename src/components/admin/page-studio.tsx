"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import {
  EMPTY_BRIEF,
  HISTORY_MAX,
  MESSAGE_MAX,
  PATTERNS,
  planPictureCount,
  type InterviewReply,
  type PageBrief,
  type PagePlan,
  type PictureJob,
  type StudioMessage,
  type StudioResult,
} from "@/lib/page-ai";
import { CARD_CLASS } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { useAdminText } from "./admin-text";

/** The studio's steps on the server, bound to the owner by the route. */
export type StudioActions = {
  talk: (history: StudioMessage[], brief: PageBrief) => Promise<StudioResult<{ reply: InterviewReply }>>;
  plan: (history: StudioMessage[], brief: PageBrief, change: { plan: PagePlan; request: string } | null) => Promise<StudioResult<{ plan: PagePlan; notes: string[] }>>;
  /** `background`: the pictures are made by the background job (PSI PERF-07), and `pictures` says how they come along. */
  build: (
    history: StudioMessage[],
    brief: PageBrief,
    plan: PagePlan,
  ) => Promise<StudioResult<{ pageId: string; pictures: PictureJob[]; notes: string[]; background: boolean }>>;
  /** One picture made in this request, where the background job does not work (a demo store). */
  picture: (pageId: string, job: PictureJob) => Promise<StudioResult<{ url: string }>>;
  pictures: (pageId: string) => Promise<StudioResult<{ pictures: StudioPictureState[] }>>;
  hear: ((audio: FormData) => Promise<StudioResult<{ text: string }>>) | null;
  speak: ((text: string) => Promise<StudioResult<{ audio: string }>>) | null;
};

type Phase = "talk" | "planned" | "building" | "built";
type PictureState = { job: PictureJob; status: "waiting" | "making" | "done" | "failed"; url?: string; problem?: string };
/** A background picture's state as the server reads it (`studioPictureStates()`). */
export type StudioPictureState = { key: string; status: PictureState["status"]; url?: string; problem?: string };

/** How often the studio asks how the background's pictures come along, and for how long at most. */
const POLL_MS = 4000;
const POLL_FOR_MS = 20 * 60_000;


const button = "inline-flex min-h-10 items-center justify-center rounded-md px-4 text-sm font-medium disabled:opacity-50";
const primary = `${button} bg-brand text-brand-ink`;
const secondary = `${button} border border-edge hover:bg-sunken`;
const card = "rounded-lg border border-line bg-card p-4";

/** The browser's recording formats, best first. */
function recorderType(): string | undefined {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  return types.find((type) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type));
}

/**
 * The AI page studio (D92): the owner talks or types to the site's AI,
 * which interviews them into a brief (shown as it grows), plans the page
 * as sections (shown to change by asking, or build), then writes it and
 * saves it as a draft, with a link to open it in the page builder. Its
 * pictures are made by the background job (PSI PERF-07), shown here as
 * they come; on a demo store, which that job leaves alone, the studio asks
 * for them one by one. The conversation lives only in this tab.
 */
export function PageStudio({
  actions,
  language,
  abilities,
  editBase,
  settingsHref,
}: {
  actions: StudioActions;
  /** The page's language, by name. */
  language: string;
  abilities: { text: boolean; sees: boolean; pictures: boolean; hear: boolean; speak: boolean };
  /** The pages' admin address; a page's is `${editBase}/${id}`. */
  editBase: string;
  /** Where the AI is set up. */
  settingsHref: string;
}) {
  const w = useAdminText("website").studio;
  const GREETING = w.greeting;
  const inputId = useId();
  const [messages, setMessages] = useState<StudioMessage[]>([{ role: "assistant", content: GREETING }]);
  const [brief, setBrief] = useState<PageBrief>(EMPTY_BRIEF);
  const [ready, setReady] = useState(false);
  const [plan, setPlan] = useState<PagePlan | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("talk");
  const [pageId, setPageId] = useState<string | null>(null);
  const [pictures, setPictures] = useState<PictureState[]>([]);
  const [background, setBackground] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [recording, setRecording] = useState(false);
  const [aloud, setAloud] = useState(false);
  const [pending, start] = useTransition();
  const [working, setWorking] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const logRef = useRef<HTMLOListElement>(null);
  // What was said is sent once written down, with the conversation as it is then.
  const sendRef = useRef<(text: string) => void>(() => undefined);

  const busy = pending || working !== null;

  useEffect(() => {
    logRef.current?.lastElementChild?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages]);

  // Leaving while the page is being built would stop its pictures.
  useEffect(() => {
    if (phase !== "building") return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  const say = async (text: string) => {
    if (!aloud || !actions.speak) return;
    const spoken = await actions.speak(text);
    if (!spoken.ok) return;
    audioRef.current?.pause();
    const audio = new Audio(`data:audio/mpeg;base64,${spoken.audio}`);
    audioRef.current = audio;
    void audio.play().catch(() => undefined);
  };

  const history = (list: StudioMessage[]) => list.slice(-HISTORY_MAX).map((m) => ({ role: m.role, content: m.content.slice(0, MESSAGE_MAX) }));

  /** A message from the owner: the interview's next turn, or, once there is a plan, a change to it. */
  function send(text: string) {
    const words = text.trim();
    if (!words || busy) return;
    const next: StudioMessage[] = [...messages, { role: "user", content: words.slice(0, MESSAGE_MAX) }];
    setMessages(next);
    setDraft("");
    setProblem(null);
    start(async () => {
      if (plan && phase === "planned") {
        const changed = await actions.plan(history(next), brief, { plan, request: words });
        if (!changed.ok) return setProblem(changed.problem);
        setPlan(changed.plan);
        setNotes(changed.notes);
        const reply = fillWords(w.changedPlan, { n: changed.plan.sections.length });
        setMessages([...next, { role: "assistant", content: reply }]);
        void say(reply);
        return;
      }
      const result = await actions.talk(history(next), brief);
      if (!result.ok) return setProblem(result.problem);
      setBrief(result.reply.brief);
      setReady(result.reply.ready);
      setMessages([...next, { role: "assistant", content: result.reply.message }]);
      void say(result.reply.message);
    });
  }

  useEffect(() => {
    sendRef.current = send;
  });

  function makePlan() {
    setProblem(null);
    setWorking(w.planning);
    void (async () => {
      const result = await actions.plan(history(messages), brief, null);
      setWorking(null);
      if (!result.ok) return setProblem(result.problem);
      setPlan(result.plan);
      setNotes(result.notes);
      setPhase("planned");
      const reply = fillWords(w.hereIsPlan, { n: result.plan.sections.length });
      setMessages((list) => [...list, { role: "assistant", content: reply }]);
      void say(reply);
    })();
  }

  function build() {
    if (!plan) return;
    setProblem(null);
    setPhase("building");
    setWorking(w.writing);
    void (async () => {
      const built = await actions.build(history(messages), brief, plan);
      if (!built.ok) {
        setWorking(null);
        setPhase("planned");
        return setProblem(built.problem);
      }
      setPageId(built.pageId);
      setNotes(built.notes);
      const states: PictureState[] = built.pictures.map((job) => ({ job, status: "waiting" }));
      setPictures(states);
      if (built.background) {
        // Made by the background job, into the draft: the owner may leave, and the pictures show here as they come (the effect below).
        setBackground(true);
        setWorking(null);
        setPhase("built");
        const reply = states.length > 0 ? `${w.ready} ${w.picturesInBackground}` : w.ready;
        setMessages((list) => [...list, { role: "assistant", content: reply }]);
        void say(reply);
        return;
      }
      // Pictures one at a time: each takes a while, and the draft is already saved.
      for (let index = 0; index < states.length; index++) {
        setWorking(fillWords(w.makingPicture, { n: index + 1, of: states.length }));
        setPictures((list) => list.map((p, i) => (i === index ? { ...p, status: "making" } : p)));
        const made = await actions.picture(built.pageId, states[index].job);
        setPictures((list) =>
          list.map((p, i) => (i === index ? (made.ok ? { ...p, status: "done", url: made.url } : { ...p, status: "failed", problem: made.problem }) : p)),
        );
      }
      setWorking(null);
      setPhase("built");
      const reply = w.ready;
      setMessages((list) => [...list, { role: "assistant", content: reply }]);
      void say(reply);
    })();
  }

  // The background's pictures, asked after every few seconds while one is still to come (and the tab is open), up to 20 minutes.
  const pictureActions = actions.pictures;
  const stillComing = background && pageId !== null && pictures.some((p) => p.status === "waiting" || p.status === "making");
  useEffect(() => {
    if (!stillComing || !pageId) return;
    const stopAt = Date.now() + POLL_FOR_MS;
    let stopped = false;
    let timer: number | undefined;
    const ask = async () => {
      const read = await pictureActions(pageId).catch(() => null);
      if (stopped) return;
      if (read?.ok) {
        const byKey = new Map(read.pictures.map((p) => [p.key, p]));
        setPictures((list) =>
          list.map((p) => {
            const now = byKey.get(p.job.key);
            return now ? { ...p, status: now.status, url: now.url, problem: now.problem ?? (now.status === "failed" ? w.notMade : undefined) } : p;
          }),
        );
      }
      if (Date.now() < stopAt) timer = window.setTimeout(ask, POLL_MS);
    };
    timer = window.setTimeout(ask, POLL_MS);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [stillComing, pageId, pictureActions, w.notMade]);

  /** Push to talk: the first press starts recording, the second sends it to be written down, then as a message. */
  async function talk() {
    const hear = actions.hear;
    if (!hear) return;
    const recorder = recorderRef.current;
    if (recorder) {
      recorder.stop();
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setProblem(w.noMicrophone);
      return;
    }
    audioRef.current?.pause();
    const type = recorderType();
    const next = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    // A minute at most, as a message.
    const limit = window.setTimeout(() => next.state === "recording" && next.stop(), 60_000);
    next.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    next.onstop = () => {
      window.clearTimeout(limit);
      stream.getTracks().forEach((track) => track.stop());
      recorderRef.current = null;
      setRecording(false);
      const audio = new Blob(chunks, { type: next.mimeType || type || "audio/webm" });
      if (audio.size === 0) return;
      const form = new FormData();
      form.set("audio", audio, "message");
      setWorking(w.listening);
      void (async () => {
        const heard = await hear(form);
        setWorking(null);
        if (!heard.ok) return setProblem(heard.problem);
        sendRef.current(heard.text);
      })();
    };
    recorderRef.current = next;
    next.start();
    setRecording(true);
  }

  function startOver() {
    setMessages([{ role: "assistant", content: GREETING }]);
    setBrief(EMPTY_BRIEF);
    setReady(false);
    setPlan(null);
    setNotes([]);
    setPhase("talk");
    setPageId(null);
    setPictures([]);
    setBackground(false);
    setProblem(null);
  }

  if (!abilities.text) {
    return (
      <p className={`${card} text-sm`}>
        {w.needsText}
        <Link href={settingsHref} className="underline">
          {w.setUp}
        </Link>
        .
      </p>
    );
  }

  const canPlan = phase === "talk" && messages.some((m) => m.role === "user");
  const briefShown = brief.title || brief.purpose || brief.keyPoints.length > 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section aria-labelledby={`${inputId}-talk`} className={`flex min-h-[32rem] flex-col ${CARD_CLASS}`}>
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 id={`${inputId}-talk`} className="text-title text-ink">
            {w.talk}
          </h2>
          <div className="flex items-center gap-3 text-sm">
            {abilities.speak && actions.speak && (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={aloud} onChange={(event) => setAloud(event.target.checked)} className="size-4" />
                {w.aloud}
              </label>
            )}
            {messages.length > 1 && (
              <button type="button" onClick={startOver} disabled={busy} className="text-muted underline disabled:opacity-50">
                {w.startOver}
              </button>
            )}
          </div>
        </header>
        <ol ref={logRef} aria-live="polite" aria-label={w.conversation} className="flex max-h-[60vh] flex-1 flex-col gap-3 overflow-y-auto p-4">
          {messages.map((message, index) => (
            <li
              key={index}
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-line ${
                message.role === "user" ? "self-end bg-brand text-brand-ink" : "self-start bg-sunken"
              }`}
            >
              <span className="sr-only">{message.role === "user" ? w.you : w.ai}</span>
              {message.content}
            </li>
          ))}
          {pending && <li className="self-start rounded-lg bg-sunken px-3 py-2 text-sm text-muted">{w.thinking}</li>}
        </ol>
        <form
          className="flex flex-col gap-2 border-t border-line p-3"
          onSubmit={(event) => {
            event.preventDefault();
            send(draft);
          }}
        >
          <label htmlFor={inputId} className="sr-only">
            {plan && phase === "planned" ? w.askChange : w.yourMessage}
          </label>
          <textarea
            id={inputId}
            value={draft}
            maxLength={MESSAGE_MAX}
            rows={3}
            disabled={phase === "building" || phase === "built"}
            placeholder={plan && phase === "planned" ? w.askChangePlaceholder : w.writePlaceholder}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send(draft);
              }
            }}
            className="w-full resize-y rounded-md border border-line bg-card px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            {abilities.hear && actions.hear ? (
              <button
                type="button"
                onClick={() => void talk()}
                disabled={(busy && !recording) || phase === "building" || phase === "built"}
                aria-pressed={recording}
                className={`${secondary} gap-2 ${recording ? "border-danger-text text-danger-text " : ""}`}
              >
                <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <rect x="9" y="3" width="6" height="11" rx="3" />
                  <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                </svg>
                {recording ? w.stopSend : w.talkButton}
              </button>
            ) : (
              <span className="text-xs text-muted">{w.noSpeech}</span>
            )}
            <button type="submit" disabled={busy || !draft.trim() || phase === "building" || phase === "built"} className={primary}>
              {w.send}
            </button>
          </div>
        </form>
      </section>

      <section aria-labelledby={`${inputId}-page`} className="flex flex-col gap-4">
        <h2 id={`${inputId}-page`} className="sr-only">
          {w.thePage}
        </h2>
        {problem && (
          <p role="alert" className="rounded-md border border-danger-line bg-danger-soft p-3 text-sm text-danger-text">
            {problem}
          </p>
        )}
        {working && (
          <p role="status" className={`${card} flex items-center gap-3 text-sm`}>
            <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            {working}
          </p>
        )}

        {!plan && (
          <div className={`${card} flex flex-col gap-3`}>
            <h3 className="text-body-strong text-ink">{w.understood}</h3>
            {briefShown ? <Brief brief={brief} /> : <p className="text-sm text-muted">{w.nothingYet}</p>}
            <p className="text-xs text-muted">
              {fillWords(w.writtenIn, { language })} {abilities.pictures ? w.picturesByAi : w.noPictures} {w.draftOnly}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={makePlan} disabled={!canPlan || busy} className={ready ? primary : secondary}>
                {w.plan}
              </button>
              {!ready && canPlan && <span className="self-center text-xs text-muted">{w.moreQuestions}</span>}
            </div>
          </div>
        )}

        {plan && (
          <div className={`${card} flex flex-col gap-4`}>
            <div>
              <h3 className="text-body-strong text-ink">{plan.title}</h3>
              <p className="text-sm text-muted">
                {countWords(plan.sections.length, w.sections)}
                {planPictureCount(plan) > 0 ? countWords(planPictureCount(plan), w.pictures) : ""}
                {plan.description ? ` · ${plan.description}` : ""}
              </p>
            </div>
            <ol className="flex flex-col gap-3">
              {plan.sections.map((section, index) => (
                <li key={index} className="rounded-md border border-line p-3 text-sm">
                  <p className="font-medium">
                    {index + 1}. {section.name}{" "}
                    <span className="font-normal text-muted">
                      · {PATTERNS[section.pattern].label}
                      {section.variant ? ` (${section.variant})` : ""}
                      {section.tinted ? w.tinted : ""}
                    </span>
                  </p>
                  {section.brief && <p className="mt-1">{section.brief}</p>}
                  {[section.picture, ...(section.pictures ?? [])].filter(Boolean).map((picture, n) => (
                    <details key={n} className="mt-1 text-muted">
                      <summary className="cursor-pointer">{fillWords(w.picture, { alt: picture!.alt })}</summary>
                      <p className="mt-1 text-xs">{picture!.prompt}</p>
                    </details>
                  ))}
                  {section.links && section.links.length > 0 && <p className="mt-1 text-xs text-muted">{fillWords(w.linksTo, { links: section.links.join(", ") })}</p>}
                </li>
              ))}
            </ol>
            {phase === "planned" && (
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={build} disabled={busy} className={primary}>
                  {w.build}
                </button>
                <button type="button" onClick={makePlan} disabled={busy} className={secondary}>
                  {w.planAgain}
                </button>
                <span className="text-xs text-muted">{w.orAsk}</span>
              </div>
            )}
          </div>
        )}

        {notes.length > 0 && (
          <div className="rounded-md border border-warning-line bg-warning-soft p-3 text-sm text-warning-text">
            <p className="font-medium">{w.goodToKnow}</p>
            <ul className="mt-1 list-disc pl-5">
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        )}

        {pageId && (
          <div className={`${card} flex flex-col gap-3`}>
            <p className="text-sm">
              {phase === "built" ? (stillComing ? `${w.done} ${w.picturesInBackground}` : w.done) : w.savedMaking}
            </p>
            {pictures.length > 0 && (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {pictures.map((picture) => (
                  <li key={picture.job.key} className="flex flex-col gap-1 text-xs">
                    <div className="flex aspect-[3/2] items-center justify-center overflow-hidden rounded-md border border-line bg-sunken">
                      {picture.url ? (
                        // eslint-disable-next-line @next/next/no-img-element -- the picture just made, from the media library
                        <img src={picture.url} alt={picture.job.alt} className="size-full object-cover" />
                      ) : (
                        <span className="text-muted">{picture.status === "making" ? w.making : picture.status === "failed" ? w.notMade : w.waiting}</span>
                      )}
                    </div>
                    <span className={picture.status === "failed" ? "text-danger-text" : "text-muted"}>
                      {picture.status === "failed" ? picture.problem : picture.job.alt}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-2">
              <Link href={`${editBase}/${pageId}`} className={phase === "built" ? primary : secondary}>
                {w.open}
              </Link>
              {phase === "built" && (
                <button type="button" onClick={startOver} className={secondary}>
                  {w.another}
                </button>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

/** The brief as the owner reads it. */
function Brief({ brief }: { brief: PageBrief }) {
  const w = useAdminText("website").studio.brief;
  const rows: [string, string | string[]][] = [
    [w.title, brief.title],
    [w.purpose, brief.purpose],
    [w.audience, brief.audience],
    [w.keyPoints, brief.keyPoints],
    [w.facts, brief.facts],
    [w.sections, brief.sections],
    [w.callToAction, brief.callToAction],
    [w.tone, brief.tone],
    [w.pictures, brief.pictures],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {rows
        .filter(([, value]) => (Array.isArray(value) ? value.length > 0 : value))
        .map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd>{Array.isArray(value) ? value.join("; ") : value}</dd>
          </div>
        ))}
    </dl>
  );
}
