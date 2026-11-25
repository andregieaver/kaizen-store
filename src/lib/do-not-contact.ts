/**
 * Do not contact, everywhere (email plan P5.6, D893): how an address or a domain is folded before it is hashed, so `Post@Firma.no`, `post@firma.no`
 * and a website `https://www.firma.no/om-oss` meet the same entry. Pure; the hashing and the list are `src/server/do-not-contact.ts`.
 */

export type DoNotContactReason = "reply" | "link" | "complaint" | "asked";

const DOMAIN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** A domain from a domain, an address or a website (`www.` dropped, lower case), or null when it is none. */
export function foldDomain(raw: string): string | null {
  let value = raw.normalize("NFKC").trim().toLowerCase();
  if (!value) return null;
  if (value.includes("@")) value = value.slice(value.lastIndexOf("@") + 1);
  else if (/^[a-z][a-z0-9+.-]*:\/\//.test(value) || value.includes("/")) {
    try {
      value = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(value) ? value : `https://${value}`).hostname;
    } catch {
      return null;
    }
  }
  value = value.replace(/\.$/, "").replace(/^www\./, "");
  return DOMAIN.test(value) ? value : null;
}

/** An email address folded (trimmed, lower case, its domain folded), or null when it is none. */
export function foldAddress(raw: string): string | null {
  const value = raw.normalize("NFKC").trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at <= 0 || at > 64 || /\s/.test(value)) return null;
  const domain = foldDomain(value.slice(at + 1));
  return domain ? `${value.slice(0, at)}@${domain}` : null;
}

/** What one entry typed by hand is: an address, else a domain or website, else nothing usable. */
export function readEntry(raw: string): { kind: "address"; value: string } | { kind: "domain"; value: string } | null {
  if (raw.includes("@")) {
    const address = foldAddress(raw);
    return address ? { kind: "address", value: address } : null;
  }
  const domain = foldDomain(raw);
  return domain ? { kind: "domain", value: domain } : null;
}
