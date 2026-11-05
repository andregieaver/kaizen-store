"use client";

import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";

import { CARD_CLASS } from "@/components/admin/ui";

export type GuideStep = { key: string; title: string; hint: string; href?: string; link?: string };

/**
 * The guided path beside the front page in the page builder's sandbox (D457 S4, `docs/builder-sandbox.md` 2): four short steps, each ticked
 * off or skipped, the whole hidden in one press. What was ticked and hidden is this browser's alone (`localStorage`, under the sandbox's
 * id); without storage the path simply starts again. Its words come from the server (the sandbox's catalogue is server-only).
 */
export function SandboxGuide({
  sandboxId,
  title,
  done,
  hide,
  steps,
}: {
  sandboxId: string;
  title: string;
  /** The words of a step's tick: *Done*. */
  done: string;
  hide: string;
  steps: readonly GuideStep[];
}) {
  const key = `kaizen_sandbox_guide_${sandboxId}`;
  const [ticked, setTicked] = useState<string[]>([]);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    let kept: { ticked?: string[]; hidden?: boolean } = {};
    try {
      kept = JSON.parse(window.localStorage.getItem(key) ?? "{}") as typeof kept;
    } catch {
      kept = {};
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from this browser's storage after the first paint
    setTicked(Array.isArray(kept.ticked) ? kept.ticked.filter((k) => typeof k === "string") : []);
    setHidden(kept.hidden === true);
  }, [key]);

  const keep = (next: { ticked: string[]; hidden: boolean }) => {
    setTicked(next.ticked);
    setHidden(next.hidden);
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Without storage the path starts again next time.
    }
  };

  const left = steps.filter((step) => !ticked.includes(step.key));
  if (hidden || left.length === 0) return null;
  return (
    <aside aria-label={title} data-sandbox-guide="" className={`${CARD_CLASS} mb-3 flex flex-wrap items-start gap-3 px-4 py-3`}>
      <p className="text-body-strong text-ink basis-full sm:basis-auto sm:pt-1">{title}</p>
      <ol className="flex flex-1 flex-wrap gap-3">
        {steps.map((step) => {
          const isDone = ticked.includes(step.key);
          return (
            <li key={step.key} className={`flex min-w-[200px] flex-1 items-start gap-2 ${isDone ? "opacity-60" : ""}`}>
              <button
                type="button"
                aria-pressed={isDone}
                aria-label={`${done}: ${step.title}`}
                onClick={() => keep({ ticked: isDone ? ticked.filter((k) => k !== step.key) : [...ticked, step.key], hidden: false })}
                className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-line text-ink hover:border-ink"
              >
                {isDone && <Check aria-hidden className="size-4" />}
              </button>
              <span className="flex flex-col">
                <span className="text-body-strong text-ink">{step.title}</span>
                <span className="text-body text-muted">
                  {step.hint}
                  {step.href && step.link && (
                    <>
                      {" "}
                      <a href={step.href} className="text-ink underline">
                        {step.link}
                      </a>
                    </>
                  )}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
      <button type="button" onClick={() => keep({ ticked, hidden: true })} className="flex items-center gap-1 text-body text-ink-2 underline">
        <X aria-hidden className="size-4" />
        {hide}
      </button>
    </aside>
  );
}
