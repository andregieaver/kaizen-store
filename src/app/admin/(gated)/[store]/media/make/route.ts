import { storePictureRequest } from "@/server/picture-route";

/** A picture model may take a minute or two for one picture (D283). */
export const maxDuration = 300;

export async function POST(request: Request, { params }: RouteContext<"/admin/[store]/media/make">) {
  const { store } = await params;
  return storePictureRequest(request, store);
}
