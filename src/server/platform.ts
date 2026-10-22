import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { ACCESS_EMAIL_KINDS, accessEmail, requestLang, requestLocale, type AccessEmailKind } from "@/lib/access-emails";
import { renderEmail } from "@/lib/email-layout";
import type { PlatformLang } from "@/lib/platform-lang";
import { slugProblem } from "@/lib/slug";
import { emailSignInLink } from "@/lib/supabase/mailer";

import { starterRefusal } from "@/lib/store-starters";

import { audit, type Account } from "./auth";
import { sendEmail } from "./email";
import { markDemoContent } from "./demo-content";
import { applyDesignPreset, isOfferedDesign } from "./design-presets";
import { notifyReferralOpened, usableReferralCode } from "./referrals";

type Row = Record<string, unknown>;

export type AccessRequestInput = {
  name: string;
  email: string;
  storeName: string;
  message: string;
  /** The referral code the sign-up came with (D131): from the link's address or form, else the cookie kept after consent. */
  referralCode?: string | null;
  /** The store template chosen (D175): a published starter's id, else nothing (the Standard store). */
  starterId?: string | null;
  /** The design profile chosen (D176): a published profile's id, else nothing (the template's own look). */
  designPresetId?: string | null;
  /** One of its presets (`docs/theme-showcase-phase-1.md` step 4), by key; kept only when its published version has it. */
  designVariation?: string | null;
  /** The language the form was sent in (D312 P6): its emails are written in it. English when left out. */
  lang?: PlatformLang;
};

/** The preset key when the design profile's published version has a preset of that key, else null (SQL, beside the profile's id). */
const publishedVariation = (presetId: unknown, key: string | null | undefined) => sql`(
  select v ->> 'key' from commerce.design_presets d, jsonb_array_elements(coalesce(d.snapshot -> 'variations', '[]'::jsonb)) v
  where d.id = ${presetId ?? null}::uuid and d.published and v ->> 'key' = ${key ?? null} limit 1
)`;

/**
 * Records a request to join the beta. A second request from an email that
 * already has one pending is quietly merged, so the form never reveals who
 * has asked before. A referral code (D131) is kept with the request when it is
 * a real one of a referrer who is not blocked; any other is dropped without a
 * word, so the form reveals nothing about codes either. Approving the request
 * makes the referral, in SQL. A store template (D175) and a design profile
 * (D176) are kept only when they are published ones; any other value is dropped
 * the same way.
 */
