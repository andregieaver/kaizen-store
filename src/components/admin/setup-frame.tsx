import Link from "next/link";
import type { ReactNode } from "react";

import { SETUP_STEPS, type SetupProgress, type SetupStepId } from "@/server/setup";

/**
 * The frame around every setup step: where you are, what is done, and a way
 * to move on without finishing (everything can be done later from the
 * checklist on the overview).
 */
export function SetupFrame({
  storeSlug,
  storeName,
  step,
  progress,
  title,
  intro,
  children,
}: {
  storeSlug: string;
  storeName: string;
  step: SetupStepId;
  progress: SetupProgress;
  title: string;
  intro: ReactNode;
  children: ReactNode;
}) {
  const index = SETUP_STEPS.findIndex((s) => s.id === step);
  const previous = SETUP_STEPS[index - 1];
  const next = SETUP_STEPS[index + 1];
  const done = (id: SetupStepId) => id !== "launch" && progress[id];
  const base = `/admin/${storeSlug}/setup`;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <nav aria-label="Setup steps">
        <p className="mb-3 text-sm text-muted">
          Setting up {storeName} · Step {index + 1} of {SETUP_STEPS.length}
        </p>
        <ol className="grid grid-cols-5 gap-2 text-xs sm:text-sm">
          {SETUP_STEPS.map((s, i) => (
            <li key={s.id}>
              <Link
                href={`${base}/${s.id}`}
                aria-current={s.id === step ? "step" : undefined}
                className="flex flex-col gap-1.5 rounded-md py-1 aria-[current=step]:font-semibold"
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 rounded-full ${
                    s.id === step ? "bg-foreground" : done(s.id) ? "bg-foreground/50" : "bg-border"
                  }`}
                />
                <span>
                  <span className="sr-only">
                    Step {i + 1}: {done(s.id) ? "done, " : ""}
                  </span>
                  {s.title}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </nav>

      <section aria-labelledby="step-title" className="rounded-lg border border-border bg-background p-6">
        <h1 id="step-title" className="mb-2 text-2xl font-semibold">
          {title}
        </h1>
        <div className="mb-6 text-sm text-muted">{intro}</div>
        {children}
      </section>

      <div className="flex justify-between text-sm">
        {previous ? (
          <Link href={`${base}/${previous.id}`} className="underline">
            Back
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link href={`${base}/${next.id}`} className="underline">
            Skip for now
          </Link>
        )}
      </div>
    </div>
  );
}
