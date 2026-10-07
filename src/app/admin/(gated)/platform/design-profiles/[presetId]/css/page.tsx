import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { CSS_MAX } from "@/lib/custom-css";

import { designWorkspacePage } from "../data";
import { DesignShell } from "../shell";
import { saveWorkspaceCssFormAction } from "../workspace-actions";

export const metadata: Metadata = { title: "Design profile CSS" };

/** A design profile's own CSS for every page (D100, D177): checked when saved, kept in the profile's draft. */
export default async function DesignCssPage({ params }: PageProps<"/admin/platform/design-profiles/[presetId]/css">) {
  const page = await designWorkspacePage((await params).presetId);
  return (
    <DesignShell design={page.design} facts={page.facts} tab="css">
      {page.problem !== null ? (
        <p role="alert" className="rounded-lg border border-border bg-background p-4 text-sm">{page.problem}</p>
      ) : (
        <ActionForm action={saveWorkspaceCssFormAction.bind(null, page.workspace.presetId)} className="flex flex-col gap-3">
          <label htmlFor="profile-css" className="flex flex-col gap-1 text-sm font-medium">
            CSS for every page
            <span id="profile-css-hint" className="font-normal text-muted">
              Applied with the profile, it replaces the store&apos;s own CSS. Style parts by the classes and ids given under Advanced in the
              builder. Pictures and fonts come from the site only; CSS that reaches into a store&apos;s files is left out of the profile.
            </span>
          </label>
          <textarea
            id="profile-css"
            name="css"
            aria-describedby="profile-css-hint"
            defaultValue={page.store.customCss}
            maxLength={CSS_MAX}
            rows={18}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="w-full rounded-md border border-border bg-surface p-3 font-mono text-[13px] leading-relaxed"
          />
          <div>
            <SubmitButton>Save</SubmitButton>
          </div>
        </ActionForm>
      )}
    </DesignShell>
  );
}
