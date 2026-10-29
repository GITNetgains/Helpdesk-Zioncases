import { describe, expect, it } from "vitest";
import { addBusinessDays, daysInText, orderShipping, quotedAnswer, parseDays, processingDays, rateTransit, readShippingSettings, shippingAnswer, zonesFor, type ShippingSetup } from "../app/services/help-desk-shipping";
import { shapeSetup } from "../app/services/help-desk-shipping.server";

const none = { processing: "", rates: {}, note: "" };
// The store's own transit days (Shopify doesn't store them for custom rates).
const times = { ...none, rates: { Standard: "3-4", Express: "1-2" } };
const rate = (name: string, price: number | null, extra = {}) => ({ name, description: "", price, currency: "USD", minTotal: null, maxTotal: null, byWeight: false, ...extra });
const setup: ShippingSetup = {
  home: "US", currency: "USD", processingTime: "P2D",
  zones: [
    { name: "Domestic", general: true, restOfWorld: false, countries: [{ code: "US", provinces: [] }],
      rates: [rate("Standard", 5), rate("Standard", 0, { minTotal: 75 }), rate("Express", 25), rate("Local courier (1 day)", 10)] },
    { name: "Hawaii & Alaska", general: true, restOfWorld: false, countries: [{ code: "US", provinces: ["HI", "AK"] }], rates: [rate("Island Shipping", 30)] },
    { name: "Canada", general: true, restOfWorld: false, countries: [{ code: "CA", provinces: [] }], rates: [rate("UPS", null)] },
    { name: "Rest of world", general: true, restOfWorld: true, countries: [], rates: [rate("Standard International", 40)] },
    { name: "Heavy items US", general: false, restOfWorld: false, countries: [{ code: "US", provinces: [] }], rates: [rate("Freight", 90)] },
    { name: "Heavy items MX", general: false, restOfWorld: false, countries: [{ code: "MX", provinces: [] }], rates: [rate("Freight", 120)] },
  ],
};
// A Monday.
const monday = new Date("2026-11-02T15:00:00Z");

