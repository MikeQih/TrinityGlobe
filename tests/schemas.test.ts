import { describe, it, expect } from "vitest";
import {
  createCheckoutSessionRequestSchema,
  productsLiveRequestSchema,
  adminRefundRequestSchema,
} from "../netlify/functions/_lib/schemas";

const validRecipient = {
  name: "Alice Tan",
  phone: "91234567",
  email: "alice@example.com",
  address: "1 Orchard Road",
  postalCode: "238801",
  notes: "",
};

const baseRequest = {
  items: [{ sku: "SKU-A", qty: 1 }],
  deliveryMethod: "standard" as const,
  recipient: validRecipient,
  ageConfirmed: true as const,
};

describe("createCheckoutSessionRequestSchema", () => {
  it("accepts a well-formed standard-delivery request", () => {
    expect(createCheckoutSessionRequestSchema.safeParse(baseRequest).success).toBe(true);
  });

  it("accepts self_collection with a blank address/postalCode", () => {
    const result = createCheckoutSessionRequestSchema.safeParse({
      ...baseRequest,
      deliveryMethod: "self_collection",
      recipient: { ...validRecipient, address: "", postalCode: "" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects standard delivery with a blank address", () => {
    const result = createCheckoutSessionRequestSchema.safeParse({
      ...baseRequest,
      recipient: { ...validRecipient, address: "" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects standard delivery with a blank postal code", () => {
    const result = createCheckoutSessionRequestSchema.safeParse({
      ...baseRequest,
      recipient: { ...validRecipient, postalCode: "" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects ageConfirmed: false — the age gate is enforced server-side too, not just in the browser", () => {
    const result = createCheckoutSessionRequestSchema.safeParse({ ...baseRequest, ageConfirmed: false });
    expect(result.success).toBe(false);
  });

  it("rejects a missing ageConfirmed field", () => {
    const { ageConfirmed: _drop, ...rest } = baseRequest;
    const result = createCheckoutSessionRequestSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects an empty items array", () => {
    const result = createCheckoutSessionRequestSchema.safeParse({ ...baseRequest, items: [] });
    expect(result.success).toBe(false);
  });

  it("rejects a quantity above the per-item cap", () => {
    const result = createCheckoutSessionRequestSchema.safeParse({
      ...baseRequest,
      items: [{ sku: "SKU-A", qty: 25 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer quantity", () => {
    const result = createCheckoutSessionRequestSchema.safeParse({
      ...baseRequest,
      items: [{ sku: "SKU-A", qty: 1.5 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid email", () => {
    const result = createCheckoutSessionRequestSchema.safeParse({
      ...baseRequest,
      recipient: { ...validRecipient, email: "not-an-email" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid deliveryMethod value", () => {
    const result = createCheckoutSessionRequestSchema.safeParse({ ...baseRequest, deliveryMethod: "teleport" });
    expect(result.success).toBe(false);
  });
});

describe("productsLiveRequestSchema", () => {
  it("accepts a non-empty sku list", () => {
    expect(productsLiveRequestSchema.safeParse({ skus: ["SKU-A", "SKU-B"] }).success).toBe(true);
  });

  it("rejects an empty sku list", () => {
    expect(productsLiveRequestSchema.safeParse({ skus: [] }).success).toBe(false);
  });

  it("rejects more than 50 skus in one request", () => {
    const skus = Array.from({ length: 51 }, (_, i) => `SKU-${i}`);
    expect(productsLiveRequestSchema.safeParse({ skus }).success).toBe(false);
  });
});

describe("adminRefundRequestSchema", () => {
  it("accepts a full-refund request with no amountCents", () => {
    expect(adminRefundRequestSchema.safeParse({ orderId: "3fa85f64-5717-4562-b3fc-2c963f66afa6" }).success).toBe(
      true
    );
  });

  it("accepts a partial-refund request with a positive amountCents", () => {
    expect(
      adminRefundRequestSchema.safeParse({ orderId: "3fa85f64-5717-4562-b3fc-2c963f66afa6", amountCents: 500 })
        .success
    ).toBe(true);
  });

  it("rejects a non-uuid orderId", () => {
    expect(adminRefundRequestSchema.safeParse({ orderId: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects a zero or negative amountCents", () => {
    expect(
      adminRefundRequestSchema.safeParse({ orderId: "3fa85f64-5717-4562-b3fc-2c963f66afa6", amountCents: 0 }).success
    ).toBe(false);
  });
});
