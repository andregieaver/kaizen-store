import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { setupEn, type SetupMessages } from "@/lib/admin-messages/setup.en";
import { EXTRA_ANSWERS, SELL_ANSWERS, type OnboardingAnswers } from "@/lib/onboarding";

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
  w = setupEn,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  answers: OnboardingAnswers;
  warnings: QuestionWarning[];
  note: string | null;
  /** The setup words in the account's language (`adminText(lang, "setup")`): the answers by id, the question's own words. */
  w?: SetupMessages;
}) {
  return (
    <ActionForm action={action} className="flex flex-col gap-5">
      {note && <p className="rounded-md border border-line p-3 text-sm">{note}</p>}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{w.features.sell}</legend>
        {SELL_ANSWERS.map((answer) => (
          <label key={answer} className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="sells" value={answer} defaultChecked={answers.sells.includes(answer)} className="mt-1" />
            <span className="flex flex-col">
              <span className="font-medium">{w.answers[answer].label}</span>
              <span className="text-muted">{w.answers[answer].words}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{w.features.extras}</legend>
        {EXTRA_ANSWERS.map((answer) => (
          <label key={answer} className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="extras" value={answer} defaultChecked={answers.extras.includes(answer)} className="mt-1" />
            <span className="flex flex-col">
              <span className="font-medium">{w.answers[answer].label}</span>
              <span className="text-muted">{w.answers[answer].words}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {warnings.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md border border-line p-3 text-sm">
          <p className="font-medium">{w.features.ifLeftOut}</p>
          <ul className="list-disc pl-5">
            {warnings.map((warning) => (
              <li key={warning.label}>
                {warning.label}: {warning.lines.join(" ")}
              </li>
            ))}
          </ul>
          <label className="flex items-start gap-2">
            <input type="checkbox" name="confirm" className="mt-1" />
            <span>{w.features.confirm}</span>
          </label>
        </div>
      )}
      <p className="text-sm text-muted">{w.features.later}</p>
      <div>
        <SubmitButton>{w.saveAndContinue}</SubmitButton>
      </div>
    </ActionForm>
  );
}
