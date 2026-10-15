// RFC 6238 time-based one-time codes (HMAC-SHA1, 30 seconds, six digits), for the Auth stand-in's platform admin
// (e2e/fixtures/auth-stub.mjs checks them, e2e/signed-in/auth.setup.ts types them), as an authenticator app would.
import { createHmac } from "node:crypto";

/** The stand-in's platform admin's authenticator secret, base32 as an app is given it. A test secret, never a real one. */
export const E2E_TOTP_SECRET = "JBSWY3DPEHPK3PXPKAIZENAE2E";

function base32(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** The six digits for the 30-second step `offset` steps from now. */
export function totp(secret = E2E_TOTP_SECRET, offset = 0, now = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30000) + offset));
  const mac = createHmac("sha1", base32(secret)).update(counter).digest();
  const at = mac[mac.length - 1] & 0xf;
  const value = (mac.readUInt32BE(at) & 0x7fffffff) % 1_000_000;
  return String(value).padStart(6, "0");
}

/** Whether a typed code is the one for now or a step either side (the window apps and servers allow for clocks). */
export const totpMatches = (code, secret = E2E_TOTP_SECRET) => [-1, 0, 1].some((offset) => totp(secret, offset) === String(code));
