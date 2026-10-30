import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Authenticated encryption (AES-256-GCM) for secrets stored in the database,
 * such as payment API keys. The key never leaves the server environment.
 *
 * Stored format: `v2.<kid>.<iv>.<tag>.<ciphertext>`, each part base64url but the key id (`keyId()`: eight hex digits of the key's
 * SHA-256), so a secret names the key it was kept under and `SETTINGS_ENCRYPTION_KEY` can be rotated (PSI SEC-06,
 * `docs/runbooks/key-rotation.md`): during a rotation the old key is `SETTINGS_ENCRYPTION_KEY_PREVIOUS`, read but never written with,
 * and `reencryptSecrets()` moves every secret to the new one. `v1.<iv>.<tag>.<ciphertext>` (no key id) is still read: with the
 * current key, then the previous.
 */
const WRITE_VERSION: "v1" | "v2" = "v2";

export function parseKey(base64: string | undefined): Buffer | null {
  if (!base64) return null;
  const key = Buffer.from(base64, "base64");
  return key.length === 32 ? key : null;
}

/** The key a secret names: the first eight hex digits of the key's SHA-256, which says nothing of the key. */
export const keyId = (key: Buffer): string => createHash("sha256").update(key).digest("hex").slice(0, 8);

/** The key kept for reading during a rotation (`SETTINGS_ENCRYPTION_KEY_PREVIOUS`), when one is set. */
export function previousKeys(env: string | undefined = process.env.SETTINGS_ENCRYPTION_KEY_PREVIOUS): Buffer[] {
  const key = parseKey(env);
  return key ? [key] : [];
}

export function encryptSecret(plaintext: string, key: Buffer, version: "v1" | "v2" = WRITE_VERSION): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const parts = [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url"));
  return (version === "v2" ? ["v2", keyId(key), ...parts] : ["v1", ...parts]).join(".");
}

function open(key: Buffer, iv: string, tag: string, ciphertext: string): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

/** A kept secret in plain text, read with the key it names (`v2`) or the first of `key` and `older` that opens it (`v1`). */
export function decryptSecret(stored: string, key: Buffer, older: Buffer[] = previousKeys()): string {
  const parts = stored.split(".");
  if (parts[0] === "v2" && parts.length === 5) {
    const [, kid, iv, tag, ciphertext] = parts;
    const named = [key, ...older].find((one) => keyId(one) === kid);
    if (!named) throw new Error("The secret was kept under a key this server does not have");
    return open(named, iv, tag, ciphertext);
  }
  if (parts[0] === "v1" && parts.length === 4 && parts[1] && parts[2]) {
    const [, iv, tag, ciphertext] = parts;
    let failure: unknown;
    for (const one of [key, ...older]) {
      try {
        return open(one, iv, tag, ciphertext);
      } catch (error) {
        failure = error;
      }
    }
    throw failure;
  }
  throw new Error("Unrecognised secret format");
}

/** Whether a kept secret is under `key` already (a `v2` naming it); a `v1` never is. */
export const keptUnder = (stored: string, key: Buffer): boolean => stored.startsWith(`v2.${keyId(key)}.`);

/** A masked form safe to show again, e.g. `sk_test_…4242`. */
export function secretHint(secret: string): string {
  const prefix = secret.match(/^[a-z]+_(?:test_|live_)?/)?.[0] ?? "";
  return `${prefix}…${secret.slice(-4)}`;
}
