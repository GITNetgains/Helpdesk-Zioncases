// topics[5] covers product questions, how-tos, the website and anything else:
// a question with an optional order number and photos.
export const topics = ["Shipping Inquiry", "Wholesale Inquiry", "Affiliate Inquiry", "Order Inquiry", "Returns & Exchanges", "General Inquiry"] as const;
export const orderTypes = ["Update order", "Product Issues", "Wrong Product Received", "Where is my order?"];
export const updates = ["Change Product or Quantity", "Update Shipping Details", "Cancel Order"];
// Why the customer wants to cancel the whole order. "Other" asks them to explain.
export const cancelReasons = [
  "Ordered by mistake", "Ordered the wrong item, size or color", "Found a better price", "Delivery will take too long",
  "Duplicate order", "Changed my mind", "Payment or billing issue", "Other",
];
// Where a cancellation request stands, for the customer and the team.
// Pending: waiting for a decision; Approved: the team agreed and will cancel
// it; Rejected: it can't be cancelled; Cancelled: the order is cancelled in Shopify.
export const cancelStatuses = ["Pending", "Approved", "Rejected", "Cancelled"] as const;
export type CancelStatus = typeof cancelStatuses[number];

// ---------- Shipping address changes ----------

// Where an address change request stands. Updated: the order's shipping
// address was changed in Shopify; Rejected: it couldn't be changed.
export const addressStatuses = ["Pending", "Updated", "Rejected"] as const;
export type AddressStatus = typeof addressStatuses[number];
// The new address the customer asks for, as form fields.
export const ADDRESS_FIELDS = ["shipName", "shipAddress1", "shipAddress2", "shipCity", "shipProvince", "shipZip", "shipCountry", "shipPhone"] as const;
export type ShippingAddress = { name: string; address1: string; address2: string; city: string; province: string; zip: string; country: string; phone: string };
export const addressFromValues = (values: Record<string, string>): ShippingAddress => ({
  name: values.shipName || "", address1: values.shipAddress1 || "", address2: values.shipAddress2 || "", city: values.shipCity || "",
  province: values.shipProvince || "", zip: values.shipZip || "", country: values.shipCountry || "", phone: values.shipPhone || "",
});
// One line per part, as it's written on a parcel.
export const addressLines = (address: Partial<ShippingAddress>) => [
  address.name, address.address1, address.address2, [address.city, address.province, address.zip].filter(Boolean).join(", "),
  address.country ? countryName(address.country) : "", address.phone,
].filter((line): line is string => Boolean(line?.trim()));

// Countries whose addresses need a state or province, with Shopify's codes for them.
export const PROVINCES: Record<string, [string, string][]> = {
  US: Object.entries({
    AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
    FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine",
    MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
    NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
    PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
    WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico", GU: "Guam", VI: "U.S. Virgin Islands", AS: "American Samoa",
    MP: "Northern Mariana Islands", AA: "Armed Forces Americas", AE: "Armed Forces Europe", AP: "Armed Forces Pacific",
  }),
  CA: Object.entries({
    AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick", NL: "Newfoundland and Labrador", NS: "Nova Scotia", NT: "Northwest Territories",
    NU: "Nunavut", ON: "Ontario", PE: "Prince Edward Island", QC: "Quebec", SK: "Saskatchewan", YT: "Yukon",
  }),
  AU: Object.entries({ ACT: "Australian Capital Territory", NSW: "New South Wales", NT: "Northern Territory", QLD: "Queensland", SA: "South Australia", TAS: "Tasmania", VIC: "Victoria", WA: "Western Australia" }),
};
// Postal code formats Shopify checks, with an example for the error message.
const POSTAL: Record<string, [RegExp, string]> = {
  US: [/^\d{5}(-\d{4})?$/, "12345 or 12345-6789"], CA: [/^[A-Z]\d[A-Z] ?\d[A-Z]\d$/i, "A1A 1A1"], AU: [/^\d{4}$/, "2000"],
  GB: [/^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i, "SW1A 1AA"], IN: [/^\d{6}$/, "110001"], DE: [/^\d{5}$/, "10115"], FR: [/^\d{5}$/, "75001"],
};

