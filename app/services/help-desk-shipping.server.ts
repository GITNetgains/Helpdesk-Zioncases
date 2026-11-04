import type { PrismaClient } from "@prisma/client";
import { forget, memo } from "./memo.server";
import { findOrder } from "./help-desk-orders.server";
import { markedUp, orderShipping, quotedAnswer, readShippingSettings, readShipStationRates, shippingAnswer, shipStationRatesReady, toOunces, type OrderShipping, type ShippingAnswer, type ShippingSetup, type ShippingZone } from "./help-desk-shipping";
import { listShipStationCarriers, shipStationRates } from "./help-desk-shipstation.server";

type AdminClient = { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> };
const MINUTE = 60_000;

// The store's shipping zones and rates (Settings › Shipping and delivery) and
// its processing time. Needs the read_shipping scope. Up to 3 profiles, 20
// zones each and 8 rates per zone keeps the query well under Shopify's cost limit.
const SHIPPING_QUERY = `#graphql
  query HelpDeskShipping {
    shop { currencyCode shopAddress { countryCodeV2 } }
    deliveryPromiseSettings { processingTime }
    deliveryProfiles(first: 3) {
      nodes {
        default
        profileLocationGroups {
          locationGroupZones(first: 20) {
            nodes {
              zone { name countries { code { countryCode restOfWorld } provinces { code } } }
              methodDefinitions(first: 8) {
                nodes {
                  name description active
                  rateProvider { __typename ... on DeliveryRateDefinition { price { amount currencyCode } } }
                  methodConditions { field operator conditionCriteria { __typename ... on MoneyV2 { amount } } }
                }
              }
            }
          }
        }
      }
    }
  }
`;

type MethodNode = {
  name: string; description: string | null; active: boolean;
  rateProvider: { __typename: string; price?: { amount: string; currencyCode: string } } | null;
  methodConditions: { field: string; operator: string; conditionCriteria: { __typename: string; amount?: string } }[];
};
type ZoneNode = {
  zone: { name: string; countries: { code: { countryCode: string | null; restOfWorld: boolean }; provinces: { code: string }[] }[] };
  methodDefinitions: { nodes: MethodNode[] };
};
type ProfileNode = { default: boolean; profileLocationGroups: { locationGroupZones: { nodes: ZoneNode[] } }[] };

export function shapeSetup(data: {
  shop?: { currencyCode?: string; shopAddress?: { countryCodeV2?: string | null } | null } | null;
  deliveryPromiseSettings?: { processingTime?: string | null } | null;
  deliveryProfiles?: { nodes: ProfileNode[] } | null;
}): ShippingSetup {
  const currency = data.shop?.currencyCode || "USD";
  const zones: ShippingZone[] = (data.deliveryProfiles?.nodes ?? []).flatMap((profile) => profile.profileLocationGroups.flatMap((group) => group.locationGroupZones.nodes.map((node) => ({
    name: node.zone.name, general: profile.default,
    countries: node.zone.countries.filter((entry) => entry.code.countryCode).map((entry) => ({ code: entry.code.countryCode!, provinces: entry.provinces.map((province) => province.code) })),
    restOfWorld: node.zone.countries.some((entry) => entry.code.restOfWorld),
    rates: node.methodDefinitions.nodes.filter((method) => method.active).map((method) => {
      const total = (operator: string) => {
        const condition = method.methodConditions.find((entry) => entry.field === "TOTAL_PRICE" && entry.operator === operator && entry.conditionCriteria.amount !== undefined);
        return condition ? Number(condition.conditionCriteria.amount) : null;
      };
      const fixed = method.rateProvider?.__typename === "DeliveryRateDefinition" ? method.rateProvider.price : undefined;
      return {
        name: method.name, description: method.description || "",
        // A carrier's rate (UPS, USPS...) is worked out at checkout.
        price: fixed ? Number(fixed.amount) : null, currency: fixed?.currencyCode || currency,
        minTotal: total("GREATER_THAN_OR_EQUAL_TO"), maxTotal: total("LESS_THAN_OR_EQUAL_TO"),
        byWeight: method.methodConditions.some((entry) => entry.field === "TOTAL_WEIGHT"),
      };
    }),
  }))));
  return { home: data.shop?.shopAddress?.countryCodeV2 || "", currency, processingTime: data.deliveryPromiseSettings?.processingTime ?? null, zones };
}

// null: the app hasn't been granted read_shipping yet; undefined: Shopify couldn't be asked.
// Shipping settings rarely change, so they're kept for 10 minutes.
const setupKey = (shop: string) => `shipping|${shop}`;
export function loadShippingSetup(admin: AdminClient | undefined, shop: string): Promise<ShippingSetup | null | undefined> {
  if (!admin) return Promise.resolve(undefined);
  return memo(setupKey(shop), 10 * 60_000, async () => {
    try {
      const json = await (await admin.graphql(SHIPPING_QUERY)).json();
      if (json.data?.deliveryProfiles) return shapeSetup(json.data);
      const text = JSON.stringify(json.errors ?? "");
      console.error("Help Desk could not load shipping settings from Shopify:", text);
      return /access denied|ACCESS_DENIED|read_shipping/i.test(text) ? null : undefined;
    } catch (error) {
      const text = `${error instanceof Error ? error.message : ""} ${JSON.stringify((error as { body?: unknown })?.body ?? "")}`;
      console.error("Help Desk could not load shipping settings from Shopify:", text);
      return /access denied|ACCESS_DENIED|read_shipping/i.test(text) ? null : undefined;
    }
  });
}
export const forgetShippingSetup = (shop: string) => forget(setupKey(shop));

