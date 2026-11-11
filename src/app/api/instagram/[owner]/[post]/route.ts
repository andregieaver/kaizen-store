import { isInstagramPicture } from "@/lib/instagram";
import { postMedia } from "@/server/instagram";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PICTURE_MAX = 8 * 1024 * 1024;
const VIDEO_MAX = 300 * 1024 * 1024;

/**
 * One kept Instagram post's picture, or with `?video` a video post's file (D559), served by the site so a visitor's browser never loads
 * from Meta: `owner` is a store's id or `kaizen`, `post` one of that owner's kept posts. Fetched from Instagram's own hosts only
 * (`isInstagramPicture()`). A picture is at most 8 MB and cached by the CDN for a day; a video is streamed as asked (the browser's `Range`
 * passed on, so it starts at once and can be skipped through), at most 300 MB, and also cached. Instagram's addresses expire; the post's id
 * does not.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/instagram/[owner]/[post]">) {
  const { owner, post } = await params;
  if ((owner !== "kaizen" && !UUID.test(owner)) || !/^[0-9_]{1,60}$/.test(post)) return new Response("Not found", { status: 404 });
  const video = new URL(request.url).searchParams.has("video");
  const address = await postMedia(owner === "kaizen" ? null : owner, post, video ? "video" : "picture");
  if (!address || !isInstagramPicture(address)) return new Response("Not found", { status: 404 });
  const range = video ? request.headers.get("range") : null;
  let upstream: Response;
  try {
    upstream = await fetch(address, {
      headers: range && /^bytes=\d*-\d*$/.test(range) ? { Range: range } : {},
      redirect: "error",
      signal: AbortSignal.timeout(video ? 30_000 : 10_000),
      cache: "no-store",
    });
  } catch {
    return new Response("Not available", { status: 502 });
  }
  const type = upstream.headers.get("content-type") ?? "";
  const length = Number(upstream.headers.get("content-length") ?? 0);
  const cache = "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800";
  if (video) {
    if (!(upstream.status === 200 || upstream.status === 206) || !type.startsWith("video/") || length > VIDEO_MAX) return new Response("Not available", { status: 502 });
    const headers = new Headers({ "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": cache, "X-Content-Type-Options": "nosniff" });
    for (const name of ["content-length", "content-range"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  }
  if (!upstream.ok || !type.startsWith("image/") || length > PICTURE_MAX) return new Response("Not available", { status: 502 });
  const body = await upstream.arrayBuffer();
  if (body.byteLength > PICTURE_MAX) return new Response("Not available", { status: 502 });
  return new Response(body, { headers: { "Content-Type": type, "Cache-Control": cache, "X-Content-Type-Options": "nosniff" } });
}
