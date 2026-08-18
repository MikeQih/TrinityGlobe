import { z } from "zod";

export const skuSchema = z.string().min(1).max(64);

export const productsLiveRequestSchema = z.object({
  skus: z.array(skuSchema).min(1).max(50),
});

export const deliveryMethodSchema = z.enum(["standard", "self_collection"]);

export const recipientSchema = z.object({
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(1).max(40),
  email: z.string().trim().email(),
  address: z.string().trim().max(500),
  postalCode: z.string().trim().max(20),
  notes: z.string().trim().max(1000),
});

export const cartItemSchema = z.object({
  sku: skuSchema,
  qty: z.number().int().min(1).max(24),
});

// Server-side mirror of src/cart.ts#validateRecipient: the client already
// enforces this, but a request can always bypass the browser, so the age
// gate and delivery-method-dependent address requirement are re-checked here.
export const createCheckoutSessionRequestSchema = z
  .object({
    items: z.array(cartItemSchema).min(1).max(30),
    deliveryMethod: deliveryMethodSchema,
    recipient: recipientSchema,
    ageConfirmed: z.literal(true),
  })
  .superRefine((data, ctx) => {
    if (data.deliveryMethod === "standard") {
      if (!data.recipient.address) {
        ctx.addIssue({ code: "custom", path: ["recipient", "address"], message: "address required for standard delivery" });
      }
      if (!data.recipient.postalCode) {
        ctx.addIssue({ code: "custom", path: ["recipient", "postalCode"], message: "postalCode required for standard delivery" });
      }
    }
  });

export type CreateCheckoutSessionRequest = z.infer<typeof createCheckoutSessionRequestSchema>;

export const adminRefundRequestSchema = z.object({
  orderId: z.string().uuid(),
  // Omitted = full refund of whatever hasn't already been refunded.
  amountCents: z.number().int().positive().optional(),
});
