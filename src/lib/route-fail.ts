/** A route's refusal as JSON, never cached. Its own file so a light route does not load the chat's module for it (bloat review step 0.4). */
export const fail = (status: number, message: string) =>
  Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
