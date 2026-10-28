import { storeChangeRequest } from "@/server/page-change-route";

/** A described change to a page may take the model a minute or two, with a new section's words (D351). */
export const maxDuration = 300;

export async function POST(request: Request, { params }: RouteContext<"/admin/[store]/pages/change">) {
  const { store } = await params;
  return storeChangeRequest(request, store);
}
