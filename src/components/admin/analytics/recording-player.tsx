"use client";

import "@rrweb/replay/dist/style.css";

import { useEffect, useRef, useState } from "react";

import { timelineMarks, type TimelineMark } from "@/lib/recording";

/**
 * The player of a recording of a visit (D656, `docs/heatmaps-and-recordings.md` step 11): rrweb's replayer, loaded only here, fed the
 * events the server sanitised. Its frame keeps rrweb's sandbox (no scripts, never `allow-scripts`, never the unsafe canvas), and the page's
 * policy (`replayRouteHeaders()`) keeps what a replayed page may load to the admin's own files. The replay is scaled to the column; the
 * controls are play and pause, the speed, skipping the quiet parts, and a timeline whose marks are the pages and the frustrated clicks,
 * listed beside it so a press seeks there.
 */

type Replayer = import("@rrweb/replay").Replayer;

export type PlayerWords = {
  play: string;
  pause: string;
  speed: string;
  skip: string;
  events: string;
  page: string;
  deadClick: string;
  rageClick: string;
  click: string;
  loading: string;
  failed: string;
  none: string;
};

const SPEEDS = [1, 2, 4, 8] as const;

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** A page as the owner reads it: without the storefront's `/s/{store}` prefix, which a store on its own address does not have. */
const shownPath = (path: string) => path.replace(/^\/s\/[^/]+(?=\/|$)/, "") || "/";

