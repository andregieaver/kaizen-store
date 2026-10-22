"use client";

import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

import type { ThemeSwatch } from "@/lib/theme-store";
import type { PlatformMessages } from "@/lib/platform-text";

import { SwatchDot } from "./theme-swatch";

/** A look of the theme as the stage shows it: its own look (`key` null) or a preset, with its colours and where it is previewed. */
export type StageLook = {
  key: string | null;
  name: string;
  swatch: ThemeSwatch | null;
  /** The live preview for the frames (the store alone), or null while the theme has no published content to show it on. */
  frameHref: string | null;
  /** The full-screen preview in the theme store (D275), or null as `frameHref`. */
  previewHref: string | null;
  /** *Add it to your store* with this look. */
  tryHref: string;
  /** *Use this theme*: sign-up with this look chosen. */
  startHref: string;
  /** Its photographed first screens (`docs/theme-showcase-phase-2.md` step 1), shown in each frame while the live preview loads. */
  computerPoster?: string | null;
  phonePoster?: string | null;
};

/** The stage's words in the page's language (D312 P3): plain texts, `{name}` the look's name, as a client part takes them. */
export type StageWords = PlatformMessages["themeStore"]["stage"];

const named = (text: string, name: string) => text.replaceAll("{name}", name);

/** The width a frame draws the store at, scaled down to the frame's own: a computer's and a phone's (`theme-shoot.ts`'s widths). */
const COMPUTER = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 780 };

/**
 * The store at a device's width, scaled to fit its frame, with its photograph behind it until the live preview is drawn. Without
 * JavaScript the preview fills the frame at the frame's own width.
 */
function ScaledFrame({ src, title, device, poster }: { src: string; title: string; device: typeof COMPUTER; poster?: string | null }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = () => setScale(element.clientWidth / device.width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [device.width]);
  return (
    <div
      ref={box}
      className="relative w-full overflow-hidden bg-background"
      style={{
        aspectRatio: `${device.width} / ${device.height}`,
        ...(poster ? { backgroundImage: `url(${JSON.stringify(poster)})`, backgroundSize: "100% auto", backgroundPosition: "top", backgroundRepeat: "no-repeat" } : {}),
      }}
    >
      {/* Lazy, so a frame not shown (the computer's, on a phone) loads nothing. */}
      <iframe
        src={src}
        title={title}
        loading="lazy"
        className="absolute left-0 top-0 border-0"
        style={
          scale
            ? { width: device.width, height: device.height, transform: `scale(${scale})`, transformOrigin: "top left" }
            : { width: "100%", height: "100%" }
        }
      />
    </div>
  );
}

/** The theme's colours where it has no content to preview yet. */
function ColourPanel({ swatch }: { swatch: ThemeSwatch | null }) {
  const s = swatch ?? { background: "#f5f5f5", surface: "#ffffff", text: "#111111", accent: "#111111", accentText: "#ffffff", heading: null };
  return (
    <div aria-hidden="true" className="flex aspect-[16/7] w-full items-end gap-3 rounded-lg p-8" style={{ background: s.background }}>
      <span className="h-12 w-32 rounded-full" style={{ background: s.accent }} />
      <span className="size-12 rounded-full" style={{ background: s.surface, boxShadow: `inset 0 0 0 1px ${s.text}22` }} />
      <span className="size-12 rounded-full" style={{ background: s.text }} />
    </div>
  );
}

type StageProps = { title: string; heading: ReactNode; looks: StageLook[]; words: StageWords };

