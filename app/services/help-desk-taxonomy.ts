import { CHAT_TOPIC, deliveryIssues, issues, orderTypes, productParts, topics, updates } from "./help-desk";

// The team's internal classification of a ticket, separate from the simple
// topic the customer picks on the form: Category › Sub-category › Root cause ›
// Resolution. Tickets are classified automatically when they arrive and
// agents correct it, so the overview can report what customers struggle with
// and why, not just which form option they chose.
//
// Built from Zion Cases' daily issues list: risers, lids, acrylic guards,
// locks, wheels and handles, inserts and the free sling bag come up most.
export const categories = [
  { name: "Product Damage", description: "Arrived broken, but the shipping box was fine. Cracks, dents and broken parts.",
    subcategories: ["Cracked acrylic or guard", "Dented or bent case", "Broken risers", "Broken lid", "Broken lock or latch", "Broken wheels or handle", "Other damage"] },
  { name: "Shipping Damage", description: "Damaged on the way: the shipping box was crushed, dented, wet or opened.",
    subcategories: ["Box crushed or dented", "Damaged in transit", "Package opened or wet"] },
  { name: "Missing Parts", description: "Something wasn't in the box: risers, lids, inserts, the free gift or an accessory.",
    subcategories: ["Risers missing", "Lids or panels missing", "Foam or insert missing", "Free gift missing", "Accessory missing", "Item missing from order"] },
  { name: "Manufacturing Defect", description: "Made wrong, not broken in transit: scratches, a lid that won't close, a lock that won't set.",
    subcategories: ["Defective or not working", "Scratches", "Lid shifts or won't close", "Lock won't set or open", "Wheel or handle failed", "Insert doesn't fit", "Bottom not flat or bowing", "Squeaking or noise", "Poor quality overall"] },
  { name: "Wrong Item Received", description: "We sent the wrong colour, variant, product or quantity.",
    subcategories: ["Wrong colour or variant", "Wrong product", "Wrong quantity", "Part of the order wrong"] },
  { name: "Product Compatibility", description: "Will my cards or slabs fit? PSA, BGS, CGC, graded guards, binders and sizes.",
    subcategories: ["PSA slab fit", "BGS slab fit", "CGC slab fit", "SGC or TAG slab fit", "Graded guards fit", "One Touch or magnetic holder fit", "Top loader or sleeve fit", "Binder: which cards fit", "Dimensions"] },
  { name: "Product Education", description: "How do I...? Protective film, lock codes, assembly, wheels and care.",
    subcategories: ["Removing protective film", "Setting the lock code", "Assembly help", "Replacing a wheel", "Cleaning and care", "Display tips"] },
  // Orders and Shipping & Delivery use the storefront form's own topic and issue
  // names (help-desk-form.ts), so a ticket reads exactly as the customer chose.
  // Orders: before the order ships (Shopify: unfulfilled, on hold) and its payment.
  { name: "Orders", description: "Changes, cancellations and payment for an order that hasn't shipped yet.",
    subcategories: ["Cancel Order", "Edit Items, Color or Quantity", "Change Shipping Address", "Payment Issue", "Order on Hold", "Invoice or Receipt", "Cancel Shipping Protection"] },
  // Shipping & Delivery: Shopify's shipment statuses, then shipping outside the U.S.
  { name: "Shipping & Delivery", description: "Tracking and every delivery status from not shipped yet to delivered, and shipping costs and times in the U.S. and abroad.",
    subcategories: [
      "Track My Order", "Order Not Shipped Yet", "Shipment Delayed", "Delivery Attempted or Failed", "Delivered but Not Received", "Partial Delivery",
      "Delivered to Wrong Address", "Lost Package", "Signature Required", "Expedited Shipping", "Shipping Times", "Domestic Shipping", "International Shipping", "Hawaii, Alaska & U.S. Territories", "International Pre-Order", "Customs & Duties",
    ] },
  { name: "Returns", description: "The customer wants to send it back or swap it for another model.",
    subcategories: ["Ordered extra", "Ordered the wrong item or colour", "Doesn't fit my cards", "Doesn't meet expectations", "Exchange for another model", "Refund status"] },
  { name: "Warranty", description: "A replacement or spare part under warranty, or buying a spare part.",
    subcategories: ["Replacement request", "Buy a replacement part", "Claim status"] },
  { name: "Wholesale Questions", description: "Dealers and stores: pricing, MOQ, applications and tax certificates.",
    subcategories: ["Dealer pricing", "Minimum order (MOQ)", "Application status", "Tax exemption or resale certificate", "Bulk discount", "Private label", "Other wholesale"] },
  { name: "Affiliates & Partnerships", description: "Affiliates and creators: joining, support and payouts.",
    subcategories: ["Join the program", "Existing partner support", "Commission or payout"] },
  { name: "Website & Checkout", description: "The website, checkout or a discount code isn't working.",
    subcategories: ["Discount code not working", "Checkout not working", "Website error", "Account or login"] },
  { name: "Feedback & Ideas", description: "Complaints, reviews and ideas: what customers wish was different.",
    subcategories: ["Bad review or complaint", "New colour", "New size", "New product", "Packaging suggestion", "Other idea"] },
  { name: "Other", description: "Anything that doesn't fit above. If it keeps coming up, it needs its own category.",
    subcategories: ["General question"] },
] as const;

