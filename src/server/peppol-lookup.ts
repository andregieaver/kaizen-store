import "server-only";

import { resolveNaptr } from "node:dns/promises";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { serviceUrl, smlName, smpUrlOf, SML_ZONE, type NaptrRecord, type PeppolDocument, type Receiver } from "@/lib/peppol";

import { log } from "./log";
import { col, typedRow } from "./typed-rows";

/**
 * Whether a business receives an invoice or a credit note on the Peppol network (B1, D463), asked of the network itself: its SMP found by
 * the SML's NAPTR record (`smlName()`, `smpUrlOf()`), then the SMP asked for each document type (`serviceUrl()`: 200 receives, 404 does
 * not). In Norway the receivers are those in ELMA, whose duty to send them EHF begins 1 January 2027. A name the SML does not know is a
 * business that receives nothing; a lookup that could not finish (DNS or the SMP down, an answer we cannot read) says so as `problem`, is
 * kept but not trusted, and is asked again next time. Answers are kept a day in `commerce.peppol_receivers`, shared by every store.
 */

export type Lookup = (participant: string) => Promise<Receiver>;
type Resolve = (name: string) => Promise<NaptrRecord[]>;

const TIMEOUT_MS = 5_000;
const FRESH_MS = 24 * 3600_000;

const dnsCode = (error: unknown) => (error as { code?: string } | null)?.code ?? "";

/** The network's answer for one participant, now: what its SMP says for invoices and credit notes. */
export async function lookupReceiver(
  participant: string,
  deps: { resolve?: Resolve; fetch?: typeof fetch; zone?: string } = {},
): Promise<Receiver> {
  const resolve = deps.resolve ?? ((name: string) => resolveNaptr(name));
  const get = deps.fetch ?? fetch;
  const none: Receiver = { participant, invoice: false, creditNote: false, problem: null };
  let records: NaptrRecord[];
  try {
    records = await resolve(smlName(participant, deps.zone ?? SML_ZONE));
  } catch (error) {
    // ENOTFOUND or ENODATA: the SML knows no such participant, so it receives nothing on Peppol.
    if (["ENOTFOUND", "ENODATA"].includes(dnsCode(error))) return none;
    return { ...none, problem: `dns_${dnsCode(error).toLowerCase() || "error"}` };
  }
  const smp = smpUrlOf(records);
  if (!smp) return none;
  const ask = async (document: PeppolDocument): Promise<boolean | string> => {
    try {
      const response = await get(serviceUrl(smp, participant, document), { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: "application/xml" } });
      if (response.status === 200) return true;
      if (response.status === 404) return false;
      return `http_${response.status}`;
    } catch (error) {
      return (error as Error)?.name === "TimeoutError" ? "timeout" : "network";
    }
  };
  const [invoice, creditNote] = await Promise.all([ask("invoice"), ask("credit_note")]);
  const problem = [invoice, creditNote].find((a): a is string => typeof a === "string") ?? null;
  return { participant, invoice: invoice === true, creditNote: creditNote === true, problem };
}

const cached = z.object({ invoice: col.bool, credit_note: col.bool, problem: col.textOrNull, fresh: col.bool });

/**
 * What the network says of a participant: the answer kept within the day when there is one without a problem, else asked now and kept.
 * Never throws: a failure to keep the answer is logged and the answer returned.
 */
export async function receiverOf(participant: string, deps: { lookup?: Lookup; now?: Date } = {}): Promise<Receiver> {
  const now = deps.now ?? new Date();
  const kept = await typedRow(
    cached,
    sql`select invoice, credit_note, problem, checked_at > ${new Date(now.getTime() - FRESH_MS).toISOString()}::timestamptz as fresh
        from commerce.peppol_receivers where participant = ${participant}`,
  );
  if (kept && kept.fresh && !kept.problem) return { participant, invoice: kept.invoice, creditNote: kept.credit_note, problem: null };
  const answer = await (deps.lookup ?? lookupReceiver)(participant);
  try {
    await db().execute(sql`
      insert into commerce.peppol_receivers (participant, invoice, credit_note, problem, checked_at)
      values (${participant}, ${answer.invoice}, ${answer.creditNote}, ${answer.problem}, ${now.toISOString()}::timestamptz)
      on conflict (participant) do update set invoice = excluded.invoice, credit_note = excluded.credit_note, problem = excluded.problem, checked_at = excluded.checked_at
    `);
  } catch (error) {
    log("warn", "peppol.lookup_not_kept", { participant: participant.slice(0, 5) }, error);
  }
  return answer;
}

/** Answers older than 30 days forgotten: a business asked about again is asked of the network. */
export async function prunePeppolReceivers(now: Date = new Date()): Promise<number> {
  const rows = await db().execute(sql`
    delete from commerce.peppol_receivers where checked_at < ${new Date(now.getTime() - 30 * 24 * 3600_000).toISOString()}::timestamptz returning participant
  `);
  return rows.length;
}
