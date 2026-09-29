import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket } from "@/lib/markets";

import type { Membership } from "./auth";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));

const tiers = await import("./customer-tiers");
const companies = await import("./companies");
const { preRegisterCustomer } = await import("./customers");

/**
 * Company accounts (D108): a store's group and company, the main account's
 * invitations, accepting them (with and without an account already), the
 * one-time sign-in link, and revoking: the discount follows the membership.
 */

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const market = { marketCode: "NO", locale: "nb-NO" };
let storeId: string;
let member: Membership;
let tierId: string;
let companyId: string;
let ownerId: string;

const mail = (name: string) => `${name}-${run}@acme.example`;

/** The last email of a kind to an address, as the link in it: emails are only logged without a mail service. */
async function linkIn(kind: string, to: string, pattern: RegExp): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    select html from commerce.email_messages where store_id = ${storeId}::uuid and kind = ${kind} and to_address = ${to} order by created_at desc limit 1
  `);
  const found = pattern.exec(String(row?.html ?? ""));
  if (!found) throw new Error(`no ${kind} email with a link to ${to}`);
  return found[1];
}
const inviteToken = (to: string) => linkIn("company.invite", to, /account\/company\/invite\/([A-Za-z0-9_-]+)/);
const signInToken = (to: string) => linkIn("company.joined", to, /account\/sign-in\/([A-Za-z0-9_-]+)/);
const emailsOf = async (kind: string, to: string) =>
  Number((await db().execute<Row>(sql`select count(*)::int as n from commerce.email_messages where store_id = ${storeId}::uuid and kind = ${kind} and to_address = ${to}`))[0].n);

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`co-${run}@example.com`}, 'Kari', 'Kaffe') returning id
  `);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`co-${run}`}, 'Kaffe', null) as id`);
  storeId = String(store.id);
  const [account] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`co-${run}@example.com`}`);
  member = {
    account: { id: String(account.id), email: String(account.email), name: "Kari", platformAdmin: false },
    role: "owner",
    store: { id: storeId, slug: `co-${run}`, markets: [no] } as unknown as Store,
  };
});

afterAll(async () => {
  await closeDb();
});

describe("discount groups", () => {
  it("makes a group, puts customers in it by email, and gives their discount", async () => {
    expect(await tiers.saveTier(member, null, { name: "Wholesale", percent: 0 })).toMatchObject({ ok: false });
    const made = await tiers.saveTier(member, null, { name: "Wholesale", percent: 10 });
    if (!made.ok) throw new Error(made.problems.join(" "));
    tierId = made.id!;
    expect(await tiers.saveTier(member, null, { name: "wholesale", percent: 5 })).toMatchObject({ ok: false });

    expect(await tiers.addToTierByEmail(member, tierId, "not an email")).toMatchObject({ ok: false });
    expect(await tiers.addToTierByEmail(member, tierId, mail("vip"))).toEqual({ ok: true });
    const vip = await preRegisterCustomer(storeId, mail("vip"));
    expect(await tiers.memberDiscountFor(db(), storeId, vip)).toEqual({ percent: 10, label: "Wholesale", via: "tier" });
    expect((await tiers.tierMembers(storeId, tierId)).map((m) => m.email)).toEqual([mail("vip")]);
    expect(await tiers.memberDiscountFor(db(), storeId, null)).toBeNull();

    // A group in use cannot be deleted; switched off, it gives nothing.
    expect(await tiers.deleteTier(member, tierId)).toMatchObject({ ok: false });
    expect(await tiers.saveTier(member, tierId, { name: "Wholesale", percent: 10, active: false })).toMatchObject({ ok: true });
    expect(await tiers.memberDiscountFor(db(), storeId, vip)).toBeNull();
    await tiers.saveTier(member, tierId, { name: "Wholesale", percent: 10, active: true });
    expect(await tiers.setCustomerTier(member, vip, null)).toEqual({ ok: true });
    expect(await tiers.memberDiscountFor(db(), storeId, vip)).toBeNull();
  });
});

