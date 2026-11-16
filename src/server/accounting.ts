import "server-only";

import { fikenAttention } from "./fiken";
import { tripletexAttention } from "./tripletex";

/**
 * The store's accounting connection, whichever it is (Tripletex D453, Fiken D460): a store sends its documents to one system at a time,
 * so the checkup, the briefing and Work's settings ask here which one, and what needs a person there.
 */

export type AccountingSystem = "tripletex" | "fiken";

/** What needs a person in the store's accounting connection: a grant or token refused, and documents waiting. Null while there is none on. */
export async function accountingAttention(storeId: string): Promise<{ system: AccountingSystem; name: string; page: string; tokenRefused: boolean; waiting: number } | null> {
  const [fiken, tripletex] = await Promise.all([fikenAttention(storeId), tripletexAttention(storeId)]);
  if (fiken) return { system: "fiken", name: "Fiken", page: "/integrations/fiken", ...fiken };
  if (tripletex) return { system: "tripletex", name: "Tripletex", page: "/integrations/tripletex", ...tripletex };
  return null;
}
