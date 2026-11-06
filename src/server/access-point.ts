import "server-only";

import type { PeppolDocument } from "@/lib/peppol";

/**
 * A Peppol access point (B1, D463): the vendor that carries Kaizena Flow's documents into the network, chosen and signed by the owner
 * (`docs/own-books-and-sales.md` section 6). Kaizena Flow is the sender's software; the access point is the sender's corner. Everything the
 * sending job needs of one is here, so the vendor chosen is one adapter of this shape and nothing else changes. Until one is chosen,
 * `configuredAccessPoint()` is null: documents whose buyers receive e-invoices are marked `waiting` and go by email as before.
 */

export type AccessPointDocument = {
  /** The UBL document (EN 16931, Peppol BIS Billing 3.0). */
  xml: string;
  document: PeppolDocument;
  /** Participant values: the seller and the buyer, `0192:923609016`. */
  sender: string;
  receiver: string;
  /** Ours, so a retry of the same document is the same message to an access point that deduplicates. */
  reference: string;
};

export type AccessPointSent = { ok: true; messageId: string } | { ok: false; problem: string; retry: boolean };
export type AccessPointStatus = { state: "sent" | "delivered" | "refused"; problem?: string };

export type AccessPoint = {
  /** Its name, kept with every message it took (`einvoice_sends.access_point`). */
  name: string;
  send(document: AccessPointDocument): Promise<AccessPointSent>;
  /** What became of a message: delivered to the receiver's access point, or refused by it. Absent when the vendor only calls back. */
  status?(messageId: string): Promise<AccessPointStatus>;
};

/** The platform's access point: none until the owner signs with a vendor. */
export function configuredAccessPoint(): AccessPoint | null {
  return null;
}