// The exact rates Shopify's checkout would offer for these products at this
// address: every price, weight and carrier rule applied. draftOrderCalculate
// only calculates; no draft order is saved. Needs write_draft_orders.
// null: it couldn't be worked out (no permission, no such products, an error).
const VARIANTS_QUERY = `#graphql
  query HelpDeskQuoteVariants($ids: [ID!]!) {
    nodes(ids: $ids) { ... on Product { id variants(first: 1) { nodes { id } } } }
  }
`;
const QUOTE_MUTATION = `#graphql
  mutation HelpDeskShippingQuote($input: DraftOrderInput!) {
    draftOrderCalculate(input: $input) {
      calculatedDraftOrder { availableShippingRates { title price { amount currencyCode } } }
      userErrors { field message }
    }
  }
`;
export type QuoteAddress = { country: string; province: string; city: string; zip: string; address1: string };
export async function quoteRates(admin: AdminClient | undefined, productIds: string[], address: QuoteAddress, quantities: number[] = []) {
  if (!admin || !productIds.length) return null;
  try {
    const variants = await (await admin.graphql(VARIANTS_QUERY, { variables: { ids: productIds } })).json();
    // nodes come back in the order asked, so each keeps its quantity.
    const lineItems = ((variants.data?.nodes ?? []) as ({ variants?: { nodes: { id: string }[] } } | null)[])
      .map((product, index) => ({ variantId: product?.variants?.nodes[0]?.id, quantity: quantities[index] || 1 })).filter((item) => item.variantId);
    if (!lineItems.length) return null;
    const json = await (await admin.graphql(QUOTE_MUTATION, { variables: { input: {
      lineItems,
      shippingAddress: { countryCode: address.country, provinceCode: address.province || undefined, city: address.city || undefined, zip: address.zip || undefined, address1: address.address1 || undefined },
    } } })).json();
    const result = json.data?.draftOrderCalculate;
    if (!result?.calculatedDraftOrder) {
      console.error("Help Desk could not quote shipping:", JSON.stringify(result?.userErrors ?? json.errors ?? ""));
      return null;
    }
    return (result.calculatedDraftOrder.availableShippingRates as { title: string; price: { amount: string; currencyCode: string } }[])
      .map((rate) => ({ title: rate.title, price: Number(rate.price.amount), currency: rate.price.currencyCode }));
  } catch (error) {
    console.error("Help Desk could not quote shipping:", error instanceof Error ? error.message : error);
    return null;
  }
}

// ---------- Live international rates (ShipStation) ----------

const WEIGHTS_QUERY = `#graphql
  query HelpDeskQuoteWeights($ids: [ID!]!) {
    nodes(ids: $ids) { ... on Product { id variants(first: 1) { nodes { inventoryItem { measurement { weight { value unit } } } } } } }
  }
`;
// The products' weight in ounces, each times how many: from the first variant,
// as Shopify has it. null when Shopify can't be read; products with no weight count 0.
export async function productsWeightOz(admin: AdminClient, productIds: string[], quantities: number[]) {
  try {
    const json = await (await admin.graphql(WEIGHTS_QUERY, { variables: { ids: productIds } })).json();
    if (json.errors?.length) throw new Error(JSON.stringify(json.errors).slice(0, 300));
    type Node = { variants?: { nodes: { inventoryItem?: { measurement?: { weight?: { value: number; unit: string } | null } | null } | null }[] } } | null;
    let total = 0;
    let missing = 0;
    (json.data?.nodes as Node[] ?? []).forEach((product, index) => {
      const weight = product?.variants?.nodes[0]?.inventoryItem?.measurement?.weight;
      const ounces = weight ? toOunces(Number(weight.value), weight.unit) : 0;
      if (!ounces) missing++;
      total += ounces * (quantities[index] || 1);
    });
    return { ounces: total, missing };
  } catch (error) {
    console.error("Help Desk could not read product weights:", error instanceof Error ? error.message : error);
    return null;
  }
}

export type LiveRate = { carrier: string; service: string; price: number };
export type LiveRates =
  | { available: false }
  | { available: true; rates: LiveRate[]; currency: string; weightOz: number; error?: "noWeight" | "noRates" | "unavailable" };