// What's wrong with a new shipping address: required parts, the state for
// countries that have them, the postal code's format and a usable phone number.
// Keys are the address's own (name, address1...).
export function addressProblems(address: ShippingAddress) {
  const errors: Partial<Record<keyof ShippingAddress, string>> = {};
  if (!address.name.trim()) errors.name = "Enter the recipient's name.";
  if (!address.address1.trim()) errors.address1 = "Enter the street address.";
  if (!address.city.trim()) errors.city = "Enter the city.";
  if (!countries.some((country) => country.code === address.country)) errors.country = "Select the country.";
  const provinces = PROVINCES[address.country];
  if (provinces && !provinces.some(([code]) => code === address.province.trim().toUpperCase())) errors.province = `Select the ${address.country === "CA" ? "province" : "state"}.`;
  const postal = POSTAL[address.country];
  if (!address.zip.trim()) errors.zip = "Enter the ZIP or postal code.";
  else if (postal && !postal[0].test(address.zip.trim())) errors.zip = `Enter a valid postal code, like ${postal[1]}.`;
  if (address.phone.trim() && !/^\+?[\d\s().-]{7,20}$/.test(address.phone.trim())) errors.phone = "Enter a valid phone number, or leave it empty.";
  return errors;
}

// The same place, however it was typed (case, spaces and punctuation aside).
export function sameAddress(a: Partial<ShippingAddress>, b: Partial<ShippingAddress>) {
  const key = (address: Partial<ShippingAddress>) => [address.address1, address.address2, address.city, address.zip, address.country]
    .map((part) => (part || "").toLowerCase().replace(/[^a-z0-9]/g, "")).join("|");
  return key(a) === key(b);
}

// Fulfillment statuses (Shopify's OrderDisplayFulfillmentStatus) where nothing
// has started yet, so the parcel can still go somewhere else.
const NOT_STARTED = ["UNFULFILLED", "ON_HOLD", "SCHEDULED", "OPEN", "REQUEST_DECLINED"];
export type AddressCheckOrder = {
  cancelled: boolean; fulfillmentStatus: string; shipments: number; requiresShipping: boolean; hasShippingAddress: boolean; country: string; verified: boolean;
};
export type AddressCheck = { id: string; label: string; ok: boolean; detail: string };

// When a shipping address can be changed. Every check must pass, except
// "verified", which staff may confirm with the customer themselves.
export function addressChangeChecks(order: AddressCheckOrder | null, newCountry: string): AddressCheck[] {
  if (!order) return [{ id: "found", label: "Order found in Shopify", ok: false, detail: "Check the order number with the customer." }];
  const notStarted = order.shipments === 0 && NOT_STARTED.includes(order.fulfillmentStatus);
  const sameCountry = !newCountry || !order.country || newCountry === order.country;
  return [
    { id: "found", label: "Order found in Shopify", ok: true, detail: "" },
    { id: "cancelled", label: "Order isn't cancelled", ok: !order.cancelled, detail: order.cancelled ? "A cancelled order won't be shipped." : "" },
    { id: "shipped", label: "Not shipped or being packed yet", ok: notStarted,
      detail: notStarted ? "" : "Fulfillment has started, so the parcel can't be redirected from here. The customer can ask the carrier to redirect it." },
    { id: "shipping", label: "Ships to an address", ok: order.requiresShipping && order.hasShippingAddress,
      detail: order.requiresShipping && order.hasShippingAddress ? "" : "This order is picked up or has nothing to ship." },
    { id: "country", label: "New address is in the same country", ok: sameCountry,
      detail: sameCountry ? "" : `Shipping, taxes and duties differ between countries (${countryName(order.country)} → ${countryName(newCountry)}). The customer can cancel and order again.` },
    { id: "verified", label: "Placed with the customer's email", ok: order.verified,
      detail: order.verified ? "" : "The order's email differs from this request. Confirm the change with the order's customer before updating it." },
  ];
}
// The checks' view of a Shopify order (OrderDetails in help-desk-orders.server.ts).
export const addressCheckOrder = (
  order: { cancelled: boolean; fulfillmentStatus: string; shipments: unknown[]; requiresShipping: boolean; shippingAddress: unknown; country: string; email: string },
  ticketEmail: string,
): AddressCheckOrder => ({
  cancelled: order.cancelled, fulfillmentStatus: order.fulfillmentStatus, shipments: order.shipments.length, requiresShipping: order.requiresShipping,
  hasShippingAddress: Boolean(order.shippingAddress), country: order.country,
  verified: Boolean(order.email) && order.email.trim().toLowerCase() === ticketEmail.trim().toLowerCase(),
});
// When a whole order can still be cancelled: it exists, isn't cancelled and nothing has shipped.
export function cancelChecks(order: AddressCheckOrder | null): AddressCheck[] {
  if (!order) return [{ id: "found", label: "Order found in Shopify", ok: false, detail: "Check the order number with the customer." }];
  const unshipped = order.shipments === 0 && !["FULFILLED", "PARTIALLY_FULFILLED"].includes(order.fulfillmentStatus);
  return [
    { id: "found", label: "Order found in Shopify", ok: true, detail: "" },
    { id: "cancelled", label: "Order isn't cancelled", ok: !order.cancelled, detail: order.cancelled ? "It's already cancelled." : "" },
    { id: "shipped", label: "Nothing has shipped yet", ok: unshipped, detail: unshipped ? "" : "It has shipped, so it can't be cancelled. The customer can return it instead." },
  ];
}

