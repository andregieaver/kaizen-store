import { connectionCallback } from "@/server/social-connect-routes";
import { TIKTOK_CONNECTION } from "@/server/tiktok";

/** Back from TikTok's sign-in with the account the owner connected (D870 S3.5), to the store's Social posts. */
export function GET(request: Request) {
  return connectionCallback(TIKTOK_CONNECTION, request);
}
