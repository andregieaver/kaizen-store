import { adminText } from "@/lib/admin-text";
import { actionAdminLang } from "@/server/admin-request-lang";
import { NextResponse } from "next/server";
import { z } from "zod";

import { sameSite } from "@/lib/same-site";
import { MESSAGE_MAX } from "@/lib/support-rules";
import { getAccount } from "@/server/auth";
import { requesterTurn } from "@/server/support-kaizen";

const NO_STORE = { "Cache-Control": "no-store" } as const;

const turnInput = z.object({
  conversation: z.uuid().nullish(),
  after: z.number().int().min(0).max(1_000_000).default(0),
  message: z.string().trim().min(1).max(MESSAGE_MAX.customer),
  aboutStore: z
    .string()
    .regex(/^[a-z0-9-]{1,63}$/)
    .nullish(),
  path: z.string().max(300).regex(/^\//).nullish(),
});

/** The signed-in account's message to Kaizen's support (D216, 2.8, step 11): a new conversation, or the next message of their own. */
export async function POST(request: Request) {
  const w = adminText(await actionAdminLang(), "support").problems;
  if (!sameSite(request))
    return NextResponse.json(
      { error: w.notThisSite },
      { status: 403, headers: NO_STORE },
    );
  const account = await getAccount();
  if (!account)
    return NextResponse.json(
      { error: w.signInAgain },
      { status: 401, headers: NO_STORE },
    );
  const raw = await request.text();
  if (raw.length > 8000)
    return NextResponse.json(
      { error: w.tooLong },
      { status: 413, headers: NO_STORE },
    );
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { error: w.unreadable },
      { status: 400, headers: NO_STORE },
    );
  }
  const input = turnInput.safeParse(body);
  if (!input.success)
    return NextResponse.json(
      { error: w.unreadable },
      { status: 400, headers: NO_STORE },
    );
  const answer = await requesterTurn(account, input.data);
  if ("status" in answer)
    return NextResponse.json(
      { error: answer.error },
      { status: answer.status, headers: NO_STORE },
    );
  return NextResponse.json(answer, { headers: NO_STORE });
}
