import { redirect } from "next/navigation";

/** A version has no list of its own: the tests are listed. */
export default async function Page({ params }: PageProps<"/admin/[store]/experiments/variants">) {
  redirect(`/admin/${(await params).store}/experiments`);
}
