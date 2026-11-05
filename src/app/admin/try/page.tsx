import type { Metadata } from "next";

import { SubmitButton } from "@/components/admin/action-form";
import { ButtonLink, FocusFrame } from "@/components/admin/ui";
import { adminText } from "@/lib/admin-text";
import { sandboxHome } from "@/lib/sandbox";
import { requestAdminLang } from "@/server/admin-request-lang";
import { currentSandbox, sandboxSettings } from "@/server/sandbox";

import { startSandboxAction } from "./actions";

export const metadata: Metadata = { title: "Try the page builder" };

/** Why a press made no sandbox, as the action sends it back. */
const PROBLEMS = ["off", "busy", "full", "failed"] as const;

/**
 * The sandbox's start screen (D457): one button, *Start building*, a form post so a crawler or a link preview makes nothing, and a line saying
 * the store is the visitor's alone for 7 days. A browser whose sandbox is still open is offered the way back to it instead.
 */
export default async function TryPage({ searchParams }: PageProps<"/admin/try">) {
  const [lang, query, settings, current] = await Promise.all([requestAdminLang(), searchParams, sandboxSettings(), currentSandbox()]);
  const w = adminText(lang, "sandbox").start;
  const problem = PROBLEMS.find((p) => p === query.problem) ?? null;
  return (
    <FocusFrame title={w.title} description={w.lead} lang={lang}>
      <p className="text-body text-ink-2">{w.private}</p>
      {problem && (
        <p role="alert" className="text-body text-danger-text">
          {w[problem]}
        </p>
      )}
      {current ? (
        <ButtonLink kind="main" full href={sandboxHome(current.id)}>
          {w.back}
        </ButtonLink>
      ) : settings.on ? (
        <form action={startSandboxAction} className="flex flex-col">
          <SubmitButton>{w.button}</SubmitButton>
        </form>
      ) : (
        !problem && <p className="text-body text-ink-2">{w.off}</p>
      )}
    </FocusFrame>
  );
}
