import { pluginPreflight, startSignInRequest } from "@/server/plugin-route";

/** A design tool's app asks to sign in to a store (D898 F1). */
export const POST = (request: Request) => startSignInRequest(request);
export const OPTIONS = () => pluginPreflight();
