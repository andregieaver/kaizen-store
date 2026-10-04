import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  DEFAULT_TAX_PROFILE,
  checkupFindings,
  parseTaxProfile,
  readiness,
  vatNumberChanged,
  type CheckupFinding,
  type OssScheme,
  type ReadinessLine,
  type TaxProfile,
  type TaxProfileField,
  type TaxProfileForm,
} from "@/lib/tax-profile";

import { audit, type Membership } from "./auth";
import { memberCan } from "./permissions";
import { checkSellerNumber, getCheck, type SellerCheckDeps, type VatCheck } from "./vat-checks";

type Row = Record<string, unknown>;
type Runner = Pick<ReturnType<typeof db>, "execute">;

/**
 * A store's tax profile (D157, docs/wave-1a-tax.md sections 2.2 and 3.4): whether it is registered for VAT and under which
 * number, where it sends goods from, its OSS and IOSS registrations. One row in `commerce.store_tax_profile` per store,
 * made on first save (no row means the defaults). Owners change it and run *Check now*; admins and other staff may read it.
 * A copy of a store keeps the choices but never the numbers (`commerce.duplicate_store()`).
 *
 * Audit entries carry the names of the fields that changed and the outcome of a check, never the numbers' values.
 */

const text = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const day = (v: unknown): string | null => (v ? new Date(String(v)).toISOString().slice(0, 10) : null);

export const toProfile = (row: Row | undefined): TaxProfile =>
  row
    ? {
        vatRegistered: row.vat_registered === true,
        vatNumber: text(row.vat_number),
        vatNumberCheckId: text(row.vat_number_check_id),
        vatNumberCheckedAt: row.vat_number_checked_at ? new Date(String(row.vat_number_checked_at)).toISOString() : null,
        vatNumberValid: row.vat_number_valid === null || row.vat_number_valid === undefined ? null : row.vat_number_valid === true,
        dispatchCountry: text(row.dispatch_country)?.trim() ?? null,
        ossScheme: (["none", "union", "non_union"].includes(String(row.oss_scheme)) ? row.oss_scheme : "none") as OssScheme,
        ossMemberState: text(row.oss_member_state)?.trim() ?? null,
        ossNumber: text(row.oss_number),
        ossRegisteredOn: day(row.oss_registered_on),
        iossNumber: text(row.ioss_number),
        iossIntermediary: text(row.ioss_intermediary),
        iossMarkets: Array.isArray(row.ioss_markets) ? row.ioss_markets.map(String) : [],
        iossRegisteredOn: day(row.ioss_registered_on),
      }
    : { ...DEFAULT_TAX_PROFILE, iossMarkets: [] };

/** The store's tax profile (the defaults when none was saved). Every query of it carries the store id. */
export async function getTaxProfile(storeId: string, runner: Runner = db()): Promise<TaxProfile> {
  const [row] = await runner.execute<Row>(sql`
    select vat_registered, vat_number, vat_number_check_id, vat_number_checked_at, vat_number_valid,
           dispatch_country::text as dispatch_country, oss_scheme, oss_member_state::text as oss_member_state, oss_number,
           oss_registered_on::text as oss_registered_on, ioss_number, ioss_intermediary, ioss_markets,
           ioss_registered_on::text as ioss_registered_on
    from commerce.store_tax_profile where store_id = ${storeId}::uuid
  `);
  return toProfile(row);
}

/** The country the store is in (`stores.country`), upper case, or null. */
export async function storeCountry(storeId: string, runner: Runner = db()): Promise<string | null> {
  const [row] = await runner.execute<Row>(sql`select country::text as country from commerce.stores where id = ${storeId}::uuid`);
  return text(row?.country)?.trim().toUpperCase() ?? null;
}

export type TaxProfileView = {
  profile: TaxProfile;
  country: string | null;
  /** What is on and what is missing for VAT, reverse charge, OSS and IOSS. */
  readiness: ReadinessLine[];
  /** The latest check of the store's own number, with VIES's name and address (staff only), or null. */
  check: VatCheck | null;
};

/** What the tax screen shows: the profile, the store's country, the readiness lines and the latest check of its own number. */
export async function taxProfileView(storeId: string): Promise<TaxProfileView> {
  const [profile, country] = await Promise.all([getTaxProfile(storeId), storeCountry(storeId)]);
  const check = profile.vatNumberCheckId ? await getCheck(db(), storeId, profile.vatNumberCheckId) : null;
  return { profile, country, readiness: readiness(profile, country), check };
}

/** What the store checkup reports about the profile (`checkupFindings()` of what is saved). */
export async function taxCheckupFindings(storeId: string): Promise<CheckupFinding[]> {
  return checkupFindings(await getTaxProfile(storeId));
}

export type TaxSaveResult =
  | { ok: true; profile: TaxProfile }
  | { ok: false; errors: Partial<Record<TaxProfileField, string>>; problems: string[] };

const OWNER_ONLY = "Only an owner can change the tax settings.";

/** The database's own rules (`store_tax_profile_rules`), said in words, for the case the form's checks did not catch it. */
function databaseProblem(error: unknown): string | null {
  const message = error instanceof Error ? `${error.message} ${(error as { cause?: { message?: string } }).cause?.message ?? ""}` : String(error);
  const code = /tax_profile_[a-z_]+/.exec(message)?.[0];
  if (!code) return null;
  return (
    {
      tax_profile_vat_prefix: "The VAT number must be one of the store's own country.",
      tax_profile_ioss_markets: "IOSS applies to EU countries only, each listed once.",
      tax_profile_oss_member_state: "The Union scheme is registered in an EU member state.",
      tax_profile_check: "The saved check does not belong to this number.",
    }[code] ?? "The tax settings were refused."
  );
}

