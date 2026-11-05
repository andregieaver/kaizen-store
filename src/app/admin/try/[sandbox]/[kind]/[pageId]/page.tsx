import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { sandboxHome } from "@/lib/sandbox";

import { SandboxEditor, isPageId, sandboxAndKind } from "../../editor";

export const metadata: Metadata = { title: "Edit page" };

/** A page, header or footer of a sandbox in the editor (D456); the editor's link to manage categories leads home. */
export default async function SandboxEditPage({ params, searchParams }: PageProps<"/admin/try/[sandbox]/[kind]/[pageId]">) {
  const [{ sandbox, kind }, { pageId }, query] = await Promise.all([sandboxAndKind(params), params, searchParams]);
  if (!sandbox) return null;
  if (!isPageId(pageId)) {
    if (pageId === "categories") redirect(sandboxHome(sandbox.id));
    notFound();
  }
  return <SandboxEditor sandbox={sandbox} kind={kind} pageId={pageId} saved={query.saved} />;
}