// The live rates the International Shipping form shows once the products and
// address are in: ShipStation's carriers, for the products' weight plus the
// packaging, with the store's markup, cheapest first. available: false when
// it's off or ShipStation isn't connected, so the form works as before.
export async function liveShippingRates(
  db: PrismaClient, admin: AdminClient | undefined, shop: string,
  request: { products: string[]; quantities: number[]; country: string; province: string; city: string; zip: string },
): Promise<LiveRates> {
  const row = await db.helpDeskSettings.findUnique({ where: { shop }, select: { shippingTimes: true, shipstationKey: true, shipstationSecret: true } });
  const settings = readShipStationRates(row?.shippingTimes);
  if (!admin || !row?.shipstationKey || !row.shipstationSecret || !shipStationRatesReady(settings)) return { available: false };
  const none = (error: "noWeight" | "noRates" | "unavailable", weightOz = 0): LiveRates => ({ available: true, rates: [], currency: settings.currency, weightOz, error });
  if (!request.products.length) return none("noWeight");
  const weight = await productsWeightOz(admin, request.products, request.quantities);
  if (!weight) return none("unavailable");
  // A product with no weight in Shopify would quote too low: none is better than a wrong one.
  if (weight.missing) return none("noWeight");
  const weightOz = Math.round((weight.ounces + settings.packagingOz) * 10) / 10;
  // Asked again with the same weight, address and setup: the same answer, for 10 minutes.
  const key = `ship-rates|${shop}|${weightOz}|${request.country}|${request.province}|${request.zip.toUpperCase()}|${settings.carriers.join("+")}|${settings.fromCountry}|${settings.fromPostalCode}`;
  const account = { key: row.shipstationKey, secret: row.shipstationSecret };
  try {
    const rates = await memo(key, 10 * MINUTE, async () => {
      const names = Object.fromEntries((await memo(`ship-carriers|${shop}`, 60 * MINUTE, () => listShipStationCarriers(account.key, account.secret)) ?? []).map((carrier) => [carrier.code, carrier.name]));
      return shipStationRates(account, {
        carriers: settings.carriers, fromPostalCode: settings.fromPostalCode, fromCountry: settings.fromCountry,
        toCountry: request.country, toState: request.province, toCity: request.city, toPostalCode: request.zip, weightOz,
      }, names);
    });
    const priced = rates.map((rate) => ({ carrier: rate.carrier, service: rate.service, price: markedUp(rate.cost, settings) }))
      .sort((a, b) => a.price - b.price).slice(0, 8);
    return priced.length ? { available: true, rates: priced, currency: settings.currency, weightOz } : none("noRates", weightOz);
  } catch (error) {
    console.error(`Help Desk could not get ShipStation rates for ${shop}:`, error instanceof Error ? error.message : error);
    forget(key);
    return none("unavailable", weightOz);
  }
}

// Whether the storefront form should offer live rates (checked on its load).
export async function liveRatesOn(db: PrismaClient, shop: string) {
  const row = await db.helpDeskSettings.findUnique({ where: { shop }, select: { shippingTimes: true, shipstationKey: true, shipstationSecret: true } });
  return Boolean(row?.shipstationKey && row.shipstationSecret && shipStationRatesReady(readShipStationRates(row.shippingTimes)));
}

export async function shippingSettings(db: PrismaClient, shop: string) {
  const row = await db.helpDeskSettings.findUnique({ where: { shop }, select: { shippingTimes: true } });
  return readShippingSettings(row?.shippingTimes);
}

// "Check shipping times" on the storefront form: the rates and times for a
// destination, and, when the customer gives their order number and email, when
// that order should arrive. orderError: the order couldn't be matched (counted as a miss).
export type ShippingLookup =
  | { answer: ShippingAnswer; order?: OrderShipping; orderError?: "notFound" | "unavailable" }
  | { error: "unavailable" };
export async function lookupShipping(
  db: PrismaClient, admin: AdminClient | undefined, shop: string,
  request: { country: string; province: string; orderNumber: string; email: string; products?: string[]; quantities?: number[]; city?: string; zip?: string; address1?: string },
): Promise<ShippingLookup> {
  const [setup, settings] = await Promise.all([loadShippingSetup(admin, shop), shippingSettings(db, shop)]);
  if (!setup) return { error: "unavailable" };
  // Products chosen: Shopify's own checkout rates for them; else the zone's rates.
  if (request.products?.length) {
    const rates = await quoteRates(admin, request.products, { country: request.country, province: request.province, city: request.city ?? "", zip: request.zip ?? "", address1: request.address1 ?? "" }, request.quantities);
    if (rates) return { answer: quotedAnswer(setup, settings, request.country, request.province, rates) };
  }
  if (!request.orderNumber.trim()) return { answer: shippingAnswer(setup, settings, request.country, request.province) };
  const order = await findOrder(admin, request.orderNumber);
  const matches = order && request.email.trim() && order.email.trim().toLowerCase() === request.email.trim().toLowerCase();
  if (!matches) return { answer: shippingAnswer(setup, settings, request.country, request.province), orderError: order === undefined ? "unavailable" : "notFound" };
  // The rates shown are for where the order is actually going.
  const country = order.country || request.country;
  return {
    answer: shippingAnswer(setup, settings, country, order.country ? order.province : request.province),
    order: orderShipping(order, setup, settings),
  };
}
