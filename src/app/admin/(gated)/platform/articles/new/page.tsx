import type { Metadata } from "next";

import { NewPageView } from "../../pages/views";

export const metadata: Metadata = { title: "New article" };

export default function Page() {
  return <NewPageView type="article" />;
}
