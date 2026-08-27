import { Webhook } from "svix";
import { getSupabaseAdmin } from "./_lib/supabase";
import { requireEnv } from "./_lib/env";
import { errorResponse, jsonResponse } from "./_lib/responses";

interface ResendWebhookEvent {
  type: string;
  created_at: string;
  data: {
    email_id?: string;
    bounce?: { type?: string; message?: string };
    failed?: { reason?: string };
    suppression?: { reason?: string };
    [key: string]: unknown;
  };
}

// Exactly the six events the ledger cares about (see
// 0019_email_delivery_tracking.sql's status check constraint and
// apply_email_webhook_event's rank table) — anything else Resend might
// send (email.opened, email.clicked, email.complained, ...) is outside
// what this ledger was built to answer and is deliberately left alone.
const EVENT_TYPE_TO_STATUS: Record<string, string> = {
  "email.sent": "accepted",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delayed",
  "email.failed": "failed",
  "email.bounced": "bounced",
  "email.suppressed": "suppressed",
};

function extractFailureReason(event: ResendWebhookEvent): string | null {
  const { bounce, failed, suppression } = event.data;
  if (bounce?.message) return `${bounce.type ?? "bounce"}: ${bounce.message}`;
  if (failed?.reason) return failed.reason;
  if (suppression?.reason) return suppression.reason;
  return null;
}

/**
 * Resend webhook endpoint. Signed with Svix (see
 * https://resend.com/docs/webhooks/verify-webhooks-requests) — every
 * request's signature is verified before any of its content is trusted,
 * exactly like stripe-webhook.ts verifies Stripe's signature before acting
 * on anything in the body. An unsigned or wrongly-signed request is
 * rejected outright; nothing here ever updates email_logs based on a
 * request whose signature didn't check out.
 *
 * Idempotent by construction the same way stripe-webhook.ts is: each
 * event's Svix message id (`svix-id`) is recorded in
 * resend_webhook_events *after* it's successfully handled, so a
 * redelivery of an already-processed event is a no-op, and a failure
 * partway through leaves it unrecorded so Resend's own retry gets another
 * chance. apply_email_webhook_event is additionally idempotent on its own
 * terms (a status can only move forward, never backward — see its
 * comment), so even an undetected duplicate delivery can't do anything
 * worse than a redundant no-op update.
 */
export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return errorResponse(405, "Method not allowed");

  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) {
    return errorResponse(400, "Missing svix signature headers");
  }

  const payload = await req.text();

  let event: ResendWebhookEvent;
  try {
    const wh = new Webhook(requireEnv("RESEND_WEBHOOK_SECRET"));
    event = wh.verify(payload, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ResendWebhookEvent;
  } catch (err) {
    console.error("resend-webhook: signature verification failed", err);
    return errorResponse(400, "Invalid signature");
  }

  const supabase = getSupabaseAdmin();

  const { data: existing } = await supabase
    .from("resend_webhook_events")
    .select("webhook_event_id")
    .eq("webhook_event_id", svixId)
    .maybeSingle();
  if (existing) {
    return jsonResponse(200, { received: true, deduped: true });
  }

  try {
    const status = EVENT_TYPE_TO_STATUS[event.type];
    if (status) {
      const emailId = event.data.email_id;
      if (!emailId) {
        console.error("resend-webhook: event missing data.email_id", event.type);
      } else {
        const { error } = await supabase.rpc("apply_email_webhook_event", {
          p_resend_email_id: emailId,
          p_status: status,
          p_failure_reason: extractFailureReason(event),
        });
        if (error) throw error;
      }
    }
  } catch (err) {
    console.error("resend-webhook: handler failed for event", event.type, svixId, err);
    return errorResponse(500, "Webhook handling failed");
  }

  const { error: recordError } = await supabase
    .from("resend_webhook_events")
    .insert({ webhook_event_id: svixId, event_type: event.type });
  if (recordError) {
    // Handling already succeeded above; failing to record the dedup row
    // just means a redelivery would re-run handling (safe, since
    // apply_email_webhook_event is itself idempotent — see its comment).
    console.error("resend-webhook: failed to record resend_webhook_events row", svixId, recordError);
  }

  return jsonResponse(200, { received: true });
};
