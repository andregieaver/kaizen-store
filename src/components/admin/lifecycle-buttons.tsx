import { fillWords } from "@/lib/admin-fill";
import { platformSiteEn } from "@/lib/admin-messages/platform-site.en";
import type { PlatformSiteMessages } from "@/lib/admin-messages/platform-site.en";
import { lifecycleActions, lifecycleState, type LifecycleFacts } from "@/lib/lifecycle";

import { ActionForm, SubmitButton, type FormState } from "./action-form";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

/** The state of a theme or a demo store (D177, D273), as a small badge. */
/** The lifecycle's words; English unless the page hands in the admin's (D312 A11). */
type Words = PlatformSiteMessages["lifecycle"];

export function LifecycleBadge({ facts, words = platformSiteEn.lifecycle }: { facts: LifecycleFacts; words?: Words }) {
  return <span className="ml-2 rounded bg-sunken px-1.5 py-0.5 text-xs font-normal">{words.states[lifecycleState(facts)]}</span>;
}

/**
 * The life of a theme or a demo store on the platform (D177, D273): Publish (also "Publish changes"), Unpublish, Archive or
 * Restore, and Delete while nothing used it, behind a disclosure that asks to confirm. Every button is a form of its own, so it works without
 * JavaScript; the server checks everything again.
 */
export function LifecycleButtons({
  kind,
  title,
  facts,
  actions,
  words = platformSiteEn.lifecycle,
}: {
  kind: "demo store" | "theme";
  title: string;
  facts: LifecycleFacts & { used: boolean };
  actions: { publish: Action; unpublish: Action; archive: Action; restore: Action; remove: Action };
  words?: Words;
}) {
  const offered = lifecycleActions(facts);
  const named = <span className="sr-only"> {title}</span>;
  return (
    <>
      {offered.includes("publish") &&
        (kind === "theme" ? (
          // A theme's Publish takes What's new (D245), shown to the stores that installed it when the new version reaches them.
          <details className="rounded-md border border-line px-3 py-2 text-sm">
            <summary className="cursor-pointer">
              {facts.published ? words.publishChangesOpen : words.publishOpen}
              {named}
            </summary>
            <ActionForm action={actions.publish} className="mt-2 flex max-w-md flex-col gap-2">
              <label className="flex flex-col gap-1">
                <span>{words.whatsNew}</span>
                <textarea name="notes" rows={3} maxLength={2000} className="rounded-lg border border-line bg-card px-3 py-2" />
                <span className="text-muted">{words.whatsNewHint}</span>
              </label>
              <div>
                <SubmitButton>
                  {facts.published ? words.publishChanges : words.publish}
                  {named}
                </SubmitButton>
              </div>
            </ActionForm>
          </details>
        ) : (
          <ActionForm action={actions.publish}>
            <SubmitButton>
              {facts.published ? words.publishChanges : words.publish}
              {named}
            </SubmitButton>
          </ActionForm>
        ))}
      {offered.includes("unpublish") && (
        <ActionForm action={actions.unpublish}>
          <SubmitButton variant="secondary">
            {words.unpublish}
            {named}
          </SubmitButton>
        </ActionForm>
      )}
      {offered.includes("archive") && (
        <ActionForm action={actions.archive}>
          <SubmitButton variant="secondary">
            {words.archive}
            {named}
          </SubmitButton>
        </ActionForm>
      )}
      {offered.includes("restore") && (
        <ActionForm action={actions.restore}>
          <SubmitButton variant="secondary">
            {words.restore}
            {named}
          </SubmitButton>
        </ActionForm>
      )}
      {offered.includes("delete") && (
        <details className="rounded-md border border-line px-3 py-2 text-sm">
          <summary className="cursor-pointer">
            {words.deleteOpen}
            {named}
          </summary>
          <ActionForm action={actions.remove} className="mt-2 flex max-w-sm flex-col gap-2">
            <p className="text-muted">
              {kind === "demo store" ? words.deleteDemo : words.deleteTheme}
            </p>
            <label className="flex items-start gap-2">
              <input type="checkbox" name="confirm" required className="mt-0.5 size-4" />
              <span>{fillWords(words.deleteConfirm, { title })}</span>
            </label>
            <div>
              <SubmitButton variant="secondary">
                {words.deleteForGood}
                {named}
              </SubmitButton>
            </div>
          </ActionForm>
        </details>
      )}
    </>
  );
}
