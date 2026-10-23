import "server-only";

import { domainsEn } from "@/lib/admin-messages/domains.en";
import { findingText, worstSeverity, type Finding } from "@/lib/domain-health";
import type { OwnerToolInput } from "@/lib/owner-tools";

import type { Account } from "./auth";
import { storeDomainHealth, type DomainHealth, type HealthDeps } from "./domain-health";
import { registrationFacts } from "./domain-registrations";
import { OwnerToolError } from "./owner-tool-error";
import type { Store } from "./stores";

/**
 * The AI manager's domain tools (D315, `docs/domains.md` 7.1). They read what the Domains page reads (`storeDomainHealth()`): every fact and
 * finding is made in code and the model repeats it. The changing tools are added with the phases that build what they change.
 */

type Ctx = { account: Account; store: Store };

const page = (store: Store) => `/admin/${store.slug}/settings/domains`;

const said = (f: Finding) => ({ finding: f.code, severity: f.severity, says: findingText(f, domainsEn.health), fix: f.fix });

const deps = (): HealthDeps => ({ registrations: registrationFacts });

function shape(h: DomainHealth) {
  const d = h.domain;
  const findings = h.findings.filter((f) => f.code !== "healthy");
  return {
    domain: h.facts.hostname,
    apex: h.apex,
    connection: d
      ? d.isPrimary
        ? "the store's address"
        : d.status === "active"
          ? d.language
            ? `the store's address in language ${d.language}`
            : "active: leads to the store's address"
          : "waiting for its DNS"
      : "registered by the store, not connected",
    registered_with: h.facts.registration.withUs ? "Kaizena Flow" : (h.facts.registration.registrar ?? "not known"),
    expires: h.facts.registration.expiresAt?.slice(0, 10) ?? "not known",
    renews_by_itself: h.facts.registration.renews ?? "not known (registered elsewhere)",
    dns_kept_by: h.facts.dnsHost === "kaizena" ? "Kaizena Flow" : h.facts.dnsHost === "elsewhere" ? "elsewhere (the owner changes records there)" : "not known",
    health: worstSeverity(h.findings),
    needs_the_owner: findings.filter((f) => f.severity === "error").length,
  };
}

/** `list_domains`: every domain of the store with its health in one line. */
export async function listDomainsTool(ctx: Ctx) {
  const rows = await storeDomainHealth(ctx.store.id, deps());
  return {
    domains: rows.map(shape),
    ...(rows.length === 0 ? { note: "The store has no domain of its own yet: it is at its Kaizena Flow address." } : {}),
    page: page(ctx.store),
  };
}

/** `check_domain`: one domain's findings, now. */
export async function checkDomainTool(ctx: Ctx, { domain }: OwnerToolInput<"check_domain">) {
  const wanted = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
  const rows = await storeDomainHealth(ctx.store.id, deps());
  const row = rows.find((r) => r.facts.hostname === wanted) ?? rows.find((r) => r.apex === wanted);
  if (!row) throw new OwnerToolError(`${wanted} isn't one of this store's domains. list_domains gives the ones it has.`);
  return { ...shape(row), findings: row.findings.map(said), page: page(ctx.store) };
}
