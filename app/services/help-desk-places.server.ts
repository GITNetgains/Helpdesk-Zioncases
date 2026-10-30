// Address suggestions on the storefront form: as the customer types a street
// address, suggestions in the chosen country appear, and picking one fills in
// the street, city, state and postal code. With the store's Google key they
// come from Google Places (the same service as Shopify's checkout); without
// one, from OpenStreetMap through Photon, which is free and needs no key.
// Either way the form only talks to the app proxy, so the key stays here.
// https://developers.google.com/maps/documentation/places/web-service/place-autocomplete
// https://photon.komoot.io

const API = "https://places.googleapis.com/v1";
const PHOTON = "https://photon.komoot.io/api/";
// address: the whole address when the suggestion already has it (Photon);
// otherwise it's fetched once picked (Google).
export type AddressSuggestion = { id: string; main: string; secondary: string; address?: SuggestedAddress };
export type SuggestedAddress = { address1: string; address2: string; city: string; province: string; provinceName: string; zip: string; country: string };
// Street addresses and buildings first (Autocomplete takes up to five types).
const ADDRESS_TYPES = ["street_address", "premise", "subpremise", "route"];

class PlacesError extends Error {
  constructor(public status: number, public body: string) { super(`Google Places answered ${status}: ${body.slice(0, 300)}`); }
}

async function call<T>(key: string, path: string, init: { method: "GET" | "POST"; body?: unknown; fields?: string }): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method: init.method,
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, ...(init.fields ? { "X-Goog-FieldMask": init.fields } : {}) },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new PlacesError(response.status, await response.text().catch(() => ""));
  return response.json() as Promise<T>;
}

type AutocompleteResponse = { suggestions?: { placePrediction?: { placeId: string; text?: { text: string }; structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } } } }[] };

// Most countries put the house number first; much of Europe and Latin America after the street.
const NUMBER_LAST = ["DE", "AT", "CH", "NL", "BE", "IT", "ES", "PT", "PL", "CZ", "DK", "NO", "SE", "FI", "MX", "BR", "AR"];
const streetLine = (number: string, street: string, country: string) =>
  (NUMBER_LAST.includes(country) ? [street, number] : [number, street]).filter(Boolean).join(" ");

// Up to five addresses in the country matching what the customer typed:
// Google with the store's key, else OpenStreetMap.
export const suggestAddresses = (key: string, input: string, country: string, sessionToken: string) =>
  key ? googleSuggestions(key, input, country, sessionToken) : photonSuggestions(input, country);

type PhotonFeature = { properties: Record<string, string | undefined> };

// OpenStreetMap addresses and streets (Photon), each with its whole address.
async function photonSuggestions(input: string, country: string): Promise<AddressSuggestion[]> {
  const params = new URLSearchParams({ q: input, limit: "8", lang: "en" });
  if (country) params.set("countrycode", country);
  params.append("layer", "house");
  params.append("layer", "street");
  const response = await fetch(`${PHOTON}?${params}`, { headers: { "User-Agent": "ZionCasesHelpDesk/1.0 (Shopify app; address suggestions)" }, signal: AbortSignal.timeout(6000) });
  if (!response.ok) throw new Error(`Photon answered ${response.status}`);
  const { features = [] } = await response.json() as { features?: PhotonFeature[] };
  const seen = new Set<string>();
  return features.flatMap(({ properties: place }) => {
    const code = (place.countrycode || country || "").toUpperCase();
    if (country && code !== country) return [];
    // A street on its own is named after itself; a building or place has a street and maybe a number.
    const line = place.type === "street" ? place.name || "" : streetLine(place.housenumber || "", place.street || "", code);
    const named = place.type !== "street" && place.name && !place.housenumber ? place.name : "";
    // Wards and mandals (common in India) aren't cities: then the city is left
    // for the customer, and the neighbourhood goes on the street line instead.
    const city = place.city || place.town || place.village || "";
    // (US and Canadian addresses don't name the neighbourhood, as at checkout.)
    const area = !["US", "CA"].includes(code) && place.locality && place.locality !== city
      && !`${named} ${line}`.toLowerCase().includes(place.locality.toLowerCase()) ? place.locality : "";
    const address1 = [...new Set([named, line, area].filter(Boolean))].filter((part, _, all) => !all.some((other) => other !== part && other.includes(part)))
      .join(", ").slice(0, 200);
    if (!address1) return [];
    const address: SuggestedAddress = { address1, address2: "", city, province: "", provinceName: place.state || "", zip: place.postcode || "", country: code };
    const main = named || line;
    const secondary = [named ? line : "", area, city, place.state, place.postcode].filter(Boolean).join(", ");
    const id = `osm:${place.osm_type || ""}${place.osm_id || ""}`;
    if (seen.has(`${main}|${secondary}`)) return [];
    seen.add(`${main}|${secondary}`);
    return [{ id, main, secondary, address }];
  }).slice(0, 5);
}

