import "server-only";

import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  companyInput,
  companyPercent,
  INVITE_DAYS,
  INVITES_PER_DAY,
  type CompanyInput,
  type InviteProblem,
  type InviteStatus,
} from "@/lib/customer-tiers";

import { audit, type Membership } from "./auth";
import { claimOrders, preRegisterCustomer, sha256, normalEmail } from "./customers";
import type { SaveResult } from "./settings";
import { sendCompanyEnded, sendCompanyInvite, sendCompanyJoined, type EmailMarket } from "./shopper-emails";

type Row = Record<string, unknown>;

/**
 * Company accounts (D108). A store makes a company, gives it a discount
 * group and a main account; the main account invites its employees by email.
 * An employee who accepts gets an account (or keeps theirs), joined to the
 * company and emailed a one-time link to sign in with. The company, or the
 * store, can revoke an invitation or remove an employee whenever they leave,
 * and the discount is read from the membership on each purchase, so it stops
 * at once. A customer is in one company at most.
 */

const LINK_DAYS = 7;

const newToken = () => randomBytes(32).toString("base64url");
const tokenOk = (token: string) => /^[A-Za-z0-9_-]{20,64}$/.test(token);

export type Company = {
  id: string;
  name: string;
  organisationNumber: string;
  tierId: string | null;
  tierName: string | null;
  tierPercent: number | null;
  tierActive: boolean;
  employeeSharePercent: number;
  maxMembers: number;
  active: boolean;
  /** Accounts in it: main accounts and employees. */
  members: number;
  pendingInvites: number;
};

const toCompany = (row: Row): Company => ({
  id: String(row.id),
  name: String(row.name),
  organisationNumber: String(row.organisation_number ?? ""),
  tierId: row.tier_id ? String(row.tier_id) : null,
  tierName: row.tier_name ? String(row.tier_name) : null,
  tierPercent: row.tier_percent === null || row.tier_percent === undefined ? null : Number(row.tier_percent),
  tierActive: Boolean(row.tier_active),
  employeeSharePercent: Number(row.employee_share_percent),
  maxMembers: Number(row.max_members),
  active: Boolean(row.active),
  members: Number(row.members ?? 0),
  pendingInvites: Number(row.pending_invites ?? 0),
});

const companyQuery = (where: ReturnType<typeof sql>) => sql`
  select co.*, t.name as tier_name, t.percent as tier_percent, coalesce(t.active, false) as tier_active,
    (select count(*)::int from commerce.customers c where c.store_id = co.store_id and c.company_id = co.id) as members,
    (select count(*)::int from commerce.company_invites i where i.store_id = co.store_id and i.company_id = co.id
       and i.status = 'pending' and i.expires_at > now()) as pending_invites
  from commerce.customer_companies co
  left join commerce.customer_tiers t on t.store_id = co.store_id and t.id = co.tier_id
  where ${where}
  order by co.active desc, lower(co.name)
`;

export async function listCompanies(storeId: string): Promise<Company[]> {
  return (await db().execute<Row>(companyQuery(sql`co.store_id = ${storeId}::uuid`))).map(toCompany);
}

export async function getCompany(storeId: string, id: string): Promise<Company | null> {
  const [row] = await db().execute<Row>(companyQuery(sql`co.store_id = ${storeId}::uuid and co.id = ${id}::uuid`));
  return row ? toCompany(row) : null;
}

/** What an employee gets of this company's discount, or null when the company gives none. */
export function employeePercent(company: Pick<Company, "tierPercent" | "tierActive" | "employeeSharePercent" | "active">): number | null {
  if (!company.active || !company.tierActive || company.tierPercent === null) return null;
  const percent = companyPercent(company.tierPercent, company.employeeSharePercent, "employee");
  return percent > 0 ? percent : null;
}

