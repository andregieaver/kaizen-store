import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { DEFAULT_RETURN_SETTINGS, type ReturnAddress, type ReturnSettings } from "@/lib/withdrawal";
import { returnSettingsInput } from "@/lib/return-input";
import { cleanTranslations, translationProblems, type InstructionTranslations } from "@/lib/return-instructions";
import { isBringReturnService } from "@/lib/bring";
import { carrierInfo, isCarrierId, type CarrierId } from "@/lib/shipping-carriers";

type Row = Record<string, unknown>;

/**
 * A store's rules for returns (D153, `commerce.return_settings`): one row per store, the legal defaults when it has
 * none. Reading is for anyone who needs the rules (the shopper's withdrawal function, the queue, the emails); saving
 * is for owners, which the action layer enforces (`requireMember` + owner), as for the other settings.
 */

function toAddress(value: unknown): ReturnAddress | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const address = {
    name: String(v.name ?? ""),
    street: String(v.street ?? ""),
    postalCode: String(v.postalCode ?? ""),
    city: String(v.city ?? ""),
    country: String(v.country ?? ""),
  };
  return address.street && address.city ? address : null;
}

export function toSettings(row: Row | undefined): ReturnSettings {
  if (!row) return { ...DEFAULT_RETURN_SETTINGS };
  return {
    windowDays: Number(row.window_days),
    transitDays: Number(row.transit_days),
    whoPaysReturn: row.who_pays_return === "store" ? "store" : "shopper",
    refundWhen: row.refund_when === "request" ? "request" : "received",
    acceptExcluded: Boolean(row.accept_excluded),
    instructions: String(row.instructions ?? ""),
    returnAddress: toAddress(row.return_address),
    b2bReturns: Boolean(row.b2b_returns),
  };
}

/** The store's return settings, or the legal defaults when it has saved none. */
export async function getReturnSettings(storeId: string): Promise<ReturnSettings> {
  const [row] = await db().execute<Row>(sql`select * from commerce.return_settings where store_id = ${storeId}::uuid`);
  return toSettings(row);
}

export type SaveSettingsOutcome = { ok: true; settings: ReturnSettings } | { ok: false; problems: string[] };

/** Saves the store's rules, checked by the schema the form shares (the legal 14 days are never shortened). */
export async function saveReturnSettings(storeId: string, input: unknown, accountId: string | null): Promise<SaveSettingsOutcome> {
  const parsed = returnSettingsInput.safeParse(input);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((issue) => issue.message))] };
  const v = parsed.data;
  await db().execute(sql`
    insert into commerce.return_settings (
      store_id, window_days, transit_days, who_pays_return, refund_when, accept_excluded, instructions, return_address,
      b2b_returns, updated_at, updated_by
    ) values (
      ${storeId}::uuid, ${v.windowDays}, ${v.transitDays}, ${v.whoPaysReturn}, ${v.refundWhen}, ${v.acceptExcluded},
      ${v.instructions}, ${v.returnAddress ? JSON.stringify(v.returnAddress) : null}::jsonb, ${v.b2bReturns}, now(),
      ${accountId}::uuid
    )
    on conflict (store_id) do update set
      window_days = excluded.window_days, transit_days = excluded.transit_days, who_pays_return = excluded.who_pays_return,
      refund_when = excluded.refund_when, accept_excluded = excluded.accept_excluded, instructions = excluded.instructions,
      return_address = excluded.return_address, b2b_returns = excluded.b2b_returns, updated_at = now(),
      updated_by = excluded.updated_by
  `);
  return { ok: true, settings: await getReturnSettings(storeId) };
}

/** The instructions in the store's other languages (`{ "sv": "…" }`), as stored; empty when there are none. */
export async function getInstructionTranslations(storeId: string): Promise<InstructionTranslations> {
  const [row] = await db().execute<Row>(sql`select instructions_translations as t from commerce.return_settings where store_id = ${storeId}::uuid`);
  const stored = row?.t && typeof row.t === "object" && !Array.isArray(row.t) ? (row.t as Record<string, unknown>) : {};
  return cleanTranslations(stored, Object.keys(stored));
}

export type SaveTranslationsOutcome = { ok: true; translations: InstructionTranslations } | { ok: false; problems: string[] };

/**
 * Saves the instructions' translations, replacing what was there: only the store's other languages (`allowed`), each
 * within the length of the instructions themselves. A store with no settings row gets one with the legal defaults.
 */
