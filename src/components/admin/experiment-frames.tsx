"use client";

import { Monitor, Smartphone } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { useAdminText } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";

/** The widths a page is drawn at, as a computer and a phone show it. */
const WIDTHS = { computer: 1280, phone: 390 } as const;
type Width = keyof typeof WIDTHS;
/** How tall each frame is on the screen; the page scrolls inside it. */
const SHOWN_HEIGHT = 520;

const NARROW = "(max-width: 640px)";
const subscribeNarrow = (change: () => void) => {
  const query = window.matchMedia(NARROW);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
};
const isNarrow = () => window.matchMedia(NARROW).matches;

export type FrameVersion = { key: string; name: string; src: string };

/** One page in a frame, drawn at the chosen width and scaled down to fit its half. */
function ScaledFrame({ version, width, label }: { version: FrameVersion; width: Width; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const seen = new ResizeObserver(([entry]) => setRoom(entry.contentRect.width));
    seen.observe(el);
    return () => seen.disconnect();
  }, []);
  const drawn = WIDTHS[width];
  const scale = room > 0 ? Math.min(1, room / drawn) : 1;
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="text-body-strong text-ink">{version.name}</figcaption>
      <div ref={box} className="overflow-hidden rounded-card border border-edge bg-card" style={{ height: SHOWN_HEIGHT }}>
        {room > 0 && (
          <iframe
            src={version.src}
            title={fillWords(label, { name: version.name })}
            loading="lazy"
            className="block origin-top-left border-0"
            style={{ width: drawn, height: SHOWN_HEIGHT / scale, transform: `scale(${scale})`, marginInline: scale === 1 ? "auto" : undefined }}
          />
        )}
      </div>
    </figure>
  );
}

/**
 * The original and a version side by side (D148 phase 16, `docs/ab-testing-usability.md` step 2b): each drawn alone by the frame route at a
 * computer's or a phone's width and scaled to half the space, so the owner sees what visitors are shown without opening two tabs. With
 * several versions, one is chosen at a time; the original stays on the left.
 */
export function ExperimentFrames({ versions }: { versions: readonly FrameVersion[] }) {
  const w = useAdminText("experiments").frames;
  const original = versions.find((v) => v.key === "a");
  const others = versions.filter((v) => v.key !== "a");
  const [shown, setShown] = useState(others[0]?.key ?? "");
  const [chosen, setWidth] = useState<Width | null>(null);
  // On a narrow screen a computer's width scaled into half of it cannot be read: until one is chosen, a phone's.
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow, () => false);
  const width: Width = chosen ?? (narrow ? "phone" : "computer");
  const version = others.find((v) => v.key === shown) ?? others[0];
  if (!original || !version) return null;
  const widthOption = (value: Width, Icon: typeof Monitor, label: string) => (
    <button
      type="button"
      aria-pressed={width === value}
      onClick={() => setWidth(value)}
      className="flex min-h-9 items-center gap-1.5 rounded-pill px-3 text-sm text-ink-2 hover:text-ink aria-pressed:bg-inverse aria-pressed:text-inverse-ink"
    >
      <Icon aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />
      {label}
    </button>
  );
  return (
    <section aria-labelledby="ab-frames" className="flex flex-col gap-4" data-frames>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="ab-frames" className="text-title text-ink">
            {w.title}
          </h2>
          <p className="max-w-[75ch] text-body text-ink-2">{w.intro}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {others.length > 1 && (
            <div role="group" aria-label={w.which} className="flex items-center gap-0.5 rounded-pill border border-edge p-0.5">
              {others.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  aria-pressed={v.key === version.key}
                  onClick={() => setShown(v.key)}
                  className="flex min-h-9 items-center rounded-pill px-3 text-sm text-ink-2 hover:text-ink aria-pressed:bg-inverse aria-pressed:text-inverse-ink"
                >
                  {v.name}
                </button>
              ))}
            </div>
          )}
          <div role="group" aria-label={w.width} className="flex items-center gap-0.5 rounded-pill border border-edge p-0.5">
            {widthOption("computer", Monitor, w.computer)}
            {widthOption("phone", Smartphone, w.phone)}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <ScaledFrame key={`a-${width}`} version={original} width={width} label={w.frameTitle} />
        <ScaledFrame key={`${version.key}-${width}`} version={version} width={width} label={w.frameTitle} />
      </div>
    </section>
  );
}
