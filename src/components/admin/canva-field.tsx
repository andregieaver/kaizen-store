"use client";

import { Brush } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { CANVA_BACK, CANVA_CHANNEL, CANVA_CONNECT, type CanvaField } from "@/lib/canva-paths";

import { useAdminText } from "./admin-text";

/**
 * *Edit in Canva* on a picture field (D898, `docs/design-tools.md` C2). Canva opens the field's picture in a tab of its own while the editor
 * stays as it is, unsaved changes and all; Canva's *Return* lands on a small page (`CANVA_BACK`) that tells this tab and closes, and the
 * edited copy is brought into the library and takes the field's place, as a picture chosen there would. A field that is not told (another
 * browser, a closed channel) asks the route where the edit stands, every few seconds and whenever the tab is looked at again.
 */

/** What every answer of the Canva route looks like. */
type Answer<T> = ({ ok: true } & T) | { ok: false; problem: string; reconnect?: boolean };

/** Asks the Canva route, an answer either way: what went wrong, in the person's words, when the route could not be reached. */
export async function ask<T>(endpoint: string, body: unknown, failed: string): Promise<Answer<T>> {
  try {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = (await response.json().catch(() => null)) as Answer<T> | null;
    return json ?? { ok: false, problem: failed };
  } catch {
    return { ok: false, problem: failed };
  }
}

const FieldContext = createContext<CanvaField | null>(null);

/** Gives every picture field below it *Edit in Canva*; without one (Canva not set up, a theme's workspace) the fields draw nothing of it. */
export function CanvaFieldProvider({ canva, children }: { canva: CanvaField | null | undefined; children?: ReactNode }) {
  return <FieldContext value={canva ?? null}>{children}</FieldContext>;
}

/** The picture a field takes from Canva. */
type FromCanva = { url: string; thumbnailUrl: string | null; width: number; height: number };

/** How long a field waits for Canva's *Return* before it stops asking. */
const WAIT_MS = 60 * 60_000;
const EVERY_MS = 8_000;

const pill = "inline-flex w-fit items-center gap-1.5 rounded-pill border border-edge px-3 py-2 text-sm focus-visible:outline-2 disabled:opacity-60";
const textButton = "w-fit text-xs underline disabled:opacity-60";

type Phase = { at: "idle" } | { at: "opening" } | { at: "waiting"; editId: string } | { at: "bringing" } | { at: "connecting" };

/**
 * The field's button: *Edit in Canva* for the field's picture, or *Connect Canva* (in a new tab) while the person's Canva is not connected.
 * `small` draws it as a text button, for a product's photo tile. Draws nothing without a provider or a picture.
 */
export function EditInCanvaButton({ current, onEdited, small = false }: { current?: { url: string } | null; onEdited: (picture: FromCanva) => void; small?: boolean }) {
  const canva = useContext(FieldContext);
  // Only where Canva is given: its words are handed to those editors alone.
  if (!canva || !current?.url) return null;
  return <FieldButton canva={canva} url={current.url} onEdited={onEdited} compact={small} />;
}

