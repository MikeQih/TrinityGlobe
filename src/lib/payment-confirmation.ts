// Extracted from src/cart.ts's handleConfirmPayment so the race/timeout
// logic can be unit-tested without a real Stripe SDK, DOM, or timers — see
// tests/payment-confirmation.test.ts.
//
// Why this exists: Stripe's Payment Element `actions.confirm()` call can, in
// at least one observed case (the official 3D Secure test card, reproduced
// twice against a real Chrome browser — not just headless automation),
// simply never resolve or reject even though the underlying Checkout
// Session genuinely completes and gets marked paid on Stripe's own side
// moments later. A customer stuck on "PROCESSING…" forever after actually
// paying is the worst possible outcome — they can't tell whether to wait,
// retry (risking Stripe rejecting a duplicate confirm attempt on an
// already-processing PaymentIntent, or just confusing them further), or
// give up. Racing `confirm()` against a bounded poll of the Checkout
// Session's own status (via get-checkout-session-status.ts, which reads
// Stripe directly — never our own DB, so it doesn't depend on the webhook
// having run yet either) means the customer sees "paid" as soon as Stripe
// itself reports it, independent of whether `confirm()` ever settles.

export type ConfirmResult = { type: "success" } | { type: "error"; error: { message: string } };
export type ConfirmWithFallbackResult = ConfirmResult | { type: "uncertain" };

export interface ConfirmWithFallbackParams {
  /** Stripe's own `actions.confirm(...)` call — may never settle. */
  confirm: () => Promise<ConfirmResult>;
  /** Polls the *Checkout Session's* own status — true once Stripe reports it paid. */
  checkPaid: () => Promise<boolean>;
  pollIntervalMs: number;
  /** How long to keep showing "processing" before switching to the reassurance UI. */
  uncertainAfterMs: number;
  /** Total time to keep racing/polling before giving up for good. */
  giveUpAfterMs: number;
  /** Fired once, the moment `uncertainAfterMs` elapses with nothing resolved yet. */
  onUncertain?: () => void;
  /** Injectable for tests — real callers get the default `setTimeout`-based sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable for tests — real callers get the default `Date.now`. */
  now?: () => number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Races `confirm()` against a bounded `checkPaid()` poll.
 *
 * - `confirm()` resolving (success or error) first wins outright — this is
 *   the normal path (e.g. a card with no 3DS challenge) and behaves exactly
 *   as a bare `await confirm()` would.
 * - `checkPaid()` reporting `true` first also resolves as `{type:"success"}`
 *   — `confirm()` is left to settle in the background and is never awaited
 *   again by the caller.
 * - If neither happens before `giveUpAfterMs`, resolves `{type:"uncertain"}`
 *   — the caller should stop presenting this as still "processing" and
 *   switch to a reassurance message instead of an error, since the payment
 *   may well have actually succeeded.
 */
export async function confirmPaymentWithStatusFallback(
  params: ConfirmWithFallbackParams
): Promise<ConfirmWithFallbackResult> {
  const sleep = params.sleep ?? defaultSleep;
  const now = params.now ?? Date.now;
  const startedAt = now();
  let settled = false;
  let uncertainFired = false;

  const confirmRace = params.confirm().then((result) => {
    settled = true;
    return { source: "confirm" as const, result };
  });

  const pollRace = (async (): Promise<{ source: "poll"; paid: boolean }> => {
    while (!settled && now() - startedAt < params.giveUpAfterMs) {
      await sleep(params.pollIntervalMs);
      if (settled) break;

      if (!uncertainFired && now() - startedAt >= params.uncertainAfterMs) {
        uncertainFired = true;
        params.onUncertain?.();
      }

      try {
        if (await params.checkPaid()) {
          settled = true;
          return { source: "poll", paid: true };
        }
      } catch {
        // Transient network/API hiccup — keep polling until giveUpAfterMs,
        // same as if this one check had simply reported "not paid yet".
      }
    }
    return { source: "poll", paid: false };
  })();

  const winner = await Promise.race([confirmRace, pollRace]);
  settled = true;

  if (winner.source === "poll") {
    return winner.paid ? { type: "success" } : { type: "uncertain" };
  }
  return winner.result;
}
