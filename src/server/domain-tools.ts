import "server-only";

import { domainsEn } from "@/lib/admin-messages/domains.en";
import { effectText, isProtected, type DnsChange, type DnsPlan } from "@/lib/dns-plan";
import { describeRecord } from "@/lib/dns-records";
import { recipeChanges } from "@/lib/dns-recipes";
import { registrantInput } from "@/lib/domain-registrant";
import { changesOf, emailRecipe } from "@/lib/domain-tools";
import { findingText, worstSeverity, type Finding } from "@/lib/domain-health";
import { formatMoney } from "@/lib/money";
import type { OwnerToolInput } from "@/lib/owner-tools";

import type { Account } from "./auth";
import { storeDomainHealth, type DomainHealth, type HealthDeps } from "./domain-health";
import { afterAnswer } from "./after-answer";
import { applyDnsChange, dnsAuto, dnsHistory, previewDnsChange, storeZone, undoDnsChange, zoneRecords } from "./domain-dns";
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

// ---------------------------------------------------------------------------
// DNS (D315 phase 3)
// ---------------------------------------------------------------------------

/** The changes a DNS tool's call stands for, planned on the live records; the reason when it can't be planned. */
async function dnsChangesFor(ctx: Ctx, name: string, input: Record<string, unknown>): Promise<{ apex: string; changes: DnsChange[]; undoOf?: string } | { problem: string }> {
  const domain = normal(String(input.domain ?? ""));
  const zone = await storeZone(ctx.store.id, domain);
  if (!zone) return { problem: `Kaizena Flow doesn't keep the DNS of ${domain}: its records are changed where it is hosted. check_domain says which records it needs.` };
  if (name === "change_dns") {
    const args = input as OwnerToolInput<"change_dns">;
    return { apex: zone.apex, changes: changesOf(args.add ?? [], args.remove ?? []) };
  }
  if (name === "verify_domain_for") {
    const made = recipeChanges("verification", { value: String(input.value ?? ""), name: String(input.name ?? "") }, []);
    return made.ok ? { apex: zone.apex, changes: made.changes } : { problem: made.problems.join(" ") };
  }
  if (name === "set_up_email") {
    const read = await zoneRecords(ctx.store.id, zone.apex);
    if (!read.ok) return { problem: read.problems.join(" ") };
    const { recipe, values } = emailRecipe(input as OwnerToolInput<"set_up_email">);
    const made = recipeChanges(recipe, values, read.records);
    return made.ok ? { apex: zone.apex, changes: made.changes } : { problem: made.problems.join(" ") };
  }
  return { problem: "Not a DNS change." };
}

/** A DNS tool's call, planned now: refused with the plan's reasons, never kept for a yes when it can't be made. */
export async function preflightDnsTool(ctx: Ctx, name: string, input: Record<string, unknown>): Promise<void> {
  if (name === "undo_dns_change") {
    const history = await dnsHistory(ctx.store.id, normal(String(input.domain ?? "")));
    const entry = history.find((h) => h.id === String(input.change ?? ""));
    if (!entry) return fail("That change isn't one of this domain's. list_dns_records gives their ids.");
    if (entry.undoneAt) return fail("That change was undone already.");
    return;
  }
  const made = await dnsChangesFor(ctx, name, input);
  if ("problem" in made) return fail(made.problem);
  const preview = await previewDnsChange(ctx.store.id, made.apex, made.changes);
  if (!preview.ok) return fail(preview.problems.join(" "));
  if (!preview.plan.ok) return fail(preview.plan.problems.join(" ") || "Nothing would change: those records are there already.");
}

/** What a DNS call does, in words for the owner's yes, with the fingerprint of the records it was planned on kept with the call. */
export async function dnsApprovalDetails(ctx: Ctx, name: string, args: Record<string, unknown>): Promise<{ summary: string; args: Record<string, unknown>; touchesEmail: boolean } | null> {
  if (name === "undo_dns_change") return { summary: `Undo the DNS change ${String(args.change ?? "")} on ${normal(String(args.domain ?? ""))}.`, args, touchesEmail: false };
  const made = await dnsChangesFor(ctx, name, args);
  if ("problem" in made) return null;
  const preview = await previewDnsChange(ctx.store.id, made.apex, made.changes);
  if (!preview.ok || !preview.plan.ok) return null;
  const words = preview.plan.effects.map((e) => effectText(e, domainsEn.dns.effects));
  const lines = [...preview.plan.removes.map((r) => `− ${describeRecord(r, made.apex)}`), ...preview.plan.adds.map((r) => `+ ${describeRecord(r, made.apex)}`)];
  return { summary: [`Change the DNS of ${made.apex}: ${words.join(" ")}`, ...lines].join("\n").slice(0, 1800), args: { ...args, rev: preview.plan.rev }, touchesEmail: preview.plan.touchesEmail };
}