// What the customer is told on the storefront when their order can't be
// changed, by the first failing check. Staff see the checks' own details.
export const CUSTOMER_BLOCKED: Record<"cancel" | "address", Record<string, string>> = {
  cancel: {
    cancelled: "This order is already cancelled.",
    shipped: "This order has already shipped, so it can no longer be cancelled. Once it arrives, you can send it back: choose Returns, Exchanges & Refunds.",
  },
  address: {
    cancelled: "This order is cancelled, so its address can't be changed.",
    shipped: "This order has already shipped or is being packed, so its address can no longer be changed. Please contact the carrier using your tracking number to redirect it.",
    shipping: "This order isn't delivered to an address (for example, it's a pickup order), so there's no address to change.",
    country: "We can only change the address to one in the same country as your order. To ship to another country, please cancel this order and place a new one.",
  },
};

// Blocking checks: everything except the email, which staff can confirm by hand.
export const addressBlockers = (checks: AddressCheck[]) => checks.filter((check) => !check.ok && check.id !== "verified");
// Delivery problems, the most common order question.
export const deliveryIssues = [
  "Order status inquiry", "Marked as delivered, not received", "Partial delivery received", "Expedited shipping request", "Delivered to an incorrect address",
  "Order not shipped yet", "Shipment delayed", "Delivery attempted or failed", "Package lost", "Signature required",
];
// Which part has the problem, so tickets can be counted per part (risers, lids, locks...).
export const productParts = ["Case or body", "Lid", "Risers", "Acrylic or guard", "Lock or latch", "Wheels or handle", "Foam or insert", "Bag strap or zipper", "Complimentary gift (sling bag)", "Accessory (labels, card holders)", "Other"];
// What the customer would like done about a damaged, defective or missing item. The team decides.
export const issueResolutions = ["Replacement", "Replacement part", "Refund", "Not sure"];
// A warranty claim without an order we can find: where and when it was bought.
export const purchasePlaces = ["Zion Cases website", "Amazon", "A store or dealer", "Gift or other"];
export const issues = ["Defective product received", "Wrong product received", "Missing items", "Wrong item ordered"];
export type HelpDeskValues = Record<string, string>;
export type Attachment = { name: string; size: number; type: string };
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// A video the customer adds to a reply, when staff allow it: one, up to 50 MB.
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
// Any common phone or camera video. Browsers don't always know a file's type
// (an .mkv on Windows has none), so the extension counts too; the bytes decide (videoFormat).
export const VIDEO_EXTENSIONS = ["mp4", "m4v", "mov", "qt", "3gp", "3g2", "webm", "mkv", "avi", "wmv", "asf", "mpg", "mpeg", "m2v", "ts", "mts", "m2ts", "flv"];
export const VIDEO_FORMATS_LABEL = "MP4, MOV, AVI, MKV, WebM or another video";
export const looksLikeVideo = (file: { name: string; type: string }) =>
  file.type.startsWith("video/") || VIDEO_EXTENSIONS.includes(file.name.split(".").pop()?.toLowerCase() || "");
// Videos browsers play inline; others are downloaded to watch.
export const PLAYABLE_VIDEO = ["video/mp4", "video/webm", "video/quicktime"];

