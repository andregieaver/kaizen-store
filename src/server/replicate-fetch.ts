import "server-only";

import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

import { isBlockedAddress, parseReplicaUrl } from "@/lib/replicate-url";

/**
 * Everything the page replicator (D150) fetches from other websites goes through here. Kaizen's server asks for what a
 * person pointed it at, so it never reaches Kaizen's own network: the address is checked (`parseReplicaUrl()`), the
 * name is looked up and every address it has must be a public one, the connection is made to the address that was
 * checked (so a name cannot change its answer between the check and the connection), each redirect goes through the
 * same checks, and the size, time and number of redirects are limited. Tests may reach a local page only with
 * `REPLICATE_ALLOW_PRIVATE=1`, which is ignored on Vercel.
 */

export const allowPrivate = (): boolean => process.env.REPLICATE_ALLOW_PRIVATE === "1" && !process.env.VERCEL;

const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export type Resolve = (host: string) => Promise<string[]>;
const resolveHost: Resolve = async (host) => (await dns.lookup(host, { all: true })).map((a) => a.address);

/** Why a host may not be opened, or null when every address it has is public. */
export async function hostProblem(host: string, resolve: Resolve = resolveHost): Promise<string | null> {
  if (allowPrivate()) return null;
  if (net.isIP(host)) return isBlockedAddress(host) ? "That address is on a private network." : null;
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    return "That address could not be found.";
  }
  if (addresses.length === 0) return "That address could not be found.";
  return addresses.some(isBlockedAddress) ? "That address is on a private network." : null;
}

export type Fetched =
  | { ok: true; url: string; status: number; contentType: string; bytes: Uint8Array }
  | { ok: false; problem: string; status?: number };

export type FetchOptions = {
  maxBytes: number;
  timeoutMs?: number;
  /** The `Accept` header. */
  accept?: string;
  /** The page it is found on, sent as the referrer as a browser would. */
  referer?: string;
  maxRedirects?: number;
  resolve?: Resolve;
  signal?: AbortSignal;
};

/** One request, to one checked address, without following redirects. */
function once(url: URL, address: string, family: number, options: FetchOptions): Promise<{ status: number; headers: http.IncomingHttpHeaders; bytes: Uint8Array | null; tooLarge: boolean }> {
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.request(
      url,
      {
        method: "GET",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: options.accept ?? "*/*",
          "Accept-Encoding": "identity",
          "Accept-Language": "en;q=0.9",
          ...(options.referer ? { Referer: options.referer } : {}),
        },
        // The connection goes to the address that was checked, whatever the name would answer now.
        lookup: (_host, lookupOptions, callback) => {
          // Node asks for every address when it tries more than one family, and for one otherwise.
          if (lookupOptions && (lookupOptions as { all?: boolean }).all) (callback as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address, family }]);
          else (callback as unknown as (e: null, a: string, f: number) => void)(null, address, family);
        },
        timeout: options.timeoutMs ?? 20_000,
        signal: options.signal,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          response.resume();
          resolve({ status, headers: response.headers, bytes: null, tooLarge: false });
          return;
        }
        const declared = Number(response.headers["content-length"] ?? 0);
        if (declared > options.maxBytes) {
          response.destroy();
          resolve({ status, headers: response.headers, bytes: null, tooLarge: true });
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        response.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > options.maxBytes) {
            response.destroy();
            resolve({ status, headers: response.headers, bytes: null, tooLarge: true });
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => resolve({ status, headers: response.headers, bytes: Buffer.concat(chunks), tooLarge: false }));
        response.on("error", reject);
      },
    );
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", reject);
    request.end();
  });
}

/** A file or page from the web, with the checks above; never throws, says in words why it could not. */
export async function safeFetch(raw: string, options: FetchOptions): Promise<Fetched> {
  let current = raw;
  for (let hop = 0; hop <= (options.maxRedirects ?? 5); hop++) {
    const parsed = parseReplicaUrl(current, { allowPrivate: allowPrivate() });
    if (!parsed.ok) return { ok: false, problem: parsed.problem };
    const url = parsed.url;
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const problem = await hostProblem(host, options.resolve);
    if (problem) return { ok: false, problem };
    let address = host;
    let family = net.isIP(host) || 4;
    if (!net.isIP(host)) {
      try {
        const found = await dns.lookup(host);
        address = found.address;
        family = found.family;
      } catch {
        return { ok: false, problem: "That address could not be found." };
      }
      // The address the connection will use is checked itself, as the name may answer differently each time.
      if (!allowPrivate() && isBlockedAddress(address)) return { ok: false, problem: "That address is on a private network." };
    }
    let result: Awaited<ReturnType<typeof once>>;
    try {
      result = await once(url, address, family, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      return { ok: false, problem: message === "timeout" ? "The site took too long to answer." : "The site could not be reached." };
    }
    if (result.status >= 300 && result.status < 400) {
      const location = result.headers.location;
      if (!location) return { ok: false, problem: "The site redirected without saying where.", status: result.status };
      try {
        current = new URL(location, url).toString();
      } catch {
        return { ok: false, problem: "The site redirected to an address that cannot be read." };
      }
      continue;
    }
    if (result.tooLarge) return { ok: false, problem: "The file is larger than can be copied.", status: result.status };
    if (result.status < 200 || result.status >= 300 || !result.bytes) return { ok: false, problem: `The site answered ${result.status}.`, status: result.status };
    return { ok: true, url: url.toString(), status: result.status, contentType: String(result.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase(), bytes: result.bytes };
  }
  return { ok: false, problem: "The site redirected too many times." };
}
