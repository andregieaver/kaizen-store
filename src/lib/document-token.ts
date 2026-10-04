/**
 * The token that is the whole access to a hosted invoice or credit note (D159, `docs/wave-1b-invoices.md` 2.2): `inv_` or
 * `crn_` and 43 base64url characters from 32 random bytes. The database makes the same (`commerce.new_document_token()`) and
 * checks the shape; this module is for code that needs to tell a token from anything else before it asks the database.
 */

export type DocumentKind = "invoice" | "credit_note";

const PREFIX: Record<DocumentKind, string> = { invoice: "inv_", credit_note: "crn_" };
export const DOCUMENT_TOKEN = /^(inv|crn)_[A-Za-z0-9_-]{43}$/;

const base64url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export function newDocumentToken(kind: DocumentKind): string {
  return PREFIX[kind] + base64url(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

export const isDocumentToken = (value: unknown): value is string => typeof value === "string" && DOCUMENT_TOKEN.test(value);

/** Which kind of document a token is for, or null when it is not a document token. */
export function kindOfToken(value: unknown): DocumentKind | null {
  if (!isDocumentToken(value)) return null;
  return value.startsWith("inv_") ? "invoice" : "credit_note";
}