export async function createAccessRequest(input: AccessRequestInput): Promise<void> {
  const referralCode = await usableReferralCode(input.referralCode);
  const [made] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name, message, referral_code, starter_id, design_preset_id, design_variation, locale)
    values (${input.email}, ${input.name}, ${input.storeName}, ${input.message}, ${referralCode},
      (select st.id from commerce.store_starters st where st.id = ${input.starterId ?? null}::uuid and st.published and st.kind = 'content'),
      (select d.id from commerce.design_presets d where d.id = ${input.designPresetId ?? null}::uuid and d.published),
      ${publishedVariation(input.designPresetId, input.designVariation)}, ${requestLocale(input.lang ?? "en")})
    on conflict ((lower(email))) where status = 'pending' do nothing
    returning id
  `);
  // A merged second request sends nothing again; the form says the same either way.
  if (made) await sendAccessEmail("received", String(made.id));
}

/**
 * One of a request's emails (D312 P6), in the language it was made in, once per request and kind. Best effort: the request, the approval
 * or the refusal stands whatever the email does.
 */
async function sendAccessEmail(kind: AccessEmailKind, requestId: string, signInUrl?: string): Promise<void> {
  try {
    const [row] = await db().execute<Row>(sql`select email, name, store_name, locale from commerce.access_requests where id = ${requestId}::uuid`);
    if (!row) return;
    const email = renderEmail(accessEmail(kind, requestLang(row.locale as string | null), { name: String(row.name), storeName: String(row.store_name), signInUrl }));
    await sendEmail({
      storeId: null,
      kind: ACCESS_EMAIL_KINDS[kind],
      to: String(row.email),
      email,
      fromName: "Kaizena Flow",
      idempotencyKey: `access-${kind}:${requestId}`,
    });
  } catch (error) {
    console.error("[platform] a request's email could not be sent", error);
  }
}

export type AccessRequest = {
  id: string;
  email: string;
  name: string;
  storeName: string;
  message: string;
  status: "pending" | "approved" | "declined";
  createdAt: string;
  decidedAt: string | null;
  storeSlug: string | null;
  /** True when this email already has an account (e.g. staff in a store). */
  hasAccount: boolean;
  /** The store template the requester chose (D175), or null for the Standard store. */
  starterId: string | null;
  starterTitle: string | null;
  /** The design profile the requester chose (D176), or null for the template's own look. */
  designPresetId: string | null;
  designTitle: string | null;
  /** The profile's preset chosen with it (`docs/theme-showcase-phase-1.md` step 4), by key; null for its own look. */
  designVariation: string | null;
};

/** Pending requests first (oldest first), then the 20 latest decisions. */
export async function listAccessRequests(): Promise<AccessRequest[]> {
  const rows = await db().execute<Row>(sql`
    (select r.*, s.slug as store_slug, st.title as starter_title, dp.title as design_title, exists (
       select 1 from commerce.accounts a where lower(a.email) = lower(r.email)
     ) as has_account
     from commerce.access_requests r
     left join commerce.stores s on s.id = r.store_id
     left join commerce.store_starters st on st.id = r.starter_id
     left join commerce.design_presets dp on dp.id = r.design_preset_id
     where r.status = 'pending'
     order by r.created_at)
    union all
    (select r.*, s.slug as store_slug, st.title as starter_title, dp.title as design_title, exists (
       select 1 from commerce.accounts a where lower(a.email) = lower(r.email)
     ) as has_account
     from commerce.access_requests r
     left join commerce.stores s on s.id = r.store_id
     left join commerce.store_starters st on st.id = r.starter_id
     left join commerce.design_presets dp on dp.id = r.design_preset_id
     where r.status <> 'pending'
     order by r.decided_at desc
     limit 20)
  `);
  return rows.map((row) => ({
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    storeName: String(row.store_name),
    message: String(row.message ?? ""),
    status: row.status as AccessRequest["status"],
    createdAt: new Date(String(row.created_at)).toISOString(),
    decidedAt: row.decided_at ? new Date(String(row.decided_at)).toISOString() : null,
    storeSlug: row.store_slug ? String(row.store_slug) : null,
    hasAccount: Boolean(row.has_account),
    starterId: row.starter_id ? String(row.starter_id) : null,
    starterTitle: row.starter_title ? String(row.starter_title) : null,
    designPresetId: row.design_preset_id ? String(row.design_preset_id) : null,
    designTitle: row.design_title ? String(row.design_title) : null,
    designVariation: row.design_variation ? String(row.design_variation) : null,
  }));
}

export async function countPendingRequests(): Promise<number> {
  const [row] = await db().execute<Row>(sql`
    select count(*)::int as n from commerce.access_requests where status = 'pending'
  `);
  return Number(row?.n ?? 0);
}

export async function isSlugTaken(slug: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    select 1 as taken from commerce.stores where slug = ${slug}
  `);
  return Boolean(row);
}

export type ApproveResult =
  | {
      ok: true;
      slug: string;
      email: string;
      invited: boolean;
      /** The design profile chosen (D176): applied, or why not (the store is made all the same, with its template's look). */
      design: { title: string | null; problem: string | null } | null;
      storeId: string;
      /**
       * What the requester chose that was no longer offered at approval (D177): the store template (the store was made from the Standard
       * store) and the design profile (the store keeps its template's own look), by title.
       */
      fellBack: { starter: string | null; design: string | null };
    }
  | { ok: false; problems: string[] };

