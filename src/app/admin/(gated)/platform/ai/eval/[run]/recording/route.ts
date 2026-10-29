import { agentEvalRecording } from "@/server/agent-eval";
import { getAccount } from "@/server/auth";

/**
 * A run of the agents' eval as recorded (D391), for platform admins: the file CI replays, kept in the repository as
 * `src/data/agent-eval-recording.json`. It holds the model's answers to the scripted cases, never a person's or a store's data.
 */
export async function GET(_request: Request, { params }: RouteContext<"/admin/platform/ai/eval/[run]/recording">) {
  const account = await getAccount();
  if (!account?.platformAdmin) return new Response("Not found", { status: 404 });
  const recording = await agentEvalRecording((await params).run);
  if (!recording) return new Response("Not found", { status: 404 });
  return new Response(`${JSON.stringify(recording, null, 2)}\n`, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="agent-eval-recording.json"',
      "Cache-Control": "no-store",
    },
  });
}