/**
 * Saves the profile. Owners only. What an owner typed is checked by `parseTaxProfile()` (the same function the browser
 * uses); saving a different VAT number clears the check of the old one (all three columns, in the same statement).
 * Audit: `store.tax_profile_updated` with the names of the fields that changed.
 */
export async function saveTaxProfile(membership: Membership, form: TaxProfileForm): Promise<TaxSaveResult> {
  const { account, store } = membership;
  if (!memberCan(membership, "owner")) return { ok: false, errors: {}, problems: [OWNER_ONLY] };
  const country = await storeCountry(store.id);
  const parsed = parseTaxProfile(form, country);
  if (!parsed.ok) return { ok: false, errors: parsed.errors, problems: Object.values(parsed.errors) };
  const v = parsed.values;
  const before = await getTaxProfile(store.id);
  const numberChanged = vatNumberChanged(before, v);
  try {
    await db().execute(sql`
      insert into commerce.store_tax_profile (
        store_id, vat_registered, vat_number, dispatch_country, oss_scheme, oss_member_state, oss_number, oss_registered_on,
        ioss_number, ioss_intermediary, ioss_markets, ioss_registered_on, updated_by, updated_at
      ) values (
        ${store.id}::uuid, ${v.vatRegistered}, ${v.vatNumber}, ${v.dispatchCountry}, ${v.ossScheme}, ${v.ossMemberState}, ${v.ossNumber},
        ${v.ossRegisteredOn}::date, ${v.iossNumber}, ${v.iossIntermediary}, array[${sql.join(v.iossMarkets.map((m) => sql`${m}`), sql`, `)}]::text[],
        ${v.iossRegisteredOn}::date, ${account.id}::uuid, now()
      )
      on conflict (store_id) do update set
        vat_registered = excluded.vat_registered,
        vat_number = excluded.vat_number,
        vat_number_check_id = case when store_tax_profile.vat_number is distinct from excluded.vat_number then null else store_tax_profile.vat_number_check_id end,
        vat_number_checked_at = case when store_tax_profile.vat_number is distinct from excluded.vat_number then null else store_tax_profile.vat_number_checked_at end,
        vat_number_valid = case when store_tax_profile.vat_number is distinct from excluded.vat_number then null else store_tax_profile.vat_number_valid end,
        dispatch_country = excluded.dispatch_country, oss_scheme = excluded.oss_scheme, oss_member_state = excluded.oss_member_state,
        oss_number = excluded.oss_number, oss_registered_on = excluded.oss_registered_on, ioss_number = excluded.ioss_number,
        ioss_intermediary = excluded.ioss_intermediary, ioss_markets = excluded.ioss_markets,
        ioss_registered_on = excluded.ioss_registered_on, updated_by = excluded.updated_by, updated_at = now()
    `);
  } catch (error) {
    const problem = databaseProblem(error);
    if (!problem) throw error;
    return { ok: false, errors: {}, problems: [problem] };
  }
  const changed = (Object.keys(v) as (keyof typeof v)[]).filter((key) => JSON.stringify(v[key]) !== JSON.stringify(before[key]));
  if (changed.length > 0) await audit(account.id, store.id, "store.tax_profile_updated", { fields: changed, numberChanged });
  return { ok: true, profile: await getTaxProfile(store.id) };
}

export type SellerCheckResult =
  | { ok: true; check: VatCheck; profile: TaxProfile }
  | { ok: false; problems: string[] };

/**
 * *Check now*: asks VIES (or, for a Norwegian number, the open register) about the store's own number and keeps the answer
 * on the profile (the check, its time and result). Owners only. Audit: `store.tax_number_checked` with the outcome, never the
 * number. An unavailable answer is kept as a check but leaves the result unknown (never valid).
 */
export async function checkOwnVatNumber(membership: Membership, deps: SellerCheckDeps = {}): Promise<SellerCheckResult> {
  const { account, store } = membership;
  if (!memberCan(membership, "owner")) return { ok: false, problems: [OWNER_ONLY] };
  const profile = await getTaxProfile(store.id);
  if (!profile.vatNumber) return { ok: false, problems: ["Save the store's VAT number first."] };
  const check = await checkSellerNumber(store.id, profile.vatNumber, deps);
  const [saved] = await db().execute<Row>(sql`
    update commerce.store_tax_profile set
      vat_number_check_id = ${check.id}::uuid,
      vat_number_checked_at = ${check.requestedAt}::timestamptz,
      vat_number_valid = ${check.status === "valid" ? true : check.status === "invalid" ? false : null}
    where store_id = ${store.id}::uuid and vat_number = ${profile.vatNumber}
    returning store_id
  `);
  // The number was changed under the check: the answer is for a number no longer on the profile.
  if (!saved) return { ok: false, problems: ["The VAT number was changed while it was being checked. Check it again."] };
  await audit(account.id, store.id, "store.tax_number_checked", { status: check.status, source: check.source, error: check.error });
  return { ok: true, check, profile: await getTaxProfile(store.id) };
}