export async function saveInstructionTranslations(
  storeId: string,
  raw: unknown,
  allowed: readonly string[],
  accountId: string | null,
): Promise<SaveTranslationsOutcome> {
  const problems = translationProblems(raw, allowed);
  if (problems.length > 0) return { ok: false, problems: [...new Set(problems.map((p) => p.message))] };
  const translations = cleanTranslations(raw, allowed);
  await db().execute(sql`
    insert into commerce.return_settings (store_id, instructions_translations, updated_at, updated_by)
    values (${storeId}::uuid, ${JSON.stringify(translations)}::jsonb, now(), ${accountId}::uuid)
    on conflict (store_id) do update set instructions_translations = excluded.instructions_translations, updated_at = now(),
      updated_by = excluded.updated_by
  `);
  return { ok: true, translations };
}

// ---------------------------------------------------------------------------
// Exchanges and return labels (wave 3, D239, docs/wave-3-exchanges.md 2.2, 2.3)
// ---------------------------------------------------------------------------

/** The store's choices for exchanges and return labels (`return_settings.exchanges`, `label_carrier`, `label_service`, `label_auto`). */
export type ExchangeLabelSettings = {
  /** *Offer exchanges* (default on). */
  exchanges: boolean;
  /** The carrier return labels are booked with; null: none chosen (the first connected carrier that books returns is offered). */
  labelCarrier: CarrierId | null;
  /** The carrier's return service; null: its default (Bring `9300`). */
  labelService: string | null;
  /** Book a withdrawal return's label by itself (the five-minute job); needs a carrier. */
  labelAuto: boolean;
};

export async function getExchangeLabelSettings(storeId: string): Promise<ExchangeLabelSettings> {
  const [row] = await db().execute<Row>(sql`select exchanges, label_carrier, label_service, label_auto from commerce.return_settings where store_id = ${storeId}::uuid`);
  return {
    exchanges: row ? Boolean(row.exchanges) : true,
    labelCarrier: row?.label_carrier && isCarrierId(String(row.label_carrier)) ? (String(row.label_carrier) as CarrierId) : null,
    labelService: row?.label_service ? String(row.label_service) : null,
    labelAuto: Boolean(row?.label_auto),
  };
}

export type SaveExchangeLabelOutcome = { ok: true; settings: ExchangeLabelSettings } | { ok: false; problems: string[] };

/**
 * Saves the exchange and label choices (owners; the action layer asks `requireOwnerRole`). A carrier must be one whose return labels are built
 * (`available` has `return_labels`), a service one that carrier knows, and automatic labels need a carrier. A store with no settings row gets one with
 * the legal defaults.
 */
export async function saveExchangeLabelSettings(storeId: string, input: unknown, accountId: string | null): Promise<SaveExchangeLabelOutcome> {
  const v = (input ?? {}) as Partial<Record<keyof ExchangeLabelSettings, unknown>>;
  const problems: string[] = [];
  const exchanges = v.exchanges === undefined ? true : v.exchanges === true;
  const carrier = typeof v.labelCarrier === "string" && v.labelCarrier !== "" ? v.labelCarrier : null;
  if (carrier !== null && (!isCarrierId(carrier) || !carrierInfo(carrier as CarrierId)?.available.includes("return_labels"))) {
    problems.push("Choose a carrier that books return labels (Posten / Bring).");
  }
  const service = typeof v.labelService === "string" && v.labelService.trim() !== "" ? v.labelService.trim() : null;
  if (service !== null && (carrier !== "bring" || !isBringReturnService(service))) problems.push("Choose one of the carrier's return services.");
  const auto = v.labelAuto === true;
  if (auto && carrier === null) problems.push("Choose the carrier before booking labels automatically.");
  if (problems.length > 0) return { ok: false, problems };
  await db().execute(sql`
    insert into commerce.return_settings (store_id, exchanges, label_carrier, label_service, label_auto, updated_at, updated_by)
    values (${storeId}::uuid, ${exchanges}, ${carrier}, ${service}, ${auto}, now(), ${accountId}::uuid)
    on conflict (store_id) do update set exchanges = excluded.exchanges, label_carrier = excluded.label_carrier, label_service = excluded.label_service,
      label_auto = excluded.label_auto, updated_at = now(), updated_by = excluded.updated_by
  `);
  return { ok: true, settings: await getExchangeLabelSettings(storeId) };
}