/** Creates a company (id null) or changes one. Orders already placed keep what they got. */
export async function saveCompany({ account, store }: Membership, id: string | null, input: CompanyInput): Promise<SaveResult & { id?: string }> {
  const parsed = companyInput.safeParse(input);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
  const d = parsed.data;
  if (id && !(await getCompany(store.id, id))) return { ok: false, problems: ["The company no longer exists."] };
  if (d.tierId) {
    const [tier] = await db().execute<Row>(sql`select 1 from commerce.customer_tiers where store_id = ${store.id}::uuid and id = ${d.tierId}::uuid`);
    if (!tier) return { ok: false, problems: ["The discount group no longer exists."] };
  }
  try {
    const [row] = id
      ? await db().execute<Row>(sql`
          update commerce.customer_companies set name = ${d.name}, organisation_number = ${d.organisationNumber}, tier_id = ${d.tierId}::uuid,
            employee_share_percent = ${d.employeeSharePercent}, max_members = ${d.maxMembers}, active = ${d.active}, updated_at = now()
          where store_id = ${store.id}::uuid and id = ${id}::uuid returning id
        `)
      : await db().execute<Row>(sql`
          insert into commerce.customer_companies (store_id, name, organisation_number, tier_id, employee_share_percent, max_members, active)
          values (${store.id}::uuid, ${d.name}, ${d.organisationNumber}, ${d.tierId}::uuid, ${d.employeeSharePercent}, ${d.maxMembers}, ${d.active})
          returning id
        `);
    await audit(account.id, store.id, id ? "company.updated" : "company.created", { name: d.name });
    return { ok: true, id: String(row.id) };
  } catch (error) {
    const code = (error as { cause?: { code?: string }; code?: string }).cause?.code ?? (error as { code?: string }).code;
    if (code === "23505") return { ok: false, problems: [`The store already has a company called ${d.name}.`] };
    throw error;
  }
}

