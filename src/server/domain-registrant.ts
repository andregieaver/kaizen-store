import "server-only";

import type { RegistrantPrefill } from "@/lib/domain-registrant";

import type { Membership } from "./auth";

/**
 * The registrant as the store and its owner already say it (D315 decision 1, `docs/domains.md` 4.5): the store's company from its business
 * details, else the owner by name; the owner only confirms or changes it. The page's buy form and the AI manager's `buy_domain` both start
 * here, so the model never writes a person's details itself.
 */
export function suggestedRegistrant(member: Pick<Membership, "account" | "store">, phone = ""): RegistrantPrefill {
  const d = member.store.details;
  const [first = "", ...rest] = (member.account.name ?? "").trim().split(/\s+/);
  const lines = (d.postalAddress ?? "")
    .split(/[\n,]+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const placeLine = lines.find((l) => /^\d{4,5}\s+\S/.test(l)) ?? "";
  const [, postalCode = "", city = ""] = /^(\d{4,5})\s+(.+)$/.exec(placeLine) ?? [];
  return {
    kind: d.legalName ? "company" : "person",
    firstName: first,
    lastName: rest.join(" "),
    companyName: d.legalName ?? "",
    orgNumber: d.organisationNumber ?? "",
    email: d.contactEmail || member.account.email,
    phone,
    address1: lines.find((l) => l !== placeLine) ?? "",
    city,
    postalCode,
    country: (d.country ?? "").toUpperCase(),
  };
}
