/**
 * Whether a person proved who they are just now (D171), read from the session token's `amr` claim: the signed list of the ways they signed in, each with the
 * time. A password, a magic link or a code each leave an entry; a token that only refreshed keeps the old time, so an old session is not fresh however
 * recently its token was renewed. Nothing here is the person's to edit: the claim comes from the verified token.
 */
export const FRESH_SIGN_IN_SECONDS = 10 * 60;

export function signedInWithin(amr: unknown, nowSeconds: number, maxSeconds: number = FRESH_SIGN_IN_SECONDS): boolean {
  if (!Array.isArray(amr)) return false;
  return amr.some((entry) => {
    const at = entry && typeof entry === "object" ? (entry as { timestamp?: unknown }).timestamp : undefined;
    return typeof at === "number" && Number.isFinite(at) && at <= nowSeconds + 60 && nowSeconds - at <= maxSeconds;
  });
}
