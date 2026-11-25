import { storeProductCanvaRequest } from "@/server/canva-route";

/** Canva may take a minute to take a photo in or export a design (D898 C2). */
export const maxDuration = 120;

export async function POST(request: Request, { params }: RouteContext<"/admin/[store]/products/canva">) {
  const { store } = await params;
  return storeProductCanvaRequest(request, store);
}
