import { platformCanvaRequest } from "@/server/canva-route";

/** Canva may take a minute to take a picture in or export a design (D898). */
export const maxDuration = 120;

export async function POST(request: Request) {
  return platformCanvaRequest(request);
}
