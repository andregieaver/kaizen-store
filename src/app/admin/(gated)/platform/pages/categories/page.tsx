import type { Metadata } from "next";

import { PageTermsView } from "../views";

export const metadata: Metadata = { title: "Page categories and tags" };

export default function Page() {
  return <PageTermsView type="page" />;
}
