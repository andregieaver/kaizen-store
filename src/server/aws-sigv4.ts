import "server-only";

import { createHash, createHmac } from "node:crypto";

/**
 * AWS Signature Version 4 for one HTTPS request (D872): what Amazon SES's API asks of every call. Kept here, a page of code, rather than
 * the AWS SDK: SES is the only AWS service Kaizena Flow calls. The request's headers are returned with `Authorization`, `X-Amz-Date` and
 * `X-Amz-Content-Sha256` added; the body is signed as it is sent.
 */

export type AwsKeys = { accessKeyId: string; secretAccessKey: string };

const sha256 = (data: string) => createHash("sha256").update(data, "utf8").digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data, "utf8").digest();

/** A path's segments encoded as SigV4 asks (RFC 3986, each segment once). */
function canonicalPath(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => encodeURIComponent(decodeURIComponent(segment)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

/** The query sorted by name, then value, each encoded. */
function canonicalQuery(search: URLSearchParams): string {
  const encode = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return [...search.entries()]
    .map(([k, v]) => [encode(k), encode(v)] as const)
    .sort(([ak, av], [bk, bv]) => (ak === bk ? (av < bv ? -1 : av > bv ? 1 : 0) : ak < bk ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

/** `20150830T123600Z` and `20150830` for a moment. */
export function amzDates(now: Date): { stamp: string; day: string } {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return { stamp, day: stamp.slice(0, 8) };
}

/**
 * Signs a request. `headers` are those the request sends besides `host` (added here); every one of them is signed. `now` is for tests.
 * `contentHash: false` leaves out `X-Amz-Content-Sha256`, as AWS's own published examples do.
 */
export function signRequest(
  keys: AwsKeys,
  input: { method: string; url: string; region: string; service: string; headers?: Record<string, string>; body?: string; now?: Date; contentHash?: boolean },
): Record<string, string> {
  const url = new URL(input.url);
  const body = input.body ?? "";
  const { stamp, day } = amzDates(input.now ?? new Date());
  const payloadHash = sha256(body);
  const headers: Record<string, string> = { ...input.headers, host: url.host, "x-amz-date": stamp };
  if (input.contentHash !== false) headers["x-amz-content-sha256"] = payloadHash;
  const lower = Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, " ")] as const);
  lower.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const signedHeaders = lower.map(([k]) => k).join(";");
  const canonical = [
    input.method.toUpperCase(),
    canonicalPath(url.pathname || "/"),
    canonicalQuery(url.searchParams),
    lower.map(([k, v]) => `${k}:${v}\n`).join(""),
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256(canonical)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${keys.secretAccessKey}`, day), input.region), input.service), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(toSign, "utf8").digest("hex");
  const out: Record<string, string> = { ...input.headers, "X-Amz-Date": stamp };
  if (input.contentHash !== false) out["X-Amz-Content-Sha256"] = payloadHash;
  out.Authorization = `AWS4-HMAC-SHA256 Credential=${keys.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return out;
}
