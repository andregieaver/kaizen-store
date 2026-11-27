import { LINKEDIN_CONNECTION } from "@/server/linkedin";
import { connectionCallback } from "@/server/social-connect-routes";

/** Back from LinkedIn's sign-in (D870 S3.6), to the store's Social posts. */
export function GET(request: Request) {
  return connectionCallback(LINKEDIN_CONNECTION, request);
}
