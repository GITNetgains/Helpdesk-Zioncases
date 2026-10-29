import { countryName } from "./help-desk";

// Shipping times: how long an order takes to arrive, from the store's own
// Shopify shipping settings. Shopify gives the zones, the rates in each and
// (when set) the processing time, but not how many days a custom rate takes in
// transit. Those come, in order, from the store's Help Desk settings, the rate's
// own name or description ("Standard (3-5 business days)"). Nothing is assumed:
// without either, the customer is told the time is shown at checkout.

export type DayRange = [min: number, max: number];

// Where Shipping Times answers for now. Any other country is told shipping
// there is coming soon, and can leave their details.
export const SHIPPING_TIMES_COUNTRIES = ["US", "CA"];
// Where a rate's transit time came from, so the admin can see what to fill in.
export type TransitSource = "setting" | "rate" | "unknown";

// The store's choices, saved as JSON in HelpDeskSettings.shippingTimes.
// processing: business days to pack and ship ("1-2"), blank to use Shopify's;
// rates: transit days by rate name ("3-5"); note: shown to customers as is.
export type ShippingTimesSettings = { processing: string; rates: Record<string, string>; note: string };

export function readShippingSettings(json: string | null | undefined): ShippingTimesSettings {
  try {
    const value = JSON.parse(json || "{}");
    const rates = value && typeof value.rates === "object" && !Array.isArray(value.rates) ? value.rates : {};
    return {
      processing: typeof value?.processing === "string" ? value.processing : "",
      rates: Object.fromEntries(Object.entries(rates).filter((entry): entry is [string, string] => typeof entry[1] === "string" && Boolean(entry[1].trim()))),
      note: typeof value?.note === "string" ? value.note : "",
    };
  } catch {
    return { processing: "", rates: {}, note: "" };
  }
}

const MAX_DAYS = 90;

// "3-5", "3 to 5", "3–5 business days", "2": a range of whole days, or null.
export function parseDays(text: string): DayRange | null {
  const match = text.match(/(\d{1,2})(?:\s*(?:-|–|—|to)\s*(\d{1,2}))?/i);
  if (!match) return null;
  const min = Number(match[1]);
  const max = Number(match[2] ?? match[1]);
  return min <= max && max <= MAX_DAYS ? [min, max] : null;
}

// Days written into a rate's name or description: "Standard (3-5 business days)".
export function daysInText(text: string): DayRange | null {
  const match = text.match(/(\d{1,2}(?:\s*(?:-|–|—|to)\s*\d{1,2})?)\s*(?:business\s+|working\s+)?days?\b/i);
  return match ? parseDays(match[1]) : null;
}

export function rateTransit(name: string, description: string, settings: ShippingTimesSettings): { days: DayRange | null; source: TransitSource } {
  const key = Object.keys(settings.rates).find((rate) => rate.trim().toLowerCase() === name.trim().toLowerCase());
  const set = key ? parseDays(settings.rates[key]) : null;
  if (set) return { days: set, source: "setting" };
  const written = daysInText(name) ?? daysInText(description);
  return written ? { days: written, source: "rate" } : { days: null, source: "unknown" };
}

// Shopify's processing time is an ISO 8601 duration of whole days, like "P2D".
export function shopifyProcessingDays(duration: string | null | undefined): DayRange | null {
  const days = duration?.match(/^P(\d{1,2})D$/)?.[1];
  return days === undefined ? null : [Number(days), Number(days)];
}
// From the store's setting, else Shopify's processing time; null when neither says.
export function processingDays(settings: ShippingTimesSettings, shopifyDuration: string | null | undefined): { days: DayRange | null; source: "setting" | "shopify" | "none" } {
  const set = settings.processing.trim() ? parseDays(settings.processing) : null;
  if (set) return { days: set, source: "setting" };
  const shopify = shopifyProcessingDays(shopifyDuration);
  return shopify ? { days: shopify, source: "shopify" } : { days: null, source: "none" };
}

