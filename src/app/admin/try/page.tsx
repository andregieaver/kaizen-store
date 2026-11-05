import type { Metadata } from "next";
import Link from "next/link";

import { SubmitButton } from "@/components/admin/action-form";
import { ButtonLink, FocusFrame } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { adminText } from "@/lib/admin-text";
import { PLATFORM_LEGAL_SLUGS } from "@/lib/platform-legal-slugs";
import { platformPath } from "@/lib/platform-lang";
import { sandboxHome } from "@/lib/sandbox";
import { requestAdminLang } from "@/server/admin-request-lang";
import { currentSandbox, sandboxDemo, sandboxSettings } from "@/server/sandbox";

import { startSandboxAction } from "./actions";

export const metadata: Metadata = { title: "Try the page builder" };

/** Why a press made no sandbox, as the action sends it back. */
const PROBLEMS = ["off", "busy", "full", "failed"] as const;

/**
 * The sandbox's start screen (D457): one button, *Start building*, a form post so a crawler or a link preview makes nothing, a line saying
 * the store is the visitor's alone for 7 days, and one linking the privacy notice (S4). From *Try it with this theme* (`?demo=`, a free
 * theme's demo store, `sandboxDemo()`) it says which store it starts from. A browser whose sandbox is still open is offered the way back to it
 * instead.
 */
export default async function TryPage({ searchParams }: PageProps<"/admin/try">) {
  const [lang, query] = await Promise.all([requestAdminLang(), searchParams]);
  const [settings, current, demo] = await Promise.all([sandboxSettings(), currentSandbox(), sandboxDemo(query.demo)]);
  const w = adminText(lang, "sandbox").start;
  const problem = PROBLEMS.find((p) => p === query.problem) ?? null;
  return (
    <FocusFrame title={w.title} description={w.lead} lang={lang}>
      {demo && !current && <p className="text-body text-ink">{fillWords(w.withTheme, { store: demo.name, theme: demo.theme })}</p>}
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
          {demo && <input type="hidden" name="demo" value={demo.id} />}
          <SubmitButton>{w.button}</SubmitButton>
        </form>
      ) : (
        !problem && <p className="text-body text-ink-2">{w.off}</p>
      )}
      <p className="text-body text-muted">
        {w.privacy}{" "}
        <Link href={platformPath(lang, `/${PLATFORM_LEGAL_SLUGS.privacy}`)} className="underline">
          {w.privacyLink}
        </Link>
      </p>
    </FocusFrame>
  );
}