// A video's real format from its first bytes, or null when it isn't one we
// know. Stored as its type, so a renamed file can't pass as a video.
export function videoFormat(bytes: Uint8Array): string | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  // MP4, MOV, M4V and 3GP: an ISO media box ("ftyp", or an older first box).
  if (["ftyp", "moov", "mdat", "wide", "free", "skip", "pnot"].includes(ascii(4, 8))) {
    const brand = ascii(4, 8) === "ftyp" ? ascii(8, 12) : "qt  ";
    return brand === "qt  " ? "video/quicktime" : brand.startsWith("3g2") ? "video/3gpp2" : brand.startsWith("3gp") ? "video/3gpp" : brand === "M4V " ? "video/x-m4v" : "video/mp4";
  }
  // WebM and MKV: an EBML header naming its doc type.
  if (starts(0x1a, 0x45, 0xdf, 0xa3)) return ascii(0, 64).includes("webm") ? "video/webm" : "video/x-matroska";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "AVI ") return "video/x-msvideo";
  if (starts(0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11)) return "video/x-ms-wmv";
  if (starts(0x00, 0x00, 0x01, 0xba) || starts(0x00, 0x00, 0x01, 0xb3)) return "video/mpeg";
  // MPEG transport streams (.ts, and camera .mts/.m2ts with a 4-byte prefix per packet).
  if ((bytes[0] === 0x47 && bytes[188] === 0x47 && bytes[376] === 0x47) || (bytes[4] === 0x47 && bytes[196] === 0x47 && bytes[388] === 0x47)) return "video/mp2t";
  if (ascii(0, 3) === "FLV") return "video/x-flv";
  return null;
}
export const MAX_IMAGES = 5;

// Photos are needed when something arrived broken, wrong or incomplete, not
// for returns the customer simply changed their mind about.
export function imagesRequired(values: HelpDeskValues) {
  return (values.topic === topics[4] && issues.slice(0, 3).includes(values.issue))
    || (values.topic === topics[3] && (values.orderType === orderTypes[2] || (values.orderType === orderTypes[1] && issues.slice(0, 2).includes(values.issue))));
}

export function validateHelpDesk(values: HelpDeskValues, products: string[], files: Attachment[], receivedProducts: string[] = []) {
  const errors: Record<string, string> = {};
  const required = (key: string, label: string) => { if (!values[key]?.trim()) errors[key] = `${label} is required.`; };
  const choice = (key: string, options: readonly string[], label: string) => { if (!options.includes(values[key])) errors[key] = `Select ${label}.`; };
  required("name", "Name");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email?.trim() || "")) errors.email = "Enter a valid email address.";
  choice("topic", topics, "a topic");
  if (values.topic === topics[0]) {
    if (!products.length) errors.products = "Select at least one product.";
    required("country", "Country"); required("address", "Address");
  }
  if (values.topic === topics[1] || values.topic === topics[2]) {
    choice("existing", ["Yes", "No"], "Yes or No");
    if (values.existing === "Yes" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.registeredEmail?.trim() || "")) errors.registeredEmail = "Enter your registered email address.";
    required("query", "Query");
  }
  if (values.topic === topics[3]) {
    required("orderNumber", "Order number"); choice("orderType", orderTypes, "an order query type");
    if (values.orderType === orderTypes[0] && values.update === updates[2]) {
      // Cancelling the whole order: a reason from the list, explained when it's "Other".
      choice("cancelReason", cancelReasons, "a reason for cancelling");
      if (values.cancelReason === "Other") required("details", "Reason for cancelling");
    } else if (values.orderType === orderTypes[0] && values.update === updates[1]) {
      // A new shipping address, part by part, checked the way Shopify will check it.
      const field = { name: "shipName", address1: "shipAddress1", address2: "shipAddress2", city: "shipCity", province: "shipProvince", zip: "shipZip", country: "shipCountry", phone: "shipPhone" } as const;
      for (const [key, error] of Object.entries(addressProblems(addressFromValues(values)))) errors[field[key as keyof typeof field]] = error;
    } else if (values.orderType === orderTypes[0]) {
      choice("update", updates, "an order update"); required("details", "Update details");
    } else if (values.orderType === orderTypes[1]) {
      choice("issue", issues.slice(0, 3), "a product issue"); required("details", "Issue details");
      if (values.resolution) choice("resolution", issueResolutions, "what you'd like us to do");
      if (values.part) choice("part", productParts, "which part has the problem");
      if (values.purchasedFrom) choice("purchasedFrom", purchasePlaces, "where you bought it");
      if (values.purchaseDate && !/^\d{4}-(0[1-9]|1[0-2])$/.test(values.purchaseDate)) errors.purchaseDate = "Enter the month you bought it.";
    } else if (values.orderType === orderTypes[2]) {
      // What arrived: a product picked from the store, or described per product.
      if (!receivedProducts.length && !values.details?.trim()) errors.receivedProducts = "Tell us what you received.";
      if (values.resolution) choice("resolution", issueResolutions, "what you'd like us to do");
      if (!products.length) errors.products = "Select the product you wanted.";
    } else if (values.orderType === orderTypes[3]) {
      choice("delivery", deliveryIssues, "what's wrong with the delivery");
    }
  }
  if (values.topic === topics[4]) {
    required("orderNumber", "Order number"); required("orderDetails", "Order details"); required("productDetails", "Product details");
    choice("issue", issues, "an issue"); required("details", "Issue details");
    if (values.part && !productParts.includes(values.part)) errors.part = "Select which part has the problem."; choice("resolution", ["Return", "Exchange", "Refund"], "a preferred resolution");
  }
  if (values.topic === topics[5]) required("query", "Your question");
  const allowsImages = values.topic === topics[4] || values.topic === topics[5] || (values.topic === topics[3] && (values.orderType === orderTypes[1] || values.orderType === orderTypes[2]));
  if (allowsImages) {
    if (imagesRequired(values) && !files.length) errors.images = "Upload at least one image for this issue.";
    if (files.length > MAX_IMAGES) errors.images = `Upload no more than ${MAX_IMAGES} images.`;
    if (files.some(file => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size === 0 || file.size > MAX_IMAGE_BYTES)) errors.images = "Use non-empty JPG, PNG or WebP images, up to 10 MB each.";
  }
  return errors;
}