export function RecordingPlayer({ eventsUrl, words }: { eventsUrl: string; words: PlayerWords }) {
  const stage = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const player = useRef<Replayer | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed" | "none">("loading");
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [skip, setSkip] = useState(true);
  const [now, setNow] = useState(0);
  const [total, setTotal] = useState(0);
  const [start, setStart] = useState(0);
  const [marks, setMarks] = useState<TimelineMark[]>([]);

  useEffect(() => {
    let alive = true;
    let observer: ResizeObserver | null = null;
    (async () => {
      try {
        const answer = await fetch(eventsUrl, { cache: "no-store" });
        if (!answer.ok) throw new Error(String(answer.status));
        const events = (await answer.json()) as { type: number; timestamp: number }[];
        if (!alive) return;
        if (events.length < 2 || !events.some((e) => e.type === 2)) {
          setState("none");
          return;
        }
        const { Replayer } = await import("@rrweb/replay");
        if (!alive || !stage.current) return;
        const replayer = new Replayer(events as never, { root: stage.current, skipInactive: true, mouseTail: false, showWarning: false });
        player.current = replayer;
        const meta = replayer.getMetaData();
        setTotal(meta.totalTime);
        setStart(meta.startTime);
        setMarks(timelineMarks(events));
        replayer.on("finish", () => setPlaying(false));
        // Scaled to the column: the replay keeps the visitor's screen size inside.
        const fit = () => {
          const wrapper = stage.current?.querySelector<HTMLElement>(".replayer-wrapper");
          const frame = replayer.iframe;
          if (!wrapper || !frame || !box.current) return;
          const width = Number(frame.getAttribute("width")) || frame.clientWidth;
          const height = Number(frame.getAttribute("height")) || frame.clientHeight;
          if (!width) return;
          const scale = Math.min(1, box.current.clientWidth / width);
          wrapper.style.transform = `scale(${scale})`;
          wrapper.style.transformOrigin = "top left";
          box.current.style.height = `${Math.round(height * scale)}px`;
          // A phone's narrow screen sits in the middle of the column.
          if (stage.current) stage.current.style.left = `${Math.max(0, Math.round((box.current.clientWidth - width * scale) / 2))}px`;
        };
        observer = new ResizeObserver(fit);
        if (box.current) observer.observe(box.current);
        replayer.on("resize", fit);
        replayer.pause(0);
        fit();
        setState("ready");
      } catch {
        if (alive) setState("failed");
      }
    })();
    return () => {
      alive = false;
      observer?.disconnect();
      player.current?.pause();
      player.current = null;
    };
  }, [eventsUrl]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setNow(player.current?.getCurrentTime() ?? 0), 250);
    return () => window.clearInterval(timer);
  }, [playing]);

  const seek = (at: number) => {
    const replayer = player.current;
    if (!replayer) return;
    const offset = Math.max(0, Math.min(total, at));
    if (playing) replayer.play(offset);
    else replayer.pause(offset);
    setNow(offset);
  };
  const toggle = () => {
    const replayer = player.current;
    if (!replayer) return;
    if (playing) {
      replayer.pause();
      setPlaying(false);
    } else {
      replayer.play(now >= total ? 0 : now);
      setPlaying(true);
    }
  };
  const label = (mark: TimelineMark) =>
    mark.kind === "page" ? words.page.replace("{path}", shownPath(mark.path ?? "")) : mark.kind === "rage" ? words.rageClick : mark.kind === "dead" ? words.deadClick : words.click;
  // Marks are times from the session's start; the replayer counts from its first event.
  const offsetOf = (mark: TimelineMark) => mark.at - start;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
      <div className="flex flex-col gap-3">
        <div ref={box} className="relative w-full overflow-hidden rounded-lg border border-line bg-sunken" style={{ minHeight: 240 }}>
          <div ref={stage} data-recording-stage className="absolute left-0 top-0" />
          {state !== "ready" ? (
            <p className="absolute inset-0 grid place-items-center p-6 text-sm text-muted">
              {state === "loading" ? words.loading : state === "failed" ? words.failed : words.none}
            </p>
          ) : null}
        </div>
        {state === "ready" ? (
          <div className="flex flex-col gap-3">
            <div className="relative">
              <input
                type="range"
                min={0}
                max={Math.max(1, total)}
                value={Math.min(now, total)}
                onChange={(e) => seek(Number(e.target.value))}
                aria-label={clock(now)}
                className="w-full"
              />
              <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 -bottom-1 h-2">
                {marks.map((mark, i) => (
                  <span
                    key={i}
                    className={`absolute top-0 h-2 w-1 rounded ${mark.kind === "rage" ? "bg-(--chart-warn)" : mark.kind === "dead" ? "bg-ink-2" : mark.kind === "page" ? "bg-brand" : "bg-muted"}`}
                    style={{ left: `${total ? (offsetOf(mark) / total) * 100 : 0}%` }}
                  />
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <button type="button" onClick={toggle} className="min-h-10 rounded-pill bg-brand px-4 font-medium text-brand-ink">
                {playing ? words.pause : words.play}
              </button>
              <span className="tabular-nums text-muted">
                {clock(now)} / {clock(total)}
              </span>
              <span className="flex items-center gap-1" role="group" aria-label={words.speed}>
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={speed === s}
                    onClick={() => {
                      setSpeed(s);
                      player.current?.setConfig({ speed: s });
                    }}
                    className={`min-h-9 rounded-panel border px-2.5 ${speed === s ? "border-brand bg-sunken font-medium" : "border-line"}`}
                  >
                    {s}×
                  </button>
                ))}
              </span>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={skip}
                  onChange={(e) => {
                    setSkip(e.target.checked);
                    player.current?.setConfig({ skipInactive: e.target.checked });
                  }}
                />
                {words.skip}
              </label>
            </div>
          </div>
        ) : null}
      </div>
      {state === "ready" ? (
        <section aria-label={words.events} className="flex flex-col gap-2">
          <h2 className="text-title text-ink">{words.events}</h2>
          <ol className="flex max-h-[32rem] flex-col divide-y divide-line overflow-y-auto rounded-lg border border-line bg-card text-sm">
            {marks.map((mark, i) => (
              <li key={i}>
                <button type="button" onClick={() => seek(offsetOf(mark))} className="flex w-full items-baseline gap-3 px-3 py-2 text-left hover:bg-sunken">
                  <span className="tabular-nums text-muted">{clock(offsetOf(mark))}</span>
                  <span className="break-all">{label(mark)}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