/**
 * Whether a DNS call waits for the owner's yes (D315 decision 5): always, unless the store set DNS changes to automatic; then only a change
 * that stops or moves email (decision 5a) waits.
 */
export async function dnsGateNeeded(ctx: Ctx, name: string, args: Record<string, unknown>): Promise<boolean> {
  if (!(await dnsAuto(ctx.store.id))) return true;
  if (name === "undo_dns_change") return false;
  const details = await dnsApprovalDetails(ctx, name, args);
  return details ? details.touchesEmail : true;
}

const applied = (apex: string, plan: DnsPlan, store: Store) => ({
  done: `Changed the DNS of ${apex}. ${plan.effects.map((e) => effectText(e, domainsEn.dns.effects)).join(" ")} It's live at Kaizena Flow's nameservers now; some networks may show the old answer for up to an hour.`,
  page: page(store),
});

async function runDnsTool(ctx: Ctx, name: string, input: Record<string, unknown>) {
  const made = await dnsChangesFor(ctx, name, input);
  if ("problem" in made) return fail(made.problem);
  const automatic = !input.rev && (await dnsAuto(ctx.store.id));
  const result = await applyDnsChange(ctx.account, ctx.store.id, made.apex, made.changes, {
    source: name === "change_dns" || name === "verify_domain_for" ? "ai_manager" : "recipe",
    rev: input.rev ? String(input.rev) : undefined,
    automatic,
  });
  if (!result.ok) return fail(result.problems.join(" "));
  return applied(made.apex, result.plan, ctx.store);
}

/** `list_dns_records`: the live records, which are the store's own, and the latest changes. */
export async function listDnsRecordsTool(ctx: Ctx, { domain }: OwnerToolInput<"list_dns_records">) {
  const read = await zoneRecords(ctx.store.id, normal(domain));
  if (!read.ok) return fail(read.problems.join(" "));
  const history = await dnsHistory(ctx.store.id, read.zone.apex, 10);
  return {
    domain: read.zone.apex,
    records: read.records.map((r) => ({
      type: r.type,
      name: r.name || "@",
      value: r.type === "SRV" && r.srv ? `${r.srv.priority} ${r.srv.weight} ${r.srv.port} ${r.srv.target}` : r.value,
      ...(r.type === "MX" ? { priority: r.mxPriority } : {}),
      ...(isProtected(r, read.connected) ? { kept_for_the_store: true } : {}),
    })),
    changes: history.map((h) => ({ id: h.id, what: h.summary, when: h.createdAt.slice(0, 16).replace("T", " "), by: h.source === "ai_manager" || h.source === "recipe" ? "the AI manager" : (h.actor ?? "Kaizena Flow"), undone: h.undoneAt !== null })),
    automatic: await dnsAuto(ctx.store.id),
    page: page(ctx.store),
  };
}

export const changeDnsTool = (ctx: Ctx, input: OwnerToolInput<"change_dns">) => runDnsTool(ctx, "change_dns", input as unknown as Record<string, unknown>);
export const setUpEmailTool = (ctx: Ctx, input: OwnerToolInput<"set_up_email">) => runDnsTool(ctx, "set_up_email", input as unknown as Record<string, unknown>);
export const verifyDomainForTool = (ctx: Ctx, input: OwnerToolInput<"verify_domain_for">) => runDnsTool(ctx, "verify_domain_for", input as unknown as Record<string, unknown>);

/** `undo_dns_change`. */
export async function undoDnsChangeTool(ctx: Ctx, { change }: OwnerToolInput<"undo_dns_change">) {
  const result = await undoDnsChange(ctx.account, ctx.store.id, change);
  if (!result.ok) return fail(result.problems.join(" "));
  return { done: "Put the change back. It's live at Kaizena Flow's nameservers now.", page: page(ctx.store) };
}
