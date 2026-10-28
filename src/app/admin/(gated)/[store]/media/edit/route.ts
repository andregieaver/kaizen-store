import { storeEditRequest } from "@/server/picture-route";

/** An edit model may take a minute or two for one picture (D349). */
export const maxDuration = 300;

export async function POST(request: Request, { params }: RouteContext<"/admin/[store]/media/edit">) {
  const { store } = await params;
  return storeEditRequest(request, store);
}