/** Deletes a company with no accounts in it; one with accounts is switched off instead. */
export async function deleteCompany({ account, store }: Membership, id: string): Promise<SaveResult> {
  const company = await getCompany(store.id, id);
  if (!company) return { ok: true };
  if (company.members > 0) return { ok: false, problems: ["Accounts belong to this company. Remove them first, or switch the company off."] };
  await db().execute(sql`delete from commerce.customer_companies where store_id = ${store.id}::uuid and id = ${id}::uuid`);
  await audit(account.id, store.id, "company.deleted", { name: company.name });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Members and invitations
// ---------------------------------------------------------------------------

export type CompanyMember = { id: string; email: string; name: string; role: "owner" | "employee"; verified: boolean; joinedAt: string };

export async function listMembers(storeId: string, companyId: string): Promise<CompanyMember[]> {
  const rows = await db().execute<Row>(sql`
    select c.id, c.email, c.name, c.company_role, c.email_verified_at is not null as verified,
      coalesce((select i.accepted_at from commerce.company_invites i where i.store_id = c.store_id and i.customer_id = c.id
                  and i.company_id = c.company_id and i.status = 'accepted' order by i.accepted_at desc limit 1), c.updated_at) as joined_at
    from commerce.customers c
    where c.store_id = ${storeId}::uuid and c.company_id = ${companyId}::uuid
    order by (c.company_role = 'owner') desc, lower(c.email)
  `);
  return rows.map((r) => ({
    id: String(r.id),
    email: String(r.email),
    name: String(r.name),
    role: r.company_role as CompanyMember["role"],
    verified: Boolean(r.verified),
    joinedAt: new Date(String(r.joined_at)).toISOString(),
  }));
}

export type CompanyInvite = {
  id: string;
  email: string;
  status: InviteStatus;
  createdAt: string;
  expiresAt: string;
  /** Pending, but past its date: it can no longer be accepted. */
  expired: boolean;
};

/** Invitations, the ones still open first, then the latest of the others. */
export async function listInvites(storeId: string, companyId: string): Promise<CompanyInvite[]> {
  const rows = await db().execute<Row>(sql`
    select id, email, status, created_at, expires_at, expires_at <= now() as expired
    from commerce.company_invites
    where store_id = ${storeId}::uuid and company_id = ${companyId}::uuid
    order by (status = 'pending') desc, created_at desc
    limit 100
  `);
  return rows.map((r) => ({
    id: String(r.id),
    email: String(r.email),
    status: r.status as InviteStatus,
    createdAt: new Date(String(r.created_at)).toISOString(),
    expiresAt: new Date(String(r.expires_at)).toISOString(),
    expired: Boolean(r.expired),
  }));
}

/** The company a signed-in customer belongs to, and their part in it. */
export async function companyOf(storeId: string, customerId: string): Promise<{ company: Company; role: "owner" | "employee" } | null> {
  const [row] = await db().execute<Row>(sql`
    select company_id, company_role from commerce.customers where store_id = ${storeId}::uuid and id = ${customerId}::uuid and company_id is not null
  `);
  if (!row) return null;
  const company = await getCompany(storeId, String(row.company_id));
  return company ? { company, role: row.company_role as "owner" | "employee" } : null;
}

/** The store's first market, whose language the emails of an action by staff are in. */
export async function staffEmailMarket(storeId: string): Promise<EmailMarket | null> {
  const [row] = await db().execute<Row>(sql`
    select m.code, m.default_locale from commerce.markets m join commerce.stores s on s.id = m.store_id
    where m.store_id = ${storeId}::uuid order by (m.code = s.country) desc nulls last, m.created_at limit 1
  `);
  return row ? { marketCode: String(row.code), locale: String(row.default_locale) } : null;
}

/** Makes an account the company's main account: someone with no account yet gets one made ahead of them. */
export async function addMainAccount({ account, store }: Membership, companyId: string, email: string): Promise<SaveResult> {
  const address = normalEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || address.length > 254) return { ok: false, problems: ["That is not an email address."] };
  const company = await getCompany(store.id, companyId);
  if (!company) return { ok: false, problems: ["The company no longer exists."] };
  const customerId = await preRegisterCustomer(store.id, address);
  const [current] = await db().execute<Row>(sql`select company_id from commerce.customers where store_id = ${store.id}::uuid and id = ${customerId}::uuid`);
  if (current?.company_id && String(current.company_id) !== companyId) return { ok: false, problems: ["That account already belongs to another company."] };
  if (!current?.company_id && company.members >= company.maxMembers) return { ok: false, problems: ["The company is full."] };
  await db().execute(sql`
    update commerce.customers set company_id = ${companyId}::uuid, company_role = 'owner', updated_at = now()
    where store_id = ${store.id}::uuid and id = ${customerId}::uuid
  `);
  await audit(account.id, store.id, "company.main_account", { companyId, customerId });
  return { ok: true };
}

export type InviteOutcome = "sent" | "resent" | "member" | "full" | "limit";
export type InviteResult = { ok: true; results: { email: string; outcome: InviteOutcome }[] } | { ok: false; problem: "company_off" };

/**
 * Invites people to a company, one email each. An address already in the
 * company is left alone; one with an invitation open gets it again, with a
 * new link (the old one stops working). The company's size and a day's
 * invitations are limited. `invitedBy` is the company account that asked, or
 * null when the store did.
 */