// ISO 3166-1 regions, including territories; labels are localized by Intl.
const regionCodes = "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW";
const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
export const countries = regionCodes.split(" ").map(code => ({ code, name: regionNames.of(code) || code })).sort((a, b) => a.name.localeCompare(b.name));

export const ticketStatuses = ["Open", "In progress", "Waiting on customer", "Resolved"] as const;
export const priorities = ["Low", "Normal", "High", "Urgent"] as const;
// Topic of tickets started from the storefront chat widget.
export const CHAT_TOPIC = "Live Chat";
export const MAX_MESSAGE_LENGTH = 10000;
export const ticketLabel = (number: number) => `#${number}`;

// Placeholders saved replies can use, with what each one inserts.
export const macroPlaceholders: [string, string][] = [
  ["customer.first_name", "Customer's first name"], ["customer.name", "Customer's full name"], ["ticket.number", "Ticket number"],
  ["ticket.topic", "Ticket topic"], ["order.number", "Order number from the request"], ["store.name", "Your store name"],
  ["order.carrier", "Shipping carrier, from Shopify"], ["order.tracking_number", "Tracking number"], ["order.tracking_url", "Tracking link"],
  ["order.shipment_status", "Latest delivery status, e.g. In transit"],
];

// The ticket's order tracking, from Shopify, for the order.* placeholders.
export type MacroOrder = { name: string; carrier: string; trackingNumber: string; trackingUrl: string; shipmentStatus: string };

// Fills a saved reply's placeholders. One with no value yet (say, no tracking
// number) is left as written, so the agent sees what still needs filling in.
export function fillMacro(body: string, ticket: { name: string; number: number; topic: string; details: Record<string, string> }, storeName: string, order?: MacroOrder | null) {
  const values: Record<string, string> = {
    "customer.first_name": ticket.name.trim().split(/\s+/)[0] || ticket.name,
    "customer.name": ticket.name,
    "ticket.number": `#${ticket.number}`,
    "ticket.topic": ticket.topic,
    "order.number": order?.name || ticket.details.orderNumber || "",
    "store.name": storeName,
    "order.carrier": order?.carrier || "",
    "order.tracking_number": order?.trackingNumber || "",
    "order.tracking_url": order?.trackingUrl || "",
    "order.shipment_status": order?.shipmentStatus || "",
  };
  return body.replace(/\{\{\s*([a-z_.]+)\s*\}\}/g, (match, key: string) => values[key] || match);
}