function Stage({ title, heading, looks, words: w, initial }: StageProps & { initial: string | null }) {
  const [chosen, setChosen] = useState<string | null>(initial);
  const look = looks.find((l) => l.key === chosen) ?? looks[0];
  const name = look.key ? `${title} · ${look.name}` : title;
  const choose = (key: string | null) => {
    setChosen(key);
    // The address keeps the look, so a shared link opens on it; the page itself is the same for everyone (prerendered).
    const url = new URL(window.location.href);
    if (key) url.searchParams.set("preset", key);
    else url.searchParams.delete("preset");
    window.history.replaceState(null, "", url);
  };
  return (
    <section aria-label={title} className="flex flex-col gap-6">
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="flex max-w-2xl flex-col gap-2">{heading}</div>
        {/* Always for the chosen look. */}
        <div className="flex flex-col gap-2 md:items-end">
          <div className="flex flex-wrap gap-3">
            <a href={look.startHref} className="button-primary inline-flex min-h-11 items-center rounded-button px-6 font-medium">
              {w.use}
              <span className="sr-only">{look.key ? `: ${name}` : ""}</span>
            </a>
            {look.previewHref && (
              <a href={look.previewHref} className="inline-flex min-h-11 items-center rounded-button border border-border px-6 font-medium">
                {w.preview}
                <span className="sr-only"> {named(w.fullScreen, name)}</span>
              </a>
            )}
          </div>
          {/* A route that knows who is signed in, then the admin (another root layout): a plain link (`docs/theme-phase-3.md` step 2). */}
          <a href={look.tryHref} className="text-sm text-muted underline underline-offset-2">
            {w.addToStore}
          </a>
        </div>
      </div>

      {look.frameHref ? (
        <div className="flex items-start gap-6">
          <div className="hidden min-w-0 flex-1 overflow-hidden rounded-lg border border-border shadow-sm lg:block">
            <ScaledFrame src={look.frameHref} title={named(w.onComputer, name)} device={COMPUTER} poster={look.computerPoster} />
          </div>
          <div className="mx-auto w-full max-w-[320px] shrink-0 overflow-hidden rounded-[2rem] border-8 border-foreground shadow-sm lg:w-[260px]">
            <ScaledFrame src={look.frameHref} title={named(w.onPhone, name)} device={PHONE} poster={look.phonePoster} />
          </div>
        </div>
      ) : (
        <ColourPanel swatch={look.swatch} />
      )}

      {looks.length > 1 && (
        <div className="flex flex-col gap-2">
          {/* Each look a dot in its colours; without JavaScript each is a link to that look's full-screen preview. */}
          <ul aria-label={w.presets} className="flex flex-wrap gap-2">
            {looks.map((choice) => {
              const current = choice.key === look.key ? "true" : undefined;
              const className =
                "flex min-h-11 items-center gap-2 rounded-full border border-border py-1 pl-1.5 pr-4 text-sm aria-[current=true]:border-foreground aria-[current=true]:font-medium";
              const label = (
                <>
                  <SwatchDot swatch={choice.swatch} />
                  {choice.name}
                </>
              );
              return (
                <li key={choice.key ?? ""}>
                  {choice.previewHref ? (
                    <a
                      href={choice.previewHref}
                      aria-current={current}
                      onClick={(event) => {
                        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                        event.preventDefault();
                        choose(choice.key);
                      }}
                      className={className}
                    >
                      {label}
                    </a>
                  ) : (
                    // Nothing to preview yet (no published content): the colours change in place.
                    <button type="button" aria-current={current} onClick={() => choose(choice.key)} className={className}>
                      {label}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {look.frameHref && <p className="text-sm text-muted">{w.sample}</p>}
    </section>
  );
}

/** Reads the chosen look from the address (`?preset=`) once in the browser; the prerendered page starts on the theme's own look. */
function FromAddress(props: StageProps) {
  const value = useSearchParams().get("preset");
  const initial = value && props.looks.some((look) => look.key === value) ? value : null;
  return <Stage {...props} initial={initial} />;
}

/**
 * The top of a theme's page in the theme store (D275, `docs/themes-content-and-demo-stores.md` section 6): its name and sentence, a
 * computer and a phone showing the chosen look on the theme's own content (its photograph at once, the live preview over it), its presets
 * as swatches under the frames, and the two buttons for the chosen look: *Use this theme* and *Preview* (full screen), with a quiet way to
 * add it to a store one already has. The address keeps the chosen look (`?preset=`).
 */
export function ThemePreviewStage(props: StageProps) {
  return (
    <Suspense fallback={<Stage {...props} initial={null} />}>
      <FromAddress {...props} />
    </Suspense>
  );
}
