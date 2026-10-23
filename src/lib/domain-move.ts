import { recordKey, type DnsRecordInput } from "./dns-records";

/**
 * Moving a domain away (D315, `docs/domains.md` 8): the checks code makes before each step, so the owner never has to guess whether the next
 * one is safe. Pure: the page, the AI manager's `plan_domain_move` and the tests share it.
 */

/** Days a zone stays on Kaizena Flow's DNS, read-only with *Switch back*, after its nameservers moved away (8.2). */
export const MOVE_KEEP_DAYS = 30;
/** Days after registration (or an earlier transfer) a gTLD can't move to another registrar (ICANN's transfer policy). */
export const TRANSFER_LOCK_DAYS = 60;
/** Expiry this close: renew first, or ask the new registrar (8.1). */
export const TRANSFER_EXPIRY_DAYS = 15;
/** A transfer started and not finished after this many days is taken as abandoned: the registration is active here again. */
export const TRANSFER_WAIT_DAYS = 30;

const DAY_MS = 86_400_000;

/** Country TLDs whose registry sets no lock after registration (Norid, policy 10.1); every other is taken as locked for 60 days. */
const NO_LOCK_TLDS = new Set(["no"]);

export type TransferFacts = {
  apex: string;
  status: "active" | "expired" | "transferring_out" | "transferred_out";
  registeredAt: string | null;
  expiresAt: string | null;
  contactVerified: boolean | null;
  /** A renewal invoiced, paid or being registered. */
  renewalUnderWay: boolean;
};

export type BlockerCode = "locked" | "renewal_under_way" | "contact_unverified" | "moved" | "expired";
export type Blocker = { code: BlockerCode; values: Record<string, string> };
export type AdviceCode = "expires_soon" | "already_started";

/** What stops a move to another registrar now, and what to know first. Blockers refuse the transfer code; advice doesn't. */
export function transferBlockers(facts: TransferFacts, now: Date): { blockers: Blocker[]; advice: { code: AdviceCode; values: Record<string, string> }[] } {
  const blockers: Blocker[] = [];
  const advice: { code: AdviceCode; values: Record<string, string> }[] = [];
  if (facts.status === "transferred_out") return { blockers: [{ code: "moved", values: { domain: facts.apex } }], advice };
  if (facts.status === "expired") blockers.push({ code: "expired", values: { domain: facts.apex } });
  const tld = facts.apex.split(".").pop() ?? "";
  if (facts.registeredAt && !NO_LOCK_TLDS.has(tld)) {
    const until = new Date(new Date(facts.registeredAt).getTime() + TRANSFER_LOCK_DAYS * DAY_MS);
    if (until > now) blockers.push({ code: "locked", values: { domain: facts.apex, date: until.toISOString().slice(0, 10) } });
  }
  if (facts.renewalUnderWay) blockers.push({ code: "renewal_under_way", values: { domain: facts.apex } });
  if (facts.contactVerified === false) blockers.push({ code: "contact_unverified", values: { domain: facts.apex } });
  if (facts.expiresAt && new Date(facts.expiresAt).getTime() - now.getTime() < TRANSFER_EXPIRY_DAYS * DAY_MS && facts.status === "active") {
    advice.push({ code: "expires_soon", values: { domain: facts.apex, date: facts.expiresAt.slice(0, 10) } });
  }
  if (facts.status === "transferring_out") advice.push({ code: "already_started", values: { domain: facts.apex } });
  return { blockers, advice };
}