// Saved replies a new store starts with. category and subcategory are from
// help-desk-taxonomy.ts; empty means a general reply for any ticket.
export const defaultMacros = [
  { title: "Acknowledge and investigating", category: "", subcategory: "", body: "Hi {{ customer.first_name }},\n\nThanks for getting in touch about {{ ticket.topic }}. We're looking into this now and will update you shortly.\n\nBest regards,\n{{ store.name }}" },
  { title: "Request photos", category: "", subcategory: "", body: "Hi {{ customer.first_name }},\n\nSorry to hear about this. Could you send us a few clear photos of the product and its packaging? You can reply on your request page and we'll take it from there.\n\nThanks,\n{{ store.name }}" },
  { title: "Replacement on the way", category: "", subcategory: "", body: "Hi {{ customer.first_name }},\n\nGood news: we've arranged a replacement for order {{ order.number }}. You'll receive a shipping confirmation by email as soon as it's dispatched.\n\nThanks for your patience,\n{{ store.name }}" },
  { title: "Refund processed", category: "", subcategory: "", body: "Hi {{ customer.first_name }},\n\nWe've processed your refund for order {{ order.number }}. Depending on your bank, it can take 5-10 business days to appear on your statement.\n\nBest regards,\n{{ store.name }}" },
  { title: "Closing: resolved", category: "", subcategory: "", body: "Hi {{ customer.first_name }},\n\nWe're glad this is sorted. We'll mark ticket {{ ticket.number }} as resolved, but just reply if there's anything else we can help with.\n\nHave a great day,\n{{ store.name }}" },
  { title: "Broken on arrival: replacement", category: "Product Damage", subcategory: "", body: "Hi {{ customer.first_name }},\n\nWe're really sorry your case arrived broken. Thanks for the photos. We'll send a replacement for order {{ order.number }} and email you the tracking as soon as it ships. There's no need to send the damaged one back.\n\nBest regards,\n{{ store.name }}" },
  { title: "Shipping damage: photos of the box", category: "Shipping Damage", subcategory: "", body: "Hi {{ customer.first_name }},\n\nWe're sorry it arrived damaged. So we can sort this out quickly, please reply with a photo of the outer shipping box and one of the damaged part.\n\nThanks,\n{{ store.name }}" },
  { title: "Missing parts: sending now", category: "Missing Parts", subcategory: "", body: "Hi {{ customer.first_name }},\n\nSorry, part of order {{ order.number }} didn't make it into the box. We're sending the missing parts today and will email you the tracking as soon as they ship.\n\nThanks for your patience,\n{{ store.name }}" },
  { title: "Will it fit? (compatibility)", category: "Product Compatibility", subcategory: "", body: "Hi {{ customer.first_name }},\n\nGreat question. To make sure you get the right case, could you tell us which card or slab you want to display (for example PSA, BGS, CGC, a One Touch or a top loader) and whether it's in a sleeve?\n\nWe'll confirm the best fit for you.\n\nThanks,\n{{ store.name }}" },
  { title: "Assembly help", category: "Product Education", subcategory: "Assembly help", body: "Hi {{ customer.first_name }},\n\nHappy to help you put it together. Could you tell us which step you're on, or send a photo of where you're stuck? We'll walk you through it.\n\nThanks,\n{{ store.name }}" },
  { title: "Scratches: protective film", category: "Manufacturing Defect", subcategory: "Scratches", body: "Hi {{ customer.first_name }},\n\nThanks for the photos. Our acrylic ships with a thin protective film on both sides, which can look like scratches or haze. Please peel it gently from one corner on each side and let us know if the marks are still there.\n\nIf they are, we'll make it right.\n\nBest regards,\n{{ store.name }}" },
  { title: "Wrong item: we'll swap it", category: "Wrong Item Received", subcategory: "", body: "Hi {{ customer.first_name }},\n\nSorry, we sent the wrong item on order {{ order.number }}. We'll ship the right one to you and email the tracking as soon as it's on its way.\n\nThanks for your patience,\n{{ store.name }}" },
  { title: "Shipping update", category: "Shipping & Delivery", subcategory: "Track My Order", body: "Hi {{ customer.first_name }},\n\nThanks for checking in on order {{ order.number }}. We're looking up the latest tracking now and will update you here shortly.\n\nBest regards,\n{{ store.name }}" },
  { title: "Wholesale: next steps", category: "Wholesale Questions", subcategory: "", body: "Hi {{ customer.first_name }},\n\nThanks for your interest in stocking our cases. Could you share your store name, website and where you're based? Our wholesale team will get back to you with pricing and minimum order details.\n\nBest regards,\n{{ store.name }}" },
  { title: "Missing risers: sending now", category: "Missing Parts", subcategory: "Risers missing", body: "Hi {{ customer.first_name }},\n\nSorry, the risers didn't make it into your box for order {{ order.number }}. We're sending them out now and will email you the tracking as soon as they ship.\n\nThanks for your patience,\n{{ store.name }}" },
  { title: "Free sling bag missing", category: "Missing Parts", subcategory: "Free gift missing", body: "Hi {{ customer.first_name }},\n\nSorry, the free sling bag was left out of order {{ order.number }}. We're sending it to you now and will share the tracking once it ships.\n\nThanks,\n{{ store.name }}" },
  { title: "Broken risers: replacement", category: "Product Damage", subcategory: "Broken risers", body: "Hi {{ customer.first_name }},\n\nSorry one of your risers arrived broken. Thanks for letting us know. We'll send a replacement for order {{ order.number }} and email you the tracking once it ships.\n\nBest regards,\n{{ store.name }}" },
  { title: "Lock code help", category: "Product Education", subcategory: "Setting the lock code", body: "Hi {{ customer.first_name }},\n\nHappy to help with the lock. Could you tell us which case you have and send a short video of what happens when you set the code? We'll walk you through it, and if the lock is faulty we'll make it right.\n\nThanks,\n{{ store.name }}" },
  { title: "Delivered but Not Received", category: "Shipping & Delivery", subcategory: "Delivered but Not Received", body: "Hi {{ customer.first_name }},\n\nSorry your package hasn't turned up even though it shows as delivered. Please check with neighbours and around your building, as carriers sometimes leave parcels nearby. We're also opening a claim with the carrier for order {{ order.number }} and will update you here.\n\nBest regards,\n{{ store.name }}" },
  { title: "Cancellation request", category: "Orders", subcategory: "Cancel Order", body: "Hi {{ customer.first_name }},\n\nWe've received your request to cancel order {{ order.number }}. If it hasn't shipped yet we'll cancel it and refund you in full, and we'll confirm here once it's done.\n\nBest regards,\n{{ store.name }}" },
  { title: "International shipping", category: "Shipping & Delivery", subcategory: "International Shipping", body: "Hi {{ customer.first_name }},\n\nThanks for your interest. Could you share the full delivery address and the products you'd like? We'll check shipping options and costs to your location and get back to you.\n\nBest regards,\n{{ store.name }}" },
  { title: "Tracking details", category: "Shipping & Delivery", subcategory: "Track My Order", body: "Hi {{ customer.first_name }},\n\nThank you for reaching out about order {{ order.number }}. It shipped with {{ order.carrier }}, and its current status is: {{ order.shipment_status }}.\n\nTracking number: {{ order.tracking_number }}\nTrack your package: {{ order.tracking_url }}\n\nIf it hasn't arrived within a few days of the expected date, please reply here and we'll look into it right away.\n\nBest regards,\n{{ store.name }}" },
  { title: "Order already shipped", category: "Orders", subcategory: "Cancel Order", body: "Hi {{ customer.first_name }},\n\nThank you for letting us know. Order {{ order.number }} has already shipped with {{ order.carrier }}, so we're no longer able to cancel or change it.\n\nTracking number: {{ order.tracking_number }}\n\nOnce it arrives, you're welcome to request a return or exchange and we'll take care of it.\n\nBest regards,\n{{ store.name }}" },
  { title: "Return instructions", category: "Returns", subcategory: "", body: "Hi {{ customer.first_name }},\n\nNo problem. We'll send you the return instructions for order {{ order.number }} here shortly. Please keep the case and packaging in their original condition.\n\nThanks,\n{{ store.name }}" },
];