/**
 * Approves a request: account, store copied from the store template chosen
 * (D175: the requester's, or the one the admin changed it to; null is the
 * Standard store) and the decision, in one database transaction; then emails
 * a sign-in link. `commerce.starter_source()` refuses a template the admin
 * chose that is not offered, so nothing is created then; one the requester
 * chose that was unpublished or archived since gives way to the Standard
 * store (D177, `fellBack`), as an unoffered design profile gives way to the
 * template's own look.
 */
export async function approveAccessRequest(
  admin: Account,
  requestId: string,
  slug: string,
  storeName: string,
  origin: string,
  /** The store template to copy: an id, null for the Standard store, or left out to keep the requester's choice. */
  starterId?: string | null,
  /** The design profile to apply after (D176): an id, null for the template's own look, or left out to keep the requester's choice. */
  designPresetId?: string | null,
  /** With a design profile the admin chose: its preset's key (`docs/theme-showcase-phase-1.md` step 4), null for its own look. */
  designVariation: string | null = null,
): Promise<ApproveResult> {
  const problem = slugProblem(slug);
  if (problem) return { ok: false, problems: [`Store address: ${problem}`] };
  if (!storeName.trim()) return { ok: false, problems: ["Enter a store name."] };
  // A profile the admin chose that is not offered is refused in plain words before anything is made.
  if (designPresetId && !(await isOfferedDesign(designPresetId))) {
    return { ok: false, problems: ["That theme is not offered any more. Choose another."] };
  }
  // What the requester chose (D175, D176), to say what gave way when it is no longer offered (D177).
  const [asked] = await db().execute<Row>(sql`
    select r.locale, r.starter_id, st.title as starter_title, commerce.starter_offered_source(r.starter_id) is not null as starter_offered,
           r.design_preset_id, d.title as design_title
    from commerce.access_requests r
    left join commerce.store_starters st on st.id = r.starter_id
    left join commerce.design_presets d on d.id = r.design_preset_id
    where r.id = ${requestId}::uuid
  `);

  let email: string;
  let storeId: string;
  let chosenDesign: string | null;
  let chosenVariation: string | null;
  try {
    const row = await db().transaction(async (tx) => {
      if (starterId !== undefined) {
        // An id that is not a published template is refused here in plain words (store_starters.not_offered), before anything is kept.
        if (starterId) await tx.execute(sql`select commerce.starter_source(${starterId}::uuid)`);
        await tx.execute(sql`
          update commerce.access_requests set starter_id = ${starterId}::uuid
           where id = ${requestId}::uuid and status = 'pending' and starter_id is distinct from ${starterId}::uuid
        `);
      }
      if (designPresetId !== undefined) {
        // The profile and its preset together (a preset the published version lacks is dropped, as at sign-up).
        await tx.execute(sql`
          update commerce.access_requests
             set design_preset_id = ${designPresetId}::uuid, design_variation = ${publishedVariation(designPresetId, designVariation)}
           where id = ${requestId}::uuid and status = 'pending'
        `);
      }
      const [approved] = await tx.execute<Row>(sql`
        select commerce.approve_access_request(
          ${requestId}::uuid, ${slug}, ${storeName.trim()}, ${admin.id}::uuid
        ) as store_id,
        (select email from commerce.access_requests where id = ${requestId}::uuid) as email,
        (select design_preset_id from commerce.access_requests where id = ${requestId}::uuid) as design_preset_id,
        (select design_variation from commerce.access_requests where id = ${requestId}::uuid) as design_variation
      `);
      return approved;
    });
    email = String(row.email);
    storeId = String(row.store_id);
    chosenDesign = row.design_preset_id ? String(row.design_preset_id) : null;
    chosenVariation = row.design_variation ? String(row.design_variation) : null;
  } catch (error) {
    return { ok: false, problems: [approvalProblem(error, slug)] };
  }
  // A profile the requester chose that was unpublished or archived since gives way to the template's own look (D177), and the admin is told.
  // (Also when the admin left the choice empty on a request whose profile is gone: the request page offers none in its place.)
  const askedDesign = asked?.design_preset_id ? String(asked.design_preset_id) : null;
  const designGone = askedDesign !== null && !designPresetId && !(await isOfferedDesign(askedDesign));
  const designFellBack = designGone ? (asked?.design_title ? String(asked.design_title) : "A theme") : null;
  if (designGone && chosenDesign === askedDesign) chosenDesign = null;
  // The store template likewise: approval made the store from the Standard store (`approve_access_request()`).
  const starterFellBack =
    !starterId && asked?.starter_id && !asked.starter_offered ? (asked.starter_title ? String(asked.starter_title) : "A demo store") : null;
  // The design profile chosen (D176), applied right after the store is made; a failure leaves the store with its template's look.
  const design = chosenDesign ? await applyChosenDesign(storeId, chosenDesign, admin.id, chosenVariation) : null;
  // What the store template brought is its demo content, removable in one press from the store's Home (`docs/theme-showcase-phase-1.md` 4b).
  await markNewStore(storeId);
  // A store that came through a referral (D131, made by the approval itself): its referrer hears it is open. Best effort.
  await notifyReferralOpened(storeId).catch(() => null);
  // The new owner's admin starts in the request's language, unless they have chosen one already (D312 P6, A0).
  await db()
    .execute(sql`
      update commerce.accounts a set admin_locale = r.locale
      from commerce.access_requests r
      where r.id = ${requestId}::uuid and r.locale is not null and lower(a.email) = lower(r.email) and a.admin_locale is null
    `)
    .catch(() => null);
  await sendAccessEmail("approved", requestId, `${origin}/admin/sign-in`);

  return {
    ok: true,
    slug,
    email,
    invited: await emailSignInLink(email, origin, asked?.locale ? String(asked.locale) : null),
    design,
    storeId,
    fellBack: { starter: starterFellBack, design: designFellBack },
  };
}

