"use client";

import { useState } from "react";

/** A look of the theme as the stage shows it: its own look (`key` null) or a preset, and where its demo store is. */
export type StageLook = {
  key: string | null;
  name: string;
  /** The trade of the demo store it is shown on ("Fashion"), or null for the Standard store. */
  trade: string | null;
  /** "Field & Fold, a demo fashion store", or null for the Standard store. */
  line: string | null;
  /** The preview for the frames (the store alone). */
  frameHref: string;
  /** The preview to open in a new window. */
  previewHref: string;
  /** *Try it in your store* with this look. */
  tryHref: string;
  /** Sign-up with this look chosen, and the store template of its demo store (`docs/theme-showcase-phase-1.md` step 4). */
  startHref: string;
  /** Its photographed first screens (`docs/theme-showcase-phase-2.md` step 1), shown in each frame while the live preview loads. */
  computerPoster?: string | null;
  phonePoster?: string | null;
};

/** A frame's photograph behind it, at the frame's width from the top: the live preview, once drawn, covers it. */
const poster = (url: string | null | undefined) =>
  url ? { backgroundImage: `url(${JSON.stringify(url)})`, backgroundSize: "100% auto", backgroundPosition: "top", backgroundRepeat: "no-repeat" } : undefined;

/**
 * A theme's previews on its page in the theme store (`docs/theme-showcase-phase-1.md` steps 1 and 3): a demo store at computer and phone
 * widths, and, when the theme has presets, a choice of them above the frames. Each look is shown on the demo store of its trade (a content
 * pack) where its listing names one, else on the Standard store. Choosing one shows it in both frames and offers to try that look in a store.
 * Without JavaScript each choice is a link to that look's preview in a new window.
 */
export function ThemePreviewStage({ title, looks }: { title: string; looks: StageLook[] }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const look = looks.find((l) => l.key === chosen) ?? looks[0];
  const name = look.key ? `${title} · ${look.name}` : title;
  const presets = looks.length - 1;
  return (
    <div className="flex flex-col gap-4">
      {presets > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            {looks.length} presets: ready-made designs of {title}, each with its own colours, fonts and buttons{looks.some((l) => l.trade) ? ", shown on a store of its trade" : ""}.
          </p>
          <ul aria-label="Presets" className="flex flex-wrap gap-2">
            {looks.map((choice) => (
              <li key={choice.key ?? ""}>
                <a
                  href={choice.previewHref}
                  target="_blank"
                  rel="noopener"
                  aria-current={choice.key === look.key ? "true" : undefined}
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                    event.preventDefault();
                    setChosen(choice.key);
                  }}
                  className="flex min-h-10 flex-col justify-center rounded-button border border-border px-4 py-1 text-sm aria-[current=true]:border-foreground aria-[current=true]:font-medium"
                >
                  <span>{choice.name}</span>
                  {choice.trade && <span className="text-xs font-normal text-muted">{choice.trade}</span>}
                </a>
              </li>
            ))}
          </ul>
          {look.key && (
            <p className="flex flex-wrap gap-3 text-sm">
              <a href={look.startHref} className="underline underline-offset-2">
                Start a store with {name}
              </a>
              <a href={look.tryHref} className="underline underline-offset-2">
                Try {name} in your store
              </a>
              <a href={look.previewHref} target="_blank" rel="noopener" className="underline underline-offset-2">
                Open {name}&apos;s preview<span className="sr-only"> (opens in a new window)</span>
              </a>
            </p>
          )}
        </div>
      )}
      <div className="flex flex-col items-start gap-6 lg:flex-row">
        <div className="w-full overflow-hidden rounded-lg border border-border lg:flex-1" style={poster(look.computerPoster)}>
          <iframe src={look.frameHref} title={`${name} on a computer`} loading="lazy" className="h-[640px] w-full" />
        </div>
        <div className="mx-auto w-[390px] max-w-full shrink-0 overflow-hidden rounded-[2rem] border-8 border-foreground" style={poster(look.phonePoster)}>
          <iframe src={look.frameHref} title={`${name} on a phone`} loading="lazy" className="h-[640px] w-full" />
        </div>
      </div>
      {look.line && <p className="text-sm text-muted">Shown on {look.line}. Its products, words and pictures are a demo.</p>}
    </div>
  );
}
