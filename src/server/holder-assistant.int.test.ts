import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import type { DnsRecord } from "@/lib/dns-records";

import type { AiConnection, ToolChatMessage } from "./ai";
import type { Account } from "./auth";
import type { DnsHostApi } from "./vercel-dns";

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {} }));
process.env.SETTINGS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const assistant = await import("./holder-assistant");

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
const apex = `held-${run}.shop`;

function fakeHost() {
  let n = 0;
  const records: DnsRecord[] = [{ id: "rec_a", ttl: 3600, type: "A", name: "", value: "203.0.113.5" } as DnsRecord];
  const host: DnsHostApi = {
    zone: async () => ({ serviceType: "zeit.world", nameservers: [], intendedNameservers: [], verified: true }),
    addZone: async () => ({ serviceType: "zeit.world", nameservers: [], intendedNameservers: [], verified: true }),
    removeZone: async () => {},
    records: async () => records.map((r) => ({ ...r })),
    create: async (_a, record) => {
      const id = `rec_${(n += 1)}`;
      records.push({ ttl: 3600, ...record, id } as DnsRecord);
      return id;
    },
    update: async () => {},
    remove: async (_a, id) => {
      const at = records.findIndex((r) => r.id === id);
      if (at >= 0) records.splice(at, 1);
    },
  };
  return { host, records };
}

const connection = { provider: "openai", textModel: "test-model" } as unknown as AiConnection;
let holder: Account;
let stranger: Account;

beforeAll(async () => {
  const make = async (email: string) => {
    const [row] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, origin) values (${email}, 'Kari Nordmann', 'domain') returning id, email`);
    return { id: String(row.id), email: String(row.email), name: "Kari Nordmann", platformAdmin: false } as Account;
  };
  holder = await make(`holder-ai-${run}@example.com`);
  stranger = await make(`holder-ai-x-${run}@example.com`);
  await db().execute(sql`insert into commerce.dns_zones (account_id, apex, arrived_at) values (${holder.id}::uuid, ${apex}, now())`);
});

afterAll(async () => {
  await closeDb();
});

describe("the holder's assistant (D317 phase 5)", () => {
  it("plans a DNS change as a proposal, changes nothing until the person confirms, and only for its own holder", async () => {
    const fake = fakeHost();
    const seen: ToolChatMessage[][] = [];
    let step = 0;
    const chat = (async (_c: AiConnection, messages: ToolChatMessage[]) => {
      seen.push([...messages]);
      step++;
      if (step === 1) return { content: null, toolCalls: [{ id: "c1", type: "function", function: { name: "list_my_domains", arguments: "{}" } }] };
      if (step === 2)
        return {
          content: null,
          toolCalls: [{ id: "c2", type: "function", function: { name: "verify_domain_for", arguments: JSON.stringify({ domain: apex, value: "google-site-verification=abc123" }) } }],
        };
      return { content: "Look at the change below and press Confirm.", toolCalls: [] };
    }) as never;
    const answer = await assistant.holderTurn(holder, [], "Verify my domain for Google", { host: fake.host, connection, chat, take: async () => 1 });
    if (!answer.ok) throw new Error(answer.problem);
    expect(answer.proposals).toHaveLength(1);
    // The model saw only the holder's own domain.
    expect(JSON.stringify(seen[1])).toContain(apex);
    // Nothing changed yet.
    expect(fake.records.map((r) => r.type)).toEqual(["A"]);
    const token = answer.proposals[0].token;
    expect(await assistant.confirmHolderProposal(stranger, token, { host: fake.host })).toMatchObject({ ok: false });
    expect(await assistant.confirmHolderProposal(holder, `${token}x`, { host: fake.host })).toMatchObject({ ok: false });
    expect(await assistant.confirmHolderProposal(holder, token, { host: fake.host })).toEqual({ ok: true, domain: apex });
    expect(fake.records.some((r) => r.type === "TXT" && r.value === "google-site-verification=abc123")).toBe(true);
  });

  it("refuses past the hourly turns and without a model", async () => {
    expect(await assistant.holderTurn(holder, [], "Hi", { take: async () => 999, connection })).toMatchObject({ ok: false });
    expect(await assistant.holderTurn(holder, [], "Hi", { take: async () => 1, connection: null })).toMatchObject({ ok: false });
  });
});