export const categoryNames = categories.map((category) => category.name) as string[];
export const describeCategory = (category: string) => categories.find((entry) => entry.name === category)?.description ?? "";
export const subcategoriesOf = (category: string): readonly string[] => categories.find((entry) => entry.name === category)?.subcategories ?? [];

// Why it happened, so fixes can go to the team that owns the cause.
export const rootCauseTeams = {
  "Transit damage": "Shipping & carriers",
  "Carrier delay or lost package": "Shipping & carriers",
  "Carrier delivery error": "Shipping & carriers",
  "Item not packed (warehouse)": "Warehouse & fulfilment",
  "Wrong item or variant packed": "Warehouse & fulfilment",
  "Free gift not added": "Warehouse & fulfilment",
  "Fulfilment delay or backorder": "Warehouse & fulfilment",
  "Packaging not protective enough": "Packaging",
  "Manufacturing or QC defect": "Manufacturing",
  "Design weakness (lid, lock, wheels)": "Product design",
  "Product page unclear (size or fit)": "Product page & guides",
  "Protective film confusion": "Product page & guides",
  "No how-to guide": "Product page & guides",
  "Website or discount bug": "Website & tech",
  "Customer ordered the wrong item": "Support",
  "Customer changed mind": "Support",
  "Customer handling": "Support",
  "Not a product issue": "Support",
  "Unknown": "Support",
} as const;
export const rootCauses = Object.keys(rootCauseTeams) as (keyof typeof rootCauseTeams)[];
export const teamFor = (rootCause: string) => (rootCauseTeams as Record<string, string>)[rootCause] ?? "";

// What the team did to close the ticket.
export const resolutionTypes = [
  "Refund", "Partial refund", "Replacement", "Replacement part", "Store credit", "Discount offered", "Exchange", "Return accepted",
  "Instructions or tutorial sent", "Recommended the right product", "Order updated", "Order cancelled", "Tracking shared",
  "Question answered", "Request declined", "No action needed",
] as const;

export type Classification = { category: string; subcategory: string };

const has = (text: string, pattern: RegExp) => pattern.test(text);
// "Scratch Resistant" and "scratch-less" are product names, not complaints.
const SCRATCH = /\bscratch(?![\s-]*(resistant|less|proof))/i;

