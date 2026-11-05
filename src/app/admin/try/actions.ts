"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { SANDBOX_PATH, sandboxHome } from "@/lib/sandbox";
import { budgetVisitor } from "@/server/request-budget";
import { currentSandbox, passCookie, sandboxStartPath, startSandbox } from "@/server/sandbox";

/**
 * *Start building* (D457): a press makes a sandbox and hands this browser its pass, then opens its front page in the builder (S4); a browser
 * whose sandbox is still open goes back to it instead of making another. From *Try it with this theme* the form names the theme's demo store
 * (`demo`), used only when it is a free theme's (`sandboxDemo()`). A refusal comes back to the start screen as its reason (`?problem=`),
 * never as a store.
 */
export async function startSandboxAction(formData: FormData): Promise<void> {
  const current = await currentSandbox();
  if (current) redirect(sandboxHome(current.id));
  const demo = formData.get("demo");
  const started = await startSandbox(budgetVisitor(await headers()), typeof demo === "string" ? demo : null);
  if (!started.ok) redirect(`${SANDBOX_PATH}?problem=${started.problem}`);
  (await cookies()).set(passCookie(started.pass));
  redirect(await sandboxStartPath(started.id));
}
