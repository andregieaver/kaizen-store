/**
 * Once when a server instance starts, before it takes requests: read the
 * interface text of languages that are translated by AI (D111), so the
 * synchronous `t()` finds it from the first page.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) return;
  const { startUi } = await import("@/server/ui-text");
  await startUi();
}
