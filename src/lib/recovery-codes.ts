/**
 * Recovery codes for the second step (wave 1, 1f, `docs/wave-1-trust.md` 2.6, 4.5), pure: how a code looks, how what a
 * person types is read, how a set is laid out to copy or print. Ten to a set; ten characters of Crockford's base-32
 * alphabet (50 bits) shown as `XXXXX-XXXXX`; read without regard to case, spaces or hyphens. Randomness is given in, so
 * a test can hold it; the hash (HMAC-SHA256 keyed from `SETTINGS_ENCRYPTION_KEY`) is the server's (`src/server/recovery-codes.ts`),
 * and the plaintext is shown once and never stored.
 */

/** Crockford's base-32: digits and letters without I, L, O and U, so a code read aloud or copied by hand is hard to get wrong. */
export const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const RECOVERY_CODE_LENGTH = 10;
export const RECOVERY_CODES_PER_SET = 10;

/** Random bytes, as `crypto.getRandomValues` or `node:crypto`'s `randomBytes` gives them. */
export type RandomBytes = (length: number) => Uint8Array;

/** `K7QM29WXDB` for a code of ten characters: 32 symbols divide 256, so the low five bits of a byte are uniform. */
export function generateRawCode(random: RandomBytes): string {
  const bytes = random(RECOVERY_CODE_LENGTH);
  if (bytes.length < RECOVERY_CODE_LENGTH) throw new Error("recovery codes need ten random bytes each");
  let code = "";
  for (let i = 0; i < RECOVERY_CODE_LENGTH; i++) code += CROCKFORD[bytes[i] & 31];
  return code;
}

/** `K7QM2-9WXDB`: the way a code is shown and typed. */
export const formatRecoveryCode = (raw: string): string => `${raw.slice(0, 5)}-${raw.slice(5)}`;

/**
 * What a person typed as the code, normalised for the hash, or null when it cannot be a code: upper case, spaces and
 * hyphens taken out, and Crockford's reading of look-alikes (I and L for 1, O for 0). Ten symbols of the alphabet.
 */
export function normaliseRecoveryCode(input: string): string | null {
  const cleaned = input
    .toUpperCase()
    .replace(/[\s\-–—_]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
  if (cleaned.length !== RECOVERY_CODE_LENGTH) return null;
  for (const char of cleaned) if (!CROCKFORD.includes(char)) return null;
  return cleaned;
}

/** A set of `count` different codes, each as it is shown. */
export function generateRecoveryCodes(random: RandomBytes, count: number = RECOVERY_CODES_PER_SET): string[] {
  const codes = new Set<string>();
  // Ten codes of 50 bits do not collide in practice; the loop is for a test's poor randomness.
  for (let guard = 0; codes.size < count && guard < count * 50; guard++) codes.add(generateRawCode(random));
  if (codes.size < count) throw new Error("could not make a set of different recovery codes");
  return [...codes].map(formatRecoveryCode);
}

/** The text of a set to copy or print: a heading that says what they are, one numbered code to a line. */
export function formatCodes(codes: readonly string[], context: { account: string; madeOn: string }): string {
  return [
    `Kaizen Store recovery codes for ${context.account}`,
    `Made ${context.madeOn}. Each code works once, and only until you make a new set.`,
    "Keep them somewhere safe, apart from the device with your authenticator app.",
    "",
    ...codes.map((code, i) => `${String(i + 1).padStart(2, " ")}. ${code}`),
    "",
  ].join("\n");
}

/** Whether what a person typed looks like a recovery code rather than the six digits of an authenticator app. */
export const looksLikeRecoveryCode = (input: string): boolean => !/^\d{6}$/.test(input.replace(/\s/g, "")) && normaliseRecoveryCode(input) !== null;
