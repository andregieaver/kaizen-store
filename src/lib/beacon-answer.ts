/**
 * The empty answer a measuring route gives (visits, speed, heatmaps, recordings, the admin's heatmaps): a status and no body, never cached,
 * so a script learns nothing from it.
 */
export const answer = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });
