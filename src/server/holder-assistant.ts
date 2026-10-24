import "server-only";

import { createHmac } from "node:crypto";

import { domainsEn } from "@/lib/admin-messages/domains.en";
import { effectText, isProtected, type DnsChange } from "@/lib/dns-plan";
import { describeRecord } from "@/lib/dns-records";
import { recipeChanges } from "@/lib/dns-recipes";
import { changesOf, emailRecipe } from "@/lib/domain-tools";
import { OWNER_TOOLS_BY_NAME, toolDefinition, type OwnerToolInput } from "@/lib/owner-tools";

import { AiError, aiFor, chatWithTools, type AiConnection, type ToolChatMessage, type ToolDefinition } from "./ai";
import type { Account } from "./auth";
import { heldDomains } from "./domain-account";
import { applyDnsChange, previewDnsChange, storeZone, zoneRecords } from "./domain-dns";
import { accountHolder, type HolderRef } from "./domain-holder";
import { take } from "./domain-search";
import type { DnsHostApi } from "./vercel-dns";

/** What tests swap: the DNS host, the model and the hourly count. */
export type HolderDeps = { host?: DnsHostApi; take?: (bucket: string) => Promise<number>; connection?: AiConnection | null; chat?: typeof chatWithTools };
import { storeRegistrations } from "./domain-registrations";

/**
 * The AI manager for a domain's holder (D317 phase 5, decision 9): on *Your domains*, for anyone holding a domain, with or without a store.
 * Its own small loop beside the store's and the platform's assistant (whose `store: null` means the platform): the domain tools only,
 * every one acting as the account's holder (`accountHolder()`), facts only from the tools. It never changes anything itself: a DNS change it
 * plans is a proposal the person confirms on the page (`confirmHolderProposal()`), planned again on the live records then, refused if they
 * moved. The conversation stays in the tab; the server keeps no transcript. Kaizena Flow's key, at most `HOLDER_TURNS_PER_HOUR` turns.
 */

export const HOLDER_TURNS_PER_HOUR = 30;
const MAX_STEPS = 5;

export type HolderMessage = { role: "user" | "assistant"; content: string };
export type HolderProposal = { token: string; domain: string; summary: string; lines: string[]; touchesEmail: boolean };
export type HolderAnswer = { ok: true; reply: string; proposals: HolderProposal[] } | { ok: false; problem: string };

const DNS_TOOLS = ["change_dns", "set_up_email", "verify_domain_for"] as const;
type DnsTool = (typeof DNS_TOOLS)[number];

const TOOLS: ToolDefinition[] = [
  {
    name: "list_my_domains",
    description:
      "The person's domains held through Kaizena Flow: each one's name, the store that uses it (or none), whether it is registered here and when it expires and renews, and whether Kaizena Flow keeps its DNS (only then can its records be changed here). Read-only.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_dns_records",
    description: "The live DNS records of one of the person's domains whose DNS Kaizena Flow keeps, with those kept for a store marked. Read-only.",
    parameters: { type: "object", properties: { domain: { type: "string", description: "The domain, as list_my_domains gives it." } }, required: ["domain"], additionalProperties: false },
  },
  ...DNS_TOOLS.map((name) => {
    const def = toolDefinition(OWNER_TOOLS_BY_NAME[name]);
    return {
      ...def,
      description: `${def.description} Here it never changes anything by itself: it gives a proposal the person confirms on the page with one press.`,
    };
  }),
];

const SYSTEM = [
  "You are Kaizena Flow's assistant for the domains a person holds through Kaizena Flow.",
  "Help with their domains only: what they hold, their DNS records, setting up email, verifying a domain for a service. Anything else (buying, renewal, payments, moving away, stores) is done on the Your domains page: say where, briefly.",
  "Every fact comes from a tool you called: never guess a domain, a date, a price or a record. Values for records come only from the person or a tool.",
  "A DNS change is never made by you: call the tool, and tell the person to look at the proposal shown below your answer and press Confirm if it is right.",
  "Answer in the person's language, plainly and briefly, as text without HTML.",
].join(" ");

