import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { gravatarHash } from "@/lib/gravatar";

// Storage is Supabase's: the files are stood in for, the rows are real.
const removed: string[][] = [];
let uploads = 0;
vi.mock("./media", () => ({
  uploadAvatarFile: async (folder: string, file: File) =>
    file.type === "image/webp" ? { ok: true, path: `${folder}/picture-${++uploads}.webp` } : { ok: false, reason: "invalid" },
  removeAvatarFiles: async (paths: string[]) => {
    removed.push(paths);
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

const { avatarFor, removeAccountAvatar, removeCustomerAvatar, setAccountAvatar, setCustomerAvatar } = await import("./avatars");
const { deleteCustomer, registerCustomer } = await import("./customers");
const { listCustomers } = await import("./customer-admin");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
const webp = () => new File([new Uint8Array([1, 2, 3])], "avatar.webp", { type: "image/webp" });
let storeId: string;
let accountId: string;

beforeAll(async () => {
  const email = `avatars-${run}@example.com`;
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${email}, 'Ada Lovelace', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${`avatars-${run}`}, 'Test', null) as id
  `);
  storeId = String(store.id);
  const [account] = await db().execute<Row>(sql`select id from commerce.accounts where lower(email) = ${email}`);
  accountId = String(account.id);
});

beforeEach(() => {
  removed.length = 0;
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await closeDb();
});

const accountPath = async () =>
  (await db().execute<Row>(sql`select avatar_path from commerce.accounts where id = ${accountId}::uuid`))[0].avatar_path;

describe("avatarFor", () => {
  it("shows their own picture, else their Gravatar through Kaizen, else initials", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SETTINGS_ENCRYPTION_KEY", Buffer.alloc(32, 1).toString("base64"));
    const own = avatarFor({ name: "Ada Lovelace", email: "ada@example.com", avatarPath: "accounts/a/b.webp" });
    expect(own).toEqual({
      label: "Ada Lovelace",
      initials: "AL",
      src: "https://project.supabase.co/storage/v1/object/public/avatars/accounts/a/b.webp",
    });
    const gravatar = avatarFor({ name: "", email: "Ada@Example.com" });
    expect(gravatar.label).toBe("Ada@Example.com");
    expect(gravatar.initials).toBe("A");
    expect(gravatar.src).toMatch(new RegExp(`^/api/gravatar/${gravatarHash("ada@example.com")}\\?k=[\\w-]{22}$`));

    vi.stubEnv("SETTINGS_ENCRYPTION_KEY", "");
    expect(avatarFor({ name: "Ada", email: "ada@example.com" }).src).toBeNull();
  });
});

describe("account pictures", () => {
  it("keeps the newest picture and removes the one it replaces", async () => {
    expect(await setAccountAvatar(accountId, webp())).toEqual({ ok: true });
    const first = await accountPath();
    expect(first).toMatch(new RegExp(`^accounts/${accountId}/picture-\\d+\\.webp$`));
    expect(removed).toEqual([[]]);

    await setAccountAvatar(accountId, webp());
    const second = await accountPath();
    expect(second).not.toBe(first);
    expect(removed.at(-1)).toEqual([first]);

    await removeAccountAvatar(accountId);
    expect(await accountPath()).toBeNull();
    expect(removed.at(-1)).toEqual([second]);
  });

  it("refuses what is not a small picture and changes nothing", async () => {
    const outcome = await setAccountAvatar(accountId, new File(["x"], "a.gif", { type: "image/gif" }));
    expect(outcome).toEqual({ ok: false, reason: "invalid" });
    expect(await accountPath()).toBeNull();
  });
});

describe("customer pictures", () => {
  it("are the store's to show, and go with the account", async () => {
    const email = `shopper-${run}@example.com`;
    const registered = await registerCustomer(storeId, { email, name: "Grace Hopper", password: "a long enough password" });
    if (!registered.ok) throw new Error("not registered");
    const customerId = registered.customerId;

    await setCustomerAvatar(storeId, customerId, webp());
    const [listed] = await listCustomers(storeId, { q: email });
    expect(listed.avatarPath).toMatch(new RegExp(`^customers/${storeId}/${customerId}/`));
    const path = listed.avatarPath;

    // Another store's id changes nothing.
    const [other] = await db().execute<Row>(sql`select id from commerce.stores where id <> ${storeId}::uuid limit 1`);
    await removeCustomerAvatar(String(other.id), customerId);
    expect((await listCustomers(storeId, { q: email }))[0].avatarPath).toBe(path);

    removed.length = 0;
    await deleteCustomer(storeId, customerId);
    expect(removed).toEqual([[path]]);
  });
});