// Business days on from a date (weekends skipped), as YYYY-MM-DD.
export function addBusinessDays(from: Date, days: number) {
  const date = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  let left = days;
  while (left > 0 || date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) left--;
  }
  return date.toISOString().slice(0, 10);
}

// The window an order arrives in: packed and shipped, then in transit.
export function arrivalWindow(from: Date, processing: DayRange, transit: DayRange): [string, string] {
  return [addBusinessDays(from, processing[0] + transit[0]), addBusinessDays(from, processing[1] + transit[1])];
}

// ---------- The store's zones and rates ----------

// What Shopify's delivery profiles say, trimmed to what's needed.
export type ShippingRate = { name: string; description: string; price: number | null; currency: string; minTotal: number | null; maxTotal: number | null; byWeight: boolean };
export type ShippingZone = { name: string; countries: { code: string; provinces: string[] }[]; restOfWorld: boolean; rates: ShippingRate[]; general: boolean };
export type ShippingSetup = { home: string; currency: string; processingTime: string | null; zones: ShippingZone[] };

// The zones that ship to a country (and state, when the zone lists states).
// The store's general profile covers most products, so its rates come first,
// and a custom profile's only when the general one doesn't ship there.
// Within each, a zone naming the country wins over its "Rest of world".
export function zonesFor(setup: ShippingSetup, country: string, province = "") {
  const matches = (zone: ShippingZone) => zone.countries.some((entry) => entry.code === country && (!province || !entry.provinces.length || entry.provinces.includes(province)));
  const resolve = (zones: ShippingZone[]) => {
    const named = zones.filter(matches);
    return named.length ? named : zones.filter((zone) => zone.restOfWorld);
  };
  const general = resolve(setup.zones.filter((zone) => zone.general));
  return general.length ? general : resolve(setup.zones.filter((zone) => !zone.general));
}

const money = (amount: number, currency: string) => new Intl.NumberFormat("en", { style: "currency", currency: currency || "USD" }).format(amount);

// One line per rate, as the customer sees it: name, price and when it applies.
export function describeRate(rate: ShippingRate) {
  const price = rate.price === null ? "Calculated at checkout" : rate.price === 0 ? "Free" : money(rate.price, rate.currency);
  const condition = rate.minTotal !== null && rate.maxTotal !== null ? `On orders of ${money(rate.minTotal, rate.currency)} to ${money(rate.maxTotal, rate.currency)}`
    : rate.minTotal !== null ? `On orders of ${money(rate.minTotal, rate.currency)} or more`
      : rate.maxTotal !== null ? `On orders up to ${money(rate.maxTotal, rate.currency)}`
        : rate.byWeight ? "Depends on the weight of your order" : "";
  return { price, condition };
}

export type PublicRate = { name: string; price: string; condition: string; days: DayRange | null; arrives: [string, string] | null };
// quoted: the rates are Shopify's checkout rates for the customer's own products
// (prices with every condition applied); otherwise they're the zone's rates.
export type ShippingAnswer = {
  country: string; countryName: string; province: string; ships: boolean; quoted: boolean;
  processing: DayRange | null; shipsBy: [string, string] | null; rates: PublicRate[]; note: string;
};

// A rate as the customer sees it, with when it arrives when both times are known.
export function publicRate(name: string, description: string, price: string, condition: string, settings: ShippingTimesSettings, processing: DayRange | null, today: Date): PublicRate {
  const { days } = rateTransit(name, description, settings);
  return { name, price, condition, days, arrives: days && processing ? arrivalWindow(today, processing, days) : null };
}
const fastestFirst = (rates: PublicRate[]) => rates.sort((a, b) => (a.days?.[1] ?? MAX_DAYS + 1) - (b.days?.[1] ?? MAX_DAYS + 1));
const destination = (setup: ShippingSetup, settings: ShippingTimesSettings, country: string, province: string, today: Date) => {
  const processing = processingDays(settings, setup.processingTime).days;
  return {
    country, countryName: countryName(country), province, processing, note: settings.note.trim(),
    shipsBy: processing ? [addBusinessDays(today, processing[0]), addBusinessDays(today, processing[1])] as [string, string] : null,
  };
};

