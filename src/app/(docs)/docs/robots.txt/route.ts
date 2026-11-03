import { docsRobots } from "@/lib/docs-text";

/** The docs' own host's rules for crawlers (D442), served there as `/robots.txt`; nothing without the host (Kaizena Flow's own apply). */
export function GET() {
  const body = docsRobots();
  if (!body) return new Response("Not found", { status: 404 });
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
