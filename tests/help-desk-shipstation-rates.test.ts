import { afterEach, describe, expect, it, vi } from "vitest";
import { markedUp, readShipStationRates, shipStationRatesReady, toOunces } from "../app/services/help-desk-shipping";
import { shipStationRates } from "../app/services/help-desk-shipstation.server";
import { liveShippingRates } from "../app/services/help-desk-shipping.server";

// Live international rates: the products' weight from Shopify, priced by
// ShipStation's carriers to the customer's address, with the store's markup.

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

describe("ShipStation rate settings", () => {
  it("reads the saved settings, with safe defaults, from the shipping times JSON", () => {
    expect(readShipStationRates("")).toMatchObject({ enabled: false, carriers: [], fromCountry: "US", packagingOz: 8, currency: "USD" });
    const saved = readShipStationRates(JSON.stringify({ processing: "1-2", shipstationRates: { enabled: true, carriers: ["ups", "bad code!"], fromPostalCode: " 90210 ", fromCountry: "us", packagingOz: -3, markupPercent: 10, markupFlat: 2.5, currency: "CAD" } }));
    expect(saved).toEqual({ enabled: true, carriers: ["ups"], fromPostalCode: "90210", fromCountry: "US", packagingOz: 8, markupPercent: 10, markupFlat: 2.5, currency: "CAD" });
    expect(shipStationRatesReady(saved)).toBe(true);
    expect(shipStationRatesReady({ ...saved, fromPostalCode: "" })).toBe(false);
    expect(shipStationRatesReady({ ...saved, carriers: [] })).toBe(false);
    expect(readShipStationRates("not json").enabled).toBe(false);
  });

  it("weighs in ounces and prices with the store's markup", () => {
    expect(toOunces(2, "POUNDS")).toBe(32);
    expect(toOunces(1, "KILOGRAMS")).toBeCloseTo(35.274, 2);
    expect(toOunces(100, "GRAMS")).toBeCloseTo(3.527, 2);
    expect(toOunces(0, "POUNDS")).toBe(0);
    expect(toOunces(3, "STONES")).toBe(0);
    expect(markedUp(40, { markupPercent: 10, markupFlat: 2.5 })).toBe(46.5);
    expect(markedUp(19.99, { markupPercent: 0, markupFlat: 0 })).toBe(19.99);
  });
});

describe("ShipStation rates", () => {
  it("asks each carrier for this weight and address, and leaves out one that fails", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push({ url, body });
      if (body.carrierCode === "fedex") return new Response("down", { status: 500 });
      return json([{ serviceName: "UPS Worldwide Expedited", serviceCode: "ups_we", shipmentCost: 40, otherCost: 2.15 }, { serviceName: "UPS Free", serviceCode: "x", shipmentCost: 0, otherCost: 0 }]);
    }));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rates = await shipStationRates({ key: "k", secret: "s" }, {
      carriers: ["ups", "fedex"], fromPostalCode: "90210", fromCountry: "US", toCountry: "GB", toState: "", toCity: "London", toPostalCode: "SW1A 1AA", weightOz: 20.2,
    }, { ups: "UPS" });
    expect(rates).toEqual([{ carrier: "UPS", service: "UPS Worldwide Expedited", cost: 42.15 }]);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe("https://ssapi.shipstation.com/shipments/getrates");
    expect(calls[0].body).toMatchObject({ carrierCode: "ups", fromPostalCode: "90210", toCountry: "GB", toPostalCode: "SW1A 1AA", toState: null, weight: { value: 21, units: "ounces" } });
  });
});

describe("Live shipping rates on the storefront form", () => {
  const settings = { enabled: true, carriers: ["ups"], fromPostalCode: "90210", fromCountry: "US", packagingOz: 8, markupPercent: 10, markupFlat: 0, currency: "USD" };
  const db = (shipstationRates: unknown, keys = true) => ({
    helpDeskSettings: { findUnique: async () => ({ shippingTimes: JSON.stringify({ shipstationRates }), shipstationKey: keys ? "k" : "", shipstationSecret: keys ? "s" : "" }) },
  }) as never;
  // Two products: 1 lb each (one of them twice), or one with no weight.
  const admin = (weights: ({ value: number; unit: string } | null)[]) => ({
    graphql: vi.fn(async () => json({ data: { nodes: weights.map((weight) => ({ variants: { nodes: [{ inventoryItem: { measurement: { weight } } }] } })) } })),
  });
  const request = { products: ["gid://shopify/Product/1", "gid://shopify/Product/2"], quantities: [2, 1], country: "GB", province: "", city: "London", zip: "SW1A 1AA" };

  it("is off until turned on with ShipStation connected", async () => {
    expect(await liveShippingRates(db({ ...settings, enabled: false }), admin([]) as never, "off.myshopify.com", request)).toEqual({ available: false });
    expect(await liveShippingRates(db(settings, false), admin([]) as never, "nokeys.myshopify.com", request)).toEqual({ available: false });
  });

  it("prices the products' weight plus packaging, cheapest first, with the markup", async () => {
    let asked: Record<string, unknown> = {};
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/carriers")) return json([{ code: "ups", name: "UPS" }]);
      asked = JSON.parse(String(init?.body));
      return json([{ serviceName: "Expedited", shipmentCost: 50, otherCost: 0 }, { serviceName: "Standard", shipmentCost: 30, otherCost: 0 }]);
    }));
    const result = await liveShippingRates(db(settings), admin([{ value: 1, unit: "POUNDS" }, { value: 1, unit: "POUNDS" }]) as never, "rates.myshopify.com", request);
    // 1 lb x 2 + 1 lb + 8 oz packaging = 56 oz.
    expect(asked).toMatchObject({ weight: { value: 56, units: "ounces" }, toCountry: "GB", fromPostalCode: "90210" });
    expect(result).toEqual({ available: true, currency: "USD", weightOz: 56, rates: [
      { carrier: "UPS", service: "Standard", price: 33 }, { carrier: "UPS", service: "Expedited", price: 55 },
    ] });
  });

  it("won't price a shipment when a product has no weight in Shopify", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await liveShippingRates(db(settings), admin([{ value: 1, unit: "POUNDS" }, null]) as never, "noweight.myshopify.com", request))
      .toMatchObject({ available: true, rates: [], error: "noWeight" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
