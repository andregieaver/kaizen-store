/** Resend's settings (D32), read from the environment; never shown, only described. */

export type EmailSettings = { apiKey: string; from: string };

export function emailSettings(env: Record<string, string | undefined> = process.env): EmailSettings | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();
  if (!apiKey?.startsWith("re_") || !from || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(from)) return null;
  return { apiKey, from };
}

/** How the email settings stand, for the health report: `unrecognised` is a key or address of the wrong shape. */
export function emailSetup(env: Record<string, string | undefined> = process.env): "ok" | "not_set" | "unrecognised" {
  if (!env.RESEND_API_KEY?.trim() && !env.EMAIL_FROM?.trim()) return "not_set";
  return emailSettings(env) ? "ok" : "unrecognised";
}

/** Whether Resend's delivery events can be checked (D32). */
export function emailEventsSetup(env: Record<string, string | undefined> = process.env): "ok" | "not_set" | "unrecognised" {
  const secret = env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) return "not_set";
  return secret.startsWith("whsec_") ? "ok" : "unrecognised";
}
