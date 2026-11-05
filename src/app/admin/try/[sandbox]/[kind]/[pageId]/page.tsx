import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { SandboxGuide } from "@/components/admin/sandbox-guide";
import { adminText } from "@/lib/admin-text";
import { sandboxHome } from "@/lib/sandbox";
import { requestAdminLang } from "@/server/admin-request-lang";

import { SandboxEditor, isPageId, sandboxAndKind } from "../../editor";

export const metadata: Metadata = { title: "Edit page" };

/**
 * A page, header, footer, article or product layout of a sandbox in the editor (D457); the editor's link to manage categories leads home.
 * The front page, where a new sandbox opens, has the guided path above it (S4).
 */
export default async function SandboxEditPage({ params, searchParams }: PageProps<"/admin/try/[sandbox]/[kind]/[pageId]">) {
  const [{ sandbox, kind }, { pageId }, query] = await Promise.all([sandboxAndKind(params), params, searchParams]);
  if (!sandbox) return null;
  if (!isPageId(pageId)) {
    if (pageId === "categories") redirect(sandboxHome(sandbox.id));
    notFound();
  }
  const lang = await requestAdminLang();
  const g = adminText(lang, "sandbox").guide;
  // The guided path (S4) beside the front page, where a new sandbox opens.
  const guide =
    kind === "page" && pageId === sandbox.store.frontPageId ? (
      <SandboxGuide
        sandboxId={sandbox.id}
        title={g.title}
        done={g.done}
        hide={g.hide}
        steps={[
          { key: "headline", ...g.headline },
          { key: "section", ...g.section },
          { key: "look", ...g.look, href: `${sandboxHome(sandbox.id)}/looks` },
          { key: "phone", ...g.phone },
        ]}
      />
    ) : null;
  return (
    <>
      {guide}
      <SandboxEditor sandbox={sandbox} kind={kind} pageId={pageId} query={query} />
    </>
  );
}
