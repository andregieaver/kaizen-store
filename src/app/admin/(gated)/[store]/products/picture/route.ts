import { storeProductPictureRequest } from "@/server/picture-route";

/** A picture model may take a minute or two for one picture (D349). */
export const maxDuration = 300;

export async function POST(request: Request, { params }: RouteContext<"/admin/[store]/products/picture">) {
  const { store } = await params;
  return storeProductPictureRequest(request, store);
}
