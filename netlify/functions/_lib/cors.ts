/**
 * The admin app is deployed as its own site (see admin-app/vite.config.ts),
 * a different origin from wherever this Function lives, so its browser
 * requests need explicit CORS headers. Set ADMIN_APP_ORIGIN once the admin
 * app's real URL is known (e.g. https://admin.trinityglobe.sg); until then
 * this quietly allows no cross-origin caller, which just means the admin
 * app can't reach this endpoint yet — not a security gap.
 */
export function corsHeaders(): Record<string, string> {
  const origin = process.env.ADMIN_APP_ORIGIN;
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization",
  };
}

export function corsPreflightResponse(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
