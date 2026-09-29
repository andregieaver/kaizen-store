"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { LIVE_APPEND_MAX } from "@/lib/speech-text";
import type { Approval } from "@/server/owner-assistant";

/**
 * A live voice call with the AI manager (D105), after Kaizen Life's: the
 * microphone up and the voice down over WebRTC, and a data channel for the
 * rest. The call is made by the admin's `…/assistant/live` route (the key
 * never reaches the browser); this hook then:
 *
 * 1. Keeps the transcript. The session streams both sides as fragments on
 *    its own timeline, with no "turn finished" event, so turns are built by
 *    grouping one speaker's fragments, ordered by when they were said.
 * 2. Answers delegations. When the voice hands work over, it says only an
 *    id: the request is what was just said, so the unsaved transcript goes
 *    to `…/live/delegate`, which runs the AI manager and returns what to
 *    say, the pages it opened and the changes it kept; what to say goes
 *    back as commentary for that delegation.
 * 3. Keeps the call in its conversation (`…/live/transcript`), in order,
 *    through one queue, so no turn is saved twice.
 */

export type LiveState = "idle" | "connecting" | "live" | "error";
export type LiveTurnView = { role: "user" | "assistant"; text: string };

type Turn = LiveTurnView & { startMs: number; endMs: number; lastDeltaAt: number };

const FLUSH_EVERY_MS = 15_000;
/** A turn is safe to save once the call is this far past its end. */
const SETTLED_MS = 4000;
/** A delegation may come before the words that caused it are transcribed: wait for them, briefly. */
const DELEGATION_SETTLE_MS = 300;
const DELEGATION_LEAD_MS = 1500;
const DELEGATION_SETTLE_MAX_MS = 2500;

let callAudio: HTMLAudioElement | null = null;

/** The one element the call's voice plays through. */
function callAudioElement(): HTMLAudioElement {
  if (!callAudio) {
    callAudio = new Audio();
    callAudio.autoplay = true;
    callAudio.setAttribute("playsinline", "");
  }
  return callAudio;
}

type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };
type WakeLock = { release: () => Promise<void> };
type WakeLockNavigator = Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLock> } };

