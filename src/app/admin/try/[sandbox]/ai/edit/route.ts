import { sandboxEditRequest } from "@/server/sandbox-ai";

/** An edit model may take a minute or two for one picture (D349), in a sandbox on its allowance (D457). */
export const maxDuration = 300;

export async function POST(request: Request, { params }: RouteContext<"/admin/try/[sandbox]/ai/edit">) {
  const { sandbox } = await params;
  return sandboxEditRequest(request, sandbox);
}
