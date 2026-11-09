import "server-only";

import { z } from "zod";

import { bearerOf, checkLinkRequest, FLOW_ISSUER, LIFE_ISSUER } from "@/lib/kaizen-life-jwt";

import {
  accountOfAuthUser,
  accountOfLifeUser,
  FLOW_DOORS,
  flowDoorPath,
  lifeLinkOf,
  linkAccounts,
  linkKeys,
  provedAccountByEmail,
  setAssistants,
  takeJti,
  unlinkAccount,
  type FlowDoor,
} from "./kaizen-life-accounts";
import { sendKaizenLifeLinkedEmail } from "./kaizen-life-emails";
import { runFromLife, takeHandoffFromLife, takeUpdateFromLife } from "./kaizen-life-handoffs";
import { afterAnswer } from "./after-answer";
import { log } from "./log";
import { takeBudget, takeMcpBudget } from "./request-budget";
import { callerOfLink, callMcpTool, storeOfCall } from "./store-mcp";
import { getWorkSummary } from "./work-summary";

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
const BODY_MAX = 8 * 1024;
/** A store tool's arguments can be longer (a product's text): as much as the store's MCP server takes (D439). */
const TOOL_BODY_MAX = 100_000;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: HEADERS });
const refuse = (status: number, error: string) => json({ error }, status);

const LIFE_USER = z.object({ lifeUserId: z.uuid() });
const LINK_BODY = z.discriminatedUnion("how", [
  z.object({ how: z.literal("email"), lifeUserId: z.uuid(), email: z.email().max(320) }),
  z.object({ how: z.literal("identity"), lifeUserId: z.uuid(), flowAuthUserId: z.uuid() }),
]);

const ASSISTANTS_BODY = z.object({ lifeUserId: z.uuid(), on: z.literal(false) });
const TOOL_BODY = z.object({
  lifeUserId: z.uuid(),
  name: z.string().min(1).max(100),
  arguments: z.record(z.string(), z.unknown()).default({}),
});

const isDoor = (door: string): door is FlowDoor => (FLOW_DOORS as readonly string[]).includes(door);

/**
 * One of Kaizen Life's doors (docs/life-work-summary.md 3.3). Every request is checked before anything is read: the keys set, a
 * token signed by Kaizen Life's key for this door and this body, within its minute, its `jti` taken once. Then:
 *
 * - `link`: Kaizen Life asks to link its user, who verified this email there (`email`) or signed in there with Kaizena Flow
 *   (`identity`). Linked only to an account whose email is proved here, by the rules of `linkAccounts()`; Kaizen Life writes its
 *   copy from the answer, and asking again answers the link that stands, so a copy lost on the way is found again.
 * - `unlink`: the person unlinked in Kaizen Life.
 * - `status`: whether its user is linked, so its copy can be checked.
 * - `work-summary`: the linked account's Work summary; `not_linked` (404) tells Kaizen Life to drop its copy.
 * - `assistants`: the person stopped their assistants working together in Kaizen Life (docs/assistants-together.md). Only off: they are
 *   switched on here, where the stores are.
 * - `tool`: Kaizen Life's assistant calls one of the store MCP's tools for the linked account, while the person lets the assistants work
 *   together: answered as `/api/mcp` answers Kaizen Life (`callMcpTool()`), with its budget, its audit and its approvals.
 * - `handoff`: Kaizen Life's assistant hands a store's AI manager a task (or takes one back), docs/assistants-together.md step 2: answered
 *   202 at once and run after the answer (`takeHandoffFromLife()`, `runFromLife()`; the five-minute job runs one that did not start).
 * - `handoff-update`: Kaizen Life reports on a task the AI manager handed it (`takeUpdateFromLife()`).
 */
