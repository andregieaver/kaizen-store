import type { Metadata } from "next";

import { NewPageView } from "../../pages/views";

export const metadata: Metadata = { title: "New footer" };

export default function Page() {
  return <NewPageView type="footer" />;
}