// Google's suggestions; the address itself comes once one is picked (addressDetails).
// sessionToken groups one address search (typing, then picking) for billing.
async function googleSuggestions(key: string, input: string, country: string, sessionToken: string): Promise<AddressSuggestion[]> {
  const body = { input, sessionToken, languageCode: "en", ...(country ? { includedRegionCodes: [country.toLowerCase()] } : {}) };
  let result: AutocompleteResponse;
  try {
    result = await call<AutocompleteResponse>(key, "/places:autocomplete", { method: "POST", body: { ...body, includedPrimaryTypes: ADDRESS_TYPES } });
  } catch (error) {
    // Should Google stop accepting a type, any place is still better than none.
    if (!(error instanceof PlacesError && error.status === 400 && /type/i.test(error.body))) throw error;
    result = await call<AutocompleteResponse>(key, "/places:autocomplete", { method: "POST", body });
  }
  return (result.suggestions ?? []).flatMap(({ placePrediction: place }) => place ? [{
    id: place.placeId, main: place.structuredFormat?.mainText?.text || place.text?.text || "", secondary: place.structuredFormat?.secondaryText?.text || "",
  }] : []);
}

type Component = { longText: string; shortText: string; types: string[] };

// The picked address, split into the form's fields.
export async function addressDetails(key: string, placeId: string, sessionToken: string): Promise<SuggestedAddress> {
  const place = await call<{ addressComponents?: Component[] }>(key, `/places/${encodeURIComponent(placeId)}?languageCode=en&sessionToken=${encodeURIComponent(sessionToken)}`, {
    method: "GET", fields: "addressComponents",
  });
  const parts = place.addressComponents ?? [];
  const find = (...types: string[]) => types.map((type) => parts.find((part) => part.types.includes(type))).find(Boolean);
  const number = find("street_number")?.longText || "";
  const route = find("route")?.longText || "";
  const premise = find("premise")?.longText || "";
  const country = find("country")?.shortText || "";
  const province = find("administrative_area_level_1");
  const street = streetLine(number, route, country);
  return {
    address1: street || premise,
    address2: [find("subpremise")?.longText, street && premise ? premise : ""].filter(Boolean).join(", "),
    city: find("locality", "postal_town", "sublocality_level_1", "sublocality", "administrative_area_level_3", "administrative_area_level_2")?.longText || "",
    province: province?.shortText || "", provinceName: province?.longText || "",
    // The plain postal code, as checkout fills it (no ZIP+4).
    zip: find("postal_code")?.longText || "",
    country,
  };
}

// Whether Google accepts the key for Places (New). Returns what's wrong, or "".
export async function checkPlacesKey(key: string): Promise<string> {
  try {
    await suggestAddresses(key, "1600 Amphitheatre Parkway", "US", crypto.randomUUID());
    return "";
  } catch (error) {
    if (error instanceof PlacesError) {
      if (/SERVICE_DISABLED|has not been used|is disabled/i.test(error.body)) return "Turn on \"Places API (New)\" for this key's project in Google Cloud, then save again.";
      if (/BILLING/i.test(error.body)) return "Google needs a billing account on this key's project before Places works.";
      if (error.status === 400 || error.status === 401 || error.status === 403) return "Google didn't accept this API key. Check it, and that it may use Places API (New).";
    }
    return "Google couldn't be reached. Please try again.";
  }
}