/** The questions to ask other nameservers: one per name and type the zone has (ALIAS asked as A, as resolvers answer it). */
export function questionsFor(records: readonly DnsRecordInput[]): { name: string; type: string }[] {
  const seen = new Set<string>();
  const out: { name: string; type: string }[] = [];
  for (const r of records) {
    const type = r.type === "ALIAS" ? "A" : r.type;
    const key = `${r.name}|${type}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ name: r.name, type });
    }
  }
  return out;
}

/** An answer from other nameservers, in the record model; ALIAS records are compared by whether the name has an address at all. */
export type Answer = { name: string; type: string; records: DnsRecordInput[] | null };

/**
 * The records the new nameservers don't answer (8.2): each record of the zone looked for among the answers to its name and type. An
 * ALIAS counts as there when the name has any A record (the new provider flattens it its own way). A question the nameservers didn't answer
 * at all is `unanswered`, so a provider that is down reads as that, never as missing records.
 */
export function missingRecords(records: readonly DnsRecordInput[], answers: readonly Answer[]): { missing: DnsRecordInput[]; unanswered: string[] } {
  const missing: DnsRecordInput[] = [];
  const unanswered = new Set<string>();
  for (const r of records) {
    const type = r.type === "ALIAS" ? "A" : r.type;
    const answer = answers.find((a) => a.name === r.name && a.type === type);
    if (!answer || answer.records === null) {
      unanswered.add(`${type} ${r.name || "@"}`);
      continue;
    }
    if (r.type === "ALIAS") {
      if (answer.records.length === 0) missing.push(r);
      continue;
    }
    const want = recordKey({ ...r, ttl: undefined });
    if (!answer.records.some((a) => recordKey({ ...a, ttl: undefined }) === want)) missing.push(r);
  }
  return { missing, unanswered: [...unanswered] };
}

/** Nameservers as an owner pastes them: host names, one a line or comma-separated, without a trailing dot, two to thirteen. */
export function cleanNameservers(text: string): { nameservers: string[]; problem: string | null } {
  const nameservers = [...new Set(text.split(/[\s,]+/).map((n) => n.trim().toLowerCase().replace(/\.$/, "")).filter(Boolean))];
  if (nameservers.length < 2) return { nameservers, problem: "Give at least two nameservers, as your new DNS provider shows them." };
  if (nameservers.length > 13) return { nameservers, problem: "That is more nameservers than a domain can have." };
  const bad = nameservers.find((n) => !/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(n));
  if (bad) return { nameservers, problem: `"${bad}" isn't a nameserver's host name, like ns1.example-dns.com.` };
  if (nameservers.some((n) => /(^|\.)vercel-dns\.com$/.test(n))) return { nameservers, problem: "Those are Kaizena Flow's own nameservers: the DNS is here already." };
  return { nameservers, problem: null };
}

export type StepState = "done" | "ready" | "waiting" | "blocked" | "not_needed";
export type MoveStep = { key: "download" | "check_new_dns" | "switch_dns" | "transfer_code" | "transfer_done" | "disconnect"; state: StepState };
export type MoveGoal = "registrar" | "dns" | "elsewhere" | "leave";

export type MoveFacts = {
  registeredHere: boolean;
  registrationStatus: TransferFacts["status"] | null;
  zoneStatus: "active" | "leaving" | "left" | null;
  connected: boolean;
  blockers: number;
};

/** The checklist for what the owner chose (8.1 to 8.4), each step's state from the facts. */
export function moveSteps(goal: MoveGoal, f: MoveFacts): MoveStep[] {
  const dnsHere = f.zoneStatus === "active";
  const dnsGone = f.zoneStatus === "leaving" || f.zoneStatus === "left";
  const dnsSteps: MoveStep[] = [
    { key: "download", state: f.zoneStatus === null ? "not_needed" : "ready" },
    { key: "check_new_dns", state: dnsGone ? "done" : dnsHere ? "ready" : "not_needed" },
    { key: "switch_dns", state: dnsGone ? "done" : dnsHere ? "waiting" : "not_needed" },
  ];
  const moved = f.registrationStatus === "transferred_out";
  const registrarSteps: MoveStep[] = [
    { key: "transfer_code", state: !f.registeredHere ? "not_needed" : moved ? "done" : f.blockers > 0 ? "blocked" : "ready" },
    { key: "transfer_done", state: !f.registeredHere ? "not_needed" : moved ? "done" : "waiting" },
  ];
  const disconnect: MoveStep = { key: "disconnect", state: f.connected ? "ready" : "done" };
  if (goal === "registrar") return registrarSteps;
  if (goal === "dns") return dnsSteps;
  if (goal === "elsewhere") return [disconnect];
  // Leaving: DNS first, so the store and email keep working while the registration moves.
  return [disconnect, ...dnsSteps, ...registrarSteps];
}
