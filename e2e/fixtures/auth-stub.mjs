// A stand-in for Supabase Auth (GoTrue), for the signed-in admin tests (e2e/signed-in/). The app is built with
// NEXT_PUBLIC_SUPABASE_URL pointed here (CI's `signed-in` job) and runs its own sign-in code unchanged: the password form
// calls `signInWithPassword()`, `getClaims()` sees an HS256 token and asks `/user`, and the browser's client refreshes
// through `/token`. Nothing in the app knows it is a stand-in, so the gate (`readSession()`, `getAccount()`) is the real one.
//
// Only the people in USERS can sign in, with E2E_PASSWORD. Store members have no second step (`factors: []`), so they pass the
// gate at once. The platform admin in ADMINS has an authenticator app already set up (a verified TOTP factor, the secret in
// e2e/fixtures/totp.mjs): the password gives an `aal1` session the gate holds at the second step, as in production, and the
// app's own form sends the six digits through `mfa.challenge()` and `mfa.verify()`, which this stand-in answers with an `aal2`
// session when the code is right.
//
//   AUTH_STUB_PORT=3912 node e2e/fixtures/auth-stub.mjs
import { createHash, createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { totpMatches } from "./totp.mjs";

// Kept in step with e2e/signed-in/accounts.ts.
export const E2E_PASSWORD = "e2e-Password-1";
const ADMINS = ["e2e-admin@example.com"];
const USERS = ["e2e-owner@example.com", "e2e-reader@example.com", ...ADMINS];

const SECRET = "kaizen-e2e-auth-stub";
const port = Number(process.env.AUTH_STUB_PORT ?? 3912);

/** A person's auth id, the same every run (a UUID from the email), so the account it is linked to stays linked. */
function userId(email) {
  const h = createHash("sha256").update(`kaizen-e2e:${email}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const b64 = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");

/** The platform admin's authenticator factor's id, the same every run. */
const factorId = (email) => userId(`factor:${email}`);

function token(email, session, aal = "aal1") {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    sub: userId(email),
    aud: "authenticated",
    role: "authenticated",
    email,
    aal,
    amr: aal === "aal2" ? [{ method: "totp", timestamp: now }, { method: "password", timestamp: now }] : [{ method: "password", timestamp: now }],
    session_id: session,
    iat: now,
    exp: now + 3600,
  };
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64(claims);
  const sig = createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

/** The claims of a token this stub signed and that has not run out, or null. */
function claimsOf(jwt) {
  const [head, body, sig] = String(jwt ?? "").split(".");
  if (!head || !body || !sig) return null;
  if (createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url") !== sig) return null;
  const claims = JSON.parse(Buffer.from(body, "base64url").toString());
  return claims.exp > Date.now() / 1000 && USERS.includes(claims.email) ? claims : null;
}

/** The email in a token this stub signed and that has not run out, or null. */
const verified = (jwt) => claimsOf(jwt)?.email ?? null;

const user = (email) => ({
  id: userId(email),
  aud: "authenticated",
  role: "authenticated",
  email,
  email_confirmed_at: "2026-01-01T00:00:00Z",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  identities: [],
  factors: ADMINS.includes(email)
    ? [{ id: factorId(email), friendly_name: "E2E authenticator", factor_type: "totp", status: "verified", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }]
    : [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

// Refresh tokens are kept in memory, with the level of the session they renew: a restart signs everyone out, as a real reset would.
const refreshTokens = new Map();
// The second step's challenges, by id, for five minutes.
const challenges = new Map();

function session(email, aal = "aal1") {
  const id = randomUUID();
  const refresh = randomUUID();
  refreshTokens.set(refresh, { email, aal });
  return {
    access_token: token(email, id, aal),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: refresh,
    user: user(email),
  };
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
  "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
};

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", ...CORS });
  res.end(JSON.stringify(body));
}

const fail = (res, status, code, msg) => send(res, status, { code: status, error_code: code, msg });

async function bodyOf(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (url.pathname === "/__health") return send(res, 200, { ok: true });

  if (url.pathname === "/auth/v1/token" && req.method === "POST") {
    const body = await bodyOf(req);
    const grant = url.searchParams.get("grant_type");
    if (grant === "password") {
      const email = String(body.email ?? "").toLowerCase();
      if (!USERS.includes(email) || body.password !== E2E_PASSWORD) return fail(res, 400, "invalid_credentials", "Invalid login credentials");
      return send(res, 200, session(email));
    }
    if (grant === "refresh_token") {
      const kept = refreshTokens.get(String(body.refresh_token ?? ""));
      if (!kept) return fail(res, 400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
      refreshTokens.delete(String(body.refresh_token));
      return send(res, 200, session(kept.email, kept.aal));
    }
    return fail(res, 400, "unsupported_grant_type", "Unsupported grant type");
  }

  if (url.pathname === "/auth/v1/user" && req.method === "GET") {
    const email = verified((req.headers.authorization ?? "").replace(/^Bearer /i, ""));
    return email ? send(res, 200, user(email)) : fail(res, 401, "bad_jwt", "invalid JWT");
  }

  if (url.pathname === "/auth/v1/logout" && req.method === "POST") {
    res.writeHead(204, CORS);
    return res.end();
  }

  if (url.pathname === "/auth/v1/factors" && req.method === "GET") return send(res, 200, []);

  // The second step (the platform admin's authenticator): a challenge, then the six digits, for the session that asks.
  const step = url.pathname.match(/^\/auth\/v1\/factors\/([0-9a-f-]{36})\/(challenge|verify)$/);
  if (step && req.method === "POST") {
    const claims = claimsOf((req.headers.authorization ?? "").replace(/^Bearer /i, ""));
    if (!claims) return fail(res, 401, "bad_jwt", "invalid JWT");
    // Only the platform admin has a factor, and only their own is challenged or verified.
    if (!ADMINS.includes(claims.email) || step[1] !== factorId(claims.email)) return fail(res, 404, "mfa_factor_not_found", "Factor not found");
    if (step[2] === "challenge") {
      const id = randomUUID();
      challenges.set(id, { email: claims.email, expires: Date.now() + 5 * 60_000 });
      return send(res, 200, { id, type: "totp", expires_at: Math.floor(Date.now() / 1000) + 300 });
    }
    const body = await bodyOf(req);
    const challenge = challenges.get(String(body.challenge_id ?? ""));
    if (!challenge || challenge.email !== claims.email || challenge.expires < Date.now()) return fail(res, 422, "mfa_challenge_expired", "Challenge expired");
    challenges.delete(String(body.challenge_id));
    if (!totpMatches(String(body.code ?? ""))) return fail(res, 422, "mfa_verification_failed", "Invalid TOTP code entered");
    return send(res, 200, session(claims.email, "aal2"));
  }

  fail(res, 404, "not_found", `The stand-in does not serve ${req.method} ${url.pathname}`);
}).listen(port, "127.0.0.1", () => console.log(`Auth stand-in on http://127.0.0.1:${port}`));
