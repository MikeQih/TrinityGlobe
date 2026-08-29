import { describe, it, expect, vi } from "vitest";
import { confirmPaymentWithStatusFallback } from "../src/lib/payment-confirmation";

// An injectable sleep that resolves immediately but still lets pending
// microtasks/other promises interleave — keeps these tests fast (no real
// setTimeout waits) while still exercising the actual race/polling logic.
const instantSleep = () => Promise.resolve();

function neverResolves<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

describe("confirmPaymentWithStatusFallback", () => {
  it("resolves success immediately when confirm() itself succeeds quickly — the normal path (e.g. 4242, no 3DS challenge)", async () => {
    const checkPaid = vi.fn();
    const result = await confirmPaymentWithStatusFallback({
      confirm: () => Promise.resolve({ type: "success" }),
      checkPaid,
      pollIntervalMs: 10,
      uncertainAfterMs: 1000,
      giveUpAfterMs: 5000,
      sleep: instantSleep,
    });

    expect(result).toEqual({ type: "success" });
    expect(checkPaid).not.toHaveBeenCalled();
  });

  it("surfaces confirm()'s error when confirm() rejects/errors before the status poll ever finds it paid", async () => {
    const result = await confirmPaymentWithStatusFallback({
      confirm: () => Promise.resolve({ type: "error", error: { message: "Your card was declined." } }),
      checkPaid: () => Promise.resolve(false),
      pollIntervalMs: 10,
      uncertainAfterMs: 1000,
      giveUpAfterMs: 5000,
      sleep: instantSleep,
    });

    expect(result).toEqual({ type: "error", error: { message: "Your card was declined." } });
  });

  it("3DS succeeds on Stripe's side but confirm() never resolves — the status poll catches it and reports success", async () => {
    let pollCount = 0;
    const onUncertain = vi.fn();

    const result = await confirmPaymentWithStatusFallback({
      confirm: neverResolves,
      checkPaid: () => {
        pollCount += 1;
        return Promise.resolve(pollCount >= 3); // "paid" on the 3rd poll
      },
      pollIntervalMs: 10,
      uncertainAfterMs: 1000, // high enough that this resolves before onUncertain would fire
      giveUpAfterMs: 5000,
      sleep: instantSleep,
    });

    expect(result).toEqual({ type: "success" });
    expect(onUncertain).not.toHaveBeenCalled();
  });

  it("fires onUncertain exactly once, then still recovers to success once the status poll reports paid — the customer sees PROCESSING switch to reassurance, then to success", async () => {
    // Fake clock so uncertainAfterMs/giveUpAfterMs are crossed deterministically, with no real waits.
    let clock = 0;
    const fakeNow = () => clock;
    const fakeSleep = (ms: number) => {
      clock += ms;
      return Promise.resolve();
    };
    const onUncertain = vi.fn();
    let pollCount = 0;

    const result = await confirmPaymentWithStatusFallback({
      confirm: neverResolves,
      checkPaid: () => {
        pollCount += 1;
        return Promise.resolve(pollCount >= 10); // "paid" well after uncertainAfterMs has elapsed
      },
      pollIntervalMs: 1000,
      uncertainAfterMs: 3000,
      giveUpAfterMs: 60000,
      onUncertain,
      sleep: fakeSleep,
      now: fakeNow,
    });

    expect(onUncertain).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ type: "success" });
    expect(clock).toBeGreaterThanOrEqual(3000);
  });

  it("gives up as 'uncertain' — never 'error' and never leaves the caller stuck — when neither confirm() nor the status poll ever resolves", async () => {
    const onUncertain = vi.fn();
    let clock = 0;
    const fakeNow = () => clock;
    const fakeSleep = (ms: number) => {
      clock += ms;
      return Promise.resolve();
    };

    const result = await confirmPaymentWithStatusFallback({
      confirm: neverResolves,
      checkPaid: () => Promise.resolve(false),
      pollIntervalMs: 1000,
      uncertainAfterMs: 2000,
      giveUpAfterMs: 5000,
      onUncertain,
      sleep: fakeSleep,
      now: fakeNow,
    });

    expect(result).toEqual({ type: "uncertain" });
    expect(onUncertain).toHaveBeenCalledTimes(1);
    expect(clock).toBeGreaterThanOrEqual(5000);
  });

  it("keeps polling through transient checkPaid() errors instead of giving up immediately", async () => {
    let calls = 0;
    const result = await confirmPaymentWithStatusFallback({
      confirm: neverResolves,
      checkPaid: () => {
        calls += 1;
        if (calls < 3) return Promise.reject(new Error("network blip"));
        return Promise.resolve(true);
      },
      pollIntervalMs: 10,
      uncertainAfterMs: 1000,
      giveUpAfterMs: 5000,
      sleep: instantSleep,
    });

    expect(result).toEqual({ type: "success" });
    expect(calls).toBe(3);
  });
});
