import { POLL_STAFF_MS, POLL_VISITOR_MS } from "./support-rules";

/**
 * Realtime for support (D216, `docs/support.md` 4.6, step 12), the pure rules, free of zod for the widget (D211). The database pings a
 * conversation's topic (`sc:{key}`) and a desk's (`sd:{key}`) with `{at}` only when something changes (`commerce.support_ping()`);
 * a client that hears a ping asks the site for what is new, as it would on its own timer. While connected the timer slows to the
 * safety net; without a connection (none set up, it failed or it closed) polling runs at its normal rate and nothing is shown.
 */

/** A ping's fetch waits this long for more pings (several messages at once become one request). */
export const PING_DEBOUNCE_MS = 300;
/** The slowest a connected client polls, in case a ping is lost. */
export const SAFETY_NET_MS = POLL_STAFF_MS.realtime;
/** A typing client says so at most this often. */
export const TYPING_EVERY_MS = 2000;
/** "typing…" stays this long after the last word of it. */
export const TYPING_SHOWN_MS = 4000;

/** Who is typing, as the other side is told. */
export type Typist = "customer" | "agent";

/** Whether the widget listens at all: only while waiting for or talking to a person (the AI's answers come with the request). */
export const widgetListens = (state: { status: string; handler: string } | null): boolean => state !== null && state.status === "open" && state.handler !== "ai";

/**
 * The widget's next poll: its normal delay (`pollDelay()`), or the safety net while a realtime connection is up; null when it does not
 * poll at all (an ended conversation).
 */
export function visitorDelay(state: { status: string; handler: string }, hidden: boolean, connected: boolean): number | null {
  if (state.status !== "open") return null;
  const normal = hidden ? POLL_VISITOR_MS.hidden : state.handler === "ai" ? POLL_VISITOR_MS.ai : POLL_VISITOR_MS.waiting;
  return connected ? Math.max(normal, SAFETY_NET_MS) : normal;
}

/** The inbox's next poll of its list or of the open conversation: the safety net while connected or hidden, else its normal rate. */
export function staffDelay(what: "list" | "conversation", hidden: boolean, connected: boolean): number {
  return hidden || connected ? SAFETY_NET_MS : POLL_STAFF_MS[what];
}

/** Whether a typing ping may be sent now, given when the last one went. */
export const maySendTyping = (lastSent: number, now: number): boolean => now - lastSent >= TYPING_EVERY_MS;

/** A typing ping's payload, read: who, or null for anything else (the text is never sent). */
export function readTyping(payload: unknown): Typist | null {
  const by = payload && typeof payload === "object" ? (payload as { by?: unknown }).by : null;
  return by === "customer" || by === "agent" ? by : null;
}

/** A topic a client may join: a conversation's or a desk's, by its random key. */
export const isTopic = (topic: string): boolean => /^s[cd]:[0-9a-f]{32}$/.test(topic);
