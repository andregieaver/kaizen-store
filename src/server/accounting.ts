import "server-only";

import { fikenAttention, getFikenConnection } from "./fiken";
import { getTripletexConnection, tripletexAttention } from "./tripletex";

/**
 * The store's accounting connection, whichever it is (Tripletex D453, Fiken D460): a store sends its documents to one system at a time,
 * so the checkup, the briefing and Work's settings ask here which one, and what needs a person there.
 */

export type AccountingSystem = "tripletex" | "fiken";

export const ACCOUNTING_NAMES: Record<AccountingSystem, string> = { tripletex: "Tripletex", fiken: "Fiken" };

/** The system the store is connected to, or null. */
export async function accountingSystem(storeId: string): Promise<AccountingSystem | null> {
  const [fiken, tripletex] = await Promise.all([getFikenConnection(storeId), getTripletexConnection(storeId)]);
  return fiken ? "fiken" : tripletex ? "tripletex" : null;
}

/** What needs a person in the store's accounting connection: a grant or token refused, and documents waiting. Null while there is none on. */
export async function accountingAttention(storeId: string): Promise<{ system: AccountingSystem; name: string; page: string; tokenRefused: boolean; waiting: number } | null> {
  const [fiken, tripletex] = await Promise.all([fikenAttention(storeId), tripletexAttention(storeId)]);
  if (fiken) return { system: "fiken", name: "Fiken", page: "/integrations/fiken", ...fiken };
  if (tripletex) return { system: "tripletex", name: "Tripletex", page: "/integrations/tripletex", ...tripletex };
  return null;
}