export function useLiveVoice(options: {
  /** The AI manager's page; the call's routes are under `{base}/live`. */
  base: string;
  /** What a delegation did beside speaking: pages opened and changes kept. */
  onDelegated: (result: { navigate: { href: string; label: string }[]; approvals: Approval[] }) => void;
  /** The call ended; its conversation holds what was said. */
  onEnded: (conversationId: string | null) => void;
}) {
  const [state, setState] = useState<LiveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<LiveTurnView[]>([]);
  const [muted, setMuted] = useState(false);
  const [working, setWorking] = useState(false);
  const optionsRef = useRef(options);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const wakeRef = useRef<WakeLock | null>(null);
  const openingRef = useRef<string | null>(null);
  const conversationRef = useRef<string | null>(null);
  const turnsRef = useRef<Turn[]>([]);
  const claimedRef = useRef(0);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const flushTimerRef = useRef<number | null>(null);
  const lastInputEndRef = useRef(-1);
  const pendingRef = useRef(0);

  useEffect(() => {
    optionsRef.current = options;
  });

  const send = useCallback((event: Record<string, unknown>) => {
    const dc = dcRef.current;
    if (dc && dc.readyState === "open") dc.send(JSON.stringify(event));
  }, []);

  const showTurns = useCallback(() => setTurns(turnsRef.current.map(({ role, text }) => ({ role, text: text.replace(/^[>\s]+/, "") }))), []);

  /** Server writes, in the order the call happened. */
  const enqueue = useCallback(<T,>(job: () => Promise<T>): Promise<T> => {
    const next = queueRef.current.then(job, job);
    queueRef.current = next.catch(() => undefined);
    return next;
  }, []);

  /** Turns [claimed, end), taken for one write. */
  const claim = useCallback((end: number) => {
    const from = claimedRef.current;
    if (end <= from) return [];
    claimedRef.current = end;
    return turnsRef.current
      .slice(from, end)
      .map(({ role, text }) => ({ role, text: text.replace(/^[>\s]+/, "").trim() }))
      .filter((t) => t.text.length > 0);
  }, []);

  const flush = useCallback(
    (final = false, beacon = false) => {
      const conversationId = conversationRef.current;
      if (!conversationId) return;
      let end = turnsRef.current.length;
      if (!final) {
        // Mid-call, only turns well behind the call's latest words: a transcript can still land late.
        const all = turnsRef.current;
        const horizon = Math.max(0, ...all.map((t) => t.endMs)) - SETTLED_MS;
        end = claimedRef.current;
        while (end < all.length - 1 && all[end].endMs <= horizon) end++;
      }
      const claimed = claim(end);
      if (claimed.length === 0) return;
      const url = `${optionsRef.current.base}/live/transcript`;
      const body = JSON.stringify({ conversationId, turns: claimed });
      if (beacon && typeof navigator.sendBeacon === "function") {
        navigator.sendBeacon(url, body);
        return;
      }
      void enqueue(() => fetch(url, { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" } }).catch(() => undefined));
    },
    [claim, enqueue],
  );

  const appendDelta = useCallback(
    (role: Turn["role"], delta: string, startMs: number, endMs: number) => {
      if (!delta) return;
      if (role === "user") lastInputEndRef.current = Math.max(lastInputEndRef.current, endMs);
      const all = turnsRef.current;
      const floor = claimedRef.current;
      let same = -1;
      for (let i = all.length - 1; i >= floor; i--) {
        if (all[i].role === role) {
          same = i;
          break;
        }
      }
      if (same >= 0) {
        const t = all[same];
        const interrupted = all.some((o, i) => i >= floor && o.role !== role && o.startMs > t.startMs && o.startMs < startMs);
        if (!interrupted) {
          t.text += delta;
          t.endMs = Math.max(t.endMs, endMs);
          t.lastDeltaAt = Date.now();
          showTurns();
          return;
        }
      }
      let at = all.length;
      while (at > floor && all[at - 1].startMs > startMs) at--;
      all.splice(at, 0, { role, text: delta, startMs, endMs, lastDeltaAt: Date.now() });
      showTurns();
    },
    [showTurns],
  );

  const handleDelegation = useCallback(
    async (delegationId: string, offsetMs: number) => {
      pendingRef.current += 1;
      setWorking(true);
      const began = Date.now();
      await new Promise<void>((resolve) => {
        const tick = () => {
          const caughtUp = lastInputEndRef.current >= offsetMs - DELEGATION_LEAD_MS;
          const lastUser = [...turnsRef.current].reverse().find((t) => t.role === "user");
          const quiet = !lastUser || Date.now() - lastUser.lastDeltaAt >= DELEGATION_SETTLE_MS;
          if ((caughtUp && quiet) || Date.now() - began >= DELEGATION_SETTLE_MAX_MS) resolve();
          else window.setTimeout(tick, 80);
        };
        tick();
      });
      const conversationId = conversationRef.current;
      if (!conversationId) return;
      // Up to and including their latest words; what the voice said since stays for the next save.
      const lastUserIdx = turnsRef.current.map((t) => t.role).lastIndexOf("user");
      const claimed = claim(lastUserIdx >= claimedRef.current ? lastUserIdx + 1 : claimedRef.current);
      const result = await enqueue(async () => {
        try {
          const response = await fetch(`${optionsRef.current.base}/live/delegate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ conversationId, turns: claimed, path: window.location.pathname }),
          });
          return (await response.json().catch(() => null)) as {
            speak?: string;
            navigate?: { href: string; label: string }[];
            approvals?: Approval[];
          } | null;
        } catch {
          return null;
        }
      });
      if (result && (result.navigate?.length || result.approvals?.length)) {
        optionsRef.current.onDelegated({ navigate: result.navigate ?? [], approvals: result.approvals ?? [] });
      }
      send({
        type: "session.commentary.append",
        delegation_id: delegationId,
        content: (result?.speak?.trim() || "That request didn't reach my tools just now. Say so plainly and offer to try again.").slice(0, LIVE_APPEND_MAX),
      });
      pendingRef.current -= 1;
      if (pendingRef.current === 0) setWorking(false);
    },
    [claim, enqueue, send],
  );

  const cleanup = useCallback(() => {
    if (flushTimerRef.current) window.clearInterval(flushTimerRef.current);
    flushTimerRef.current = null;
    dcRef.current?.close();
    dcRef.current = null;
    pcRef.current?.getSenders().forEach((sender) => sender.track?.stop());
    pcRef.current?.close();
    pcRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (callAudio) callAudio.srcObject = null;
    void wakeRef.current?.release().catch(() => undefined);
    wakeRef.current = null;
    const session = (navigator as AudioSessionNavigator).audioSession;
    if (session) session.type = "auto";
    pendingRef.current = 0;
    setWorking(false);
    setMuted(false);
  }, []);

  const end = useCallback(() => {
    const conversationId = conversationRef.current;
    flush(true);
    cleanup();
    setState("idle");
    // Once the last turns are kept, the conversation shows the whole call.
    void queueRef.current.then(() => optionsRef.current.onEnded(conversationId));
  }, [cleanup, flush]);

  const stop = useCallback(() => {
    send({ type: "session.close" });
    end();
  }, [end, send]);

  const endRef = useRef(end);
  useEffect(() => {
    endRef.current = end;
  }, [end]);

  const handleEvent = useCallback(
    (raw: string) => {
      let event: {
        type?: string;
        delta?: string;
        start_ms?: number;
        end_ms?: number;
        offset_ms?: number;
        delegation?: { id?: string; target?: string };
        reason?: string;
        error?: { message?: string; code?: string };
      };
      try {
        event = JSON.parse(raw);
      } catch {
        return;
      }
      switch (event.type) {
        case "session.started": {
          setState("live");
          const opening = openingRef.current;
          openingRef.current = null;
          // Commentary is what the voice says; a beat after the start so the greeting is not clipped.
          if (opening) {
            window.setTimeout(() => send({ type: "session.commentary.append", delegation_id: null, content: opening.slice(0, LIVE_APPEND_MAX) }), 600);
          }
          break;
        }
        case "session.input_transcript.delta":
          appendDelta("user", event.delta ?? "", event.start_ms ?? 0, event.end_ms ?? 0);
          break;
        case "session.output_transcript.delta":
          appendDelta("assistant", event.delta ?? "", event.start_ms ?? 0, event.end_ms ?? 0);
          break;
        case "session.delegation.created":
          if (event.delegation?.id && event.delegation.target !== "responses") void handleDelegation(event.delegation.id, event.offset_ms ?? 0);
          break;
        case "session.closed":
          if (event.reason === "content") setError("The call was ended by the provider's safety filter.");
          else if (event.reason === "connection_lost") setError("The voice connection dropped.");
          endRef.current();
          break;
        case "error":
          console.warn("[live-voice]", event.error?.code, event.error?.message);
          break;
      }
    },
    [appendDelta, handleDelegation, send],
  );

  const start = useCallback(
    async (conversationId: string | null) => {
      if (pcRef.current) return;
      setError(null);
      setState("connecting");
      turnsRef.current = [];
      claimedRef.current = 0;
      lastInputEndRef.current = -1;
      setTurns([]);
      // Sound is allowed only from a click: start the call's element now, before anything asynchronous.
      const unlock = callAudioElement();
      unlock.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
      void unlock.play().catch(() => undefined);
      // iOS: playing and recording at once needs this before the microphone opens.
      const session = (navigator as AudioSessionNavigator).audioSession;
      if (session) session.type = "play-and-record";
      try {
        const audio = callAudioElement();
        const pc = new RTCPeerConnection();
        pcRef.current = pc;
        pc.ontrack = (event) => {
          audio.removeAttribute("src");
          audio.srcObject = event.streams[0] ?? null;
          void audio.play().catch(() => undefined);
        };
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "failed") {
            setError("The voice connection dropped.");
            endRef.current();
          }
        };
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        streamRef.current = stream;
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));
        const dc = pc.createDataChannel("oai-events");
        dcRef.current = dc;
        dc.onmessage = (event) => handleEvent(typeof event.data === "string" ? event.data : "");
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const response = await fetch(`${optionsRef.current.base}/live`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sdp: offer.sdp, conversationId }),
        });
        const data = (await response.json().catch(() => null)) as { sdp?: string; conversationId?: string; opening?: string; error?: string } | null;
        if (!response.ok || !data?.sdp) throw new Error(data?.error ?? "The call could not start.");
        conversationRef.current = data.conversationId ?? null;
        openingRef.current = data.opening ?? null;
        await pc.setRemoteDescription({ type: "answer", sdp: data.sdp });
        flushTimerRef.current = window.setInterval(() => flush(), FLUSH_EVERY_MS);
        const wake = (navigator as WakeLockNavigator).wakeLock;
        wakeRef.current = wake ? await wake.request("screen").catch(() => null) : null;
      } catch (problem) {
        cleanup();
        setError(problem instanceof DOMException && problem.name === "NotAllowedError" ? "The browser did not let the page use the microphone." : problem instanceof Error ? problem.message : "The call could not start.");
        setState("error");
      }
    },
    [cleanup, flush, handleEvent],
  );

  const toggleMute = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      send({ type: next ? "session.input_audio.mute" : "session.input_audio.unmute" });
      streamRef.current?.getAudioTracks().forEach((track) => (track.enabled = !next));
      return next;
    });
  }, [send]);

  // Leaving the page mid-call still keeps what was said.
  useEffect(() => {
    const onHide = () => {
      if (pcRef.current) flush(true, true);
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [flush]);

  // Unmounting (the panel closed) ends the call.
  useEffect(
    () => () => {
      if (pcRef.current) {
        send({ type: "session.close" });
        flush(true);
        cleanup();
      }
    },
    [cleanup, flush, send],
  );

  return { state, active: state === "connecting" || state === "live", error, turns, muted, working, start, stop, toggleMute };
}