export async function answerLifeDoor(door: string, request: Request, invalidate: (tag: string) => void = () => {}): Promise<Response> {
  if (!isDoor(door)) return refuse(404, "not_found");
  const keys = linkKeys();
  if (!keys) return refuse(503, "not_set_up");
  const max = door === "tool" || door === "handoff" || door === "handoff-update" ? TOOL_BODY_MAX : BODY_MAX;
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > max) return refuse(413, "too_large");
  const body = await request.text();
  if (Buffer.byteLength(body) > max) return refuse(413, "too_large");
  const token = bearerOf(request.headers.get("authorization"));
  if (!token) return refuse(401, "unsigned");
  const checked = checkLinkRequest(token, { issuer: LIFE_ISSUER, audience: FLOW_ISSUER, path: flowDoorPath(door), body, publicKeyPem: keys.lifePublicKey });
  if (!checked.ok) {
    log("warn", "kaizen_life.door_refused", { door, reason: checked.reason });
    return refuse(401, "unsigned");
  }
  if (!(await takeJti(checked.jti, checked.expiresAt))) {
    log("warn", "kaizen_life.door_refused", { door, reason: "replayed" });
    return refuse(401, "unsigned");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return refuse(400, "bad_request");
  }

  if (door === "work-summary") {
    const input = LIFE_USER.safeParse(parsed);
    if (!input.success) return refuse(400, "bad_request");
    const accountId = await accountOfLifeUser(input.data.lifeUserId);
    if (!accountId) return refuse(404, "not_linked");
    if (!(await takeBudget(null, "life_summary", accountId))) return refuse(429, "slow_down");
    return json(await getWorkSummary({ id: accountId }));
  }

  if (door === "tool") return answerTool(parsed, invalidate);

  if (door === "handoff" || door === "handoff-update") {
    const who = LIFE_USER.safeParse(parsed);
    if (!who.success) return refuse(400, "bad_request");
    if (!(await takeBudget(null, "life_handoff", who.data.lifeUserId))) return refuse(429, "slow_down");
  }

  if (door === "handoff") {
    const outcome = await takeHandoffFromLife(parsed);
    if (outcome.kind === "refused") return refuse(outcome.status, outcome.error);
    if (outcome.kind === "cancelled") return json({ ok: true });
    if (outcome.fresh) afterAnswer(() => runFromLife(outcome.id));
    return json({ accepted: true, handoffId: outcome.id }, 202);
  }

  if (door === "handoff-update") {
    const outcome = await takeUpdateFromLife(parsed);
    if ("error" in outcome) return refuse(outcome.error === "bad_request" ? 400 : 404, outcome.error);
    return json({ ok: true });
  }

  if (!(await takeBudget(null, "life_link", door))) return refuse(429, "slow_down");

  if (door === "status") {
    const input = LIFE_USER.safeParse(parsed);
    if (!input.success) return refuse(400, "bad_request");
    const accountId = await accountOfLifeUser(input.data.lifeUserId);
    const link = accountId ? await lifeLinkOf(accountId) : null;
    return json(
      accountId && link ? { linked: true, flowAccountId: accountId, linkedAt: link.linkedAt, assistants: link.assistants !== null } : { linked: false },
    );
  }

  if (door === "assistants") {
    const input = ASSISTANTS_BODY.safeParse(parsed);
    if (!input.success) return refuse(400, "bad_request");
    const accountId = await accountOfLifeUser(input.data.lifeUserId);
    if (accountId) await setAssistants(accountId, null, "life");
    return json({ ok: true });
  }

  if (door === "unlink") {
    const input = LIFE_USER.safeParse(parsed);
    if (!input.success) return refuse(400, "bad_request");
    const accountId = await accountOfLifeUser(input.data.lifeUserId);
    if (accountId) await unlinkAccount(accountId, "life");
    return json({ ok: true });
  }

  const input = LINK_BODY.safeParse(parsed);
  if (!input.success) return refuse(400, "bad_request");
  const accountId =
    input.data.how === "email" ? await provedAccountByEmail(input.data.email) : await accountOfAuthUser(input.data.flowAuthUserId);
  if (!accountId) return json({ linked: false, reason: "none" });
  const outcome = await linkAccounts(accountId, input.data.lifeUserId, input.data.how);
  if (outcome.kind === "refused") return json({ linked: false, reason: outcome.reason });
  if (outcome.kind === "linked") await sendKaizenLifeLinkedEmail(accountId, input.data.how);
  return json({ linked: true, flowAccountId: accountId, linkedAt: outcome.link.linkedAt });
}

/**
 * The `tool` door: one tool of the store's MCP server for the linked account, as Kaizen Life's caller (`callerOfLink()`), only while the
 * person lets the assistants work together. Refusals Kaizen Life's assistant can word: `not_linked`, `assistants_off`, `two_step` (the
 * switch was turned on without the second step, and the stores need it), `no_stores` (the account owns none open to it).
 */
async function answerTool(parsed: unknown, invalidate: (tag: string) => void): Promise<Response> {
  const input = TOOL_BODY.safeParse(parsed);
  if (!input.success) return refuse(400, "bad_request");
  const accountId = await accountOfLifeUser(input.data.lifeUserId);
  if (!accountId) return refuse(404, "not_linked");
  const link = await lifeLinkOf(accountId);
  if (!link?.assistants) return refuse(403, "assistants_off");
  const caller = await callerOfLink(accountId, link.assistants.aal);
  if (!caller) {
    const atSecondStep = link.assistants.aal === "aal1" ? await callerOfLink(accountId, "aal2") : null;
    return refuse(403, atSecondStep ? "two_step" : "no_stores");
  }
  const { name, arguments: args } = input.data;
  if (!(await takeMcpBudget(`kaizen-life:${accountId}`, storeOfCall(caller, args)))) return refuse(429, "slow_down");
  try {
    return json(await callMcpTool(caller, name, args, invalidate));
  } catch (error) {
    log("error", "kaizen_life.tool_failed", { tool: name.slice(0, 100) }, error);
    return refuse(500, "failed");
  }
}
