/**
 * Once when a server instance starts, before it takes requests: read the
 * interface text of languages that are translated by AI (D111), so the
 * synchronous `t()` finds it from the first page. Then it marks the end of the start (`markRegistered()`, bloat review step 1.16).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.DATABASE_URL) {
    const { markRegistered } = await import("@/server/instance-start");
    markRegistered(0);
    return;
  }
  const { startUi, uiBytesAtStart } = await import("@/server/ui-text-read");
  await startUi();
  const { markRegistered } = await import("@/server/instance-start");
  markRegistered(uiBytesAtStart());
}
