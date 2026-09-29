"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { isNoiseTranscript, speakable, takeSentences } from "@/lib/speech-text";

type Result<T> = ({ ok: true } & T) | { ok: false; problem: string };

/**
 * The AI manager's voice mode (D104), after Kaizen Life's hands-free loop:
 * it listens, notices when the person has finished speaking (the loudness
 * of the microphone, sampled every frame), sends what it heard, and speaks
 * the answer sentence by sentence as it is written, then listens again.
 * Talking over it stops it and it listens (barge-in); typing while it
 * listens discards what was heard, so keyboard clicks are never a message.
 * The same speaker reads answers aloud when voice mode is off.
 */

export type VoiceStatus = "off" | "starting" | "listening" | "hearing" | "thinking" | "speaking";

/** Loudness (RMS) that starts speech, and below which is silence. */
const START_THRESHOLD = 0.02;
const STOP_THRESHOLD = 0.015;
/** Silence after speech that ends what was said. */
const SILENCE_MS = 700;
/** Speech must go on this long to count (a cough or a click does not). */
const MIN_SPEECH_MS = 300;
const MAX_UTTERANCE_MS = 30_000;
/** A key pressed this close to or during an utterance discards it. */
const KEYSTROKE_GUARD_MS = 400;
/** Talking over the answer: louder than its echo, for this long. */
const BARGE_THRESHOLD = 0.06;
const BARGE_MS = 280;
/** Recordings smaller than this held no speech. */
const MIN_BYTES = 1200;

/** A moment of silence, played in the click that starts voice, so later answers may play. */
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";

let audioElement: HTMLAudioElement | null = null;

/** The one audio element answers play through, unlocked by a click (browsers block sound until then). */
function speakerElement(): HTMLAudioElement {
  if (!audioElement) {
    audioElement = new Audio();
    audioElement.setAttribute("playsinline", "");
  }
  return audioElement;
}

/** Call in the click that starts voice mode, before anything asynchronous. */
export function unlockVoiceAudio() {
  const audio = speakerElement();
  audio.src = SILENT_WAV;
  void audio.play().catch(() => undefined);
}

/** The browser's recording formats, best first. */
function recorderType(): string | undefined {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  return types.find((type) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type));
}

type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };
type WakeLock = { release: () => Promise<void> };
type WakeLockNavigator = Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLock> } };

