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
  takeJti,
  unlinkAccount,
  type FlowDoor,
} from "./kaizen-life-accounts";
import { sendKaizenLifeLinkedEmail } from "./kaizen-life-emails";
import { log } from "./log";
import { takeBudget } from "./request-budget";
import { getWorkSummary } from "./work-summary";

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
const BODY_MAX = 8 * 1024;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: HEADERS });
const refuse = (status: number, error: string) => json({ error }, status);

const LIFE_USER = z.object({ lifeUserId: z.uuid() });
const LINK_BODY = z.discriminatedUnion("how", [
  z.object({ how: z.literal("email"), lifeUserId: z.uuid(), email: z.email().max(320) }),
  z.object({ how: z.literal("identity"), lifeUserId: z.uuid(), flowAuthUserId: z.uuid() }),
]);

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
 */
export async function answerLifeDoor(door: string, request: Request): Promise<Response> {
  if (!isDoor(door)) return refuse(404, "not_found");
  const keys = linkKeys();
  if (!keys) return refuse(503, "not_set_up");
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > BODY_MAX) return refuse(413, "too_large");
  const body = await request.text();
  if (body.length > BODY_MAX) return refuse(413, "too_large");
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

  if (!(await takeBudget(null, "life_link", door))) return refuse(429, "slow_down");

  if (door === "status") {
    const input = LIFE_USER.safeParse(parsed);
    if (!input.success) return refuse(400, "bad_request");
    const accountId = await accountOfLifeUser(input.data.lifeUserId);
    const link = accountId ? await lifeLinkOf(accountId) : null;
    return json(accountId && link ? { linked: true, flowAccountId: accountId, linkedAt: link.linkedAt } : { linked: false });
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