// Labels for submitted fields, in display order. Name, email and topic are
// shown separately in the admin ticket header and the notification email.
export const fieldLabels: Record<string, string> = {
  phone: "Phone", orderNumber: "Order number", orderType: "Order query", update: "Order update", cancelReason: "Cancellation reason",
  shipName: "New address: recipient", shipAddress1: "New address: street", shipAddress2: "New address: apartment, suite", shipCity: "New address: city",
  shipProvince: "New address: state or province", shipZip: "New address: ZIP or postal code", shipCountry: "New address: country", shipPhone: "New address: phone", delivery: "Delivery problem",
  issue: "Issue", part: "Part with the problem", resolution: "Requested resolution", replacement: "Replacement wanted", purchasedFrom: "Bought from", purchaseDate: "Bought in (month)",
  orderDetails: "Order details", productDetails: "Product details",
  details: "Details", existing: "Existing partner", registeredEmail: "Registered email", query: "Query",
  country: "Country", address: "Address", otherDetails: "Other details", transcript: "Chat transcript",
};
export const countryName = (code: string) => countries.find(country => country.code === code)?.name || code;

// Tags drawn from what the customer chose in the form, so tickets are tagged
// the same way every time: topic, query type, issue and the resolution asked for.
const TAGS_BY_VALUE: Record<string, string[]> = {
  [topics[0]]: ["shipping"], [topics[1]]: ["wholesale"], [topics[2]]: ["affiliate"], [topics[4]]: ["return"], [CHAT_TOPIC]: ["chat"],
  [orderTypes[0]]: ["order-update"], [orderTypes[1]]: ["product-issue"], [orderTypes[2]]: ["wrong-item"],
  [updates[0]]: ["change-product"], [updates[1]]: ["address-change"], [updates[2]]: ["cancel"],
  [orderTypes[3]]: ["order-status"], [deliveryIssues[1]]: ["not-received"], [deliveryIssues[2]]: ["partial-delivery"], [deliveryIssues[3]]: ["expedite"],
  [productParts[2]]: ["risers"], [productParts[1]]: ["lid"], [productParts[4]]: ["lock"], [productParts[5]]: ["wheels"], [productParts[8]]: ["free-gift"],
  [issues[0]]: ["defective"], [issues[1]]: ["wrong-item"], [issues[2]]: ["missing-item"], [issues[3]]: ["ordered-wrong"],
  Return: ["return"], Exchange: ["exchange"], Refund: ["refund"],
};
const KEYWORD_TAGS: [RegExp, string][] = [
  [/\b(broken|crack(ed)?|damaged?|scratch(ed)?|shatter(ed)?)\b/i, "damaged"], [/\b(late|delay(ed)?|not (arrived|received)|where is|tracking)\b/i, "shipping-delay"],
  [/\b(cancel(led)?|cancellation)\b/i, "cancel"], [/\b(urgent|asap|immediately)\b/i, "urgent"],
];

