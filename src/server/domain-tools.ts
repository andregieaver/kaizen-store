import "server-only";

import { domainsEn } from "@/lib/admin-messages/domains.en";
import { registrantInput } from "@/lib/domain-registrant";
import { findingText, worstSeverity, type Finding } from "@/lib/domain-health";
import { formatMoney } from "@/lib/money";
import type { OwnerToolInput } from "@/lib/owner-tools";

import type { Account } from "./auth";
import { storeDomainHealth, type DomainHealth, type HealthDeps } from "./domain-health";
import { afterAnswer } from "./after-answer";
import { listStoreDomains } from "./domains";
import { domainPricingRows, storeDomainCurrency } from "./domain-prices";
import { buyingOpen, chargeDomainPurchases, quoteDomain, renewalOffer, renewDomainNow, setDomainRenewal, startDomainPurchase } from "./domain-purchases";
import { suggestedRegistrant } from "./domain-registrant";
import { registrationFacts, storeRegistration, storeRegistrations } from "./domain-registrations";
import { searchDomains } from "./domain-search";
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

// ---------------------------------------------------------------------------
// Buying and renewing (D315 phase 2)
// ---------------------------------------------------------------------------

const normal = (domain: string) => domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
const fail = (message: string): never => {
  throw new OwnerToolError(message);
};
const priced = (minor: number, currency: string) => formatMoney(minor, currency, "en-GB");

/** `search_domains`: what the page's search answers, with prices written in code. */
export async function searchDomainsTool(ctx: Ctx, { query }: OwnerToolInput<"search_domains">) {
  const [domains, registrations, pricing] = await Promise.all([listStoreDomains(ctx.store.id), storeRegistrations(ctx.store.id), domainPricingRows()]);
  const currency = await storeDomainCurrency(ctx.store.id, pricing.map((p) => p.currency));
  const answer = await searchDomains(query, { asker: { store: ctx.store.id }, currency, owned: [...domains.map((d) => d.hostname), ...registrations.map((r) => r.apex)] });
  if (!answer.ok) return fail(answer.message);
  const open = await buyingOpen(ctx.store.id);
  return {
    names: answer.offers.map((o) => ({
      domain: o.domain,
      state: STATE_WORDS[o.state],
      ...(o.state === "available" && o.firstYear !== null && answer.currency
        ? { first_year: priced(o.firstYear, answer.currency), then_each_year: o.renewal !== null ? priced(o.renewal, answer.currency) : "not known" }
        : {}),
    })),
    ...(open ? {} : { note: "Buying domains isn't open for this store yet: the owner can connect a domain they own on the Domains page." }),
    page: page(ctx.store),
  };
}

const STATE_WORDS = { available: "free", taken: "taken", premium: "a premium name, not sold here", not_sold: "an ending not sold here yet", yours: "already the store's" } as const;

/** The registrant `buy_domain` uses: the store's and the owner's own details, with the phone the owner gave. */
async function registrantFor(ctx: Ctx, phone: string | undefined) {
  const member = { account: ctx.account, store: ctx.store };
  return suggestedRegistrant(member, phone ?? "");
}

/** Refuses a buy, renewal or renewal switch now that couldn't be done, so the owner is never asked to approve it. */
export async function preflightDomainTool(ctx: Ctx, name: string, input: Record<string, unknown>): Promise<void> {
  const domain = normal(String(input.domain ?? ""));
  if (name === "buy_domain") {
    if (!(await buyingOpen(ctx.store.id))) return fail("Buying domains isn't open for this store yet. The owner can connect a domain they own on the Domains page.");
    const registrant = registrantInput.safeParse(await registrantFor(ctx, input.phone ? String(input.phone) : undefined));
    if (!registrant.success) {
      return fail(`The registrant isn't complete: ${[...new Set(registrant.error.issues.map((i) => i.message))].join(" ")} Ask the owner, or they buy it on the Domains page where they can fill it in.`);
    }
    const quoted = await quoteDomain(ctx.store.id, domain, 1);
    if (!quoted.ok) return fail(quoted.problems.join(" "));
    return;
  }
  const registration = await storeRegistration(ctx.store.id, domain);
  if (!registration) return fail(`${domain} isn't registered by this store through Kaizena Flow.`);
  if (name === "renew_domain" && !(await renewalOffer(ctx.store.id, registration.apex, registration.registrar, 1))) return fail("The renewal can't be priced just now.");
  if (name === "set_domain_renewal" && registration.renew === (input.renew === true)) return fail(`${domain} already ${registration.renew ? "renews by itself" : "doesn't renew"}: nothing to change.`);
}