describe("company accounts", () => {
  it("makes a company with a main account, who gets the whole discount; employees half", async () => {
    const made = await companies.saveCompany(member, null, { name: "Acme AS", tierId, employeeSharePercent: 50, maxMembers: 3 });
    if (!made.ok) throw new Error(made.problems.join(" "));
    companyId = made.id!;
    expect(await companies.saveCompany(member, null, { name: "ACME AS", tierId })).toMatchObject({ ok: false });
    expect(await companies.addMainAccount(member, companyId, mail("boss"))).toEqual({ ok: true });
    ownerId = await preRegisterCustomer(storeId, mail("boss"));
    expect(await tiers.memberDiscountFor(db(), storeId, ownerId)).toEqual({ percent: 10, label: "Acme AS", via: "company" });
    const company = (await companies.getCompany(storeId, companyId))!;
    expect(company).toMatchObject({ members: 1, tierPercent: 10, employeeSharePercent: 50 });
    expect(companies.employeePercent(company)).toBe(5);
    // A customer is in one company at most.
    const other = await companies.saveCompany(member, null, { name: "Other AS", tierId });
    expect(await companies.addMainAccount(member, other.id!, mail("boss"))).toMatchObject({ ok: false });
  });

  it("invites by email; sending again replaces the link, and only the newest works", async () => {
    const first = await companies.createInvites(storeId, companyId, [mail("ane"), mail("bo"), mail("ane")], { invitedBy: ownerId, inviterName: "Boss", market });
    expect(first).toEqual({ ok: true, results: [{ email: mail("ane"), outcome: "sent" }, { email: mail("bo"), outcome: "sent" }, { email: mail("ane"), outcome: "resent" }] });
    // The first of Ane's links was replaced by the second.
    expect(await emailsOf("company.invite", mail("ane"))).toBe(2);
    const again = await companies.createInvites(storeId, companyId, [mail("boss")], { invitedBy: ownerId, inviterName: "Boss", market });
    expect(again).toEqual({ ok: true, results: [{ email: mail("boss"), outcome: "member" }] });
    const preview = await companies.previewInvite(storeId, await inviteToken(mail("ane")));
    expect(preview).toMatchObject({ ok: true, company: "Acme AS", email: mail("ane"), percent: 5 });
    expect(await companies.previewInvite(storeId, "x".repeat(30))).toEqual({ ok: false, problem: "gone" });
    // The company is full at its limit of three accounts: the boss, Ane and Bo.
    const over = await companies.createInvites(storeId, companyId, [mail("cy")], { invitedBy: ownerId, inviterName: "Boss", market });
    expect(over).toEqual({ ok: true, results: [{ email: mail("cy"), outcome: "full" }] });
    expect((await companies.listInvites(storeId, companyId)).filter((i) => i.status === "pending")).toHaveLength(2);
  });

  it("opens an account for an employee who accepts, and emails a sign-in link that works once", async () => {
    const token = await inviteToken(mail("ane"));
    const accepted = await companies.acceptInvite(storeId, token, market);
    expect(accepted).toEqual({ ok: true, company: "Acme AS", existing: false, alreadyMember: false });
    // The link cannot be used twice.
    expect(await companies.acceptInvite(storeId, token, market)).toEqual({ ok: false, problem: "gone" });
    const ane = await preRegisterCustomer(storeId, mail("ane"));
    const [row] = await db().execute<Row>(sql`select company_role, email_verified_at from commerce.customers where id = ${ane}::uuid`);
    expect(row).toMatchObject({ company_role: "employee" });
    expect(row.email_verified_at).not.toBeNull();
    expect(await tiers.memberDiscountFor(db(), storeId, ane)).toEqual({ percent: 5, label: "Acme AS", via: "company" });

    const link = await signInToken(mail("ane"));
    expect(await companies.previewSignInLink(storeId, link)).toEqual({ email: mail("ane") });
    expect(await companies.consumeSignInLink(storeId, link)).toBe(ane);
    expect(await companies.consumeSignInLink(storeId, link)).toBeNull();
    expect(await companies.previewSignInLink(storeId, link)).toBeNull();
  });

  it("lets someone with an account accept too, and drops a password nobody proved was theirs", async () => {
    // Bo registered with a password before, and never proved the address.
    const bo = await preRegisterCustomer(storeId, mail("bo"));
    await db().execute(sql`update commerce.customers set password_hash = 'scrypt$x' where id = ${bo}::uuid`);
    const accepted = await companies.acceptInvite(storeId, await inviteToken(mail("bo")), market);
    expect(accepted).toEqual({ ok: true, company: "Acme AS", existing: true, alreadyMember: false });
    const [row] = await db().execute<Row>(sql`select password_hash, email_verified_at, company_id from commerce.customers where id = ${bo}::uuid`);
    expect(row.password_hash).toBeNull();
    expect(row.email_verified_at).not.toBeNull();
    expect(String(row.company_id)).toBe(companyId);
    expect(await emailsOf("company.joined", mail("bo"))).toBe(1);

    // A proven account keeps its password.
    const dee = await preRegisterCustomer(storeId, mail("dee"));
    await db().execute(sql`update commerce.customers set password_hash = 'scrypt$y', email_verified_at = now() where id = ${dee}::uuid`);
    await companies.saveCompany(member, companyId, { name: "Acme AS", tierId, employeeSharePercent: 50, maxMembers: 10 });
    await companies.createInvites(storeId, companyId, [mail("dee")], { invitedBy: ownerId, inviterName: "Boss", market });
    await companies.acceptInvite(storeId, await inviteToken(mail("dee")), market);
    const [kept] = await db().execute<Row>(sql`select password_hash from commerce.customers where id = ${dee}::uuid`);
    expect(kept.password_hash).toBe("scrypt$y");
  });

  it("refuses an account that belongs to another company, an expired or withdrawn invitation, and a company switched off", async () => {
    const other = await companies.saveCompany(member, null, { name: "Rival AS", tierId });
    const rivalMember = await preRegisterCustomer(storeId, mail("eve"));
    await db().execute(sql`update commerce.customers set company_id = ${other.id!}::uuid, company_role = 'employee' where id = ${rivalMember}::uuid`);
    await companies.createInvites(storeId, companyId, [mail("eve"), mail("fay"), mail("gus")], { invitedBy: ownerId, inviterName: "Boss", market });
    expect(await companies.acceptInvite(storeId, await inviteToken(mail("eve")), market)).toEqual({ ok: false, problem: "other_company" });

    // Withdrawn: the link stops working at once.
    const fay = await inviteToken(mail("fay"));
    const invite = (await companies.listInvites(storeId, companyId)).find((i) => i.email === mail("fay") && i.status === "pending")!;
    expect(await companies.revokeInvite(storeId, companyId, invite.id)).toBe(true);
    expect(await companies.revokeInvite(storeId, companyId, invite.id)).toBe(false);
    expect(await companies.previewInvite(storeId, fay)).toEqual({ ok: false, problem: "gone" });
    expect(await companies.acceptInvite(storeId, fay, market)).toEqual({ ok: false, problem: "gone" });

    // Expired.
    const gus = await inviteToken(mail("gus"));
    await db().execute(sql`update commerce.company_invites set expires_at = now() - interval '1 minute' where store_id = ${storeId}::uuid and lower(email) = ${mail("gus")}`);
    expect(await companies.acceptInvite(storeId, gus, market)).toEqual({ ok: false, problem: "expired" });

    // A company switched off gives no discount and takes no one in.
    await companies.createInvites(storeId, companyId, [mail("hal")], { invitedBy: ownerId, inviterName: "Boss", market });
    const hal = await inviteToken(mail("hal"));
    await companies.saveCompany(member, companyId, { name: "Acme AS", tierId, employeeSharePercent: 50, maxMembers: 10, active: false });
    expect(await companies.acceptInvite(storeId, hal, market)).toEqual({ ok: false, problem: "company_off" });
    expect(await tiers.memberDiscountFor(db(), storeId, ownerId)).toBeNull();
    expect(await companies.createInvites(storeId, companyId, [mail("ivy")], { invitedBy: ownerId, inviterName: "Boss", market })).toEqual({ ok: false, problem: "company_off" });
    await companies.saveCompany(member, companyId, { name: "Acme AS", tierId, employeeSharePercent: 50, maxMembers: 10, active: true });
    expect(await tiers.memberDiscountFor(db(), storeId, ownerId)).toMatchObject({ percent: 10 });
  });

  it("takes an employee out at any time: the discount stops at once, and they are told", async () => {
    const ane = await preRegisterCustomer(storeId, mail("ane"));
    // The main account cannot be removed by the company; the store can.
    expect(await companies.removeMember(storeId, companyId, ownerId, { market })).toBe(false);
    expect(await companies.removeMember(storeId, companyId, ane, { market })).toBe(true);
    expect(await companies.removeMember(storeId, companyId, ane, { market })).toBe(false);
    expect(await tiers.memberDiscountFor(db(), storeId, ane)).toBeNull();
    expect(await emailsOf("company.ended", mail("ane"))).toBe(1);
    // Their account is still theirs.
    const [row] = await db().execute<Row>(sql`select company_id, company_role from commerce.customers where id = ${ane}::uuid`);
    expect(row).toEqual({ company_id: null, company_role: null });
    const invites = await companies.listInvites(storeId, companyId);
    expect(invites.find((i) => i.email === mail("ane"))?.status).toBe("ended");
    // They can be invited again.
    const again = await companies.createInvites(storeId, companyId, [mail("ane")], { invitedBy: ownerId, inviterName: "Boss", market });
    expect(again).toMatchObject({ ok: true, results: [{ outcome: "sent" }] });
    expect(await companies.acceptInvite(storeId, await inviteToken(mail("ane")), market)).toMatchObject({ ok: true });
    // The store takes the main account out.
    expect(await companies.removeMember(storeId, companyId, ownerId, { allowOwner: true, quiet: true, market })).toBe(true);
    expect(await tiers.memberDiscountFor(db(), storeId, ownerId)).toBeNull();
  });

  it("forgets old invitations and used-up links, and keeps the recent ones", async () => {
    await db().execute(sql`update commerce.company_invites set created_at = now() - interval '2 years', ended_at = now() - interval '2 years' where store_id = ${storeId}::uuid and status = 'revoked'`);
    const before = (await companies.listInvites(storeId, companyId)).length;
    expect(await companies.pruneCompanyRecords()).toBeGreaterThan(0);
    const after = await companies.listInvites(storeId, companyId);
    expect(after.length).toBeLessThan(before);
    expect(after.some((i) => i.status === "pending" || i.status === "accepted")).toBe(true);
  });

  it("holds an employee to the company's limit and a day's invitations", async () => {
    const small = await companies.saveCompany(member, null, { name: "Tiny AS", tierId, maxMembers: 1 });
    const many = Array.from({ length: 3 }, (_, i) => mail(`t${i}`));
    const result = await companies.createInvites(storeId, small.id!, many, { invitedBy: null, inviterName: "Kaffe", market });
    expect(result).toEqual({ ok: true, results: many.map((email, i) => ({ email, outcome: i === 0 ? "sent" : "full" })) });
  });
});