// Suggested tags for a ticket: from the request first, then the store's most-used
// tags. Tags the ticket already has are left out.
export function suggestTags(ticket: { topic: string; details: Record<string, string>; tags: string }, usedTags: string[], limit = 8) {
  const current = new Set(ticket.tags.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean));
  const fromRequest = [ticket.topic, ticket.details.orderType, ticket.details.update, ticket.details.delivery, ticket.details.issue, ticket.details.part, ticket.details.resolution]
    .flatMap((value) => (value && TAGS_BY_VALUE[value]) || []);
  const text = [ticket.details.details, ticket.details.query, ticket.details.productDetails, ticket.details.orderDetails].filter(Boolean).join(" ");
  const fromText = KEYWORD_TAGS.filter(([pattern]) => pattern.test(text)).map(([, tag]) => tag);
  const counts = new Map<string, number>();
  for (const tag of usedTags.flatMap((value) => value.split(",")).map((tag) => tag.trim().toLowerCase()).filter(Boolean)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  const popular = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([tag]) => tag);
  const suggested = [...new Set([...fromRequest, ...fromText])].filter((tag) => !current.has(tag));
  const others = popular.filter((tag) => !current.has(tag) && !suggested.includes(tag));
  return { fromRequest: suggested.slice(0, limit), popular: others.slice(0, Math.max(0, limit - suggested.length)) };
}
