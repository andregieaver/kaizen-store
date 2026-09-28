import { connection } from "next/server";

import { gravatarSignatureOk, gravatarSource } from "@/lib/gravatar";
import { parseKey } from "@/lib/secret-box";

/**
 * Someone's Gravatar (D97), asked for by the server so visitors' browsers
 * never reach Gravatar. Only addresses Kaizen signed are served. Without a
 * Gravatar, an empty picture: `<Avatar>` draws the initials beneath it.
 */
const NONE = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';
const TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function none(maxAge: number): Response {
  return new Response(NONE, {
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": `public, max-age=${maxAge}, s-maxage=${maxAge}` },
  });
}

export async function GET(request: Request, { params }: RouteContext<"/api/gravatar/[hash]">) {
  await connection();
  const { hash } = await params;
  const signature = new URL(request.url).searchParams.get("k") ?? "";
  const key = parseKey(process.env.SETTINGS_ENCRYPTION_KEY);
  if (!key || !gravatarSignatureOk(hash, signature, key)) {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const response = await fetch(gravatarSource(hash), { signal: AbortSignal.timeout(4000), cache: "no-store" });
    const type = response.headers.get("content-type")?.split(";")[0].trim() ?? "";
    if (response.status === 404) return none(3600);
    if (!response.ok || !TYPES.has(type)) return none(300);
    const body = await response.arrayBuffer();
    if (body.byteLength > 1024 * 1024) return none(300);
    return new Response(body, {
      headers: {
        "Content-Type": type,
        "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return none(60);
  }
}
