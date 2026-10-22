"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { parsePatternList } from "@/lib/postal-patterns";
import { parsePrice } from "@/lib/product-input";
import { actionAdminLang } from "@/server/admin-request-lang";
import { checkPermission } from "@/server/permissions";
import { checkLocalCode, deleteLocalArea, listLocalAreas, saveLocalArea } from "@/server/local-delivery";
import { listPickupPlaces, savePickupOption } from "@/server/pickup";
import {
  checkZoneCode,
  deleteShippingMethod,
  deleteShippingProfile,
  deleteShippingZone,
  getShippingSetup,
  reorderShipping,
  saveDefaultWeight,
  saveShippingMethod,
  saveShippingProfile,
  saveShippingZone,
} from "@/server/shipping-methods";

/**
 * The shipping settings' actions (D237, `docs/wave-3-shipping-methods.md` 2.1 to 2.3): each asks `settings:write` itself and takes the store's
 * slug as its bound first argument. The server functions they call validate again, write in one transaction, audit under `shipping.*` and
 * refresh the catalogue's tag (structured data and the chat read shipping), which also draws the page again for the person who saved.
 * Amounts typed are read in the currency the row is kept in (the market's own, never the shopper's view).
 */

const error = (...messages: string[]): FormState => ({ status: "error", messages });
const ok = (message: string): FormState => ({ status: "ok", messages: [message] });
const field = (form: FormData, name: string, max = 2000) => String(form.get(name) ?? "").trim().slice(0, max);
const isUuid = (value: unknown): value is string => z.uuid().safeParse(value).success;
const isMarket = (value: unknown): value is string => typeof value === "string" && /^[A-Z]{2}$/.test(value);
const base = (slug: string) => `/admin/${slug}/settings/shipping`;
/** What the actions answer, in the account's language (D312 A8); before a member is known, the request's (English outside one). */
const wordsOf = (member: { account: { adminLocale?: string | null } }) => adminText(adminLangOf(member.account.adminLocale), "shipping").actions;
const noAccess = async () => adminText(await actionAdminLang(), "shipping").actions.noAccess;

/** An amount typed in a currency: empty is null, anything else must read as one (`invalid`). */
function amountOf(text: string, currency: string): number | null | "invalid" {
  if (!text) return null;
  const minor = parsePrice(text, currency);
  return minor === null ? "invalid" : minor;
}

// ---------------------------------------------------------------------------
// Methods (the method page's editor sends the whole method as JSON)
// ---------------------------------------------------------------------------

export type MethodSaved = { ok: true; id: string; message: string } | { ok: false; message: string };

/** Saves a method and every rate block of it (`methodInput`, checked again on the server); a new one opens on its own page. */
export async function saveMethodAction(storeSlug: string, input: unknown): Promise<MethodSaved> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { ok: false, message: await noAccess() };
  const saved = await saveShippingMethod(member.account.id, member.store.id, input);
  if (!saved.ok) return { ok: false, message: saved.message };
  return { ok: true, id: saved.id, message: wordsOf(member).methodSaved };
}

export async function deleteMethodAction(storeSlug: string, methodId: string, marketCode: string): Promise<{ ok: false; problems: string[] }> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { ok: false, problems: [await noAccess()] };
  if (!isUuid(methodId) || !(await deleteShippingMethod(member.account.id, member.store.id, methodId))) return { ok: false, problems: [wordsOf(member).methodGone] };
  redirect(`${base(storeSlug)}/methods?market=${isMarket(marketCode) ? marketCode : ""}`);
}

/** Moves a method or a zone one place up or down within its market. */
export async function moveShippingAction(storeSlug: string, table: "methods" | "zones", marketCode: string, id: string, direction: "up" | "down"): Promise<void> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member || !isMarket(marketCode) || !isUuid(id) || (table !== "methods" && table !== "zones")) return;
  const setup = await getShippingSetup(member.store.id);
  const ids = (table === "methods" ? setup.methods : setup.zones).filter((row) => row.marketCode === marketCode).map((row) => row.id);
  const at = ids.indexOf(id);
  const to = direction === "up" ? at - 1 : at + 1;
  if (at < 0 || to < 0 || to >= ids.length) return;
  [ids[at], ids[to]] = [ids[to], ids[at]];
  await reorderShipping(member.account.id, member.store.id, table, marketCode, ids);
}

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

