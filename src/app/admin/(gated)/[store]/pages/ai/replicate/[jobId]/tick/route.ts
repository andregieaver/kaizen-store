import { tickRequest } from "@/server/replicate-route";

/** One piece of a copy takes a browser, downloads and the AI: it may use the whole limit (D150). */
export const maxDuration = 300;

export async function POST(request: Request, { params }: RouteContext<"/admin/[store]/pages/ai/replicate/[jobId]/tick">) {
  const { store, jobId } = await params;
  return tickRequest(request, store, jobId);
}
