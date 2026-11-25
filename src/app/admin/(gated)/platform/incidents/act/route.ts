import { NextResponse, type NextRequest } from "next/server";

import { sameSite } from "@/lib/same-site";
import { getAccount, platformCan } from "@/server/auth";
import { requestWake } from "@/server/autopilot-wake";
import { addIdea, decideIncident, saveAutopilotSettings, type OwnerDecision } from "@/server/incidents";

const DECISIONS: readonly OwnerDecision[] = ["approve", "dismiss", "send_back", "wont_fix", "reopen"];

/**
 * Everything the incidents pages ask (D895), by the button pressed (`intent`): a decision on an entry, an idea, or the autopilot's settings.
 * A plain form's post to a route, not a server action, so the pages add no entry to the server-reference manifest (as D870's social posts);
 * it answers with a redirect back to the page it came from, saying what happened (`done` or `problem`). The settings area's (an owner of the
 * platform, D510) and same-site only.
 */
export async function POST(request: NextRequest) {
  const account = await getAccount();
  if (!account || !platformCan(account, "settings", "write")) return new NextResponse("Not found", { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  const back = (query: string) => {
    const page = form.get("from") === "entry" && /^[0-9a-f-]{36}$/i.test(id) ? `/admin/platform/incidents/${id}` : "/admin/platform/incidents";
    return NextResponse.redirect(new URL(`${page}?${query}`, request.url), 303);
  };
  const intent = String(form.get("intent") ?? "");
  const note = String(form.get("note") ?? "").trim() || null;
  if (intent === "idea") {
    return (await addIdea(account.id, String(form.get("title") ?? ""), note)) ? back("done=idea") : back("problem=idea");
  }
  if (intent === "run_now") return (await requestWake("run_now", account.id)) ? back("done=run_now") : back("problem=off");
  if (intent === "settings") {
    const saved = await saveAutopilotSettings(account.id, { on: form.get("on") === "on", gapHours: Number(form.get("gap")) });
    return saved ? back("done=settings") : back("problem=gap");
  }
  const decision = DECISIONS.find((d) => d === intent);
  if (!decision) return back("problem=unknown");
  const done = await decideIncident(account.id, id, decision, note);
  return done.ok ? back("done=moved") : back(`problem=${done.problem}`);
}
