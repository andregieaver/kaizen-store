import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import type { SetupStep, SetupStepId } from "@/lib/setup-steps";
import type { SetupProgress } from "@/server/setup";
import { ButtonLink, CARD_CLASS } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { setupEn, type SetupMessages } from "@/lib/admin-messages/setup.en";

/**
 * The frame around every setup step: where you are, what is done, and a way
 * to move on without finishing (everything can be done later from the
 * checklist on the overview). The steps are the store's own (`setupStepsFor()`): they follow its features (D178 step 6).
 */
export function SetupFrame({
  storeSlug,
  steps,
  step,
  progress,
  title,
  intro,
  children,
  w = setupEn.frame,
}: {
  storeSlug: string;
  /** Named in the top bar of the `focus` layout ("Setting up …"), so not repeated here. */
  storeName?: string;
  steps: SetupStep[];
  step: SetupStepId;
  progress: SetupProgress;
  title: string;
  intro: ReactNode;
  children: ReactNode;
  /** The frame's words in the account's language (`adminText(lang, "setup").frame`); the steps come named in it. */
  w?: SetupMessages["frame"];
}) {
  const index = steps.findIndex((s) => s.id === step);
  const previous = steps[index - 1];
  const next = steps[index + 1];
  const done = (id: SetupStepId) => id !== "launch" && progress[id];
  const base = `/admin/${storeSlug}/setup`;

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={w.steps}>
        <p className="mb-3 text-eyebrow text-muted uppercase">
          {fillWords(w.stepOf, { n: index + 1, count: steps.length })}
        </p>
        <ol className="flex gap-2 text-caption sm:text-body">
          {steps.map((s, i) => (
            <li key={s.id} className="min-w-0 flex-1">
              <Link
                href={`${base}/${s.id}`}
                aria-current={s.id === step ? "step" : undefined}
                className="flex flex-col gap-1.5 rounded-pill py-1 text-ink-2 hover:text-ink aria-[current=step]:text-body-strong aria-[current=step]:text-ink"
              >
                <span aria-hidden="true" className={`h-1.5 rounded-pill ${s.id === step ? "bg-brand" : done(s.id) ? "bg-brand/50" : "bg-line"}`} />
                <span className="truncate">
                  <span className="sr-only">
                    {fillWords(done(s.id) ? w.stepDone : w.stepNumber, { n: i + 1 })}
                  </span>
                  {s.title}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </nav>

      <section aria-labelledby="step-title" className={`p-6 sm:p-8 ${CARD_CLASS}`}>
        <h1 id="step-title" className="mb-2 text-display text-ink">
          {title}
        </h1>
        <div className="mb-6 text-body text-ink-2">{intro}</div>
        {children}
      </section>

      <div className="flex items-center justify-between gap-3">
        {previous ? (
          <ButtonLink href={`${base}/${previous.id}`} kind="quiet" icon={<ChevronLeft />}>
            {w.back}
          </ButtonLink>
        ) : (
          <span />
        )}
        {next && (
          <ButtonLink href={`${base}/${next.id}`} kind="secondary">
            {w.skip}
          </ButtonLink>
        )}
      </div>
    </div>
  );
}