export function useVoice(options: {
  /** The route that speaks a piece of text (MP3). */
  speakUrl: string;
  hear: ((form: FormData) => Promise<Result<{ text: string }>>) | null;
  /** What the person said, to send as a message. */
  onUtterance: (text: string) => void;
  onProblem: (message: string) => void;
}) {
  const [status, setStatusState] = useState<VoiceStatus>("off");
  const [level, setLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const statusRef = useRef<VoiceStatus>("off");
  const mutedRef = useRef(false);
  const optionsRef = useRef(options);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const frameRef = useRef<number | null>(null);
  const wakeRef = useRef<WakeLock | null>(null);
  const vad = useRef({ speechMs: 0, hasSpeech: false, silenceStart: null as number | null, started: 0, lastTick: 0, bargeMs: 0, lastKey: 0, lastLevel: 0, discard: false });
  // The speaker: pieces of the answer, fetched as they come and played in order.
  const queueRef = useRef<Promise<Blob | null>[]>([]);
  const bufferRef = useRef("");
  const finishedRef = useRef(true);
  const playingRef = useRef(false);
  const generationRef = useRef(0);

  useEffect(() => {
    optionsRef.current = options;
  });

  const setStatus = useCallback((next: VoiceStatus) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);

  // Listening ---------------------------------------------------------------------------

  const listenRef = useRef<() => void>(() => undefined);

  const onRecorded = useCallback(
    async (chunks: Blob[], type: string, spoke: boolean) => {
      recorderRef.current = null;
      if (statusRef.current === "off") return;
      const discard = vad.current.discard || mutedRef.current;
      const audio = new Blob(chunks, { type });
      if (!spoke || discard || audio.size < MIN_BYTES) return listenRef.current();
      const hear = optionsRef.current.hear;
      if (!hear) return;
      setStatus("thinking");
      const form = new FormData();
      form.set("audio", audio, "message");
      const heard = await hear(form);
      // Voice mode may have ended while it was being heard.
      if ((statusRef.current as VoiceStatus) === "off") return;
      if (!heard.ok) {
        optionsRef.current.onProblem(heard.problem);
        return listenRef.current();
      }
      const text = heard.text.trim();
      if (!text || isNoiseTranscript(text)) return listenRef.current();
      finishedRef.current = false;
      optionsRef.current.onUtterance(text);
    },
    [setStatus],
  );

  const listen = useCallback(() => {
    const stream = streamRef.current;
    if (statusRef.current === "off" || !stream || recorderRef.current) return;
    const type = recorderType();
    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    const now = performance.now();
    vad.current = { ...vad.current, speechMs: 0, hasSpeech: false, silenceStart: null, started: now, lastTick: now, bargeMs: 0, discard: false };
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => void onRecorded(chunks, recorder.mimeType || type || "audio/webm", vad.current.hasSpeech);
    recorderRef.current = recorder;
    recorder.start();
    setStatus("listening");
  }, [onRecorded, setStatus]);

  useEffect(() => {
    listenRef.current = listen;
  }, [listen]);

  // Speaking --------------------------------------------------------------------------------

  const spokenAll = useCallback(() => {
    // In voice mode, listen again once the whole answer is said.
    if (statusRef.current === "speaking" || statusRef.current === "thinking") listenRef.current();
  }, []);

  const playNextRef = useRef<() => Promise<void>>(async () => undefined);
  const playNext = useCallback(async () => {
    const generation = generationRef.current;
    const next = queueRef.current.shift();
    if (!next) {
      playingRef.current = false;
      if (finishedRef.current) spokenAll();
      return;
    }
    playingRef.current = true;
    if (statusRef.current !== "off") setStatus("speaking");
    const blob = await next;
    if (generation !== generationRef.current) return;
    if (blob) {
      const audio = speakerElement();
      const url = URL.createObjectURL(blob);
      audio.src = url;
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        audio.play().catch(() => resolve());
      });
      URL.revokeObjectURL(url);
      if (generation !== generationRef.current) return;
    }
    void playNextRef.current();
  }, [setStatus, spokenAll]);

  useEffect(() => {
    playNextRef.current = playNext;
  }, [playNext]);

  const say = useCallback(
    (piece: string) => {
      const text = speakable(piece);
      if (!text) return;
      const { speakUrl } = optionsRef.current;
      queueRef.current.push(
        fetch(speakUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: text.slice(0, 600) }) })
          .then((response) => (response.ok ? response.blob() : null))
          .catch(() => null),
      );
      if (!playingRef.current) void playNext();
    },
    [playNext],
  );

  /** Stops speaking at once, dropping what was still to be said. */
  const stopSpeaking = useCallback(() => {
    generationRef.current += 1;
    queueRef.current = [];
    bufferRef.current = "";
    playingRef.current = false;
    finishedRef.current = true;
    speakerElement().pause();
  }, []);

  /** A new answer is coming: what is still being said of an older one stops. */
  const expectAnswer = useCallback(() => {
    stopSpeaking();
    finishedRef.current = false;
    if (statusRef.current !== "off") {
      recorderRef.current?.stop();
      vad.current.discard = true;
      setStatus("thinking");
    }
  }, [setStatus, stopSpeaking]);

  /** More of the answer's text: whole sentences are spoken as they come. */
  const feed = useCallback(
    (delta: string) => {
      bufferRef.current += delta;
      const { ready, rest } = takeSentences(bufferRef.current);
      bufferRef.current = rest;
      ready.forEach(say);
    },
    [say],
  );

  /** The answer is complete: the rest is spoken, then voice mode listens again. */
  const finish = useCallback(() => {
    const { ready } = takeSentences(bufferRef.current, true);
    bufferRef.current = "";
    ready.forEach(say);
    finishedRef.current = true;
    if (!playingRef.current && queueRef.current.length === 0) spokenAll();
  }, [say, spokenAll]);

  // The microphone's loudness, every frame ----------------------------------------------------------

  const tickRef = useRef<() => void>(() => undefined);
  const tick = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const samples = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const x of samples) sum += x * x;
    const rms = Math.sqrt(sum / samples.length);
    const now = performance.now();
    const v = vad.current;
    const step = Math.min(100, now - v.lastTick);
    v.lastTick = now;
    if (now - v.lastLevel > 70) {
      v.lastLevel = now;
      setLevel(mutedRef.current ? 0 : Math.min(1, rms * 8));
    }
    const status = statusRef.current;
    if (!mutedRef.current && (status === "listening" || status === "hearing")) {
      if (rms > START_THRESHOLD) {
        v.speechMs += step;
        if (v.speechMs >= MIN_SPEECH_MS && !v.hasSpeech) {
          v.hasSpeech = true;
          setStatus("hearing");
        }
        v.silenceStart = null;
      } else if (v.hasSpeech && rms < STOP_THRESHOLD) {
        if (v.silenceStart === null) v.silenceStart = now;
        else if (now - v.silenceStart > SILENCE_MS && recorderRef.current?.state === "recording") recorderRef.current.stop();
      }
      if (now - v.started > MAX_UTTERANCE_MS && recorderRef.current?.state === "recording") recorderRef.current.stop();
      if (v.lastKey >= v.started - KEYSTROKE_GUARD_MS) v.discard = true;
    } else if (!mutedRef.current && status === "speaking") {
      v.bargeMs = rms > BARGE_THRESHOLD ? v.bargeMs + step : 0;
      if (v.bargeMs >= BARGE_MS) {
        // They are talking over the answer: stop and listen.
        v.bargeMs = 0;
        stopSpeaking();
        listenRef.current();
      }
    }
    frameRef.current = requestAnimationFrame(() => tickRef.current());
  }, [setStatus, stopSpeaking]);

  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  // Starting and stopping ---------------------------------------------------------------------------

  const stop = useCallback(() => {
    if (statusRef.current === "off") return;
    setStatus("off");
    stopSpeaking();
    recorderRef.current?.stop();
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    void contextRef.current?.close().catch(() => undefined);
    contextRef.current = null;
    analyserRef.current = null;
    void wakeRef.current?.release().catch(() => undefined);
    wakeRef.current = null;
    const session = (navigator as AudioSessionNavigator).audioSession;
    if (session) session.type = "auto";
    setLevel(0);
  }, [setStatus, stopSpeaking]);

  const start = useCallback(async () => {
    if (statusRef.current !== "off") return;
    unlockVoiceAudio();
    setStatus("starting");
    // iOS: playing and recording at once needs this before the microphone opens.
    const session = (navigator as AudioSessionNavigator).audioSession;
    if (session) session.type = "play-and-record";
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      setStatus("off");
      optionsRef.current.onProblem("The browser did not let the page use the microphone.");
      return;
    }
    // Ended while the browser asked for the microphone.
    if ((statusRef.current as VoiceStatus) !== "starting") {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    streamRef.current = stream;
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    contextRef.current = context;
    analyserRef.current = analyser;
    const wake = (navigator as WakeLockNavigator).wakeLock;
    wakeRef.current = wake ? await wake.request("screen").catch(() => null) : null;
    frameRef.current = requestAnimationFrame(tick);
    listen();
  }, [listen, setStatus, tick]);

  const toggleMute = useCallback(() => {
    mutedRef.current = !mutedRef.current;
    setMuted(mutedRef.current);
    if (mutedRef.current && recorderRef.current) vad.current.discard = true;
  }, []);

  /** Stops the answer being spoken and listens at once. */
  const interrupt = useCallback(() => {
    stopSpeaking();
    if (statusRef.current !== "off") listenRef.current();
  }, [stopSpeaking]);

  // Keys pressed while listening mean typing, not talking.
  useEffect(() => {
    if (status === "off") return;
    const onKey = () => {
      vad.current.lastKey = performance.now();
    };
    const onVisible = () => {
      const wake = (navigator as WakeLockNavigator).wakeLock;
      if (document.visibilityState === "visible" && wake && !wakeRef.current) {
        void wake.request("screen").then((lock) => (wakeRef.current = lock), () => undefined);
      }
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [status]);

  // Leaving the page ends voice mode.
  useEffect(() => stop, [stop]);

  return { status, level, muted, active: status !== "off", start, stop, interrupt, toggleMute, expectAnswer, feed, finish, stopSpeaking };
}
