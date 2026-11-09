import { generateKeyPairSync, randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { FLOW_ISSUER, LIFE_ISSUER, checkLinkRequest, signLinkRequest } from "@/lib/kaizen-life-jwt";
import type { WorkSummary } from "@/lib/work-summary";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const pair = () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
};
const FLOW = pair();
const LIFE = pair();
const STRANGER = pair();
process.env.KAIZEN_LIFE_LINK_PRIVATE_KEY = FLOW.privateKeyPem.replace(/\n/g, "\\n");
process.env.KAIZEN_LIFE_LINK_PUBLIC_KEY = LIFE.publicKeyPem;
process.env.KAIZEN_LIFE_URL = "https://life-app.example";

const links = await import("./kaizen-life-accounts");
const doors = await import("./kaizen-life-doors");

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
const emailOf = (who: string) => `life-accounts-${who}-${run}@example.com`;
let owner: { id: string; email: string; slug: string };
let fresh: { id: string; email: string };
let unproved: { id: string; email: string };

async function makeOwner(who: string): Promise<{ id: string; email: string; slug: string }> {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${emailOf(who)}, 'Kari', 'Kaffe') returning id
  `);
  const slug = `life-accounts-${who}-${run}`;
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Kaffe', null)`);
  const [account] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${emailOf(who)}`);
  return { id: String(account.id), email: String(account.email), slug };
}

/** The account has signed in: its address is proved. */
const signedIn = (id: string) => db().execute(sql`update commerce.accounts set auth_user_id = ${randomUUID()}::uuid where id = ${id}::uuid`);

/** A request to one of Flow's doors, signed as Kaizen Life signs it (or with another key, at another time). */
async function ask(door: string, body: unknown, options: { key?: string; token?: string; path?: string } = {}) {
  const text = JSON.stringify(body);
  const token =
    options.token ??
    signLinkRequest({ issuer: LIFE_ISSUER, audience: FLOW_ISSUER, path: options.path ?? `/api/kaizen-life/v1/${door}`, body: text, privateKeyPem: options.key ?? LIFE.privateKeyPem });
  const response = await doors.answerLifeDoor(
    door,
    new Request(`https://kaizenaflow.com/api/kaizen-life/v1/${door}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: text }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown>, token };
}

type Sent = { url: string; body: Record<string, unknown>; checked: boolean };
/** Kaizen Life's doors, played in turn: each answer given back, each request kept and its signature checked with Flow's key. */
function lifeAnswers(...answers: (Record<string, unknown> | number)[]): { fetcher: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    const body = String(init.body);
    const token = String((init.headers as Record<string, string>).authorization).replace(/^Bearer /, "");
    const path = new URL(url).pathname;
    const checked = checkLinkRequest(token, { issuer: FLOW_ISSUER, audience: LIFE_ISSUER, path, body, publicKeyPem: FLOW.publicKeyPem }).ok;
    sent.push({ url, body: JSON.parse(body) as Record<string, unknown>, checked });
    const answer = answers.shift() ?? 500;
    return typeof answer === "number" ? new Response("{}", { status: answer }) : Response.json(answer);
  }) as unknown as typeof fetch;
  return { fetcher, sent };
}

const linkRow = async (accountId: string) => {
  const [row] = await db().execute<Row>(sql`select life_user_id, how, unlinked_at, unlinked_from from commerce.kaizen_life_accounts where account_id = ${accountId}::uuid`);
  return row ?? null;
};

beforeAll(async () => {
  owner = await makeOwner("owner");
  await signedIn(owner.id);
  const second = await makeOwner("fresh");
  await signedIn(second.id);
  fresh = second;
  const third = await makeOwner("unproved");
  unproved = third;
});

afterAll(async () => {
  await closeDb();
});