describe("Shipping times", () => {
  it("reads day ranges however they're written", () => {
    expect(parseDays("3-5")).toEqual([3, 5]);
    expect(parseDays("3 to 5")).toEqual([3, 5]);
    expect(parseDays("2")).toEqual([2, 2]);
    expect(parseDays("5-3")).toBeNull();
    expect(parseDays("soon")).toBeNull();
    expect(daysInText("Standard (3–5 business days)")).toEqual([3, 5]);
    expect(daysInText("Next day")).toBeNull();
    expect(daysInText("Ships in 1 day")).toEqual([1, 1]);
  });
  it("takes a rate's transit time from the store, else its name, and never assumes one", () => {
    expect(rateTransit("standard", "", { ...none, rates: { Standard: "2-3" } })).toEqual({ days: [2, 3], source: "setting" });
    expect(rateTransit("Local courier (1 day)", "", none)).toEqual({ days: [1, 1], source: "rate" });
    expect(rateTransit("Express", "", none)).toEqual({ days: null, source: "unknown" });
    expect(rateTransit("Freight", "", none)).toEqual({ days: null, source: "unknown" });
  });
  it("uses the store's processing time, else Shopify's, else none", () => {
    expect(processingDays({ ...none, processing: "3" }, "P2D")).toEqual({ days: [3, 3], source: "setting" });
    expect(processingDays(none, "P2D")).toEqual({ days: [2, 2], source: "shopify" });
    expect(processingDays(none, null)).toEqual({ days: null, source: "none" });
    expect(readShippingSettings("not json")).toEqual(none);
    expect(readShippingSettings(JSON.stringify({ processing: "1", rates: { A: "2", B: "", C: 3 }, note: "Hi" }))).toEqual({ processing: "1", rates: { A: "2" }, note: "Hi" });
  });
  it("counts business days, skipping weekends", () => {
    expect(addBusinessDays(monday, 0)).toBe("2026-11-02");
    expect(addBusinessDays(monday, 4)).toBe("2026-11-06");
    expect(addBusinessDays(monday, 5)).toBe("2026-11-09");
    // Ordered on a Saturday: day 0 is the next Monday.
    expect(addBusinessDays(new Date("2026-11-07T10:00:00Z"), 0)).toBe("2026-11-09");
  });
  it("finds the zones for a destination, by state when the zone lists states", () => {
    expect(zonesFor(setup, "US").map((zone) => zone.name)).toEqual(["Domestic", "Hawaii & Alaska"]);
    expect(zonesFor(setup, "US", "TX").map((zone) => zone.name)).toEqual(["Domestic"]);
    expect(zonesFor(setup, "US", "HI").map((zone) => zone.name)).toEqual(["Domestic", "Hawaii & Alaska"]);
    expect(zonesFor(setup, "FR").map((zone) => zone.name)).toEqual(["Rest of world"]);
    // Only a custom profile ships there.
    expect(zonesFor(setup, "MX").map((zone) => zone.name)).toEqual(["Rest of world"]);
    expect(zonesFor({ ...setup, zones: setup.zones.filter((zone) => !zone.restOfWorld) }, "MX").map((zone) => zone.name)).toEqual(["Heavy items MX"]);
  });
  it("answers with each rate, its price and when it arrives, fastest first", () => {
    const answer = shippingAnswer(setup, times, "US", "TX", monday);
    expect(answer).toMatchObject({ ships: true, quoted: false, countryName: "United States", processing: [2, 2], shipsBy: ["2026-11-04", "2026-11-04"] });
    expect(answer.rates.map((entry) => [entry.name, entry.price, entry.condition, entry.arrives])).toEqual([
      ["Local courier (1 day)", "$10.00", "", ["2026-11-05", "2026-11-05"]],
      ["Express", "$25.00", "", ["2026-11-05", "2026-11-06"]],
      ["Standard", "$5.00", "", ["2026-11-09", "2026-11-10"]],
      ["Standard", "Free", "On orders of $75.00 or more", ["2026-11-09", "2026-11-10"]],
    ]);
    // Without a processing time anywhere, prices but no dates.
    const undated = shippingAnswer({ ...setup, processingTime: null }, times, "US", "TX", monday);
    expect(undated).toMatchObject({ processing: null, shipsBy: null });
    expect(undated.rates.every((rate) => rate.arrives === null)).toBe(true);
    const canada = shippingAnswer(setup, none, "CA", "", monday);
    expect(canada.rates).toEqual([{ name: "UPS", price: "Calculated at checkout", condition: "", days: null, arrives: null }]);
    const nowhere = shippingAnswer({ ...setup, zones: [] }, { ...none, note: " Holidays may add a day. " }, "FR", "", monday);
    expect(nowhere).toMatchObject({ ships: false, rates: [], note: "Holidays may add a day." });
  });
  it("estimates the customer's own order from where it is", () => {
    const order = { name: "#1010", createdAt: "2026-11-02T09:00:00Z", cancelled: false, fulfillmentStatus: "UNFULFILLED", shippingMethod: "Standard", shipments: [] };
    expect(orderShipping(order, setup, times, monday)).toMatchObject({ status: "processing", method: "Standard", arrives: ["2026-11-09", "2026-11-10"] });
    expect(orderShipping(order, setup, none, monday).arrives).toBeNull();
    expect(orderShipping({ ...order, fulfillmentStatus: "ON_HOLD" }, setup, none, monday).status).toBe("onHold");
    // Placed weeks ago and still not shipped: counted from today, not a date that's passed.
    expect(orderShipping({ ...order, createdAt: "2026-10-01T09:00:00Z" }, setup, times, monday).arrives).toEqual(["2026-11-05", "2026-11-10"]);
    expect(orderShipping({ ...order, cancelled: true }, setup, none, monday)).toMatchObject({ status: "cancelled", arrives: null });
    const shipment = { status: "IN_TRANSIT", shippedAt: "2026-11-03T12:00:00Z", deliveredAt: null, estimatedAt: null, url: "https://carrier.example/1" };
    expect(orderShipping({ ...order, shipments: [shipment] }, setup, times, monday)).toMatchObject({ status: "shipped", arrives: ["2026-11-06", "2026-11-09"], trackingUrl: "https://carrier.example/1" });
    expect(orderShipping({ ...order, shipments: [{ ...shipment, estimatedAt: "2026-11-05T20:00:00Z" }] }, setup, none, monday).arrives).toEqual(["2026-11-05", "2026-11-05"]);
    expect(orderShipping({ ...order, shipments: [{ ...shipment, status: "DELIVERED", deliveredAt: "2026-11-04T18:00:00Z", url: "javascript:alert(1)" }] }, setup, none, monday))
      .toMatchObject({ status: "delivered", date: "2026-11-04T18:00:00Z", trackingUrl: "" });
  });
  it("shows Shopify's checkout rates for the customer's products", () => {
    const answer = quotedAnswer(setup, times, "US", "TX", [{ title: "Standard", price: 0, currency: "USD" }, { title: "Express", price: 15, currency: "USD" }, { title: "UPS Ground", price: 12.4, currency: "USD" }], monday);
    expect(answer).toMatchObject({ quoted: true, ships: true, shipsBy: ["2026-11-04", "2026-11-04"] });
    expect(answer.rates.map((rate) => [rate.name, rate.price, rate.arrives])).toEqual([
      ["Express", "$15.00", ["2026-11-05", "2026-11-06"]], ["Standard", "Free", ["2026-11-09", "2026-11-10"]], ["UPS Ground", "$12.40", null],
    ]);
    expect(quotedAnswer(setup, times, "FR", "", [], monday).ships).toBe(false);
  });
  it("reads Shopify's delivery profiles", () => {
    const shaped = shapeSetup({
      shop: { currencyCode: "USD", shopAddress: { countryCodeV2: "US" } },
      deliveryPromiseSettings: { processingTime: "P1D" },
      deliveryProfiles: { nodes: [{ default: true, profileLocationGroups: [{ locationGroupZones: { nodes: [{
        zone: { name: "US", countries: [{ code: { countryCode: "US", restOfWorld: false }, provinces: [{ code: "HI" }] }, { code: { countryCode: null, restOfWorld: true }, provinces: [] }] },
        methodDefinitions: { nodes: [
          { name: "Free", description: null, active: true, rateProvider: { __typename: "DeliveryRateDefinition", price: { amount: "0.0", currencyCode: "USD" } },
            methodConditions: [{ field: "TOTAL_PRICE", operator: "GREATER_THAN_OR_EQUAL_TO", conditionCriteria: { __typename: "MoneyV2", amount: "50.0" } }] },
          { name: "UPS", description: "", active: true, rateProvider: { __typename: "DeliveryParticipant" }, methodConditions: [] },
          { name: "Old", description: "", active: false, rateProvider: null, methodConditions: [] },
        ] },
      }] } }] }] },
    });
    expect(shaped).toEqual({
      home: "US", currency: "USD", processingTime: "P1D",
      zones: [{ name: "US", general: true, restOfWorld: true, countries: [{ code: "US", provinces: ["HI"] }], rates: [
        { name: "Free", description: "", price: 0, currency: "USD", minTotal: 50, maxTotal: null, byWeight: false },
        { name: "UPS", description: "", price: null, currency: "USD", minTotal: null, maxTotal: null, byWeight: false },
      ] }],
    });
  });
});
