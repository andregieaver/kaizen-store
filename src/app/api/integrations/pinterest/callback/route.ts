import { PINTEREST_CONNECTION } from "@/server/pinterest";
import { connectionCallback } from "@/server/social-connect-routes";

/** Back from Pinterest's sign-in with what the owner shared (D870 S3.4), to the store's Social posts. */
export function GET(request: Request) {
  return connectionCallback(PINTEREST_CONNECTION, request);
}