describe("Kaizen Life's doors into Kaizena Flow", () => {
  const lifeUser = randomUUID();

  it("refuse an unsigned request, another key, another door, and the same request twice", async () => {
    const response = await doors.answerLifeDoor("status", new Request("https://kaizenaflow.com/api/kaizen-life/v1/status", { method: "POST", body: "{}" }));
    expect(response.status).toBe(401);
    expect((await ask("status", { lifeUserId: lifeUser }, { key: STRANGER.privateKeyPem })).status).toBe(401);
    expect((await ask("status", { lifeUserId: lifeUser }, { path: "/api/kaizen-life/v1/unlink" })).status).toBe(401);
    const first = await ask("status", { lifeUserId: lifeUser });
    expect(first).toMatchObject({ status: 200, body: { linked: false } });
    expect((await ask("status", { lifeUserId: lifeUser }, { token: first.token })).status).toBe(401);
    expect((await ask("nothing", {})).status).toBe(404);
  });

  it("link a Kaizen Life user to the account with the same email, only when the account has signed in", async () => {
    expect((await ask("link", { how: "email", lifeUserId: randomUUID(), email: unproved.email })).body).toEqual({ linked: false, reason: "none" });
    const linked = await ask("link", { how: "email", lifeUserId: lifeUser, email: owner.email.toUpperCase() });
    expect(linked.body).toMatchObject({ linked: true, flowAccountId: owner.id });
    // Asked again (a copy lost on the way), the link that stands is answered.
    const again = await ask("link", { how: "email", lifeUserId: lifeUser, email: owner.email });
    expect(again.body).toEqual(linked.body);
    // Another Kaizen Life user cannot take the account, nor this user another account.
    expect((await ask("link", { how: "email", lifeUserId: randomUUID(), email: owner.email })).body).toEqual({ linked: false, reason: "taken" });
    expect((await ask("link", { how: "email", lifeUserId: lifeUser, email: fresh.email })).body).toEqual({ linked: false, reason: "taken" });
    expect((await ask("status", { lifeUserId: lifeUser })).body).toMatchObject({ linked: true, flowAccountId: owner.id });
    const [audit] = await db().execute<Row>(sql`select details from commerce.audit_log where account_id = ${owner.id}::uuid and action = 'account.kaizen_life_linked'`);
    expect(audit.details).toEqual({ how: "email" });
  });

  it("answers the linked account's Work summary, with every link through the door", async () => {
    const off = (await ask("work-summary", { lifeUserId: lifeUser })).body as unknown as WorkSummary;
    expect(off.workOn).toBe(false);
    expect(off.needs).toEqual([]);
    expect(off.turnOn).toMatch(/\/admin\/sign-in\/kaizen-life\?next=%2Fadmin%2Faccount%2Fwork%2Fsettings$/);
    await db().execute(sql`update commerce.stores set modules = array_append(modules, 'work') where slug = ${owner.slug}`);
    const on = (await ask("work-summary", { lifeUserId: lifeUser })).body as unknown as WorkSummary;
    expect(on.workOn).toBe(true);
    expect(on.stores.find((s) => s.slug === owner.slug)).toMatchObject({ workOn: true, unbilledMinutes: 0 });
    expect(new URL(on.open).searchParams.get("next")).toBe("/admin/account/work");
    expect((await ask("work-summary", { lifeUserId: randomUUID() })).status).toBe(404);
  });

  it("unlinks for Kaizen Life, after which the summary is not_linked and an email never links the pair again", async () => {
    expect((await ask("unlink", { lifeUserId: lifeUser })).body).toEqual({ ok: true });
    expect(await linkRow(owner.id)).toMatchObject({ unlinked_from: "life" });
    expect((await ask("work-summary", { lifeUserId: lifeUser })).body).toEqual({ error: "not_linked" });
    expect((await ask("link", { how: "email", lifeUserId: lifeUser, email: owner.email })).body).toEqual({ linked: false, reason: "undone" });
  });

  it("links the pair again only by the person's own sign-in with the other app", async () => {
    const [account] = await db().execute<Row>(sql`select auth_user_id from commerce.accounts where id = ${owner.id}::uuid`);
    const relinked = await ask("link", { how: "identity", lifeUserId: lifeUser, flowAuthUserId: String(account.auth_user_id) });
    expect(relinked.body).toMatchObject({ linked: true, flowAccountId: owner.id });
    expect(await linkRow(owner.id)).toMatchObject({ how: "identity", unlinked_at: null, unlinked_from: null });
    // A link joins one account and one Kaizen Life user for good.
    await expect(db().execute(sql`update commerce.kaizen_life_accounts set life_user_id = ${randomUUID()}::uuid where account_id = ${owner.id}::uuid`)).rejects.toThrow();
  });
});

describe("Kaizena Flow linking by itself", () => {
  it("links after a sign-in when Kaizen Life has the same verified email, and writes Life's copy in the same call", async () => {
    const lifeUserId = randomUUID();
    const life = lifeAnswers({ lifeUserId }, { linked: true });
    const outcome = await links.offerLinkByEmail(fresh.id, fresh.email, life.fetcher);
    expect(outcome).toMatchObject({ kind: "linked", link: { lifeUserId, how: "email" } });
    expect(life.sent.map((s) => [new URL(s.url).pathname, s.checked])).toEqual([
      ["/api/kaizena-flow/v1/lookup", true],
      ["/api/kaizena-flow/v1/link", true],
    ]);
    expect(life.sent[0].body).toEqual({ email: fresh.email });
    expect(life.sent[1].body).toEqual({ lifeUserId, flowAccountId: fresh.id, how: "email" });
    expect(await links.kaizenLifeAppUrl(fresh.id)).toBe("https://life-app.example/app/today");

    // Unlinked in Flow: Kaizen Life is told, and asking by email never links again.
    const told = lifeAnswers({ ok: true });
    expect(await links.unlinkFromFlow(fresh.id, told.fetcher)).toBe(true);
    expect(told.sent[0].body).toEqual({ lifeUserId });
    expect(await linkRow(fresh.id)).toMatchObject({ unlinked_from: "flow" });
    const asked = lifeAnswers({ lifeUserId });
    expect(await links.offerLinkByEmail(fresh.id, fresh.email, asked.fetcher)).toBeNull();
    expect(asked.sent).toEqual([]);
  });

  it("takes a link back when Kaizen Life did not take its copy, and does nothing when Life has no such user", async () => {
    const other = await makeOwner("taken-back");
    await signedIn(other.id);
    const failing = lifeAnswers({ lifeUserId: randomUUID() }, 503);
    expect(await links.offerLinkByEmail(other.id, other.email, failing.fetcher)).toEqual({ kind: "refused", reason: "life" });
    expect(await linkRow(other.id)).toBeNull();
    const nobody = lifeAnswers({ lifeUserId: null });
    expect(await links.offerLinkByEmail(other.id, other.email, nobody.fetcher)).toBeNull();
    expect(await linkRow(other.id)).toBeNull();
  });
});
