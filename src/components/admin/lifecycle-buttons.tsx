import { LIFECYCLE_WORDS, lifecycleActions, lifecycleState, type LifecycleFacts } from "@/lib/lifecycle";

import { ActionForm, SubmitButton, type FormState } from "./action-form";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

/** The state of a store template or a design profile (D177), as a small badge. */
export function LifecycleBadge({ facts }: { facts: LifecycleFacts }) {
  return <span className="ml-2 rounded bg-surface px-1.5 py-0.5 text-xs font-normal">{LIFECYCLE_WORDS[lifecycleState(facts)]}</span>;
}

/**
 * The life of a store template or a design profile on the platform (D177): Publish (also "Publish changes"), Unpublish, Archive or
 * Restore, and Delete while nothing used it, behind a disclosure that asks to confirm. Every button is a form of its own, so it works without
 * JavaScript; the server checks everything again.
 */
export function LifecycleButtons({
  kind,
  title,
  facts,
  actions,
}: {
  kind: "store template" | "design profile";
  title: string;
  facts: LifecycleFacts & { used: boolean };
  actions: { publish: Action; unpublish: Action; archive: Action; restore: Action; remove: Action };
}) {
  const offered = lifecycleActions(facts);
  const named = <span className="sr-only"> {title}</span>;
  return (
    <>
      {offered.includes("publish") && (
        <ActionForm action={actions.publish}>
          <SubmitButton>
            {facts.published ? "Publish changes" : "Publish"}
            {named}
          </SubmitButton>
        </ActionForm>
      )}
      {offered.includes("unpublish") && (
        <ActionForm action={actions.unpublish}>
          <SubmitButton variant="secondary">
            Unpublish{named}
          </SubmitButton>
        </ActionForm>
      )}
      {offered.includes("archive") && (
        <ActionForm action={actions.archive}>
          <SubmitButton variant="secondary">
            Archive{named}
          </SubmitButton>
        </ActionForm>
      )}
      {offered.includes("restore") && (
        <ActionForm action={actions.restore}>
          <SubmitButton variant="secondary">
            Restore{named}
          </SubmitButton>
        </ActionForm>
      )}
      {offered.includes("delete") && (
        <details className="rounded-md border border-border px-3 py-2 text-sm">
          <summary className="cursor-pointer">
            Delete…{named}
          </summary>
          <ActionForm action={actions.remove} className="mt-2 flex max-w-sm flex-col gap-2">
            <p className="text-muted">
              {kind === "store template"
                ? "Deleting takes the store template off the platform for good. Its store and its published copies are closed and kept, as stores always are."
                : "Deleting takes the design profile off the platform for good. Its workspace is closed and kept, as stores always are; a store template recommending it recommends none after."}
            </p>
            <label className="flex items-start gap-2">
              <input type="checkbox" name="confirm" required className="mt-0.5 size-4" />
              <span>I want to delete {title}; this cannot be undone.</span>
            </label>
            <div>
              <SubmitButton variant="secondary">
                Delete for good{named}
              </SubmitButton>
            </div>
          </ActionForm>
        </details>
      )}
    </>
  );
}
