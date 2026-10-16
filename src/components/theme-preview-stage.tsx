"use client";

import { useState } from "react";

/** An address with one of the theme's presets (`preset={key}`), or without one for its own look; full or relative as it was given. */
function withPreset(href: string, key: string | null): string {
  const absolute = /^https?:\/\//.test(href);
  const url = new URL(href, "http://x");
  if (key) url.searchParams.set("preset", key);
  else url.searchParams.delete("preset");
  return absolute ? url.toString() : `${url.pathname}${url.search}`;
}

/**
 * A theme's previews on its page in the theme store (`docs/theme-showcase-phase-1.md` step 1): the demo store at computer and phone widths,
 * and, when the theme has presets, a choice of them above the frames. Choosing one shows it in both frames and offers to try that preset in a
 * store. Without JavaScript each choice is a link to that preset's preview in a new window.
 */
export function ThemePreviewStage({
  title,
  presets,
  frameHref,
  previewHref,
  tryHref,
}: {
  title: string;
  presets: { key: string; name: string }[];
  /** The preview for the frames (the store alone). */
  frameHref: string;
  /** The preview to open in a new window. */
  previewHref: string;
  /** *Try it in your store*. */
  tryHref: string;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const preset = presets.find((p) => p.key === chosen) ?? null;
  const name = preset ? `${title} · ${preset.name}` : title;
  const frame = withPreset(frameHref, chosen);
  return (
    <div className="flex flex-col gap-4">
      {presets.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            {presets.length + 1} presets: ready-made designs of {title}, each with its own colours, fonts and buttons.
          </p>
          <ul aria-label="Presets" className="flex flex-wrap gap-2">
            {[null, ...presets].map((choice) => {
              const key = choice?.key ?? null;
              return (
                <li key={key ?? ""}>
                  <a
                    href={withPreset(previewHref, key)}
                    target="_blank"
                    rel="noopener"
                    aria-current={key === chosen ? "true" : undefined}
                    onClick={(event) => {
                      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                      event.preventDefault();
                      setChosen(key);
                    }}
                    className="flex min-h-10 items-center rounded-button border border-border px-4 text-sm aria-[current=true]:border-foreground aria-[current=true]:font-medium"
                  >
                    {choice ? choice.name : title}
                  </a>
                </li>
              );
            })}
          </ul>
          {preset && (
            <p className="flex flex-wrap gap-3 text-sm">
              <a href={withPreset(tryHref, preset.key)} className="underline underline-offset-2">
                Try {name} in your store
              </a>
              <a href={withPreset(previewHref, preset.key)} target="_blank" rel="noopener" className="underline underline-offset-2">
                Open {name}&apos;s preview<span className="sr-only"> (opens in a new window)</span>
              </a>
            </p>
          )}
        </div>
      )}
      <div className="flex flex-col items-start gap-6 lg:flex-row">
        <div className="w-full overflow-hidden rounded-lg border border-border lg:flex-1">
          <iframe src={frame} title={`${name} on a computer`} loading="lazy" className="h-[640px] w-full" />
        </div>
        <div className="mx-auto w-[390px] max-w-full shrink-0 overflow-hidden rounded-[2rem] border-8 border-foreground">
          <iframe src={frame} title={`${name} on a phone`} loading="lazy" className="h-[640px] w-full" />
        </div>
      </div>
    </div>
  );
}
