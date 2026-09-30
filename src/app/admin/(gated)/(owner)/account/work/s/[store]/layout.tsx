import { requireMember } from "@/server/auth";

/**
 * One store's Work screens (D123). The shell (sub-navigation, running timer) is
 * the parent layout's; this only refuses a store the account is not a member of
 * before its pages start. Every page and action still checks for itself.
 */
export default async function WorkStoreLayout({ children, params }: LayoutProps<"/admin/account/work/s/[store]">) {
  await requireMember((await params).store);
  return children;
}
