import type { Metadata } from "next";

import { StoreEditPageView } from "../../../pages/views";

export const metadata: Metadata = { title: "Edit version" };

/** A version of a page made for an A/B test (D148), edited in the page builder like the page. */
export default function Page({ params, searchParams }: PageProps<"/admin/[store]/experiments/variants/[pageId]">) {
  return <StoreEditPageView type="variant" params={params} searchParams={searchParams} />;
}
