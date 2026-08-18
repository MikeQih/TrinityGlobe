import type {
  CreateCheckoutSessionRequest,
  CreateCheckoutSessionResponse,
  LiveProductInfo,
} from "./types";

const FUNCTIONS_BASE = "/.netlify/functions";

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function parseJsonOrThrow(res: Response): Promise<unknown> {
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined; // non-JSON error body (e.g. a Netlify 502 HTML page)
  }

  if (!res.ok) {
    const errorBody = body as { error?: string; code?: string } | undefined;
    throw new ApiError(
      errorBody?.error ?? `Request failed with status ${res.status}`,
      res.status,
      errorBody?.code
    );
  }

  return body;
}

/** Batch-fetches authoritative live price + stock for the given SKUs. */
export async function fetchLivePrices(skus: string[]): Promise<LiveProductInfo[]> {
  if (skus.length === 0) return [];
  const res = await fetch(`${FUNCTIONS_BASE}/products-live`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ skus }),
  });
  const body = (await parseJsonOrThrow(res)) as { products: LiveProductInfo[] };
  return body.products;
}

/**
 * Creates a Pending Payment order + reserves stock + returns a Stripe
 * Checkout URL to redirect the customer to. All pricing is recomputed
 * server-side from `items` (sku + qty only) — nothing the client sends is
 * trusted as a price.
 */
export async function createCheckoutSession(
  payload: CreateCheckoutSessionRequest
): Promise<CreateCheckoutSessionResponse> {
  const res = await fetch(`${FUNCTIONS_BASE}/create-checkout-session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return (await parseJsonOrThrow(res)) as CreateCheckoutSessionResponse;
}