// Shopify's checkout rates for the customer's products to their address.
export function quotedAnswer(setup: ShippingSetup, settings: ShippingTimesSettings, country: string, province: string, rates: { title: string; price: number; currency: string }[], today = new Date()): ShippingAnswer {
  const base = destination(setup, settings, country, province, today);
  const shown = rates.map((rate) => publicRate(rate.title, "", rate.price === 0 ? "Free" : money(rate.price, rate.currency), "", settings, base.processing, today));
  return { ...base, ships: shown.length > 0, quoted: true, rates: fastestFirst(shown) };
}

// What the storefront shows for a destination: when an order placed today
// ships, and each way it can be sent there with when it would arrive.
export function shippingAnswer(setup: ShippingSetup, settings: ShippingTimesSettings, country: string, province = "", today = new Date()): ShippingAnswer {
  const base = destination(setup, settings, country, province, today);
  const seen = new Set<string>();
  const rates: PublicRate[] = [];
  for (const zone of zonesFor(setup, country, province)) {
    for (const rate of zone.rates) {
      const { price, condition } = describeRate(rate);
      const key = `${rate.name}|${price}|${condition}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rates.push(publicRate(rate.name, rate.description, price, condition, settings, base.processing, today));
    }
  }
  // Fastest first; rates without a known time last.
  return { ...base, ships: rates.length > 0, quoted: false, rates: fastestFirst(rates) };
}

// ---------- One order ----------

export type OrderShippingStatus = "cancelled" | "delivered" | "shipped" | "processing" | "onHold";
export type OrderShipping = {
  order: string; method: string; placedAt: string; status: OrderShippingStatus;
  // delivered or shipped: when; arrives: the expected window (one day when the carrier gives a date).
  date: string | null; arrives: [string, string] | null; trackingUrl: string;
};
type OrderView = {
  name: string; createdAt: string; cancelled: boolean; fulfillmentStatus: string; shippingMethod: string;
  shipments: { status: string; shippedAt: string | null; deliveredAt: string | null; estimatedAt: string | null; url: string }[];
};

// When the customer's own order should arrive, from what Shopify knows about it.
export function orderShipping(order: OrderView, setup: ShippingSetup | null, settings: ShippingTimesSettings, today = new Date()): OrderShipping {
  const base = { order: order.name, method: order.shippingMethod, placedAt: order.createdAt, date: null, arrives: null, trackingUrl: "" };
  if (order.cancelled) return { ...base, status: "cancelled" };
  const transit = order.shippingMethod ? rateTransit(order.shippingMethod, "", settings).days : null;
  const shipment = order.shipments[0];
  const url = shipment && /^https:\/\//i.test(shipment.url) ? shipment.url : "";
  if (shipment) {
    const delivered = order.shipments.every((entry) => entry.deliveredAt || entry.status === "DELIVERED");
    if (delivered) return { ...base, status: "delivered", date: shipment.deliveredAt, trackingUrl: url };
    const shippedAt = shipment.shippedAt ? new Date(shipment.shippedAt) : today;
    const arrives: [string, string] | null = shipment.estimatedAt ? [shipment.estimatedAt.slice(0, 10), shipment.estimatedAt.slice(0, 10)]
      : transit ? arrivalWindow(shippedAt, [0, 0], transit) : null;
    return { ...base, status: "shipped", date: shipment.shippedAt, arrives, trackingUrl: url };
  }
  const processing = processingDays(settings, setup?.processingTime).days;
  // Placed a while ago and still not shipped: count from today instead of promising a date that's passed.
  const placed = new Date(order.createdAt);
  const window = transit && processing ? arrivalWindow(placed, processing, transit) : null;
  const arrives = window && window[1] < today.toISOString().slice(0, 10) ? arrivalWindow(today, [0, processing![1]], transit!) : window;
  return { ...base, status: order.fulfillmentStatus === "ON_HOLD" ? "onHold" : "processing", arrives };
}
