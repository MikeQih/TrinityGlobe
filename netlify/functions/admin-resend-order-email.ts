import { z } from "zod";
import { getSupabaseAdmin } from "./_lib/supabase";
import { jsonResponse, errorResponse } from "./_lib/responses";
import { corsHeaders, corsPreflightResponse } from "./_lib/cors";
import { sendOrderConfirmationEmail } from "./_lib/email";

const requestSchema = z.object({ orderId: z.string().uuid() });

/**
 * POST { orderId } -> { ok: true }
 *
 * Lets staff re-send the order confirmation email from admin-app — e.g. the
 * customer says it never arrived, or it bounced and they've since given a
 * corrected address on the phone. Same admin/ops role check as
 * admin-refund-order.ts, for the same reason: this uses the service_role
 * key and so bypasses RLS entirely, and re-sending mail to a customer is
 * exactly the kind of side effect that shouldn't be gate-able by whatever
 * admin-app's client code happens to show.
 *
 * Deliberately just re-sends the existing confirmation template — it does
 * not change order state, and works regardless of current status (a staff
 * member re-sending proof of an old order is a legitimate ask even for a
 * completed or refunded one).
 */
export default async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return corsPreflightResponse();
  if (req.method !== "POST") return errorResponse(405, "Method not allowed", undefined, corsHeaders());

  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return errorResponse(401, "Missing authorization", undefined, corsHeaders());

  const supabase = getSupabaseAdmin();

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) {
    return errorResponse(401, "Invalid session", undefined, corsHeaders());
  }

  const { data: profile } = await supabase
    .from("admin_profiles")
    .select("role")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (!profile || (profile.role !== "admin" && profile.role !== "ops")) {
    return errorResponse(403, "Not authorized to resend order emails", undefined, corsHeaders());
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "Invalid JSON body", undefined, corsHeaders());
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return errorResponse(400, "Invalid request", "validation_error", corsHeaders());

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, recipient_snapshot, delivery_method, subtotal_cents, shipping_fee_cents, total_cents, gst_cents, gst_registered_at_checkout")
    .eq("id", parsed.data.orderId)
    .single();
  if (orderError || !order) return errorResponse(404, "Order not found", undefined, corsHeaders());

  const { data: items } = await supabase
    .from("order_items")
    .select("name_snapshot, qty, line_total_cents")
    .eq("order_id", order.id);

  await sendOrderConfirmationEmail(order, items ?? []);

  return jsonResponse(200, { ok: true }, corsHeaders());
};
