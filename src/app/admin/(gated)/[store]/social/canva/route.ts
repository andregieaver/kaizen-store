import { storeSocialCanvaRequest } from "@/server/canva-route";

/** Canva may take a minute to take a post's picture in or export it (D898 C3). */
export const maxDuration = 120;

export async function POST(request: Request, { params }: RouteContext<"/admin/[store]/social/canva">) {
  const { store } = await params;
  return storeSocialCanvaRequest(request, store);
}
