import "server-only";

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { sameSite } from "@/lib/same-site";

import { requireAccount, type Membership } from "./auth";
import { log } from "./log";
import { checkPermission } from "./permissions";

/**
 * The two routes every social account connected from Social posts has (D870: Facebook S1.2b, Pinterest S3.4): the card's plain forms
 * (`connect` to the platform's sign-in, `choose` among the person's Pages or boards, `disconnect`), and the callback back from the sign-in.
 * Each answers back to the page with how it went (`?{key}={status}#social-{key}`); the platform's own parts come in `Connection`.
 */

export type Connection = {
  /** `facebook`, `pinterest`: the address's key and the card's anchor. */
  key: string;
  cookie: string;
  cookiePath: string;
  /** The platform's own error, whose words may be shown; anything else is logged. */
  isPlatformError: (error: unknown) => boolean;
  start: (storeSlug: string, accountId: string) => { url: string; cookie: string } | null;
  started: (cookie: string | undefined, params: URLSearchParams) => { store: string; accountId: string };
  connect: (accountId: string, storeId: string, params: URLSearchParams) => Promise<{ choose: unknown[] }>;
  choose: (accountId: string, storeId: string, id: string) => Promise<boolean>;
  /** The form field `choose` sends (`page`, `board`). */
  chooseField: string;
  disconnect: (accountId: string, storeId: string) => Promise<void>;
  /** The status a failed connect answers: `cancelled`, the platform's own (`nopage`, `noboard`), or `failed`. */
  failedStatus: (error: unknown) => string;
};

const backTo = (request: Request, slug: string, key: string, status: string, code?: number) =>
  NextResponse.redirect(new URL(`/admin/${slug}/social?${key}=${status}#social-${key}`, request.url), code);

/** The card's forms, for a member who may change the marketing of a store with the social media manager. */
export async function connectionForm(c: Connection, request: NextRequest, store: string): Promise<NextResponse> {
  const member = await checkPermission(store, "marketing:write", "social");
  if (!member) return new NextResponse("Not found", { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });
  const form = await request.formData().catch(() => null);
  const action = form?.get("do");
  const back = (status: string) => backTo(request, member.store.slug, c.key, status, 303);
  if (action === "connect") {
    const start = c.start(member.store.slug, member.account.id);
    if (!start) return back("failed");
    const response = NextResponse.redirect(start.url, 303);
    response.cookies.set(c.cookie, start.cookie, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: c.cookiePath, maxAge: 600 });
    return response;
  }
  if (action === "choose") {
    const id = form?.get(c.chooseField);
    try {
      return back(typeof id === "string" && (await c.choose(member.account.id, member.store.id, id)) ? "connected" : "failed");
    } catch (error) {
      if (!c.isPlatformError(error)) log("error", `${c.key}.choose_failed`, {}, error);
      return back("failed");
    }
  }
  if (action === "disconnect") {
    await c.disconnect(member.account.id, member.store.id);
    return back("disconnected");
  }
  return back("failed");
}

/** Back from the platform's sign-in, to the store's Social posts: checked against who started it, then connected. */
export async function connectionCallback(c: Connection, request: Request): Promise<NextResponse> {
  const account = await requireAccount();
  const jar = await cookies();
  const cookie = jar.get(c.cookie)?.value;
  jar.delete({ name: c.cookie, path: c.cookiePath });
  const params = new URL(request.url).searchParams;
  let started: { store: string; accountId: string };
  try {
    started = c.started(cookie, params);
  } catch {
    return NextResponse.redirect(new URL("/admin", request.url));
  }
  const back = (status: string) => backTo(request, started.store, c.key, status);
  if (started.accountId !== account.id) return back("failed");
  const member: Membership | null = await checkPermission(started.store, "marketing:write", "social");
  if (!member) return back("failed");
  try {
    const { choose } = await c.connect(account.id, member.store.id, params);
    return back(choose.length > 0 ? "choose" : "connected");
  } catch (error) {
    if (!c.isPlatformError(error)) log("error", `${c.key}.connect_failed`, {}, error);
    return back(c.failedStatus(error));
  }
}
