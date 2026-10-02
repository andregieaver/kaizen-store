import { currentRequest, startRequest } from "@/server/replicate-route";

/** The store's copying of other pages (D150): the latest job, and starting one. */
export async function GET(request: Request, { params }: RouteContext<"/admin/[store]/pages/ai/replicate">) {
  return currentRequest(request, (await params).store);
}

export async function POST(request: Request, { params }: RouteContext<"/admin/[store]/pages/ai/replicate">) {
  return startRequest(request, (await params).store);
}
