import { z } from "zod";
import { getSupabaseAdmin } from "./_lib/supabase";
import { jsonResponse, errorResponse } from "./_lib/responses";
import { corsHeaders, corsPreflightResponse } from "./_lib/cors";
import { resendOrderConfirmationEmail, resendStaffNotificationEmail } from "./_lib/email";

const requestSchema = z.object({
  orderId: z.string().uuid(),
  emailType: z.enum(["customer_confirmation", "staff_notification"]),
});

/**
 * POST { orderId, emailType } -> { ok: true, outcome: "accepted" | "failed" | "error" }
 *
 * Lets staff re-send either the customer confirmation or the internal
 * staff notification from admin-app's Email section — e.g. the customer
 * says it never arrived, or email_logs shows it bounced/was suppressed
 * and they've since given a corrected address on the phone. Same
 * admin/ops role check as admin-refund-order.ts, for the same reason:
 * this uses the service_role key and so bypasses RLS entirely, and
 * re-sending mail to a customer is exactly the kind of side effect that
 * shouldn't be gate-able by whatever admin-app's client code happens to
 * show. finance_readonly is deliberately excluded — see
 * PROJECT_STATUS.md's RLS audit round for why read-only staff must not
 * be able to trigger a send even though the button is hidden for them in
 * admin-app's UI already.
 *
 * Always claims a brand new tracked attempt (see resendOrderConfirmation-
 * Email/resendStaffNotificationEmail's forceNew) — it does not change
 * order state, and works regardless of current status (a staff member
 * re-sending proof of an old order is a legitimate ask even for a
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
    .select(
      "id, recipient_snapshot, delivery_method, subtotal_cents, shipping_fee_cents, total_cents, gst_cents, gst_registered_at_checkout, created_at, paid_at"
    )
    .eq("id", parsed.data.orderId)
    .single();
  if (orderError || !order) return errorResponse(404, "Order not found", undefined, corsHeaders());

  const { data: items } = await supabase
    .from("order_items")
    .select("name_snapshot, qty, line_total_cents")
    .eq("order_id", order.id);

  const result =
    parsed.data.emailType === "customer_confirmation"
      ? await resendOrderConfirmationEmail(order, items ?? [], userData.user.id)
      : await resendStaffNotificationEmail(order, items ?? [], userData.user.id);

  if (!result) {
    // staff_notification with no STAFF_NOTIFICATION_EMAILS configured —
    // nothing to resend to, not a failure of the resend itself.
    return errorResponse(409, "No staff notification address configured", "no_recipient", corsHeaders());
  }

  return jsonResponse(200, { ok: true, outcome: result.outcome }, corsHeaders());
};
