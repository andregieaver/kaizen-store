import { abortRequest } from "@/server/replicate-route";

export async function POST(request: Request, { params }: RouteContext<"/admin/[store]/pages/ai/replicate/[jobId]/abort">) {
  const { store, jobId } = await params;
  return abortRequest(request, store, jobId);
}