/**
 * Applies the design profile chosen for a store just made (D176), with its preset (`docs/theme-showcase-phase-1.md` step 4), never
 * throwing: the store stays whatever happens. A preset its published version no longer has gives way to the profile's own look.
 */
async function applyChosenDesign(
  storeId: string,
  presetId: string,
  accountId: string,
  variation: string | null = null,
): Promise<{ title: string | null; problem: string | null }> {
  try {
    const [preset] = await db().execute<Row>(sql`
      select title, ${publishedVariation(presetId, variation)} as variation, (
        select v ->> 'name' from jsonb_array_elements(coalesce(snapshot -> 'variations', '[]'::jsonb)) v where v ->> 'key' = ${variation} limit 1
      ) as variation_name
      from commerce.design_presets where id = ${presetId}::uuid
    `);
    const kept = preset?.variation ? String(preset.variation) : null;
    const result = await applyDesignPreset(storeId, presetId, accountId, {}, kept);
    const title = preset ? (kept && preset.variation_name ? `${String(preset.title)} · ${String(preset.variation_name)}` : String(preset.title)) : null;
    return { title, problem: result.ok ? null : result.problems.join(" ") };
  } catch (error) {
    console.error("[platform] the theme could not be applied", error);
    return { title: null, problem: "The theme could not be applied." };
  }
}

/**
 * Marks a store just made's demo content, after its design is applied, so a change the design made is not taken for the owner's. Never
 * throwing: a store left unmarked only lacks *Remove demo content*.
 */
async function markNewStore(storeId: string): Promise<void> {
  await markDemoContent(storeId).catch((error) => console.error("[platform] the demo content could not be marked", error));
}

function approvalProblem(error: unknown, slug: string): string {
  const text = describe(error);
  const starter = starterRefusal(text);
  if (starter) return starter;
  if (text.includes("stores_slug_unique")) return `The address ${slug} is taken. Choose another.`;
  if (text.includes("already")) return "This request has already been decided.";
  if (text.includes("disabled")) return "That person's account is disabled.";
  if (text.includes("template")) return "There is no template store to copy.";
  return "The store could not be created. Nothing was changed; try again.";
}