/** A zone: its name and its postal codes and prefixes as typed (comma, space or line separated), cleaned by the country's rule. */
export async function saveZoneAction(storeSlug: string, zoneId: string | null, marketCode: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return error(await noAccess());
  const w = wordsOf(member);
  if (!isMarket(marketCode) || (zoneId !== null && !isUuid(zoneId))) return error(w.zoneGone);
  const { patterns, invalid } = parsePatternList(marketCode, field(form, "patterns", 20_000));
  if (invalid.length > 0) {
    const shown = invalid.slice(0, 5).join(", ");
    return error(fillWords(w.notCodes, { codes: shown, more: invalid.length > 5 ? fillWords(w.andMore, { n: invalid.length - 5 }) : "" }));
  }
  const saved = await saveShippingZone(member.account.id, member.store.id, { id: zoneId, marketCode, name: field(form, "name", 200), patterns });
  if (!saved.ok) return error(saved.message);
  return ok(zoneId ? w.zoneSaved : w.zoneAdded);
}

export async function deleteZoneAction(storeSlug: string, zoneId: string): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return error(await noAccess());
  const w = wordsOf(member);
  if (!isUuid(zoneId) || !(await deleteShippingZone(member.account.id, member.store.id, zoneId))) return error(w.zoneGone);
  return ok(w.zoneDeleted);
}

/** *Check a postal code*: which zone it falls in, and which active methods have a rate there. Nothing is saved. */
export async function checkZoneCodeAction(storeSlug: string, marketCode: string, _state: FormState, form: FormData): Promise<FormState> {
  // A try before saving: the editors' own (`settings:write`), as every action of the page.
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return error(await noAccess());
  const w = wordsOf(member);
  if (!isMarket(marketCode)) return error(w.chooseCountry);
  const typed = field(form, "code", 20);
  const found = await checkZoneCode(member.store.id, marketCode, typed);
  if (!found.code) return error(fillWords(w.notACode, { code: typed }));
  const zoneId = found.zone?.id ?? null;
  const methods = (await getShippingSetup(member.store.id)).methods.filter((m) => m.marketCode === marketCode && m.active && m.rates.some((r) => r.zoneId === zoneId));
  const where = found.zone ? fillWords(w.theZone, { name: found.zone.name }) : w.restOfCountry;
  const priced = methods.length === 0 ? w.noRateThere : fillWords(w.ratesThere, { names: methods.map((m) => m.name).join(", ") });
  return ok(fillWords(w.inZone, { code: found.code, where, priced }));
}

// ---------------------------------------------------------------------------
// Profiles and the default weight
// ---------------------------------------------------------------------------

/** A profile: its name and the products ticked (`product` fields); products not ticked that were in it go back to General. */
export async function saveProfileAction(storeSlug: string, profileId: string | null, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return error(await noAccess());
  const w = wordsOf(member);
  if (profileId !== null && !isUuid(profileId)) return error(w.profileGone);
  const productIds = form.getAll("product").map(String).filter(isUuid);
  const saved = await saveShippingProfile(member.account.id, member.store.id, { id: profileId, name: field(form, "name", 200), productIds });
  if (!saved.ok) return error(saved.message);
  if (!profileId) redirect(`${base(storeSlug)}/profiles`);
  return ok(countWords(new Set(productIds).size, w.profileSaved));
}

export async function deleteProfileAction(storeSlug: string, profileId: string): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return error(await noAccess());
  const w = wordsOf(member);
  if (!isUuid(profileId)) return error(w.profileGone);
  const done = await deleteShippingProfile(member.account.id, member.store.id, profileId);
  if (!done.ok) return error(w.profileGone);
  return ok(countWords(done.moved, w.profileDeleted));
}

export async function saveDefaultWeightAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return error(await noAccess());
  const w = wordsOf(member);
  const typed = field(form, "grams", 20);
  const grams = /^\d+$/.test(typed) ? Number(typed) : Number.NaN;
  if (!Number.isSafeInteger(grams)) return error(w.weightProblem);
  const saved = await saveDefaultWeight(member.account.id, member.store.id, { grams });
  return saved.ok ? ok(w.weightSaved) : error(saved.message);
}

// ---------------------------------------------------------------------------
// Pickup
// ---------------------------------------------------------------------------

/** A place's pickup option: the switch, the price (empty is free), the usual ready time in hours and the instructions. */
export async function savePickupAction(storeSlug: string, locationId: string, currency: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return error(await noAccess());
  const w = wordsOf(member);
  if (!isUuid(locationId)) return error(w.placeGone);
  const amount = amountOf(field(form, "amount", 30), currency);
  if (amount === "invalid") return error(fillWords(w.pickupPrice, { currency }));
  const hoursText = field(form, "readyInHours", 10) || "0";
  if (!/^\d+$/.test(hoursText)) return error(w.readyProblem);
  // Translations of the instructions are kept as they are: they are written from the store translation page.
  const option = (await listPickupPlaces(member.store.id)).find((p) => p.locationId === locationId)?.option ?? null;
  const saved = await savePickupOption(member.account.id, member.store.id, {
    locationId,
    active: form.get("active") === "on",
    amountMinor: amount ?? 0,
    readyInHours: Number(hoursText),
    instructions: field(form, "instructions", 5000),
    instructionsT: option?.instructionsT ?? {},
  });
  return saved.ok ? ok(w.pickupSaved) : error(saved.message);
}

