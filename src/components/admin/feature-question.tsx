import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { EXTRA_ANSWER_WORDS, EXTRA_ANSWERS, SELL_ANSWER_WORDS, SELL_ANSWERS, type OnboardingAnswers } from "@/lib/onboarding";

/** What switching off one of the features on now would mean (`featureWarnings()`), shown over the form's confirmation tick. */
export type QuestionWarning = { label: string; lines: string[] };

/**
 * The setup wizard's first question, "What will you sell?" (D178 step 6): what the store sells (several), or just a website, and what else it
 * does. Pre-filled from the features on now (`answersForFeatures()`). When leaving something out would switch off a feature that has something
 * set up (a store template's appointment products, say), the warnings are listed and a tick confirms them, as the Features page's *Switch off*
 * does. Plain markup: it works without JavaScript.
 */
export function FeatureQuestion({
  action,
  answers,
  warnings,
  note,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  answers: OnboardingAnswers;
  warnings: QuestionWarning[];
  note: string | null;
}) {
  return (
    <ActionForm action={action} className="flex flex-col gap-5">
      {note && <p className="rounded-md border border-border p-3 text-sm">{note}</p>}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">I will sell</legend>
        {SELL_ANSWERS.map((answer) => (
          <label key={answer} className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="sells" value={answer} defaultChecked={answers.sells.includes(answer)} className="mt-1" />
            <span className="flex flex-col">
              <span className="font-medium">{SELL_ANSWER_WORDS[answer].label}</span>
              <span className="text-muted">{SELL_ANSWER_WORDS[answer].words}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">And I want to</legend>
        {EXTRA_ANSWERS.map((answer) => (
          <label key={answer} className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="extras" value={answer} defaultChecked={answers.extras.includes(answer)} className="mt-1" />
            <span className="flex flex-col">
              <span className="font-medium">{EXTRA_ANSWER_WORDS[answer].label}</span>
              <span className="text-muted">{EXTRA_ANSWER_WORDS[answer].words}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {warnings.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm">
          <p className="font-medium">If you leave out something that is on now:</p>
          <ul className="list-disc pl-5">
            {warnings.map((warning) => (
              <li key={warning.label}>
                {warning.label}: {warning.lines.join(" ")}
              </li>
            ))}
          </ul>
          <label className="flex items-start gap-2">
            <input type="checkbox" name="confirm" className="mt-1" />
            <span>Switch off what I left out. Nothing is deleted: switch it on again under Settings, Features.</span>
          </label>
        </div>
      )}
      <p className="text-sm text-muted">The bonus and referral programs, and everything here, are switched on and off later under Settings, Features.</p>
      <div>
        <SubmitButton>Save and continue</SubmitButton>
      </div>
    </ActionForm>
  );
}
