import "server-only";

import { VercelError, vercelCall, type VercelCall } from "../vercel";

import { RegistrarError, type DomainRegistrar, type Order, type OrderStatus, type SearchResult } from "./types";

/**
 * Vercel's Registrar API (D315, `docs/domains.md` 1, read 22 and 23 October 2026) as a `DomainRegistrar`: generic TLDs, in US dollars, in
 * Kaizena Flow's team, so a name bought here lands on Vercel's nameservers in the same team as the store's project. Every call goes through
 * `vercelCall` (the team's token, a time limit); tests pass their own `call`. Answers are read defensively: a field Vercel leaves out is
 * null, never guessed, and its errors come back as `RegistrarError` with Vercel's own words.
 */

const enc = encodeURIComponent;
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const bool = (v: unknown): boolean => v === true || v === "true";
const iso = (v: unknown): string | null => {
  const n = num(v);
  if (n !== null && n > 0) return new Date(n).toISOString();
  if (typeof v === "string" && !Number.isNaN(Date.parse(v))) return new Date(v).toISOString();
  return null;
};

const ORDER_STATUSES: readonly OrderStatus[] = ["draft", "purchasing", "completed", "failed"];

export function vercelRegistrar(call: VercelCall = vercelCall): DomainRegistrar {
  const ask = async <T>(path: string, init?: RequestInit): Promise<T> => {
    try {
      return await call<T>(path, init);
    } catch (error) {
      if (error instanceof VercelError) throw new RegistrarError(error.message, error.code, error.status);
      throw new RegistrarError("The registrar could not be reached.");
    }
  };
  const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

  return {
    id: "vercel",
    currency: "USD",

    async supportedTlds() {
      const body = await ask<unknown>("/v1/registrar/tlds/supported");
      const list = Array.isArray(body) ? body : Array.isArray((body as { tlds?: unknown })?.tlds) ? (body as { tlds: unknown[] }).tlds : [];
      return list.filter((t): t is string => typeof t === "string").map((t) => t.toLowerCase());
    },

    async search(domains) {
      if (domains.length === 0) return [];
      const body = await ask<{ results?: Record<string, unknown>[] }>("/v1/registrar/domains/search", json("POST", { domains }));
      return (body.results ?? []).map(
        (r): SearchResult => ({
          domain: String(r.domain ?? "").toLowerCase(),
          available: bool(r.available),
          premium: bool(r.premium),
          years: num(r.years),
          price: num(r.price),
          renewalPrice: num(r.renewalPrice),
        }),
      );
    },

    async price(domain, years) {
      const body = await ask<Record<string, unknown>>(`/v1/registrar/domains/${enc(domain)}/price${years ? `?years=${years}` : ""}`);
      const purchase = num(body.purchasePrice);
      const renewal = num(body.renewalPrice);
      if (purchase === null || renewal === null) throw new RegistrarError("The registrar gave no price for that name.");
      return { years: num(body.years) ?? years ?? 1, purchase, renewal, transfer: num(body.transferPrice), currency: "USD" };
    },

    async available(domain) {
      const body = await ask<{ available?: unknown }>(`/v1/registrar/domains/${enc(domain)}/availability`);
      return bool(body.available);
    },

    async contactSchema(domain) {
      const body = await ask<Record<string, unknown>>(`/v1/registrar/domains/${enc(domain)}/contact-info/schema`);
      return body && typeof body === "object" ? body : {};
    },

    async buy(domain, { years, expectedPrice, autoRenew, contact }) {
      const body = await ask<{ orderId?: unknown }>(
        `/v1/registrar/domains/${enc(domain)}/buy`,
        json("POST", { years, expectedPrice, autoRenew, contactInformation: contact }),
      );
      if (typeof body.orderId !== "string" || !body.orderId) throw new RegistrarError("The registrar took the order but gave no order number.");
      return { orderId: body.orderId };
    },

    async order(orderId) {
      const body = await ask<{ orderId?: unknown; status?: unknown; error?: { code?: unknown; details?: unknown } | null; domains?: { error?: unknown }[] }>(
        `/v1/registrar/orders/${enc(orderId)}`,
      );
      const status = ORDER_STATUSES.includes(body.status as OrderStatus) ? (body.status as OrderStatus) : "purchasing";
      const lineError = body.domains?.find((d) => d.error)?.error;
      const code = body.error?.code ?? (typeof lineError === "string" ? lineError : (lineError as { code?: unknown } | undefined)?.code);
      return { orderId, status, error: code ? String(code) : null } satisfies Order;
    },

    async renew(domain, { years, expectedPrice }) {
      const body = await ask<{ orderId?: unknown }>(`/v1/registrar/domains/${enc(domain)}/renew`, json("POST", { years, expectedPrice }));
      return { orderId: typeof body.orderId === "string" ? body.orderId : null };
    },

    async setAutoRenew(domain, autoRenew) {
      await ask(`/v1/registrar/domains/${enc(domain)}/auto-renew`, json("PATCH", { autoRenew }));
    },

    async setNameservers(domain, nameservers) {
      await ask(`/v1/registrar/domains/${enc(domain)}/nameservers`, json("PATCH", { nameservers }));
    },

    async authCode(domain) {
      const body = await ask<{ authCode?: unknown }>(`/v1/registrar/domains/${enc(domain)}/auth-code`);
      if (typeof body.authCode !== "string" || !body.authCode) throw new RegistrarError("The registrar gave no transfer code.");
      return body.authCode;
    },

    async contactVerified(domain) {
      try {
        const body = await ask<{ verified?: unknown }>(`/v1/registrar/domains/${enc(domain)}/contact-verification`);
        return bool(body.verified);
      } catch (error) {
        // Asked within 30 minutes of buying, Vercel answers `bought_too_recently`: not known yet.
        if (error instanceof RegistrarError && error.code === "bought_too_recently") return null;
        throw error;
      }
    },

    async domain(domain) {
      try {
        const body = await ask<{ domain?: Record<string, unknown> }>(`/v5/domains/${enc(domain)}`);
        const d = body.domain;
        if (!d) return null;
        const nameservers = Array.isArray(d.nameservers) ? d.nameservers.map(String) : [];
        return {
          expiresAt: iso(d.expiresAt),
          boughtAt: iso(d.boughtAt),
          renews: typeof d.renew === "boolean" ? d.renew : null,
          nameservers,
        };
      } catch (error) {
        if (error instanceof RegistrarError && error.status === 404) return null;
        throw error;
      }
    },
  };
}
