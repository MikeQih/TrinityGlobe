import type { CartItem, CartItemPriceTiers } from "./types";
import { effectiveUnitPriceCents } from "./pricing";

const STORAGE_KEY = "tg_cart_v1";

// High enough for a genuine wholesale order (a customer typing a qty of a
// few hundred into the cart's qty input, see src/cart.ts) while still
// guarding against a wildly fat-fingered value colliding with the server's
// reservation TTL logic in unexpected ways.
export const MAX_QTY_PER_ITEM = 999;

type Listener = () => void;

/**
 * Client-side cart state, persisted to localStorage. Prices stored here are
 * an optimistic snapshot only (for instant UI feedback) — the server always
 * recomputes authoritative price + stock at checkout time, see
 * src/api-client.ts#createCheckoutSession.
 */
export class CartStore {
  private items: CartItem[] = [];
  private listeners: Listener[] = [];

  constructor() {
    this.items = loadFromStorage();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private emit(): void {
    saveToStorage(this.items);
    for (const listener of this.listeners) listener();
  }

  getItems(): readonly CartItem[] {
    return this.items;
  }

  getItemCount(): number {
    return this.items.reduce((sum, i) => sum + i.qty, 0);
  }

  getSubtotalCents(): number {
    return this.items.reduce((sum, i) => sum + effectiveUnitPriceCents(i.qty, i.priceTiers) * i.qty, 0);
  }

  addItem(item: Omit<CartItem, "qty">, qty = 1): void {
    if (qty <= 0) return;
    const existing = this.items.find((i) => i.sku === item.sku);
    if (existing) {
      existing.qty = Math.min(MAX_QTY_PER_ITEM, existing.qty + qty);
    } else {
      this.items.push({ ...item, qty: Math.min(MAX_QTY_PER_ITEM, qty) });
    }
    this.emit();
  }

  updateQty(sku: string, qty: number): void {
    const existing = this.items.find((i) => i.sku === sku);
    if (!existing) return;
    if (qty <= 0) {
      this.removeItem(sku);
      return;
    }
    existing.qty = Math.min(MAX_QTY_PER_ITEM, qty);
    this.emit();
  }

  /**
   * Refreshes a line's price ladder against the currently-loaded catalog
   * (see src/cart.ts#reconcilePriceTiers). A cart persists in localStorage
   * across page loads with whatever price tiers were live when each item
   * was added — without this, a bottle added before a case price/size was
   * configured would keep quoting bottle price forever, even after enough
   * of it sits in the cart to qualify for a case discount. No-ops (and
   * doesn't notify subscribers) if nothing actually changed.
   */
  updatePriceTiers(sku: string, priceTiers: CartItemPriceTiers): void {
    const existing = this.items.find((i) => i.sku === sku);
    if (!existing || JSON.stringify(existing.priceTiers) === JSON.stringify(priceTiers)) return;
    existing.priceTiers = priceTiers;
    this.emit();
  }

  removeItem(sku: string): void {
    const before = this.items.length;
    this.items = this.items.filter((i) => i.sku !== sku);
    if (this.items.length !== before) this.emit();
  }

  clear(): void {
    this.items = [];
    this.emit();
  }
}

function loadFromStorage(): CartItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidCartItem);
  } catch {
    return []; // corrupted/blocked storage — start with an empty cart rather than throwing
  }
}

function saveToStorage(items: CartItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Storage full or blocked (private browsing) — cart still works for
    // this page load, it just won't survive a refresh.
  }
}

function isValidCartItem(value: unknown): value is CartItem {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const tiers = v.priceTiers as Record<string, unknown> | undefined;
  return (
    typeof v.sku === "string" &&
    typeof v.name === "string" &&
    typeof v.image === "string" &&
    typeof tiers === "object" &&
    tiers !== null &&
    typeof tiers.bottlePriceCents === "number" &&
    typeof v.qty === "number" &&
    v.qty > 0
  );
}
