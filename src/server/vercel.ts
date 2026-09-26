import "server-only";

import { resolveTxt } from "node:dns/promises";

/**
 * Kaizen's Vercel project, for stores' own domains (P8): adding a domain to
 * the project, asking how its DNS stands, and deploying again so the new
 * routing takes effect. Needs `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID`,
 * `VERCEL_TEAM_ID` and `VERCEL_DEPLOY_HOOK_URL` (a deploy hook on `main`).
 */

type Verification = { type: string; domain: string; value: string };

/** How Vercel sees a domain on the project. */
export type ProjectDomain = { verified: boolean; verification: Verification[]; apexName: string | null };

/** Whether the domain points at Vercel, and what Vercel recommends it points to. */
export type DomainConfig = { misconfigured: boolean; aValues: string[]; cname: string | null };

/** What stores' domains need from outside: Vercel and DNS. Swapped for fakes in tests. */
export type DomainServices = {
  add(hostname: string): Promise<ProjectDomain>;
  get(hostname: string): Promise<ProjectDomain | null>;
  verify(hostname: string): Promise<ProjectDomain>;
  config(hostname: string): Promise<DomainConfig>;
  remove(hostname: string): Promise<void>;
  deploy(): Promise<void>;
  txt(name: string): Promise<string[]>;
};

export class VercelError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
  }
}

function settings() {
  const token = process.env.VERCEL_API_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  const teamId = process.env.VERCEL_TEAM_ID;
  const deployHook = process.env.VERCEL_DEPLOY_HOOK_URL;
  return token && projectId && deployHook ? { token, projectId, teamId, deployHook } : null;
}

/** Whether Kaizen can add stores' domains here: its Vercel settings are there. */
export const domainsConfigured = () => settings() !== null;

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const s = settings();
  if (!s) throw new VercelError("Custom domains are not set up on Kaizen yet.", 503, null);
  const url = new URL(`https://api.vercel.com${path}`);
  if (s.teamId) url.searchParams.set("teamId", s.teamId);
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${s.token}`, "Content-Type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string } } & T;
  if (!response.ok) {
    throw new VercelError(body.error?.message ?? `Vercel answered ${response.status}.`, response.status, body.error?.code ?? null);
  }
  return body;
}

const project = () => encodeURIComponent(settings()?.projectId ?? "");
const toDomain = (body: { verified?: boolean; verification?: Verification[]; apexName?: string }): ProjectDomain => ({
  verified: body.verified === true,
  verification: body.verification ?? [],
  apexName: body.apexName ?? null,
});

/** Vercel's recommendations come ranked; the first is the one to use. */
function preferred<T>(list: unknown): T | null {
  if (!Array.isArray(list) || list.length === 0) return null;
  const ranked = [...list].sort((a, b) => (a?.rank ?? 0) - (b?.rank ?? 0));
  return (ranked[0]?.value ?? null) as T | null;
}

export const vercelDomains: DomainServices = {
  async add(hostname) {
    return toDomain(await call(`/v10/projects/${project()}/domains`, { method: "POST", body: JSON.stringify({ name: hostname }) }));
  },
  async get(hostname) {
    try {
      return toDomain(await call(`/v9/projects/${project()}/domains/${encodeURIComponent(hostname)}`));
    } catch (error) {
      if (error instanceof VercelError && error.status === 404) return null;
      throw error;
    }
  },
  async verify(hostname) {
    return toDomain(
      await call(`/v9/projects/${project()}/domains/${encodeURIComponent(hostname)}/verify`, { method: "POST" }),
    );
  },
  async config(hostname) {
    const body = await call<{ misconfigured?: boolean; recommendedIPv4?: unknown; recommendedCNAME?: unknown }>(
      `/v6/domains/${encodeURIComponent(hostname)}/config?projectIdOrName=${project()}`,
    );
    const ips = preferred<string[] | string>(body.recommendedIPv4);
    return {
      misconfigured: body.misconfigured !== false,
      aValues: Array.isArray(ips) ? ips : ips ? [ips] : [],
      cname: preferred<string>(body.recommendedCNAME),
    };
  },
  async remove(hostname) {
    try {
      await call(`/v9/projects/${project()}/domains/${encodeURIComponent(hostname)}`, { method: "DELETE" });
    } catch (error) {
      if (!(error instanceof VercelError && error.status === 404)) throw error;
    }
  },
  async deploy() {
    const s = settings();
    if (!s) throw new VercelError("Custom domains are not set up on Kaizen yet.", 503, null);
    const response = await fetch(s.deployHook, { method: "POST", signal: AbortSignal.timeout(15_000), cache: "no-store" });
    if (!response.ok) throw new VercelError(`The deploy hook answered ${response.status}.`, response.status, null);
  },
  async txt(name) {
    try {
      return (await resolveTxt(name)).map((parts) => parts.join(""));
    } catch {
      return [];
    }
  },
};