function describe(error: unknown): string {
  const parts: string[] = [];
  for (let e: unknown = error; e && parts.length < 5; e = (e as { cause?: unknown }).cause) {
    const record = e as { message?: unknown; constraint_name?: unknown };
    if (typeof record.message === "string") parts.push(record.message);
    if (typeof record.constraint_name === "string") parts.push(record.constraint_name);
  }
  return parts.join(" ");
}

export async function declineAccessRequest(admin: Account, requestId: string): Promise<void> {
  const [row] = await db().execute<Row>(sql`
    update commerce.access_requests
       set status = 'declined', decided_by = ${admin.id}::uuid, decided_at = now()
     where id = ${requestId}::uuid and status = 'pending'
    returning email
  `);
  if (!row) return;
  await audit(admin.id, null, "platform.access_declined", { email: String(row.email) });
  await sendAccessEmail("declined", requestId);
}

/** How many stores one person may own; platform admins have no limit. */
export const MAX_STORES_PER_OWNER = 10;

export type CreateStoreResult =
  | { ok: true; slug: string; storeId: string; design: { title: string | null; problem: string | null } | null }
  | { ok: false; problems: string[] };

/**
 * An owner creates another store: a copy of the store template chosen (D175:
 * a published starter's id) or of the demo template (null, the Standard
 * store), with them as owner, like an approved request. The source is decided
 * by `commerce.starter_source()`, so no other store can be passed. Only people
 * who already own a store (or run the platform) can, so the beta stays
 * invite-only.
 */
export async function createStoreForOwner(
  account: Account,
  name: string,
  slug: string,
  starterId: string | null = null,
  /** The design profile to apply once the store is made (D176): a published profile's id, or null for the template's own look. */
  designPresetId: string | null = null,
  /** Its preset (`docs/theme-showcase-phase-1.md` step 4), by key; null for its own look. */
  designVariation: string | null = null,
): Promise<CreateStoreResult> {
  const problems: string[] = [];
  if (!name.trim()) problems.push("Enter a store name.");
  const problem = slugProblem(slug);
  if (problem) problems.push(`Store address: ${problem}`);
  if (designPresetId && !(await isOfferedDesign(designPresetId))) problems.push("That theme is not offered any more. Choose another.");
  if (problems.length > 0) return { ok: false, problems };

  const [owned] = await db().execute<Row>(sql`
    select count(*)::int as n from commerce.store_members m
    join commerce.stores s on s.id = m.store_id
    where m.account_id = ${account.id}::uuid and m.role = 'owner' and m.disabled_at is null
      and s.status <> 'closed' and not (s.is_template or s.starter)
  `);
  const count = Number(owned?.n ?? 0);
  if (!account.platformAdmin && count === 0) {
    return { ok: false, problems: ["Only store owners can create more stores. Ask for a store at /sign-up."] };
  }
  if (!account.platformAdmin && count >= MAX_STORES_PER_OWNER) {
    return { ok: false, problems: [`You can own up to ${MAX_STORES_PER_OWNER} stores. Contact Kaizena Flow for more.`] };
  }
  if (await isSlugTaken(slug)) return { ok: false, problems: [`The address ${slug} is taken. Choose another.`] };

  try {
    await db().execute(sql`
      select commerce.clone_store(
        commerce.starter_source(${starterId}::uuid), ${slug}, ${name.trim()}, ${account.id}::uuid
      )
    `);
  } catch (error) {
    return { ok: false, problems: [approvalProblem(error, slug)] };
  }
  const [store] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${slug}`);
  const storeId = String(store.id);
  await audit(account.id, storeId, "store.created_by_owner", { slug, name: name.trim(), starter: starterId, design: designPresetId, preset: designVariation });
  // The design profile chosen (D176), applied right after; a failure leaves the store with its template's look.
  const design = designPresetId ? await applyChosenDesign(storeId, designPresetId, account.id, designVariation) : null;
  await markNewStore(storeId);
  return { ok: true, slug, storeId, design };
}
