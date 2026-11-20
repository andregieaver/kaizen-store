import { InvoicesSkeleton } from "@/components/admin/invoices/skeletons";
import { LoadingWords } from "@/components/admin/loading-words";

export default function InvoicesLoading() {
  return <InvoicesSkeleton label={<LoadingWords of="invoices" />} />;
}
