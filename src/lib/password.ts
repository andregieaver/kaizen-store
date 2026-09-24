/**
 * Password rules for Kaizen accounts. Length matters far more than symbol
 * rules (NIST SP 800-63B), so the rule is simply: at least 12 characters,
 * and not the email address or an obvious variant of it.
 */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 72; // bcrypt, used by Supabase Auth, ignores the rest.

export function passwordProblem(password: string, email: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters. A few unrelated words make a strong, memorable password.`;
  }
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_LENGTH) {
    return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  }
  const lower = password.toLowerCase();
  const local = email.toLowerCase().split("@")[0];
  if (lower === email.toLowerCase() || (local.length >= 4 && lower.includes(local))) {
    return "Do not use your email address in your password.";
  }
  if (new Set(password).size < 4) return "Use a less repetitive password.";
  return null;
}

/**
 * Where to go after signing in, taken from a `next` parameter: only paths
 * inside the admin, so a link cannot send someone to another site.
 */
export function safeNext(next: string | null | undefined, fallback = "/admin"): string {
  if (!next || !next.startsWith("/admin") || next.startsWith("//") || next.includes("\\")) return fallback;
  try {
    const url = new URL(next, "http://kaizen.invalid");
    return url.origin === "http://kaizen.invalid" && url.pathname.startsWith("/admin")
      ? `${url.pathname}${url.search}`
      : fallback;
  } catch {
    return fallback;
  }
}
