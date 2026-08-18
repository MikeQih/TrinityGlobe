export function jsonResponse(status: number, body: unknown, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}

/** Shape consumed by src/api-client.ts#ApiError on the storefront. */
export function errorResponse(status: number, error: string, code?: string, extraHeaders?: Record<string, string>): Response {
  return jsonResponse(status, { error, code }, extraHeaders);
}
