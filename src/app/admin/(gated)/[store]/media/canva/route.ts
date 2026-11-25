import { storeCanvaRequest } from "@/server/canva-route";

/** Canva may take a minute to take a picture in or export a design (D898). */
export const maxDuration = 120;

export async function POST(request: Request, { params }: RouteContext<"/admin/[store]/media/canva">) {
  const { store } = await params;
  return storeCanvaRequest(request, store);
}