export async function createInvites(
  storeId: string,
  companyId: string,
  emails: string[],
  { invitedBy, inviterName, market }: { invitedBy: string | null; inviterName: string; market: EmailMarket },
): Promise<InviteResult> {
  const company = await getCompany(storeId, companyId);
  if (!company || !company.active) return { ok: false, problem: "company_off" };
  const percent = employeePercent(company);
  const [today] = await db().execute<Row>(sql`
    select count(*)::int as n from commerce.company_invites
    where store_id = ${storeId}::uuid and company_id = ${companyId}::uuid and created_at > now() - interval '1 day'
  `);
  let sentToday = Number(today?.n ?? 0);
  let taken = company.members + company.pendingInvites;
  const results: { email: string; outcome: InviteOutcome }[] = [];
  for (const raw of emails) {
    const email = normalEmail(raw);
    const [member] = await db().execute<Row>(sql`
      select 1 from commerce.customers where store_id = ${storeId}::uuid and lower(email) = ${email} and company_id = ${companyId}::uuid
    `);
    if (member) {
      results.push({ email, outcome: "member" });
      continue;
    }
    const [open] = await db().execute<Row>(sql`
      select 1 from commerce.company_invites
      where store_id = ${storeId}::uuid and company_id = ${companyId}::uuid and lower(email) = ${email} and status = 'pending' and expires_at > now()
    `);
    if (!open && taken >= company.maxMembers) {
      results.push({ email, outcome: "full" });
      continue;
    }
    if (sentToday >= INVITES_PER_DAY) {
      results.push({ email, outcome: "limit" });
      continue;
    }
    const token = newToken();
    const [row] = await db().execute<Row>(sql`
      insert into commerce.company_invites (store_id, company_id, email, token_hash, invited_by, expires_at)
      values (${storeId}::uuid, ${companyId}::uuid, ${email}, ${sha256(token)}, ${invitedBy}::uuid, now() + make_interval(days => ${INVITE_DAYS}))
      on conflict (company_id, lower(email)) where status = 'pending'
      do update set token_hash = excluded.token_hash, expires_at = excluded.expires_at, invited_by = excluded.invited_by
      returning id, expires_at, (xmax = 0) as inserted
    `);
    sentToday += 1;
    if (row.inserted) taken += 1;
    await sendCompanyInvite(storeId, market, {
      id: String(row.id),
      to: email,
      token,
      inviter: inviterName,
      company: company.name,
      percent,
      expiresAt: new Date(String(row.expires_at)).toISOString(),
    });
    results.push({ email, outcome: row.inserted ? "sent" : "resent" });
  }
  return { ok: true, results };
}

/** Withdraws an invitation that is still open: its link stops working at once. */
export async function revokeInvite(storeId: string, companyId: string, inviteId: string): Promise<boolean> {
  const rows = await db().execute<Row>(sql`
    update commerce.company_invites set status = 'revoked', ended_at = now()
    where store_id = ${storeId}::uuid and company_id = ${companyId}::uuid and id = ${inviteId}::uuid and status = 'pending'
    returning id
  `);
  return rows.length > 0;
}

/**
 * Takes an account out of a company (an employee who left, or was let go): it
 * keeps its account and orders but no longer gets the company's discount, from
 * the next purchase on. Main accounts are only taken out by the store
 * (`allowOwner`). The person is told, unless `quiet`.
 */
