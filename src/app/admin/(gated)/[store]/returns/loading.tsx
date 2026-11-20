import { LoadingWords } from "@/components/admin/loading-words";
import { QueueSkeleton } from "@/components/admin/returns/skeletons";

export default function ReturnsLoading() {
  return <QueueSkeleton label={<LoadingWords of="returns" />} />;
}
