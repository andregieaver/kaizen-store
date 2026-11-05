import type { Metadata } from "next";

import { SandboxEditor, sandboxAndKind } from "../../editor";

export const metadata: Metadata = { title: "New page" };

/** A new page, header or footer in a sandbox (D457). */
export default async function SandboxNewPage({ params }: PageProps<"/admin/try/[sandbox]/[kind]/new">) {
  const { sandbox, kind } = await sandboxAndKind(params);
  if (!sandbox) return null;
  return <SandboxEditor sandbox={sandbox} kind={kind} pageId={null} saved={null} />;
}
