import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Account } from "./auth";
import type { DomainServices } from "./vercel";

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {} }));

const { addStoreDomain, checkStoreDomain, deployIfBehind, listStoreDomains, removeStoreDomain, routedAsSaved, setPrimaryDomain } =
  await import("./domains");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
let owner: Account;
let kari: { id: string; slug: string };
let ola: { id: string; slug: string };

/** Vercel and DNS as a test arranges them: which TXT records exist and which domains point at Vercel. */
function fakeServices() {
  const txt = new Map<string, string[]>();
  const pointed = new Set<string>();
  const onProject = new Set<string>();
  const calls: string[] = [];
  const found = (hostname: string) => ({ verified: true, verification: [], apexName: hostname.split(".").slice(-2).join(".") });
  const services: DomainServices = {
    add: async (hostname) => (calls.push(`add ${hostname}`), onProject.add(hostname), found(hostname)),
    get: async (hostname) => (onProject.has(hostname) ? found(hostname) : null),
    verify: async (hostname) => found(hostname),
    config: async (hostname) => ({ misconfigured: !pointed.has(hostname), aValues: ["76.76.21.21"], cname: "cname.vercel-dns.com" }),
    remove: async (hostname) => void (calls.push(`remove ${hostname}`), onProject.delete(hostname)),
    deploy: async () => void calls.push("deploy"),
    txt: async (name) => txt.get(name) ?? [],
  };
  return { services, txt, pointed, calls };
}

beforeAll(async () => {
  const [account] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name) values (${`domains-${run}@example.com`}, 'Owner') returning id, email
  `);
  owner = { id: String(account.id), email: String(account.email), name: "Owner", platformAdmin: false };
  const store = async (slug: string) => {
    const [row] = await db().execute<Row>(sql`insert into commerce.stores (slug, name) values (${slug}, 'Store') returning id`);
    return { id: String(row.id), slug };
  };
  kari = await store(`domains-kari-${run}`);
  ola = await store(`domains-ola-${run}`);
});

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_STORE_DOMAIN", "kaizenstore.site");
  vi.stubEnv("VERCEL_API_TOKEN", "test");
  vi.stubEnv("VERCEL_PROJECT_ID", "prj_test");
  vi.stubEnv("VERCEL_DEPLOY_HOOK_URL", "https://example.com/hook");
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDb();
});

describe("stores' own domains (P8)", () => {
  it("activates a domain once its DNS proves it is the store's and points at Vercel", async () => {
    const { services, txt, pointed, calls } = fakeServices();
    const hostname = `butikk-${run}.example.no`;
    expect(await addStoreDomain(owner, kari.id, { hostname: "not a domain" }, services, true)).toMatchObject({ ok: false });
    expect(await addStoreDomain(owner, kari.id, { hostname }, services, false)).toEqual({
      ok: false,
      problems: ["Custom domains are not set up on Kaizen yet."],
    });
    const added = await addStoreDomain(owner, kari.id, { hostname: `https://${hostname.toUpperCase()}/` }, services, true);
    if (!added.ok) throw new Error(added.problems.join(" "));
    expect(added.domain).toMatchObject({ hostname, status: "pending", isPrimary: false });
    expect(calls).toEqual([`add ${hostname}`]);
    expect(await addStoreDomain(owner, kari.id, { hostname }, services, true)).toEqual({
      ok: false,
      problems: [`${hostname} is already one of your store's domains.`],
    });

    // Pointed at Vercel but without our TXT record: still waiting.
    pointed.add(hostname);
    let checked = await checkStoreDomain(kari.id, added.domain.id, services);
    expect(checked).toMatchObject({ ok: true, domain: { status: "pending", checks: { txt: false, misconfigured: false } } });
    // Another store may claim it meanwhile, but its token is not the one in the DNS.
    const claim = await addStoreDomain(owner, ola.id, { hostname }, services, true);
    if (!claim.ok) throw new Error(claim.problems.join(" "));

    txt.set(`_kaizen.${hostname}`, [`kaizen-verify=${added.domain.token}`]);
    expect((await checkStoreDomain(ola.id, claim.domain.id, services)).ok && (await listStoreDomains(ola.id))[0].status).toBe("pending");
    checked = await checkStoreDomain(kari.id, added.domain.id, services);
    expect(checked).toMatchObject({ ok: true, domain: { status: "active", isPrimary: true, checks: { txt: true } } });
    expect(calls.at(-1)).toBe("deploy");
    // Now it is Kaizen's for this store: others cannot add it.
    expect(await addStoreDomain(owner, ola.id, { hostname: `x-${hostname}` }, services, true)).toMatchObject({ ok: true });
    const again = await addStoreDomain(owner, ola.id, { hostname }, services, true);
    expect(again).toMatchObject({ ok: false });
  });

  it("routes as saved only once a deployment has the store's domains, and asks for one at most every 15 minutes", async () => {
    const { services, calls } = fakeServices();
    const domains = await listStoreDomains(kari.id);
    expect(routedAsSaved(kari.slug, domains)).toBe(false);
    await db().execute(sql`update commerce.platform_settings set domains_deploy_requested_at = null`);
    expect(await deployIfBehind(kari.slug, domains, services)).toBe(true);
    expect(await deployIfBehind(kari.slug, domains, services)).toBe(false);
    expect(calls).toEqual(["deploy"]);

    const hostname = domains[0].hostname;
    vi.stubEnv("NEXT_PUBLIC_STORE_HOSTS", JSON.stringify({ [kari.slug]: { primary: hostname, hosts: [hostname] } }));
    expect(routedAsSaved(kari.slug, domains)).toBe(true);
  });

  it("changes the store's address and removes domains, leaving Vercel's until no store claims it", async () => {
    const { services, calls } = fakeServices();
    const [domain] = await listStoreDomains(kari.id);
    const [pending] = (await listStoreDomains(ola.id)).filter((d) => d.status === "pending" && d.hostname === domain.hostname);
    expect(await setPrimaryDomain(owner, kari.id, pending.id, services)).toMatchObject({ ok: false });
    expect(await setPrimaryDomain(owner, kari.id, null, services)).toEqual({ ok: true });
    expect((await listStoreDomains(kari.id))[0].isPrimary).toBe(false);
    expect(await setPrimaryDomain(owner, kari.id, domain.id, services)).toEqual({ ok: true });

    // Ola still claims it, so Vercel keeps it; then Ola lets go.
    expect(await removeStoreDomain(owner, kari.id, domain.id, services)).toEqual({ ok: true });
    expect(calls).toEqual(["deploy", "deploy", "deploy"]);
    expect(await removeStoreDomain(owner, ola.id, pending.id, services)).toEqual({ ok: true });
    expect(calls.at(-1)).toBe(`remove ${domain.hostname}`);
    expect(await removeStoreDomain(owner, ola.id, pending.id, services)).toMatchObject({ ok: false });
  });
});
