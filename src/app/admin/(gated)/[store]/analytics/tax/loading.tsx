import { TaxSkeleton } from "@/components/admin/analytics/tax-skeletons";
import { LoadingWords } from "@/components/admin/loading-words";

/** What the VAT, OSS and IOSS page shows while its figures are read: the route has no words of its own, so both lines come from the shell. */
export default function AnalyticsTaxLoading() {
  const loading = <LoadingWords of="vatReport" />;
  const statement = <LoadingWords of="vatReportStatement" />;
  return <TaxSkeleton words={{ loading, statement }} />;
}