function FieldButton({ canva, url, onEdited, compact }: { canva: CanvaField; url: string; onEdited: (picture: FromCanva) => void; compact: boolean }) {
  const w = useAdminText("canvaField");
  const [connected, setConnected] = useState(canva.connected);
  const [phase, setPhase] = useState<Phase>({ at: "idle" });
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  // The latest `onEdited`, so a wait that began before the field changed still hands the picture to the field as it is now.
  const handOver = useRef(onEdited);
  useEffect(() => {
    handOver.current = onEdited;
  });

  const endpoint = canva.endpoint;
  const waitingFor = phase.at === "waiting" ? phase.editId : null;

  // Waiting for Canva's *Return*: told by the back page on this site's channel, or found by asking.
  useEffect(() => {
    if (!waitingFor) return;
    let over = false;
    const bring = async () => {
      if (over) return;
      over = true;
      setPhase({ at: "bringing" });
      const brought = await ask<FromCanva>(endpoint, { do: "bring", editId: waitingFor }, w.problems.failed);
      if (brought.ok) {
        handOver.current({ url: brought.url, thumbnailUrl: brought.thumbnailUrl, width: brought.width, height: brought.height });
        setSaid({ ok: true, text: w.field.done });
      } else setSaid({ ok: false, text: brought.problem });
      setPhase({ at: "idle" });
    };
    const check = async () => {
      const status = await ask<{ status: string }>(endpoint, { do: "status", editId: waitingFor }, w.problems.failed);
      if (status.ok && status.status !== "open") void bring();
    };
    const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(CANVA_CHANNEL) : null;
    channel?.addEventListener("message", (event: MessageEvent<{ edit?: string }>) => {
      if (event.data?.edit === waitingFor) void bring();
    });
    const look = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", look);
    const timer = window.setInterval(() => void check(), EVERY_MS);
    const stop = window.setTimeout(() => setPhase({ at: "idle" }), WAIT_MS);
    return () => {
      over = true;
      channel?.close();
      document.removeEventListener("visibilitychange", look);
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, [waitingFor, endpoint, w]);

  // Connecting in another tab: the back page says when it is done.
  useEffect(() => {
    if (phase.at !== "connecting" || typeof BroadcastChannel !== "function") return;
    const channel = new BroadcastChannel(CANVA_CHANNEL);
    channel.addEventListener("message", (event: MessageEvent<{ connected?: boolean }>) => {
      if (typeof event.data?.connected !== "boolean") return;
      if (event.data.connected) setConnected(true);
      setSaid(event.data.connected ? null : { ok: false, text: w.outcome.failed });
      setPhase({ at: "idle" });
    });
    return () => channel.close();
  }, [phase.at, w]);

  const edit = async () => {
    setSaid(null);
    // The tab is opened on the press itself, or the browser takes it for a pop-up; Canva's address follows once the design is made.
    const tab = window.open("", "_blank");
    if (!tab) return setSaid({ ok: false, text: w.field.blocked });
    tab.opener = null;
    setPhase({ at: "opening" });
    const started = await ask<{ url: string; editId: string }>(endpoint, { do: "edit", url, place: "field" }, w.problems.failed);
    if (!started.ok) {
      tab.close();
      if (started.reconnect) setConnected(false);
      setSaid({ ok: false, text: started.problem });
      return setPhase({ at: "idle" });
    }
    tab.location.href = started.url;
    setPhase({ at: "waiting", editId: started.editId });
  };

  const words = phase.at === "opening" ? w.opening : phase.at === "bringing" ? w.field.bringing : w.edit;
  return (
    <>
      {connected ? (
        <button type="button" onClick={() => void edit()} disabled={phase.at !== "idle"} aria-busy={phase.at !== "idle"} className={compact ? textButton : pill} data-field-canva>
          {!compact && <Brush aria-hidden className="size-4" />}
          {words}
        </button>
      ) : (
        // A plain form to a new tab: Canva's consent there, and the back page here says when it is done.
        <form method="post" action={CANVA_CONNECT} target="_blank" onSubmit={() => setPhase({ at: "connecting" })} className="contents">
          <input type="hidden" name="back" value={CANVA_BACK} />
          <button type="submit" title={w.field.connectLead} className={compact ? textButton : pill} data-field-canva-connect>
            {!compact && <Brush aria-hidden className="size-4" />}
            {w.connect}
          </button>
        </form>
      )}
      {phase.at === "waiting" && (
        <p role="status" className="basis-full text-xs text-muted">
          {w.field.waiting}{" "}
          <button type="button" className="underline" onClick={() => setPhase({ at: "idle" })}>
            {w.field.stop}
          </button>
        </p>
      )}
      {said && (
        <p role={said.ok ? "status" : "alert"} className={`basis-full text-xs ${said.ok ? "text-muted" : "text-danger-text"}`}>
          {said.text}
        </p>
      )}
    </>
  );
}
