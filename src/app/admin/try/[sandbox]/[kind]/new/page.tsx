import type { Metadata } from "next";

import { SandboxEditor, sandboxAndKind } from "../../editor";

export const metadata: Metadata = { title: "New page" };

/** A new page, header, footer, article or product layout in a sandbox (D457); with `?with=`, beside another of its documents (S4). */
export default async function SandboxNewPage({ params, searchParams }: PageProps<"/admin/try/[sandbox]/[kind]/new">) {
  const [{ sandbox, kind }, query] = await Promise.all([sandboxAndKind(params), searchParams]);
  if (!sandbox) return null;
  return <SandboxEditor sandbox={sandbox} kind={kind} pageId={null} query={query} />;
}
