import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Who may run a scheduled job (`cronAuthorised()`): the gate in front of every cron route, which renew subscriptions, send reminders and
 * run the autopilot. Vercel Cron's bearer (`CRON_SECRET`) or Supabase's scheduler's token from Vault, compared in constant time; nothing
 * else, and never an empty or missing secret. The Vault read is the database's, faked here.
 */

vi.mock("server-only", () => ({}));
const execute = vi.hoisted(() => vi.fn());
vi.mock("@/db/client", () => ({ db: () => ({ execute }) }));

const saved = process.env.CRON_SECRET;
const vault = (token: string | null) => execute.mockResolvedValue(token === null ? [] : [{ decrypted_secret: token }]);
const asked = (authorization?: string) =>
  new Request("http://localhost/api/cron/usage", { headers: authorization === undefined ? {} : { authorization } });

/** The module afresh: its Vault token is kept for five minutes between calls. */
async function load() {
  vi.resetModules();
  return import("./cron-auth");
}

beforeEach(() => {
  execute.mockReset();
  vault(null);
  delete process.env.CRON_SECRET;
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-19T12:00:00Z") });
});

afterEach(() => {
  vi.useRealTimers();
  if (saved === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = saved;
});

describe("cronAuthorised", () => {
  it("lets in Vercel Cron's bearer", async () => {
    process.env.CRON_SECRET = "cron-s3cret";
    const { cronAuthorised } = await load();
    expect(await cronAuthorised(asked("Bearer cron-s3cret"))).toBe(true);
  });

  it("refuses a wrong token, one a character longer or shorter, one without Bearer, and none", async () => {
    process.env.CRON_SECRET = "cron-s3cret";
    const { cronAuthorised } = await load();
    for (const authorization of ["Bearer cron-s3creT", "Bearer cron-s3cretx", "Bearer cron-s3cre", "cron-s3cret", "Basic cron-s3cret", "bearer cron-s3cret", ""]) {
      expect(await cronAuthorised(asked(authorization)), authorization).toBe(false);
    }
    expect(await cronAuthorised(asked())).toBe(false);
  });

  it("lets nothing in when no secret is set, whatever the request says", async () => {
    process.env.CRON_SECRET = "";
    const { cronAuthorised } = await load();
    for (const authorization of ["Bearer ", "Bearer undefined", "Bearer null", "Bearer  "]) {
      expect(await cronAuthorised(asked(authorization)), authorization).toBe(false);
    }
  });

  it("lets in Supabase's scheduler with the token in Vault, read at most every five minutes", async () => {
    vault("vault-token-1");
    const { cronAuthorised } = await load();
    expect(await cronAuthorised(asked("Bearer vault-token-1"))).toBe(true);
    expect(await cronAuthorised(asked("Bearer vault-token-2"))).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);

    // The token is changed in Vault: the old one works until the five minutes are up, then only the new one.
    vault("vault-token-2");
    vi.setSystemTime(new Date("2026-11-19T12:04:59Z"));
    expect(await cronAuthorised(asked("Bearer vault-token-1"))).toBe(true);
    vi.setSystemTime(new Date("2026-11-19T12:05:01Z"));
    expect(await cronAuthorised(asked("Bearer vault-token-1"))).toBe(false);
    expect(await cronAuthorised(asked("Bearer vault-token-2"))).toBe(true);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("takes either token when both are set, and a database without Vault leaves only CRON_SECRET", async () => {
    process.env.CRON_SECRET = "cron-s3cret";
    vault("vault-token");
    let auth = await load();
    expect(await auth.cronAuthorised(asked("Bearer vault-token"))).toBe(true);
    expect(await auth.cronAuthorised(asked("Bearer cron-s3cret"))).toBe(true);

    execute.mockRejectedValue(new Error('relation "vault.decrypted_secrets" does not exist'));
    auth = await load();
    expect(await auth.cronAuthorised(asked("Bearer vault-token"))).toBe(false);
    expect(await auth.cronAuthorised(asked("Bearer cron-s3cret"))).toBe(true);
  });
});

describe("cronBearer", () => {
  it("is CRON_SECRET's header first, else Vault's, else none", async () => {
    process.env.CRON_SECRET = "cron-s3cret";
    vault("vault-token");
    expect(await (await load()).cronBearer()).toBe("Bearer cron-s3cret");
    expect(execute).not.toHaveBeenCalled();

    delete process.env.CRON_SECRET;
    expect(await (await load()).cronBearer()).toBe("Bearer vault-token");

    vault(null);
    expect(await (await load()).cronBearer()).toBeNull();
  });
});
