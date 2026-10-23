import "server-only";

import { fromVercelRecord, toVercelRecord, type DnsRecord, type DnsRecordInput } from "@/lib/dns-records";

import { VercelError, vercelCall, type VercelCall } from "./vercel";

/**
 * Vercel DNS for the domains whose DNS Kaizena Flow keeps (D315, `docs/domains.md` 5): a zone is a domain added to Kaizena Flow's Vercel
 * team, answered by Vercel's nameservers once the domain points at them. Only `src/server/domain-dns.ts` writes through this (a scan test
 * holds it); everything else reads. Tests pass their own `call`.
 */

const enc = encodeURIComponent;

export type ZoneInfo = {
  /** `zeit.world` while Vercel's nameservers answer for it, `external` otherwise. */
  serviceType: string | null;
  /** The nameservers the domain points at now, and the ones Vercel wants. */
  nameservers: string[];
  intendedNameservers: string[];
  verified: boolean;
};

export type DnsHostApi = {
  /** The zone as Vercel holds it, or null when the domain is not in the team. */
  zone(apex: string): Promise<ZoneInfo | null>;
  /** Adds the domain to the team, so Vercel answers for it once its nameservers are Vercel's. */
  addZone(apex: string): Promise<ZoneInfo>;
  removeZone(apex: string): Promise<void>;
  records(apex: string): Promise<DnsRecord[]>;
  create(apex: string, record: DnsRecordInput): Promise<string>;
  update(id: string, record: DnsRecordInput): Promise<void>;
  remove(apex: string, id: string): Promise<void>;
};

const toZone = (d: Record<string, unknown> | undefined): ZoneInfo | null =>
  d
    ? {
        serviceType: typeof d.serviceType === "string" ? d.serviceType : null,
        nameservers: Array.isArray(d.nameservers) ? d.nameservers.map(String) : [],
        intendedNameservers: Array.isArray(d.intendedNameservers) ? d.intendedNameservers.map(String) : [],
        verified: d.verified === true,
      }
    : null;

export function vercelDns(call: VercelCall = vercelCall): DnsHostApi {
  return {
    async zone(apex) {
      try {
        return toZone((await call<{ domain?: Record<string, unknown> }>(`/v5/domains/${enc(apex)}`)).domain);
      } catch (error) {
        if (error instanceof VercelError && error.status === 404) return null;
        throw error;
      }
    },
    async addZone(apex) {
      const body = await call<{ domain?: Record<string, unknown> }>(`/v5/domains`, { method: "POST", body: JSON.stringify({ name: apex }) });
      return toZone(body.domain) ?? { serviceType: null, nameservers: [], intendedNameservers: [], verified: false };
    },
    async removeZone(apex) {
      try {
        await call(`/v6/domains/${enc(apex)}`, { method: "DELETE" });
      } catch (error) {
        if (!(error instanceof VercelError && error.status === 404)) throw error;
      }
    },
    async records(apex) {
      const all: DnsRecord[] = [];
      let until: number | null = null;
      for (let page = 0; page < 20; page++) {
        const body: { records?: Record<string, unknown>[]; pagination?: { next?: number | null } } = await call(
          `/v4/domains/${enc(apex)}/records?limit=100${until ? `&until=${until}` : ""}`,
        );
        for (const r of body.records ?? []) {
          const record = fromVercelRecord(r);
          if (record) all.push(record);
        }
        const next = body.pagination?.next;
        if (!next) break;
        until = next;
      }
      return all;
    },
    async create(apex, record) {
      const body = await call<{ uid?: unknown; id?: unknown }>(`/v2/domains/${enc(apex)}/records`, { method: "POST", body: JSON.stringify(toVercelRecord(record)) });
      const id = body.uid ?? body.id;
      if (typeof id !== "string") throw new VercelError("Vercel made the record but gave no id.", 500, null);
      return id;
    },
    async update(id, record) {
      const { type, name, value, ttl, mxPriority, srv } = toVercelRecord(record);
      await call(`/v1/domains/records/${enc(id)}`, { method: "PATCH", body: JSON.stringify({ type, name, value, ttl, mxPriority, srv }) });
    },
    async remove(apex, id) {
      try {
        await call(`/v2/domains/${enc(apex)}/records/${enc(id)}`, { method: "DELETE" });
      } catch (error) {
        if (!(error instanceof VercelError && error.status === 404)) throw error;
      }
    },
  };
}
