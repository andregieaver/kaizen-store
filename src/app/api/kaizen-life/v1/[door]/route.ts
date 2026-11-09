import { revalidateTag } from "next/cache";
import { connection } from "next/server";

import { answerLifeDoor } from "@/server/kaizen-life-doors";

/**
 * Kaizen Life's doors into Kaizena Flow (docs/life-work-summary.md 3.3): `link`, `unlink`, `status` and `work-summary`, and for the
 * assistants working together (docs/assistants-together.md) `assistants` and `tool`, each a POST from Kaizen Life's server with a request
 * signed by its key. Never cached, never from a browser.
 */
/** `tool` may be a question to the store's assistant, which can take a few tool rounds (as `/api/mcp`). */
export const maxDuration = 300;

export async function POST(request: Request, { params }: RouteContext<"/api/kaizen-life/v1/[door]">): Promise<Response> {
  await connection();
  return answerLifeDoor((await params).door, request, (tag) => revalidateTag(tag, "max"));
}
