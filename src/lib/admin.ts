// Guards the dashboard's demo buttons (reset, backup dispatch).
import type { NextRequest } from "next/server";

/** True if the request carries DASHBOARD_ADMIN_KEY (header x-admin-key or ?key=). Open in dev when no key is set. */
export function isAdmin(req: NextRequest): boolean {
  const key = process.env.DASHBOARD_ADMIN_KEY;
  if (!key) return process.env.NODE_ENV !== "production";
  return req.headers.get("x-admin-key") === key || req.nextUrl.searchParams.get("key") === key;
}
