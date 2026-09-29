import { WorkShell } from "@/components/admin/work/work-shell";
import { requireMember } from "@/server/auth";

/**
 * Work's pages share the person's running timer (`WorkShell`): a bar at the top
 * of each, and the estimate warnings, while the page is open. Every page and
 * action still checks for itself; this only reads the timer.
 */
export default async function WorkLayout({ children, params }: LayoutProps<"/admin/[store]/work">) {
  const member = await requireMember((await params).store);
  return <WorkShell member={member}>{children}</WorkShell>;
}
