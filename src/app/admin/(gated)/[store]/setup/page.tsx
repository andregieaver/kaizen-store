import { redirect } from "next/navigation";

import { firstOpenStep } from "@/lib/setup-steps";
import { requireMemberAny } from "@/server/permissions";
import { getSetupProgress } from "@/server/setup";

/** Resumes setup at the first of the store's steps (they follow its features, D178 step 6) that is not done yet. */
export default async function SetupStart({ params }: PageProps<"/admin/[store]/setup">) {
  const { store } = await requireMemberAny((await params).store);
  const progress = await getSetupProgress(store);
  redirect(`/admin/${store.slug}/setup/${firstOpenStep(store, progress)}`);
}
