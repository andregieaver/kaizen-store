"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { parsePatternList } from "@/lib/postal-patterns";
import { parsePrice } from "@/lib/product-input";
import { NO_ACCESS, checkPermission } from "@/server/permissions";
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
  if (!member) return { ok: false, message: NO_ACCESS };
  const saved = await saveShippingMethod(member.account.id, member.store.id, input);
  if (!saved.ok) return { ok: false, message: saved.message };
  return { ok: true, id: saved.id, message: "Method saved." };
}

export async function deleteMethodAction(storeSlug: string, methodId: string, marketCode: string): Promise<{ ok: false; problems: string[] }> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  if (!isUuid(methodId) || !(await deleteShippingMethod(member.account.id, member.store.id, methodId))) return { ok: false, problems: ["That method no longer exists."] };
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
  if (!member) return error(NO_ACCESS);
  if (!isMarket(marketCode) || (zoneId !== null && !isUuid(zoneId))) return error("That zone no longer exists.");
  const { patterns, invalid } = parsePatternList(marketCode, field(form, "patterns", 20_000));
  if (invalid.length > 0) {
    const shown = invalid.slice(0, 5).join(", ");
    return error(`Not postal codes of this country: ${shown}${invalid.length > 5 ? ` and ${invalid.length - 5} more` : ""}. Write codes like 0150, or prefixes like 01*.`);
  }
  const saved = await saveShippingZone(member.account.id, member.store.id, { id: zoneId, marketCode, name: field(form, "name", 200), patterns });
  if (!saved.ok) return error(saved.message);
  return ok(zoneId ? "Zone saved." : "Zone added.");
}

export async function deleteZoneAction(storeSlug: string, zoneId: string): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return error(NO_ACCESS);
  if (!isUuid(zoneId) || !(await deleteShippingZone(member.account.id, member.store.id, zoneId))) return error("That zone no longer exists.");
  return ok("Zone deleted. Its postal codes are Rest of country now.");
}

/** *Check a postal code*: which zone it falls in, and which active methods have a rate there. Nothing is saved. */
export async function checkZoneCodeAction(storeSlug: string, marketCode: string, _state: FormState, form: FormData): Promise<FormState> {
  // A try before saving: the editors' own (`settings:write`), as every action of the page.
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return error(NO_ACCESS);
  if (!isMarket(marketCode)) return error("Choose a country.");
  const typed = field(form, "code", 20);
  const found = await checkZoneCode(member.store.id, marketCode, typed);
  if (!found.code) return error(`"${typed}" is not a postal code of this country.`);
  const zoneId = found.zone?.id ?? null;
  const methods = (await getShippingSetup(member.store.id)).methods.filter((m) => m.marketCode === marketCode && m.active && m.rates.some((r) => r.zoneId === zoneId));
  const where = found.zone ? `the zone ${found.zone.name}` : "Rest of country";
  const priced = methods.length === 0 ? "No active method has a rate there yet." : `Methods with a rate there: ${methods.map((m) => m.name).join(", ")}.`;
  return ok(`${found.code} is in ${where}. ${priced}`);
}

// ---------------------------------------------------------------------------
// Profiles and the default weight
// ---------------------------------------------------------------------------

/** A profile: its name and the products ticked (`product` fields); products not ticked that were in it go back to General. */
export async function saveProfileAction(storeSlug: string, profileId: string | null, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return error(NO_ACCESS);
  if (profileId !== null && !isUuid(profileId)) return error("That profile no longer exists.");
  const productIds = form.getAll("product").map(String).filter(isUuid);
  const saved = await saveShippingProfile(member.account.id, member.store.id, { id: profileId, name: field(form, "name", 200), productIds });
  if (!saved.ok) return error(saved.message);
  if (!profileId) redirect(`${base(storeSlug)}/profiles`);
  return ok(`Profile saved with ${new Set(productIds).size} ${productIds.length === 1 ? "product" : "products"}.`);
}

export async function deleteProfileAction(storeSlug: string, profileId: string): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return error(NO_ACCESS);
  if (!isUuid(profileId)) return error("That profile no longer exists.");
  const done = await deleteShippingProfile(member.account.id, member.store.id, profileId);
  if (!done.ok) return error("That profile no longer exists.");
  return ok(`Profile deleted. ${done.moved} ${done.moved === 1 ? "product moved" : "products moved"} to General.`);
}

