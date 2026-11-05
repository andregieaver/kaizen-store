import { sandboxPictureRequest } from "@/server/sandbox-ai";

/** A picture model may take a minute or two for one picture (D283), in a sandbox on its allowance (D457). */
export const maxDuration = 300;

export async function POST(request: Request, { params }: RouteContext<"/admin/try/[sandbox]/ai/make">) {
  const { sandbox } = await params;
  return sandboxPictureRequest(request, sandbox);
}
