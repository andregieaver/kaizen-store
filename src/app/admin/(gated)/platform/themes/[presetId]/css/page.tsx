import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { CSS_MAX } from "@/lib/custom-css";

import { designWorkspacePage } from "../data";
import { DesignShell } from "../shell";
import { saveWorkspaceCssFormAction } from "../workspace-actions";
import { platformSiteWords } from "@/server/platform-site-words";

export const metadata: Metadata = { title: "Theme CSS" };

/** A design profile's own CSS for every page (D100, D177): checked when saved, kept in the profile's draft. */
export default async function DesignCssPage({ params }: PageProps<"/admin/platform/themes/[presetId]/css">) {
  const page = await designWorkspacePage((await params).presetId);
  const { w } = await platformSiteWords();
  return (
    <DesignShell design={page.design} facts={page.facts} tab="css">
      {page.problem !== null ? (
        <p role="alert" className="rounded-panel border border-line bg-card p-4 text-sm">{page.problem}</p>
      ) : (
        <ActionForm action={saveWorkspaceCssFormAction.bind(null, page.workspace.presetId)} className="flex flex-col gap-3">
          <label htmlFor="profile-css" className="flex flex-col gap-1 text-sm font-medium">
            {w.css.label}
            <span id="profile-css-hint" className="font-normal text-muted">
              {w.css.hint}
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
            className="w-full rounded-md border border-line bg-sunken p-3 font-mono text-[13px] leading-relaxed"
          />
          <div>
            <SubmitButton>{w.css.save}</SubmitButton>
          </div>
        </ActionForm>
      )}
    </DesignShell>
  );
}