export async function saveDefaultWeightAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return error(NO_ACCESS);
  const typed = field(form, "grams", 20);
  const grams = /^\d+$/.test(typed) ? Number(typed) : Number.NaN;
  if (!Number.isSafeInteger(grams)) return error("Default weight: whole grams, like 500.");
  const saved = await saveDefaultWeight(member.account.id, member.store.id, { grams });
  return saved.ok ? ok("Default weight saved.") : error(saved.message);
}

// ---------------------------------------------------------------------------
// Pickup
// ---------------------------------------------------------------------------

/** A place's pickup option: the switch, the price (empty is free), the usual ready time in hours and the instructions. */
export async function savePickupAction(storeSlug: string, locationId: string, currency: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return error(NO_ACCESS);
  if (!isUuid(locationId)) return error("This place no longer exists.");
  const amount = amountOf(field(form, "amount", 30), currency);
  if (amount === "invalid") return error(`Price: an amount in ${currency}, or leave it empty for free.`);
  const hoursText = field(form, "readyInHours", 10) || "0";
  if (!/^\d+$/.test(hoursText)) return error("Usually ready in: whole hours, 0 to say nothing.");
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
  return saved.ok ? ok("Pickup saved.") : error(saved.message);
}

// ---------------------------------------------------------------------------
// Local delivery
// ---------------------------------------------------------------------------

/** A local delivery area, new when `areaId` is null; its market is fixed once made. */
export async function saveAreaAction(storeSlug: string, areaId: string | null, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return error(NO_ACCESS);
  if (areaId !== null && !isUuid(areaId)) return error("That area no longer exists.");
  const marketCode = field(form, "market", 2);
  const market = member.store.markets.find((m) => m.code === marketCode);
  if (!market) return error("Choose a country you sell to.");
  const currency = market.nativeCurrency;
  const kind = form.get("kind") === "radius" ? "radius" : "postal";
  const problems: string[] = [];
  const amount = amountOf(field(form, "amount", 30), currency);
  const minimum = amountOf(field(form, "minBasket", 30), currency);
  const freeOver = amountOf(field(form, "freeOver", 30), currency);
  if (amount === "invalid") problems.push(`Price: an amount in ${currency}, or leave it empty for free.`);
  if (minimum === "invalid") problems.push(`Minimum basket: an amount in ${currency}, or leave it empty.`);
  if (freeOver === "invalid") problems.push(`Free above: an amount in ${currency}, or leave it empty.`);
  let patterns: string[] = [];
  if (kind === "postal") {
    const parsed = parsePatternList(marketCode, field(form, "patterns", 20_000));
    if (parsed.invalid.length > 0) problems.push(`Not postal codes of this country: ${parsed.invalid.slice(0, 5).join(", ")}. Write codes like 0150, or prefixes like 01*.`);
    patterns = parsed.patterns;
  }
  const radiusText = field(form, "radiusKm", 10).replace(",", ".");
  const radiusKm = kind === "radius" ? (radiusText && /^\d+(\.\d)?$/.test(radiusText) ? Number(radiusText) : null) : null;
  if (kind === "radius" && radiusKm === null) problems.push("Radius: kilometres, like 15 or 7.5.");
  const locationText = field(form, "location", 40);
  const locationId = isUuid(locationText) ? locationText : null;
  if (problems.length > 0) return error(...problems);
  const existing = areaId ? (await listLocalAreas(member.store.id)).find((a) => a.id === areaId) : null;
  if (areaId && !existing) return error("That area no longer exists.");
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
  return ok("Area saved.");
}

export async function deleteAreaAction(storeSlug: string, areaId: string): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return error(NO_ACCESS);
  if (!isUuid(areaId) || !(await deleteLocalArea(member.account.id, member.store.id, areaId))) return error("That area no longer exists.");
  return ok("Area deleted.");
}

/** *Check a postal code* on the Local delivery page: which areas cover it, and whether it is in the reference data (radius areas). */
export async function checkLocalCodeAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return error(NO_ACCESS);
  const marketCode = field(form, "market", 2);
  if (!member.store.markets.some((m) => m.code === marketCode)) return error("Choose a country you sell to.");
  const typed = field(form, "code", 20);
  const found = await checkLocalCode(member.store.id, marketCode, typed);
  if (!found.code) return error(`"${typed}" is not a postal code of this country.`);
  const known = found.known ? "" : " It is not in the postal-code reference data, so no radius area covers it.";
  if (found.areas.length === 0) return ok(`No area covers ${found.code}.${known}`);
  const names = found.areas.map((a) => (a.active ? a.name : `${a.name} (switched off)`)).join(", ");
  return ok(`${found.code} is covered by: ${names}.${known}`);
}