// The part the customer picked on the form, as each category's sub-category.
const PART = Object.fromEntries(productParts.map((part, index) => [part, index])) as Record<string, number>;
const DAMAGE_BY_PART = ["Dented or bent case", "Broken lid", "Broken risers", "Cracked acrylic or guard", "Broken lock or latch", "Broken wheels or handle", "Other damage", "Other damage", "Other damage", "Other damage", "Other damage"];
const MISSING_BY_PART = ["Item missing from order", "Lids or panels missing", "Risers missing", "Item missing from order", "Item missing from order", "Item missing from order", "Foam or insert missing", "Item missing from order", "Free gift missing", "Accessory missing", "Item missing from order"];
const DEFECT_BY_PART: Record<number, string> = { 1: "Lid shifts or won't close", 4: "Lock won't set or open", 5: "Wheel or handle failed", 6: "Insert doesn't fit" };

// Sub-categories from the customer's words, most specific first.
const SUBCATEGORY_WORDS: Record<string, [RegExp, string][]> = {
  "Product Damage": [[/\briser/i, "Broken risers"], [/\b(acrylic|guard|crack|shatter)/i, "Cracked acrylic or guard"], [/\b(wheel|handle)/i, "Broken wheels or handle"],
    [/\b(lock|latch|clasp|hinge)/i, "Broken lock or latch"], [/\blid\b/i, "Broken lid"], [/\b(dent|bent|gouge|bow)/i, "Dented or bent case"]],
  "Shipping Damage": [[/\b(box|package|parcel)\b[^.]*\b(crush|damag|dent)/i, "Box crushed or dented"], [/\b(wet|opened|tampered)/i, "Package opened or wet"]],
  "Missing Parts": [[/\briser/i, "Risers missing"], [/\bonly \d+ (out (of )?|of )\d+ lids?\b/i, "Lids or panels missing"], [/\b(sling|free gift|gift)/i, "Free gift missing"], [/\b(lid|panel)s?\b/i, "Lids or panels missing"],
    [/\b(foam|insert|carbon fib)/i, "Foam or insert missing"], [/\b(label|magpro|holder|sleeve|accessor)/i, "Accessory missing"]],
  "Manufacturing Defect": [[SCRATCH, "Scratches"], [/\b(lock|code|latch)|(unable to|can'?t|won'?t) open/i, "Lock won't set or open"], [/\b(wheel|handle)/i, "Wheel or handle failed"],
    [/\b(lid)\b[^.]*\b(shift|close|loose)|won'?t close|doesn'?t close|not clos/i, "Lid shifts or won't close"], [/\b(insert)\b[^.]*\bfit/i, "Insert doesn't fit"],
    [/\b(bottom|base)\b[^.]*\b(flat|bow)|\bbowing\b/i, "Bottom not flat or bowing"], [/\b(squeak|noise|rattl)/i, "Squeaking or noise"], [/\b(quality|disappointed|cheap)/i, "Poor quality overall"]],
  "Wrong Item Received": [[/\b\d+ (out (of )?|of )\d+\b/i, "Part of the order wrong"], [/\b(colou?r|variant|black|white|blue|red|green|clear|instead of)\b/i, "Wrong colour or variant"],
    [/\b(quantity|only (one|1)|too many)\b/i, "Wrong quantity"]],
  "Product Compatibility": [[/\bpsa\b/i, "PSA slab fit"], [/\bbgs\b|beckett/i, "BGS slab fit"], [/\bcgc\b/i, "CGC slab fit"], [/\bsgc\b|\btag\b/i, "SGC or TAG slab fit"],
    [/graded guard/i, "Graded guards fit"], [/one ?touch|magnetic holder|magpro/i, "One Touch or magnetic holder fit"], [/top ?loader|sleeve/i, "Top loader or sleeve fit"],
    [/\bbinder/i, "Binder: which cards fit"], [/dimension|interior|measure|size/i, "Dimensions"]],
  "Product Education": [[/protective film|\bfilm|\bpeel|wrapper/i, "Removing protective film"], [/\b(lock|code|combination)\b/i, "Setting the lock code"], [/\bwheel/i, "Replacing a wheel"],
    [/assembl|install|put together|set ?up/i, "Assembly help"], [/clean|polish|\bcare\b/i, "Cleaning and care"], [/display|stand|mount|wall/i, "Display tips"]],
  ...ordersAndShipping(),
  Returns: [[/\bextra\b|ordered (2|two|more)|need(ed)? only one|only (needed|wanted) one/i, "Ordered extra"], [/\bordered\b[^.]*\binstead of\b|ordered (the )?wrong|wrong (colou?r|item|size)/i, "Ordered the wrong item or colour"], [/\bexchange|swap|vertical|horizontal/i, "Exchange for another model"],
    [/\b(fit|accommodate|graded)/i, "Doesn't fit my cards"], [/wrong (colou?r|item|size)/i, "Ordered the wrong item or colour"], [/\brefund/i, "Refund status"],
    [/disappoint|quality|not (great|good|working)|expect/i, "Doesn't meet expectations"]],
  Warranty: [[/\b(buy|purchase|order)\b[^.]*\b(part|wheel|lid|riser|replaceable)/i, "Buy a replacement part"], [/status|update/i, "Claim status"]],
  "Wholesale Questions": [[/pric/i, "Dealer pricing"], [/\bmoq\b|minimum/i, "Minimum order (MOQ)"], [/applica|approv|status/i, "Application status"],
    [/tax|resale|certificate|exempt/i, "Tax exemption or resale certificate"], [/bulk|volume|discount/i, "Bulk discount"], [/private label|custom logo|branding/i, "Private label"]],
  "Affiliates & Partnerships": [[/commission|payout|paid|payment/i, "Commission or payout"]],
  "Website & Checkout": [[/discount|promo|coupon|code/i, "Discount code not working"], [/checkout|payment/i, "Checkout not working"], [/login|account|password/i, "Account or login"]],
  "Feedback & Ideas": [[/not (a )?(great|good)|\bbad\b|disappoint|terrible|review/i, "Bad review or complaint"], [/colou?r/i, "New colour"], [/size|bigger|smaller/i, "New size"], [/packag/i, "Packaging suggestion"]],
};

