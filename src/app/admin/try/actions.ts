"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { SANDBOX_PATH, sandboxHome } from "@/lib/sandbox";
import { budgetVisitor } from "@/server/request-budget";
import { currentSandbox, passCookie, startSandbox } from "@/server/sandbox";

/**
 * *Start building* (D456): a press makes a sandbox and hands this browser its pass, then opens it; a browser whose sandbox is still open goes
 * back to it instead of making another. A refusal comes back to the start screen as its reason (`?problem=`), never as a store.
 */
export async function startSandboxAction(): Promise<void> {
  const current = await currentSandbox();
  if (current) redirect(sandboxHome(current.id));
  const started = await startSandbox(budgetVisitor(await headers()));
  if (!started.ok) redirect(`${SANDBOX_PATH}?problem=${started.problem}`);
  (await cookies()).set(passCookie(started.pass));
  redirect(sandboxHome(started.id));
}