export async function removeMember(
  storeId: string,
  companyId: string,
  customerId: string,
  { allowOwner = false, quiet = false, market }: { allowOwner?: boolean; quiet?: boolean; market: EmailMarket | null },
): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    update commerce.customers set company_id = null, company_role = null, updated_at = now()
    where store_id = ${storeId}::uuid and id = ${customerId}::uuid and company_id = ${companyId}::uuid
      and (company_role = 'employee' or ${allowOwner})
    returning email
  `);
  if (!row) return false;
  await db().execute(sql`
    update commerce.company_invites set status = 'ended', ended_at = now()
    where store_id = ${storeId}::uuid and company_id = ${companyId}::uuid and customer_id = ${customerId}::uuid and status = 'accepted'
  `);
  if (!quiet && market) {
    const company = await getCompany(storeId, companyId);
    if (company) await sendCompanyEnded(storeId, market, { key: `${companyId}:${customerId}:${Date.now()}`, to: String(row.email), company: company.name });
  }
  return true;
}

// ---------------------------------------------------------------------------
// Accepting an invitation
// ---------------------------------------------------------------------------

export type InvitePreview =
  | { ok: true; company: string; email: string; percent: number | null; store: string }
  | { ok: false; problem: InviteProblem };

type Found = { id: string; email: string; status: string; expired: boolean; company_id: string; name: string; active: boolean; max_members: number };

async function findInvite(runner: Pick<ReturnType<typeof db>, "execute">, storeId: string, token: string, lock = false): Promise<Found | null> {
  if (!tokenOk(token)) return null;
  const [row] = await runner.execute<Row>(sql`
    select i.id, i.email, i.status, i.expires_at <= now() as expired, i.company_id, co.name, co.active, co.max_members
    from commerce.company_invites i
    join commerce.customer_companies co on co.store_id = i.store_id and co.id = i.company_id
    where i.store_id = ${storeId}::uuid and i.token_hash = ${sha256(token)}
    ${lock ? sql`for update of i` : sql``}
  `);
  return (row as unknown as Found) ?? null;
}

/** What the page behind an invitation's link shows, without changing anything. */
export async function previewInvite(storeId: string, token: string): Promise<InvitePreview> {
  const found = await findInvite(db(), storeId, token);
  if (!found || found.status !== "pending") return { ok: false, problem: "gone" };
  if (found.expired) return { ok: false, problem: "expired" };
  if (!found.active) return { ok: false, problem: "company_off" };
  const company = await getCompany(storeId, found.company_id);
  const [store] = await db().execute<Row>(sql`select name from commerce.stores where id = ${storeId}::uuid`);
  return { ok: true, company: found.name, email: found.email, percent: company ? employeePercent(company) : null, store: String(store?.name ?? "") };
}

export type AcceptOutcome = { ok: true; company: string; existing: boolean; alreadyMember: boolean } | { ok: false; problem: InviteProblem };

/**
 * Accepts an invitation (the person pressed the button on the page its link
 * opens). The link proves the email is theirs, so the account is made if
 * there is none, or kept if there is (an account whose email nobody had
 * proven loses a password chosen before, since that may not have been
 * theirs). They join the company as an employee, and an email confirms it,
 * with a link that signs them in once.
 */
export async function acceptInvite(storeId: string, token: string, market: EmailMarket): Promise<AcceptOutcome> {
  const decided = await db().transaction(async (tx): Promise<
    | { ok: true; found: Found; customerId: string; email: string; existing: boolean; alreadyMember: boolean }
    | { ok: false; problem: InviteProblem }
  > => {
    const found = await findInvite(tx, storeId, token, true);
    if (!found || found.status !== "pending") return { ok: false, problem: "gone" };
    if (found.expired) return { ok: false, problem: "expired" };
    if (!found.active) return { ok: false, problem: "company_off" };
    const email = normalEmail(found.email);
    const [customer] = await tx.execute<Row>(sql`
      select id, company_id, email_verified_at is not null as verified from commerce.customers
      where store_id = ${storeId}::uuid and lower(email) = ${email} for update
    `);
    let customerId: string;
    let alreadyMember = false;
    if (customer) {
      customerId = String(customer.id);
      if (customer.company_id && String(customer.company_id) !== found.company_id) return { ok: false, problem: "other_company" };
      alreadyMember = Boolean(customer.company_id);
      if (!alreadyMember) {
        const [count] = await tx.execute<Row>(sql`
          select count(*)::int as n from commerce.customers where store_id = ${storeId}::uuid and company_id = ${found.company_id}::uuid
        `);
        if (Number(count.n) >= Number(found.max_members)) return { ok: false, problem: "full" };
        await tx.execute(sql`
          update commerce.customers set company_id = ${found.company_id}::uuid, company_role = 'employee',
            email_verified_at = coalesce(email_verified_at, now()),
            password_hash = case when email_verified_at is null then null else password_hash end,
            updated_at = now()
          where store_id = ${storeId}::uuid and id = ${customerId}::uuid
        `);
      }
    } else {
      const [count] = await tx.execute<Row>(sql`
        select count(*)::int as n from commerce.customers where store_id = ${storeId}::uuid and company_id = ${found.company_id}::uuid
      `);
      if (Number(count.n) >= Number(found.max_members)) return { ok: false, problem: "full" };
      const [created] = await tx.execute<Row>(sql`
        insert into commerce.customers (store_id, email, email_verified_at, company_id, company_role)
        values (${storeId}::uuid, ${email}, now(), ${found.company_id}::uuid, 'employee') returning id
      `);
      customerId = String(created.id);
    }
    await tx.execute(sql`
      update commerce.company_invites set status = 'accepted', accepted_at = now(), customer_id = ${customerId}::uuid
      where id = ${found.id}::uuid
    `);
    return { ok: true, found, customerId, email, existing: Boolean(customer), alreadyMember };
  });
  if (!decided.ok) return decided;
  const { found, customerId, email } = decided;
  // The address is proven: orders placed with it belong to the account.
  await claimOrders(storeId, customerId, email);
  const company = await getCompany(storeId, found.company_id);
  const linkToken = await createSignInLink(storeId, customerId);
  await sendCompanyJoined(storeId, market, {
    customerId,
    to: email,
    token: linkToken,
    company: found.name,
    percent: company ? employeePercent(company) : null,
    existing: decided.existing,
  });
  return { ok: true, company: found.name, existing: decided.existing, alreadyMember: decided.alreadyMember };
}

// ---------------------------------------------------------------------------
// One-time sign-in links
// ---------------------------------------------------------------------------

/** A link that signs the customer in once, within a week. Earlier unused ones stay valid until they run out. */
export async function createSignInLink(storeId: string, customerId: string): Promise<string> {
  const token = newToken();
  await db().execute(sql`
    insert into commerce.customer_sign_in_links (store_id, customer_id, token_hash, expires_at)
    values (${storeId}::uuid, ${customerId}::uuid, ${sha256(token)}, now() + make_interval(days => ${LINK_DAYS}))
  `);
  return token;
}

/** Whether a sign-in link can still be used, and for which email, without using it. */
export async function previewSignInLink(storeId: string, token: string): Promise<{ email: string } | null> {
  if (!tokenOk(token)) return null;
  const [row] = await db().execute<Row>(sql`
    select c.email from commerce.customer_sign_in_links l
    join commerce.customers c on c.store_id = l.store_id and c.id = l.customer_id
    where l.store_id = ${storeId}::uuid and l.token_hash = ${sha256(token)} and l.used_at is null and l.expires_at > now()
  `);
  return row ? { email: String(row.email) } : null;
}

/** Uses a sign-in link: the customer it is for, or null when it was used, has run out or is not one. */
export async function consumeSignInLink(storeId: string, token: string): Promise<string | null> {
  if (!tokenOk(token)) return null;
  const [row] = await db().execute<Row>(sql`
    update commerce.customer_sign_in_links set used_at = now()
    where store_id = ${storeId}::uuid and token_hash = ${sha256(token)} and used_at is null and expires_at > now()
    returning customer_id
  `);
  return row ? String(row.customer_id) : null;
}

/**
 * Daily: invitations are kept a year after they ended (a record of who was let in and out) and three months
 * after they ran out unanswered; sign-in links a month after they expired. Returns how many went.
 */
export async function pruneCompanyRecords(): Promise<number> {
  const invites = await db().execute<Row>(sql`
    delete from commerce.company_invites
    where (status <> 'pending' and coalesce(ended_at, accepted_at, created_at) < now() - interval '1 year')
       or (status = 'pending' and expires_at < now() - interval '3 months')
    returning 1
  `);
  const links = await db().execute<Row>(sql`delete from commerce.customer_sign_in_links where expires_at < now() - interval '1 month' returning 1`);
  return invites.length + links.length;
}
