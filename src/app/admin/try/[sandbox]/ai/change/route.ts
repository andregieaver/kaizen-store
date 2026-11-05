import { sandboxChangeRequest } from "@/server/sandbox-ai";

/** A described change to a page may take the model a minute or two (D351), in a sandbox on its allowance (D457). */
export const maxDuration = 300;

export async function POST(request: Request, { params }: RouteContext<"/admin/try/[sandbox]/ai/change">) {
  const { sandbox } = await params;
  return sandboxChangeRequest(request, sandbox);
}
