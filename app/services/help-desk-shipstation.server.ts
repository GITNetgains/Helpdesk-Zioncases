import type { ShippingAddress, ShipStationStatus } from "./help-desk";

// ShipStation, where the warehouse buys shipping labels for Shopify orders
// (V1 API: https://www.shipstation.com/docs/api/). Before staff change an
// order's address, the ticket checks whether a label exists there: a label
// bought for the old address must be voided in ShipStation first. Once the
// address changes in Shopify, the ShipStation order gets it too, so the
// next label goes to the right place.

const API = "https://ssapi.shipstation.com";
export type ShipStationAccount = { key: string; secret: string; storeId: string };
export type ShipStationStore = { id: string; name: string; marketplace: string };
// Orders still waiting for a label; their address can change in ShipStation.
const OPEN_STATUSES = ["awaiting_payment", "awaiting_shipment", "pending_fulfillment", "on_hold"];

type ShipStationOrder = {
  orderId: number; orderNumber: string; orderKey: string | null; orderStatus: string;
  shipTo: Record<string, unknown> | null; advancedOptions?: { storeId?: number | null } | null;
} & Record<string, unknown>;
type ShipStationShipment = {
  orderId: number; trackingNumber: string | null; carrierCode: string | null; serviceCode: string | null; shipDate: string | null; voided: boolean; isReturnLabel: boolean;
};

class ShipStationError extends Error {
  constructor(public status: number, body: string) { super(`ShipStation answered ${status}: ${body.slice(0, 300)}`); }
}

// The store's ShipStation account, once both keys and the store are saved. The
// store matters: one ShipStation account can import the same Shopify order
// into several stores (a test store, say).
export const shipStationAccount = (settings: { shipstationKey: string; shipstationSecret: string; shipstationStoreId: string } | null): ShipStationAccount | null =>
  settings?.shipstationKey && settings.shipstationSecret && settings.shipstationStoreId ? { key: settings.shipstationKey, secret: settings.shipstationSecret, storeId: settings.shipstationStoreId } : null;

async function call<T>(account: Pick<ShipStationAccount, "key" | "secret">, path: string, init?: { method: string; body: unknown }): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method: init?.method ?? "GET",
    headers: { Authorization: `Basic ${Buffer.from(`${account.key}:${account.secret}`).toString("base64")}`, "Content-Type": "application/json", Accept: "application/json" },
    ...(init ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new ShipStationError(response.status, await response.text().catch(() => ""));
  return response.json() as Promise<T>;
}

// The account's active stores, to choose the one that holds this shop's
// orders; also proves the keys work. null: the keys are wrong.
export async function listShipStationStores(key: string, secret: string): Promise<ShipStationStore[] | null> {
  try {
    const stores = await call<{ storeId: number; storeName: string; marketplaceName: string; active: boolean }[]>({ key, secret }, "/stores");
    return stores.filter((store) => store.active).map((store) => ({ id: String(store.storeId), name: store.storeName, marketplace: store.marketplaceName }))
      .sort((a, b) => a.marketplace.localeCompare(b.marketplace) || a.name.localeCompare(b.name));
  } catch (error) {
    if (error instanceof ShipStationError && (error.status === 401 || error.status === 403)) return null;
    throw error;
  }
}

// The Shopify order's orders in the chosen ShipStation store (more than one
// when it was split). Imported orders' orderKey starts with the Shopify order
// ID; that one is preferred over an order typed in with the same number.
const orderNumber = (order: { name: string }) => order.name.replace(/^#/, "");
async function findOrders(account: ShipStationAccount, order: { id: string; name: string }) {
  const number = orderNumber(order);
  const { orders } = await call<{ orders: ShipStationOrder[] }>(account, `/orders?orderNumber=${encodeURIComponent(number)}&storeId=${encodeURIComponent(account.storeId)}&pageSize=100`);
  const exact = orders.filter((found) => found.orderNumber === number);
  const byKey = exact.filter((found) => (found.orderKey || "").split("-")[0] === order.id);
  return byKey.length ? byKey : exact;
}

// Whether ShipStation has bought a label for the order. Never throws.
export async function shipStationStatus(account: ShipStationAccount, order: { id: string; name: string }): Promise<ShipStationStatus> {
  try {
    const orders = await findOrders(account, order);
    if (!orders.length) return { state: "missing" };
    const ids = new Set(orders.map((found) => found.orderId));
    const { shipments } = await call<{ shipments: ShipStationShipment[] }>(account, `/shipments?orderNumber=${encodeURIComponent(orderNumber(order))}&storeId=${encodeURIComponent(account.storeId)}&pageSize=100`);
    const labels = shipments.filter((shipment) => ids.has(shipment.orderId) && !shipment.voided && !shipment.isReturnLabel).map((shipment) => ({
      trackingNumber: shipment.trackingNumber || "", carrier: (shipment.carrierCode || "").toUpperCase(), service: shipment.serviceCode || "", shipDate: shipment.shipDate || "",
    }));
    return { state: "found", orderStatuses: [...new Set(orders.map((found) => found.orderStatus))], labels };
  } catch (error) {
    console.error("Help Desk could not check the order in ShipStation:", error instanceof Error ? error.message : error);
    return { state: "error" };
  }
}

// Gives the ShipStation order(s) still waiting for a label the new address.
// ShipStation updates an existing order when the whole order is sent back
// with its orderKey. Returns how many orders changed; throws when ShipStation fails.
export async function updateShipStationAddress(account: ShipStationAccount, order: { id: string; name: string }, address: ShippingAddress): Promise<number> {
  const open = (await findOrders(account, order)).filter((found) => OPEN_STATUSES.includes(found.orderStatus));
  for (const found of open) {
    await call(account, "/orders/createorder", {
      method: "POST",
      body: {
        ...found,
        shipTo: {
          ...(found.shipTo ?? {}), name: address.name, street1: address.address1, street2: address.address2 || "", street3: null, city: address.city,
          state: address.province || null, postalCode: address.zip, country: address.country, phone: address.phone || (found.shipTo?.phone ?? null), addressVerified: null,
        },
      },
    });
  }
  return open.length;
}

// Marks the ShipStation order(s) still waiting for a label as cancelled, once
// the order is cancelled in Shopify, so the warehouse doesn't ship it before
// ShipStation next hears from Shopify. Returns how many changed; throws when ShipStation fails.
export async function cancelShipStationOrders(account: ShipStationAccount, order: { id: string; name: string }): Promise<number> {
  const open = (await findOrders(account, order)).filter((found) => OPEN_STATUSES.includes(found.orderStatus));
  for (const found of open) await call(account, "/orders/createorder", { method: "POST", body: { ...found, orderStatus: "cancelled" } });
  return open.length;
}
