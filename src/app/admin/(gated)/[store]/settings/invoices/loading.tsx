import { InvoiceSettingsSkeleton } from "@/components/admin/invoices/skeletons";
import { LoadingWords } from "@/components/admin/loading-words";

export default function InvoiceSettingsLoading() {
  return <InvoiceSettingsSkeleton label={<LoadingWords of="invoiceSettings" />} />;
}
