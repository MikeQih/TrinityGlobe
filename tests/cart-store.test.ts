import { describe, it, expect, beforeEach } from "vitest";
import { CartStore, MAX_QTY_PER_ITEM } from "../src/cart-store";

const ITEM_A = { sku: "SKU-A", name: "Whisky A", image: "/a.png", unitPriceCents: 5000 };
const ITEM_B = { sku: "SKU-B", name: "Whisky B", image: "/b.png", unitPriceCents: 3000 };

beforeEach(() => {
  localStorage.clear();
});

describe("CartStore", () => {
  it("starts empty", () => {
    const store = new CartStore();
    expect(store.getItems()).toEqual([]);
    expect(store.getItemCount()).toBe(0);
    expect(store.getSubtotalCents()).toBe(0);
  });

  it("adds a new item", () => {
    const store = new CartStore();
    store.addItem(ITEM_A);
    expect(store.getItems()).toHaveLength(1);
    expect(store.getItems()[0]?.qty).toBe(1);
    expect(store.getSubtotalCents()).toBe(5000);
  });

  it("merges quantity when adding the same sku again instead of duplicating the row", () => {
    const store = new CartStore();
    store.addItem(ITEM_A);
    store.addItem(ITEM_A, 2);
    expect(store.getItems()).toHaveLength(1);
    expect(store.getItems()[0]?.qty).toBe(3);
    expect(store.getSubtotalCents()).toBe(15000);
  });

  it("caps quantity at MAX_QTY_PER_ITEM", () => {
    const store = new CartStore();
    store.addItem(ITEM_A, MAX_QTY_PER_ITEM + 10);
    expect(store.getItems()[0]?.qty).toBe(MAX_QTY_PER_ITEM);

    store.updateQty(ITEM_A.sku, MAX_QTY_PER_ITEM + 50);
    expect(store.getItems()[0]?.qty).toBe(MAX_QTY_PER_ITEM);
  });

  it("ignores a non-positive add quantity", () => {
    const store = new CartStore();
    store.addItem(ITEM_A, 0);
    expect(store.getItems()).toHaveLength(0);
  });

  it("removes the item when updateQty is called with zero or less", () => {
    const store = new CartStore();
    store.addItem(ITEM_A, 2);
    store.updateQty(ITEM_A.sku, 0);
    expect(store.getItems()).toHaveLength(0);
  });

  it("removeItem drops only the targeted sku", () => {
    const store = new CartStore();
    store.addItem(ITEM_A);
    store.addItem(ITEM_B);
    store.removeItem(ITEM_A.sku);
    expect(store.getItems().map((i) => i.sku)).toEqual([ITEM_B.sku]);
  });

  it("clear empties the cart", () => {
    const store = new CartStore();
    store.addItem(ITEM_A);
    store.addItem(ITEM_B);
    store.clear();
    expect(store.getItems()).toEqual([]);
  });

  it("computes subtotal across multiple distinct items and quantities", () => {
    const store = new CartStore();
    store.addItem(ITEM_A, 2); // 2 * 5000 = 10000
    store.addItem(ITEM_B, 3); // 3 * 3000 = 9000
    expect(store.getSubtotalCents()).toBe(19000);
    expect(store.getItemCount()).toBe(5);
  });

  it("notifies subscribers on every mutation", () => {
    const store = new CartStore();
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });
    store.addItem(ITEM_A);
    store.updateQty(ITEM_A.sku, 2);
    store.removeItem(ITEM_A.sku);
    expect(calls).toBe(3);

    unsubscribe();
    store.addItem(ITEM_B);
    expect(calls).toBe(3); // no further notifications after unsubscribe
  });

  it("persists to localStorage and a new instance picks up the saved state", () => {
    const store = new CartStore();
    store.addItem(ITEM_A, 2);

    const reloaded = new CartStore();
    expect(reloaded.getItems()).toHaveLength(1);
    expect(reloaded.getItems()[0]).toMatchObject({ sku: ITEM_A.sku, qty: 2 });
  });

  it("ignores corrupted localStorage content instead of throwing", () => {
    localStorage.setItem("tg_cart_v1", "{not valid json");
    expect(() => new CartStore()).not.toThrow();
    expect(new CartStore().getItems()).toEqual([]);
  });

  it("filters out malformed entries in localStorage but keeps the well-formed ones", () => {
    const validItem = { ...ITEM_A, qty: 2 };
    localStorage.setItem("tg_cart_v1", JSON.stringify([{ sku: "missing-fields" }, validItem]));
    const store = new CartStore();
    expect(store.getItems()).toEqual([validItem]);
  });
});