/** The words and the price a gated buy or renewal is kept with: the price is put in by the server, and the yes is for that price only. */
export async function domainApprovalDetails(ctx: Ctx, tool: string, args: Record<string, unknown>): Promise<{ summary: string; args: Record<string, unknown> } | null> {
  const domain = normal(String(args.domain ?? ""));
  if (tool === "buy_domain") {
    const quoted = await quoteDomain(ctx.store.id, domain, 1);
    if (!quoted.ok) return null;
    const q = quoted.quote;
    const r = await registrantFor(ctx, args.phone ? String(args.phone) : undefined);
    const who = r.kind === "company" && r.companyName ? r.companyName : `${r.firstName} ${r.lastName}`.trim();
    const then = q.renewalMinor !== null ? `, then ${priced(q.renewalMinor, q.currency)} a year` : "";
    return {
      summary: `Buy ${q.domain} for ${priced(q.amountMinor, q.currency)} the first year${then}, registered to ${who}${args.connect === false ? "" : ", and make it the store's address"}. A registration can't be undone once made.`,
      args: { ...args, domain: q.domain, agreed: `${q.currency}:${q.amountMinor}` },
    };
  }
  if (tool === "renew_domain") {
    const registration = await storeRegistration(ctx.store.id, domain);
    if (!registration) return null;
    const offer = await renewalOffer(ctx.store.id, registration.apex, registration.registrar, 1);
    if (!offer) return null;
    return {
      summary: `Renew ${registration.apex} for a year for ${priced(offer.amountMinor, offer.currency)}.`,
      args: { ...args, domain: registration.apex, agreed: `${offer.currency}:${offer.amountMinor}` },
    };
  }
  return null;
}

/** `buy_domain` after the owner's yes: buys at the price they said yes to, then invoicing follows. */
export async function buyDomainTool(ctx: Ctx, args: OwnerToolInput<"buy_domain"> & { agreed?: string }) {
  const result = await startDomainPurchase(ctx.account, ctx.store.id, {
    domain: normal(args.domain),
    years: 1,
    agreed: String(args.agreed ?? ""),
    connect: args.connect !== false,
    registrant: await registrantFor(ctx, args.phone),
  });
  if (!result.ok) return fail(result.problems.join(" "));
  afterAnswer(() => chargeDomainPurchases({ storeId: ctx.store.id }));
  return {
    done: `Buying ${result.quote.domain} for ${priced(result.quote.amountMinor, result.quote.currency)}. It's invoiced now and registered as soon as it's paid${args.connect === false ? "" : "; the store then moves to it by itself"}. If it can't be registered, the money goes back.`,
    page: page(ctx.store),
  };
}

/** `renew_domain` after the owner's yes. */
export async function renewDomainTool(ctx: Ctx, args: OwnerToolInput<"renew_domain"> & { agreed?: string }) {
  const result = await renewDomainNow(ctx.account, ctx.store.id, normal(args.domain), 1, String(args.agreed ?? ""));
  if (!result.ok) return fail(result.problems.join(" "));
  afterAnswer(() => chargeDomainPurchases({ storeId: ctx.store.id }));
  return { done: `Renewing ${result.purchase.apex} for a year. It's renewed as soon as the invoice is paid.`, page: page(ctx.store) };
}

/** `set_domain_renewal` after the owner's yes. */
export async function setDomainRenewalTool(ctx: Ctx, { domain, renew }: OwnerToolInput<"set_domain_renewal">) {
  const result = await setDomainRenewal(ctx.account, ctx.store.id, normal(domain), renew);
  if (!result.ok) return fail(result.problems.join(" "));
  const expires = result.registration.expiresAt?.slice(0, 10) ?? "its expiry date";
  return {
    done: renew ? `${result.registration.apex} renews by itself: it's invoiced 30 days before ${expires}.` : `${result.registration.apex} won't renew: it stops working on ${expires}.`,
    page: page(ctx.store),
  };
}
