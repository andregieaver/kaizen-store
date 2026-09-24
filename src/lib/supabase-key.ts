/**
 * Which kind of Supabase API key a value is, without calling Supabase:
 * the secret key (`sb_secret_…`, or the legacy `service_role` JWT) that
 * server-side uploads need, or the publishable one (`sb_publishable_…`,
 * or the legacy `anon` JWT) that Storage treats as an anonymous visitor.
 */
export function supabaseKeyKind(key: string): "secret" | "publishable" | "unknown" {
  const value = key.trim();
  if (value.startsWith("sb_secret_")) return "secret";
  if (value.startsWith("sb_publishable_")) return "publishable";
  const payload = value.split(".")[1];
  if (!payload) return "unknown";
  try {
    const role = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).role;
    return role === "service_role" ? "secret" : role === "anon" ? "publishable" : "unknown";
  } catch {
    return "unknown";
  }
}