/** A proposal's token: the plan and the records it was planned on, signed so the page can't change it (HMAC, with the settings key). */
function sign(payload: string): string {
  const key = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!key) throw new Error("SETTINGS_ENCRYPTION_KEY is not set.");
  return createHmac("sha256", `holder-proposal:${key}`).update(payload).digest("base64url");
}
const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
const decode = (text: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(Buffer.from(text, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
};

/** The changes a DNS tool call stands for, on the holder's zone and its live records. */
async function planFor(holder: HolderRef, name: DnsTool, input: Record<string, unknown>, deps: HolderDeps = {}): Promise<{ apex: string; changes: DnsChange[] } | { problem: string }> {
  const domain = String(input.domain ?? "").trim().toLowerCase().replace(/\.$/, "");
  const zone = await storeZone(holder, domain);
  if (!zone) return { problem: `Kaizena Flow doesn't keep the DNS of ${domain} for you: its records are changed where it is hosted.` };
  if (name === "change_dns") {
    const args = input as OwnerToolInput<"change_dns">;
    return { apex: zone.apex, changes: changesOf(args.add ?? [], args.remove ?? []) };
  }
  if (name === "verify_domain_for") {
    const made = recipeChanges("verification", { value: String(input.value ?? ""), name: String(input.name ?? "") }, []);
    return made.ok ? { apex: zone.apex, changes: made.changes } : { problem: made.problems.join(" ") };
  }
  const read = await zoneRecords(holder, zone.apex, deps);
  if (!read.ok) return { problem: read.problems.join(" ") };
  const { recipe, values } = emailRecipe(input as OwnerToolInput<"set_up_email">);
  const made = recipeChanges(recipe, values, read.records);
  return made.ok ? { apex: zone.apex, changes: made.changes } : { problem: made.problems.join(" ") };
}

/** Plans a DNS tool call into a proposal the person can confirm, or the reason it can't be made. */
async function propose(account: Account, name: DnsTool, input: Record<string, unknown>, deps: HolderDeps): Promise<HolderProposal | { problem: string }> {
  const holder = accountHolder(account.id);
  const made = await planFor(holder, name, input, deps);
  if ("problem" in made) return made;
  const preview = await previewDnsChange(holder, made.apex, made.changes, deps);
  if (!preview.ok) return { problem: preview.problems.join(" ") };
  if (!preview.plan.ok) return { problem: preview.plan.problems.join(" ") || "Nothing would change: those records are there already." };
  const payload = encode({ a: account.id, n: name, i: input, r: preview.plan.rev, t: Date.now() });
  return {
    token: `${payload}.${sign(payload)}`,
    domain: made.apex,
    summary: preview.plan.effects.map((e) => effectText(e, domainsEn.dns.effects)).join(" "),
    lines: [...preview.plan.removes.map((r) => `− ${describeRecord(r, made.apex)}`), ...preview.plan.adds.map((r) => `+ ${describeRecord(r, made.apex)}`)],
    touchesEmail: preview.plan.touchesEmail,
  };
}

/** The person's yes to a proposal: within an hour, theirs, planned again and applied only if the records are as they were (`rev`). */
export async function confirmHolderProposal(account: Account, token: string, deps: HolderDeps = {}): Promise<{ ok: true; domain: string } | { ok: false; problems: string[] }> {
  const [payload, signature] = String(token).split(".");
  if (!payload || !signature || sign(payload) !== signature) return { ok: false, problems: ["That proposal isn't valid. Ask again."] };
  const data = decode(payload);
  if (!data || data.a !== account.id || !DNS_TOOLS.includes(data.n as DnsTool)) return { ok: false, problems: ["That proposal isn't yours."] };
  if (Date.now() - Number(data.t) > 3_600_000) return { ok: false, problems: ["That proposal is more than an hour old. Ask again."] };
  const holder = accountHolder(account.id);
  const made = await planFor(holder, data.n as DnsTool, data.i as Record<string, unknown>, deps);
  if ("problem" in made) return { ok: false, problems: [made.problem] };
  const result = await applyDnsChange(account, holder, made.apex, made.changes, { source: data.n === "set_up_email" ? "recipe" : "ai_manager", rev: String(data.r), host: deps.host });
  if (!result.ok) return { ok: false, problems: result.problems };
  return { ok: true, domain: made.apex };
}

async function runTool(account: Account, name: string, args: Record<string, unknown>, proposals: HolderProposal[], deps: HolderDeps): Promise<unknown> {
  const holder = accountHolder(account.id);
  if (name === "list_my_domains") {
    const [held, registrations] = await Promise.all([heldDomains(account.id), storeRegistrations(holder)]);
    return held.map((d) => {
      const reg = registrations.find((r) => r.apex === d.apex);
      return {
        domain: d.apex,
        used_by_store: d.store?.name ?? null,
        registered_here: Boolean(reg),
        expires: reg?.expiresAt?.slice(0, 10) ?? null,
        renews_by_itself: reg ? reg.renew : null,
        dns_kept_here: Boolean(d.zoneId),
        shows_while_unused: d.store ? null : (d.holding?.mode ?? null),
      };
    });
  }
  if (name === "list_dns_records") {
    const read = await zoneRecords(holder, String(args.domain ?? "").trim().toLowerCase(), deps);
    if (!read.ok) return { error: read.problems.join(" ") };
    return {
      domain: read.zone.apex,
      records: read.records.map((r) => ({
        type: r.type,
        name: r.name || "@",
        value: r.type === "SRV" && r.srv ? `${r.srv.priority} ${r.srv.weight} ${r.srv.port} ${r.srv.target}` : r.value,
        ...(r.type === "MX" ? { priority: r.mxPriority } : {}),
        ...(isProtected(r, read.connected) ? { kept_for_a_store: true } : {}),
      })),
    };
  }
  if ((DNS_TOOLS as readonly string[]).includes(name)) {
    const parsed = OWNER_TOOLS_BY_NAME[name].input.safeParse(args);
    if (!parsed.success) return { error: "Those arguments don't fit the tool." };
    const proposal = await propose(account, name as DnsTool, parsed.data as Record<string, unknown>, deps);
    if ("problem" in proposal) return { error: proposal.problem };
    proposals.push(proposal);
    return { proposed: proposal.summary, records: proposal.lines, next: "The person confirms it on the page; nothing is changed until then." };
  }
  return { error: "No such tool." };
}

/** One turn: the tab's conversation and the new message in, the answer and any proposals out. */
export async function holderTurn(account: Account, history: HolderMessage[], message: string, deps: HolderDeps = {}): Promise<HolderAnswer> {
  const text = message.trim().slice(0, 2000);
  if (!text) return { ok: false, problem: "Write something first." };
  const used = await (deps.take ?? ((bucket: string) => take(null, bucket)))(`holder-ai:${account.id}`);
  if (used > HOLDER_TURNS_PER_HOUR) return { ok: false, problem: "That's a lot of questions for one hour. Try again a little later." };
  const connection = deps.connection !== undefined ? deps.connection : await aiFor(null, { feature: "ai_manager", accountId: account.id });
  if (!connection?.textModel) return { ok: false, problem: "The assistant isn't available just now. Everything it does is on this page too." };
  const messages: ToolChatMessage[] = [
    { role: "system", content: SYSTEM },
    ...history.slice(-12).map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }) as ToolChatMessage),
    { role: "user", content: text },
  ];
  const proposals: HolderProposal[] = [];
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const answer = await (deps.chat ?? chatWithTools)(connection, messages, TOOLS, { maxTokens: 700 });
      if (answer.toolCalls.length === 0) return { ok: true, reply: (answer.content ?? "").replace(/<[^>]*>/g, "").trim().slice(0, 4000), proposals };
      messages.push({ role: "assistant", content: answer.content, tool_calls: answer.toolCalls });
      for (const call of answer.toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
        } catch {
          // Read as no arguments.
        }
        const result = await runTool(account, call.function.name, args, proposals, deps);
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, 12_000) });
      }
    }
    return { ok: true, reply: proposals.length > 0 ? "Look at the change below and confirm it if it's right." : "I couldn't finish that. Try asking in fewer steps.", proposals };
  } catch (error) {
    if (error instanceof AiError) return { ok: false, problem: "The assistant can't answer just now. Everything it does is on this page too." };
    throw error;
  }
}