// Orders and Shipping & Delivery, told apart by the same words in one list, most
// specific first: "cancel my order" is Orders, "it says delivered" is shipping.
function orderWords(): [RegExp, string, string][] {
  return [
    [/charged (twice|two times|double)|double charged|payment (failed|pending|declined|didn'?t go through)|card (was )?declined/i, "Orders", "Payment Issue"],
    [/\b(invoice|receipt)\b/i, "Orders", "Invoice or Receipt"],
    [/armou?rship|shipping protection|insurance/i, "Orders", "Cancel Shipping Protection"],
    [/not (yet )?shipped|hasn'?t shipped|unfulfilled|still processing/i, "Shipping & Delivery", "Order Not Shipped Yet"],
    [/marked (as )?delivered|says delivered|shows delivered|delivered none/i, "Shipping & Delivery", "Delivered but Not Received"],
    [/wrong address/i, "Shipping & Delivery", "Delivered to Wrong Address"],
    [/\bsignature\b|\bsign(ed)? for\b/i, "Shipping & Delivery", "Signature Required"],
    [/\blost\b|never (arrived|came)/i, "Shipping & Delivery", "Lost Package"],
    [/how long|shipping times?|delivery times?|when will (it|my order|this) (ship|arrive)/i, "Shipping & Delivery", "Shipping Times"],
    [/failed delivery|delivery (attempt|failed)/i, "Shipping & Delivery", "Delivery Attempted or Failed"],
    [/fragment|partial|only (\d|some)|out of \d|few items/i, "Shipping & Delivery", "Partial Delivery"],
    [/expedite|faster|rush/i, "Shipping & Delivery", "Expedited Shipping"],
    [/hawai|alaska|puerto rico|guam|territor/i, "Shipping & Delivery", "Hawaii, Alaska & U.S. Territories"],
    [/pre.?order/i, "Shipping & Delivery", "International Pre-Order"],
    [/\btax(es)?\b|dut(y|ies)|customs/i, "Shipping & Delivery", "Customs & Duties"],
    [/\b(international|overseas|uk|canada|australia|europe|spain|españa|france|singapore)\b/i, "Shipping & Delivery", "International Shipping"],
    [/\bcancel/i, "Orders", "Cancel Order"],
    [/\bon hold\b/i, "Orders", "Order on Hold"],
    [/\baddress\b/i, "Orders", "Change Shipping Address"],
    [/\b(change|edit)\b[^.]*\b(variant|colou?r|product|order)|\binstead of\b/i, "Orders", "Edit Items, Color or Quantity"],
    [/\b(delay|late|months?)\b/i, "Shipping & Delivery", "Shipment Delayed"],
    [/track|where is|status|update|not delivered|no updates?/i, "Shipping & Delivery", "Track My Order"],
  ];
}
function ordersAndShipping() {
  const words = orderWords();
  return {
    Orders: words.filter(([, category]) => category === "Orders").map(([pattern, , sub]) => [pattern, sub] as [RegExp, string]),
    "Shipping & Delivery": words.filter(([, category]) => category === "Shipping & Delivery").map(([pattern, , sub]) => [pattern, sub] as [RegExp, string]),
  };
}
// Which of the two an order-related message is about; shipping when unclear.
const orderCategory = (text: string) => orderWords().find(([pattern]) => has(text, pattern))?.[1] ?? "Shipping & Delivery";

// Used when nothing in the customer's words points to a sub-category.
const DEFAULT_SUBCATEGORY: Record<string, string> = {
  Warranty: "Replacement request", "Shipping & Delivery": "Track My Order",
  "Wrong Item Received": "Wrong product", "Missing Parts": "Item missing from order", "Product Damage": "Other damage", "Feedback & Ideas": "Bad review or complaint",
};
const subcategoryFor = (category: string, text: string, fallback = DEFAULT_SUBCATEGORY[category] ?? "") =>
  SUBCATEGORY_WORDS[category]?.find(([pattern]) => has(text, pattern))?.[1] ?? fallback;

// Category from the words alone, for free-text requests (live chat, emails)
// and to spot damage that happened in transit.
export function categoryFromText(text: string) {
  if (has(text, /\b(box|package|parcel)\b[^.]*\b(crush|damag|dent|smash)/i)) return "Shipping Damage";
  if (has(text, /\b(discount|promo|coupon) code\b|\b(checkout|website)\b[^.]*\b(not|error|down)/i)) return "Website & Checkout";
  // Delivery problems mention "wrong" and "missing" too, but the order is what went wrong.
  if (has(text, /marked (as )?delivered|says delivered|shows delivered|delivered none|wrong address/i)) return "Shipping & Delivery";
  if (has(text, /\b(warranty)\b/i) || has(text, /\b(buy|purchase)\b[^.]*\b(replace|spare|part|wheel)/i)) return "Warranty";
  if (has(text, /\bnot (a )?(great|good) product\b|\b(bad|negative) review\b/i)) return "Feedback & Ideas";
  if (has(text, /\b(missing|without|wihout|didn'?t (come|arrive) with|not included)\b|\bonly \d+ (out (of )?|of )\d+/i)) return "Missing Parts";
  // The problem comes before what the customer wants done about it: scratched
  // lids they want to return are a defect, with Return as the resolution.
  if (has(text, SCRATCH) || has(text, /\b(won'?t close|doesn'?t close|shifts?|squeak|bowing|not flat|lock issue|unable to open|fell off|quality)/i)) return "Manufacturing Defect";
  if (has(text, /\b(broken|broke|brok|crack(ed)?|shatter(ed)?|snapped|dent(ed)?|damaged?)\b/i)) return "Product Damage";
  if (has(text, /\b(return(s|ed|ing)?|refund(ed)?|exchange)\b/i)) return "Returns";
  // "Ordered X instead of Y" is the customer's mix-up; "received X instead of Y" is ours.
  // "Order X instead of Y" (not yet received) asks to change the order.
  if (has(text, /\b(wrong|incorrect|instead of)\b/i)) {
    if (has(text, /\b(received|got|came|delivered|sent|arrived|incorrect)\b/i) || !has(text, /\border(ed)?\b/i)) return "Wrong Item Received";
    return has(text, /\bordered\b/i) ? "Returns" : "Orders";
  }
  if (has(text, /\b(fit|fits|fitting|accommodate|compatible|dimension|interior)\b/i)) return "Product Compatibility";
  if (has(text, /\b(hawai|alaska|puerto rico|international|overseas|uk|canada|australia|europe|spain|france|singapore)\b/i)) return "Shipping & Delivery";
  if (has(text, /\b(how (do|to)|assembl|protective film|peel|clean)/i)) return "Product Education";
  if (has(text, /\b(wish|would love|suggest|please make|not (a )?great product)\b/i)) return "Feedback & Ideas";
  if (has(text, /\b(wholesale|dealer|reseller|bulk)\b/i)) return "Wholesale Questions";
  if (has(text, /\b(affiliate|commission|influencer)\b/i)) return "Affiliates & Partnerships";
  if (has(text, /\b(order(ed|s)?|track(ing)?|ship(ping|ment|ped)?|deliver(y|ed)?|cancel|address|delay(ed)?|status|updates?|invoice|receipt|charged|payment)\b/i)) return orderCategory(text);
  return "";
}

// "Defective product received" covers three different problems: broken in
// transit (the box shows it), broken parts, and things made wrong.
function defectCategory(text: string) {
  if (has(text, /\b(box|package|parcel)\b[^.]*\b(crush|damag|dent|smash)|damaged (in|during) (shipping|transit)/i)) return "Shipping Damage";
  if ((has(text, SCRATCH) || has(text, /\b(won'?t close|doesn'?t close|shift|squeak|noise|bowing|not flat|lock|code|fell off|insert|quality)/i)) && !has(text, /\b(broken|broke|crack|shatter|snapped)/i)) return "Manufacturing Defect";
  return "Product Damage";
}
const DEFECT_FALLBACK: Record<string, string> = { "Product Damage": "Other damage", "Shipping Damage": "Damaged in transit", "Manufacturing Defect": "" };

// Classifies a ticket from what the customer chose on the form and wrote.
export function classifyTicket(topic: string, details: Record<string, string>): Classification {
  const text = [details.details, details.query, details.productDetails, details.otherDetails, details.transcript].filter(Boolean).join(" \n");
  const result = (category: string, fallback?: string) => ({ category, subcategory: subcategoryFor(category, text, fallback) });
  const part = details.part in PART ? PART[details.part] : -1;
  const issue = details.issue;
  const fromIssue = () => {
    if (issue === issues[0]) {
      const category = defectCategory(text);
      const byPart = part < 0 ? "" : category === "Product Damage" ? DAMAGE_BY_PART[part] : category === "Manufacturing Defect" ? DEFECT_BY_PART[part] ?? "" : "";
      const fromWords = subcategoryFor(category, text);
      // The customer's words are more specific than the part ("scratched lid" is Scratches, not just the lid).
      return { category, subcategory: (category === "Manufacturing Defect" ? fromWords || byPart : byPart && byPart !== "Other damage" ? byPart : fromWords) || DEFECT_FALLBACK[category] };
    }
    if (issue === issues[1]) return result("Wrong Item Received", "Wrong product");
    if (issue === issues[2]) return { category: "Missing Parts", subcategory: part >= 0 && MISSING_BY_PART[part] !== "Item missing from order" ? MISSING_BY_PART[part] : subcategoryFor("Missing Parts", text, "Item missing from order") };
    return null;
  };
  switch (topic) {
    case topics[0]: return result("Shipping & Delivery", "International Shipping");
    case topics[1]: return result("Wholesale Questions", details.existing === "No" ? "Application status" : "");
    case topics[2]: return result("Affiliates & Partnerships", details.existing === "No" ? "Join the program" : "Existing partner support");
    case topics[3]:
      if (details.orderType === orderTypes[0]) {
        if (details.update === updates[2]) return { category: "Orders", subcategory: "Cancel Order" };
        return { category: "Orders", subcategory: details.update === updates[1] ? "Change Shipping Address" : "Edit Items, Color or Quantity" };
      }
      if (details.orderType === orderTypes[2]) return result("Wrong Item Received", "Wrong product");
      if (details.orderType === orderTypes[3]) {
        // In the order of deliveryIssues (help-desk.ts).
        const delivery = ["Track My Order", "Delivered but Not Received", "Partial Delivery", "Expedited Shipping", "Delivered to Wrong Address",
          "Order Not Shipped Yet", "Shipment Delayed", "Delivery Attempted or Failed", "Lost Package", "Signature Required"][deliveryIssues.indexOf(details.delivery)];
        return { category: "Shipping & Delivery", subcategory: delivery || subcategoryFor("Shipping & Delivery", text, "Track My Order") };
      }
      return fromIssue() ?? result(orderCategory(text));
    case topics[4]:
      if (issue === issues[3]) return result("Returns", "Ordered the wrong item or colour");
      return fromIssue() ?? result("Returns");
    case CHAT_TOPIC:
    default: {
      const category = categoryFromText(text);
      return category ? result(category) : { category: "Other", subcategory: "" };
    }
  }
}

// The category and sub-category the customer picked on the storefront form
// win; anything they left out (or that isn't in the taxonomy) is filled in
// automatically from the rest of the request.
// The storefront's broad choices (like Shopify's "Damaged or defective"): the
// part and description pick the exact sub-category when they can, so reports
// still say "Lock won't set or open" rather than just "Defective".
export const BROAD_SUBCATEGORIES = ["Defective or not working", "Damaged in transit", "Item missing from order", "Other damage"];

export function classifyWithChoice(topic: string, details: Record<string, string>, chosen: { category?: string; subcategory?: string }): Classification {
  const automatic = classifyTicket(topic, details);
  if (!chosen.category || !categoryNames.includes(chosen.category)) return automatic;
  const subcategories = subcategoriesOf(chosen.category);
  if (chosen.subcategory && BROAD_SUBCATEGORIES.includes(chosen.subcategory) && subcategories.includes(chosen.subcategory)) {
    const refined = automatic.category === chosen.category ? automatic.subcategory : subcategoryFor(chosen.category, Object.values(details).join(" \n"));
    return { category: chosen.category, subcategory: refined || chosen.subcategory };
  }
  const subcategory = chosen.subcategory && subcategories.includes(chosen.subcategory) ? chosen.subcategory
    : automatic.category === chosen.category ? automatic.subcategory : subcategoryFor(chosen.category, Object.values(details).join(" \n"));
  return { category: chosen.category, subcategory };
}

type Categorised = { category: string; subcategory: string };

// Groups saved replies for a ticket's reply box: replies for its category
// (exact sub-category matches first), then general replies, then the rest.
export function groupMacros<T extends Categorised>(macros: T[], ticket: Categorised) {
  const fits = (macro: T) => Boolean(ticket.category) && macro.category === ticket.category && (!macro.subcategory || macro.subcategory === ticket.subcategory);
  const suggested = macros.filter(fits).sort((a, b) => Number(Boolean(b.subcategory)) - Number(Boolean(a.subcategory)));
  return {
    suggested,
    general: macros.filter((macro) => !macro.category),
    other: macros.filter((macro) => macro.category && !fits(macro)),
  };
}

// "Missing Parts › Risers missing", "Missing Parts" or "General".
export const macroScope = (macro: Categorised) => !macro.category ? "General" : macro.subcategory ? `${macro.category} › ${macro.subcategory}` : macro.category;
