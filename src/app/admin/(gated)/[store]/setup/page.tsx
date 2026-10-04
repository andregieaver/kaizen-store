import { redirect } from "next/navigation";

import { requireMemberAny } from "@/server/permissions";
import { getSetupProgress, SETUP_STEPS } from "@/server/setup";

/** Resumes setup at the first step that is not done yet. */
export default async function SetupStart({ params }: PageProps<"/admin/[store]/setup">) {
  const { store } = await requireMemberAny((await params).store);
  const progress = await getSetupProgress(store);
  const first = SETUP_STEPS.find((step) => step.id !== "launch" && !progress[step.id]);
  redirect(`/admin/${store.slug}/setup/${first?.id ?? "launch"}`);
}