// ---------------------------------------------------------------------------
// Local delivery
// ---------------------------------------------------------------------------

/** A local delivery area, new when `areaId` is null; its market is fixed once made. */
export async function saveAreaAction(storeSlug: string, areaId: string | null, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return error(await noAccess());
  const w = wordsOf(member);
  if (areaId !== null && !isUuid(areaId)) return error(w.areaGone);
  const marketCode = field(form, "market", 2);
  const market = member.store.markets.find((m) => m.code === marketCode);
  if (!market) return error(w.chooseSold);
  const currency = market.nativeCurrency;
  const kind = form.get("kind") === "radius" ? "radius" : "postal";
  const problems: string[] = [];
  const amount = amountOf(field(form, "amount", 30), currency);
  const minimum = amountOf(field(form, "minBasket", 30), currency);
  const freeOver = amountOf(field(form, "freeOver", 30), currency);
  if (amount === "invalid") problems.push(fillWords(w.areaPrice, { currency }));
  if (minimum === "invalid") problems.push(fillWords(w.areaMinimum, { currency }));
  if (freeOver === "invalid") problems.push(fillWords(w.areaFree, { currency }));
  let patterns: string[] = [];
  if (kind === "postal") {
    const parsed = parsePatternList(marketCode, field(form, "patterns", 20_000));
    if (parsed.invalid.length > 0) problems.push(fillWords(w.notCodes, { codes: parsed.invalid.slice(0, 5).join(", "), more: "" }));
    patterns = parsed.patterns;
  }
  const radiusText = field(form, "radiusKm", 10).replace(",", ".");
  const radiusKm = kind === "radius" ? (radiusText && /^\d+(\.\d)?$/.test(radiusText) ? Number(radiusText) : null) : null;
  if (kind === "radius" && radiusKm === null) problems.push(w.radiusProblem);
  const locationText = field(form, "location", 40);
  const locationId = isUuid(locationText) ? locationText : null;
  if (problems.length > 0) return error(...problems);
  const existing = areaId ? (await listLocalAreas(member.store.id)).find((a) => a.id === areaId) : null;
  if (areaId && !existing) return error(w.areaGone);
  const saved = await saveLocalArea(member.account.id, member.store.id, {
    id: areaId,
    marketCode,
    locationId,
    name: field(form, "name", 200),
    names: existing?.names ?? {},
    kind,
    patterns,
    radiusKm,
    amountMinor: amount === null || amount === "invalid" ? 0 : amount,
    minBasketMinor: minimum === "invalid" ? null : minimum,
    freeOverMinor: freeOver === "invalid" ? null : freeOver,
    info: field(form, "info", 2000),
    infoT: existing?.infoT ?? {},
    active: form.get("active") === "on",
  });
  if (!saved.ok) return error(saved.message);
  if (!areaId) redirect(`${base(storeSlug)}/local`);
  return ok(w.areaSaved);
}

export async function deleteAreaAction(storeSlug: string, areaId: string): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return error(await noAccess());
  const w = wordsOf(member);
  if (!isUuid(areaId) || !(await deleteLocalArea(member.account.id, member.store.id, areaId))) return error(w.areaGone);
  return ok(w.areaDeleted);
}

/** *Check a postal code* on the Local delivery page: which areas cover it, and whether it is in the reference data (radius areas). */
export async function checkLocalCodeAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return error(await noAccess());
  const w = wordsOf(member);
  const marketCode = field(form, "market", 2);
  if (!member.store.markets.some((m) => m.code === marketCode)) return error(w.chooseSold);
  const typed = field(form, "code", 20);
  const found = await checkLocalCode(member.store.id, marketCode, typed);
  if (!found.code) return error(fillWords(w.notACode, { code: typed }));
  const known = found.known ? "" : w.notKnown;
  if (found.areas.length === 0) return ok(fillWords(w.noArea, { code: found.code, known }));
  const names = found.areas.map((a) => (a.active ? a.name : fillWords(w.switchedOff, { name: a.name }))).join(", ");
  return ok(fillWords(w.coveredBy, { code: found.code, names, known }));
}
