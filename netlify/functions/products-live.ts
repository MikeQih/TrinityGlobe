import { getSupabaseAdmin } from "./_lib/supabase";
import { jsonResponse, errorResponse } from "./_lib/responses";
import { productsLiveRequestSchema } from "./_lib/schemas";

/**
 * POST { skus: string[] } -> { products: LiveProductInfo[] }
 *
 * Authoritative price + real-time available stock for the given SKUs,
 * called by the storefront cart before checkout so displayed prices never
 * silently drift from what create-checkout-session will actually charge.
 * SKUs not found in product_variants are simply omitted from the response
 * (the caller treats a missing SKU as unavailable).
 */
export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return errorResponse(405, "Method not allowed");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "Invalid JSON body");
  }

  const parsed = productsLiveRequestSchema.safeParse(body);
  if (!parsed.success) return errorResponse(400, "Invalid request", "validation_error");

  const supabase = getSupabaseAdmin();
  const { skus } = parsed.data;

  const { data: variants, error: variantsError } = await supabase
    .from("product_variants")
    .select("sku, unit_price_cents, is_active")
    .in("sku", skus);

  if (variantsError) {
    console.error("products-live: failed to load product_variants", variantsError);
    return errorResponse(500, "Failed to load product data");
  }

  const products = await Promise.all(
    (variants ?? []).map(async (v) => {
      const { data: stock, error: stockError } = await supabase.rpc("get_available_stock", { p_sku: v.sku });
      if (stockError) {
        console.error("products-live: get_available_stock failed", v.sku, stockError);
      }
      return {
        sku: v.sku as string,
        unitPriceCents: v.unit_price_cents as number,
        availableStock: typeof stock === "number" ? stock : 0,
        isActive: v.is_active as boolean,
      };
    })
  );

  return jsonResponse(200, { products });
};
