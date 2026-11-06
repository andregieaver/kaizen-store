import { createHash } from "node:crypto";

/**
 * The Peppol network's addressing, pure (B1 of `docs/own-books-and-sales.md`, D463): who a business is on Peppol, how its record is found in
 * the network's DNS, and which documents a receiver takes. A business is a participant `iso6523-actorid-upis::{EAS}:{number}`, where the
 * electronic address scheme (EAS) is its country's register: Norway's organisation number (0192, the scheme the receiver register ELMA uses),
 * Sweden's (0007) and Denmark's CVR (0184), as D403 writes the endpoint of a document. Its capabilities are published by an SMP, which the
 * SML's DNS names: since February 2026 a U-NAPTR record (service `Meta:SMP`) at
 * `strip-trailing(base32(sha256(lowercase(value))), "=") + "." + scheme + "." + zone` (Peppol Policy for use of Identifiers 4.4.0, POLICY 7;
 * SML 1.3.0; the CNAME to NAPTR migration process 1.0.0, whose test vector `tests/peppol` holds). Then the SMP answers
 * `{smp}/{participant}/services/{document type}` with the endpoints that receive it, or 404 when the receiver does not.
 */

/** The production SML's zone; the test network's is `acc.edelivery.tech.ec.europa.eu`. */
export const SML_ZONE = "edelivery.tech.ec.europa.eu";
export const PARTICIPANT_SCHEME = "iso6523-actorid-upis";
export const DOCUMENT_SCHEME = "busdox-docid-qns";

/** Peppol BIS Billing 3.0 (EHF Billing 3.0 in Norway): the document types an invoice and a credit note are sent as. */
export const DOCUMENT_TYPES = {
  invoice: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1",
  credit_note: "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2::CreditNote##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1",
} as const;
export type PeppolDocument = keyof typeof DOCUMENT_TYPES;

/** The process both are sent in (BT-23). */
export const BILLING_PROCESS = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";

/** The electronic address schemes by country, with the length of the number each takes. */
const SCHEMES: Readonly<Record<string, { eas: string; digits: number }>> = {
  NO: { eas: "0192", digits: 9 },
  SE: { eas: "0007", digits: 10 },
  DK: { eas: "0184", digits: 8 },
};

/** Norway's organisation numbers end in a modulus 11 check digit with these weights (Brønnøysundregistrene). */
function norwegianCheckDigitOk(digits: string): boolean {
  const weights = [3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((s, w, i) => s + w * Number(digits[i]), 0);
  const rest = 11 - (sum % 11);
  const check = rest === 11 ? 0 : rest;
  return check !== 10 && check === Number(digits[8]);
}

/**
 * A business's participant value (`0192:923456789`) from its country and organisation number, or null when the country has no scheme here
 * or the number is not one (wrong length, or a Norwegian number whose check digit fails). Spaces, dots and a trailing `MVA` are ignored.
 */
export function participantOf(country: string | null | undefined, organisationNumber: string | null | undefined): string | null {
  const scheme = SCHEMES[(country ?? "").toUpperCase()];
  if (!scheme) return null;
  const digits = (organisationNumber ?? "").replace(/MVA$/i, "").replace(/\D/g, "");
  if (digits.length !== scheme.digits) return null;
  if (country?.toUpperCase() === "NO" && !norwegianCheckDigitOk(digits)) return null;
  return `${scheme.eas}:${digits}`;
}

/** The participant's full identifier, as an SMP's addresses carry it. */
export const participantIdentifier = (value: string) => `${PARTICIPANT_SCHEME}::${value}`;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32 of bytes, without padding. */
export function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** The DNS name the SML publishes a participant's SMP under (POLICY 7's new algorithm). */
export function smlName(value: string, zone: string = SML_ZONE): string {
  const hash = createHash("sha256").update(value.toLowerCase()).digest();
  return `${base32(hash)}.${PARTICIPANT_SCHEME}.${zone}`;
}

export type NaptrRecord = { flags: string; service: string; regexp: string; replacement: string; order: number; preference: number };

/**
 * The SMP's address from the participant's NAPTR records: the `Meta:SMP` record with flag `U`, the lowest order and preference first, whose
 * regexp (`!^.*$!https://smp.example.org/!`) gives the URL. Null when there is none, or the URL is not https without a query, fragment or
 * user (SML 1.3.0, 2.1.1).
 */
export function smpUrlOf(records: readonly NaptrRecord[]): string | null {
  const candidates = records
    .filter((r) => r.service.toLowerCase() === "meta:smp" && r.flags.toUpperCase() === "U")
    .sort((a, b) => a.order - b.order || a.preference - b.preference);
  for (const r of candidates) {
    const delimiter = r.regexp[0];
    const parts = delimiter ? r.regexp.slice(1).split(delimiter) : [];
    // `!^.*$!https://…!`: the pattern matches the whole name, so the replacement is the URL itself.
    if (parts.length < 2 || parts[0] !== "^.*$") continue;
    const url = parts[1];
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) continue;
      return url.replace(/\/+$/, "");
    } catch {
      continue;
    }
  }
  return null;
}

/** Where an SMP says whether a participant receives a document type. */
export function serviceUrl(smp: string, value: string, document: PeppolDocument): string {
  const participant = encodeURIComponent(participantIdentifier(value));
  const type = encodeURIComponent(`${DOCUMENT_SCHEME}::${DOCUMENT_TYPES[document]}`);
  return `${smp.replace(/\/+$/, "")}/${participant}/services/${type}`;
}

/** What a lookup found: whether the participant receives invoices and credit notes, or why it could not tell. */
export type Receiver = { participant: string; invoice: boolean; creditNote: boolean; problem: string | null };
