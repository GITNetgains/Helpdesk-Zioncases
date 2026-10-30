import { categories } from "./help-desk-taxonomy";
import { deliveryIssues, issues, orderTypes, productParts, topics, updates } from "./help-desk";

// The storefront form: category, its subcategory, then the fields it needs.
// Each option carries the ticket's category and sub-category (see
// help-desk-taxonomy.ts) and the form values the request is checked against,
// so the customer's two clicks classify the ticket exactly.
//
// Labels and membership come from the same taxonomy as the admin screens.

// What a flow shows after the option is picked:
// delivery: order + optional details; orderUpdate: unshipped order + details;
// cancel: unshipped order + cancellation reason + optional details (the whole order);
// address: unshipped order + the new address, part by part + optional details;
// productIssue: order, then the products with a problem, each with details, photos and video;
// wrongItem: the same, each with what arrived instead;
// return: order + details + photos + return/exchange/refund; international: products,
// country and address; partner: existing partner? + query; question: optional order + question;
// shippingTimes: destination (and optional order) answered with the store's rates and
// delivery dates, then a question only if that didn't answer it; customs: the country
// it ships to + optional order + question.
export type Flow = "customs" | "delivery" | "orderUpdate" | "cancel" | "address" | "productIssue" | "wrongItem" | "return" | "international" | "partner" | "question" | "shippingTimes";

export type FormOption = {
  label: string;
  category: string;
  subcategory: string;
  flow: Flow;
  // Form fields the option fills in for the customer (topic, orderType, issue...).
  preset: Record<string, string>;
  // Field labels and placeholders that suit this option.
  detailsLabel?: string;
  placeholder?: string;
  // "tracking": the form can answer it straight away from the order's live
  // tracking; a request is only sent if the customer still needs help.
  selfService?: "tracking";
  // Shipping requests: which countries the address can be in (the store's own, or any other).
  region?: "domestic" | "international";
  // One option covering several ticket categories: the customer's answer
  // ("What happened?") sets the ticket's category and sub-category.
  kinds?: { label: string; hint: string; category: string; subcategory: string }[];
};
// An option's section is its ticket category, shown as a heading in the
// subcategory list when a main topic covers several categories. An option's
// description shows under the dropdown once it's picked.
// flat: a hand-picked list, shown without category headings.
export type FormGroup = { label: string; hint: string; flat?: boolean; options: (FormOption & { section: string; description?: string })[] };

const order = topics[3];
// The Orders and Shipping & Delivery topics are ticket categories of the same
// name, and each issue is the sub-category of the same name, so what the
// customer picks is exactly what the team sees.
const ORDERS = "Orders";
const SHIPPING = "Shipping & Delivery";
// Delivery questions the order's live tracking can answer without a ticket.
const TRACKABLE = ["Track My Order", "Order Not Shipped Yet", "Shipment Delayed", "Delivery Attempted or Failed", "Lost Package"];
const delivery = (label: string, value: string, detailsLabel?: string, placeholder?: string): FormOption => ({
  label, category: SHIPPING, subcategory: label, flow: "delivery", preset: { topic: order, orderType: orderTypes[3], delivery: value }, detailsLabel, placeholder,
  ...(TRACKABLE.includes(label) ? { selfService: "tracking" as const } : {}),
});
const update = (label: string, value: string, detailsLabel: string, placeholder: string): FormOption =>
  ({ label, category: ORDERS, subcategory: label, flow: "orderUpdate", preset: { topic: order, orderType: orderTypes[0], update: value }, detailsLabel, placeholder });
const orderQuestion = (label: string, placeholder: string): FormOption =>
  ({ label, category: ORDERS, subcategory: label, flow: "question", preset: { topic: topics[5] }, placeholder });
// A broken, defective or missing item. Without a part, the customer picks one.
const productIssue = (label: string, category: string, subcategory: string, issue: string, part = "", placeholder = ""): FormOption =>
  ({ label, category, subcategory, flow: "productIssue", preset: { topic: order, orderType: orderTypes[1], issue, ...(part ? { part } : {}) }, placeholder });
const question = (label: string, category: string, subcategory: string, placeholder = ""): FormOption =>
  ({ label, category, subcategory, flow: "question", preset: { topic: topics[5] }, placeholder });
const [broken, , missing, orderedWrong] = issues;
const part = (index: number) => productParts[index];

const wrongItem = (label: string, subcategory: string): FormOption =>
  ({ label, category: "Wrong Item Received", subcategory, flow: "wrongItem", preset: { topic: order, orderType: orderTypes[2] } });
const returnRequest = (label: string, subcategory: string, extra: Record<string, string> = {}): FormOption =>
  ({ label, category: "Returns", subcategory, flow: "return", preset: { topic: topics[4], issue: orderedWrong, ...extra } });
// Shipping a product to an address: what it costs and how long it takes.
const international = (label: string, region?: FormOption["region"], placeholder?: string): FormOption =>
  ({ label, category: SHIPPING, subcategory: label, flow: "international", preset: { topic: topics[0] }, ...(region ? { region } : {}), placeholder });
const partner = (label: string, category: string, subcategory: string, topic: string): FormOption =>
  ({ label, category, subcategory, flow: "partner", preset: { topic } });

const formOptions: FormOption[] = [
  { ...update("Cancel Order", updates[2], "Reason for Cancellation", "Anything else we should know? For example: I ordered the 9-pocket case instead of the 4-pocket one."), flow: "cancel" },
  update("Edit Items, Color or Quantity", updates[0], "Requested Change", "For example: Blue instead of Black, or a quantity of 2 instead of 1."),
  { ...update("Change Shipping Address", updates[1], "Anything Else? (optional)", "For example: please leave it with the front desk."), flow: "address" },
  orderQuestion("Payment Issue", "For example: payment declined, pending or charged twice."),
  orderQuestion("Order on Hold", "Please include your order number and any message you received."),
  orderQuestion("Invoice or Receipt", "Please include your order number and what you need on the invoice."),
  orderQuestion("Cancel Shipping Protection", "Please include your order number."),
  delivery("Track My Order", deliveryIssues[0]),
  delivery("Order Not Shipped Yet", deliveryIssues[5]),
  delivery("Shipment Delayed", deliveryIssues[6]),
  delivery("Delivery Attempted or Failed", deliveryIssues[7]),
  delivery("Delivered but Not Received", deliveryIssues[1]),
  delivery("Partial Delivery", deliveryIssues[2]),
  delivery("Delivered to Wrong Address", deliveryIssues[4]),
  delivery("Lost Package", deliveryIssues[8], undefined, "For example: the tracking hasn't moved in a week, or the carrier says the package is lost."),
  delivery("Signature Required", deliveryIssues[9], "Tell Us About the Delivery", "For example: I missed the delivery because a signature was needed, or I'd like a signature added to my delivery."),
  delivery("Expedited Shipping", deliveryIssues[3]),
  { ...question("Shipping Times", SHIPPING, "Shipping Times", "For example: will it arrive before Saturday?"), flow: "shippingTimes" },
  international("Domestic Shipping", "domestic", "For example: can it arrive before the 20th, or can you ship to a P.O. box?"),
  international("International Shipping", "international", "For example: which carrier do you use, or can it arrive before the 20th?"),
  international("Hawaii, Alaska & U.S. Territories"),
  international("International Pre-Order", "international", "For example: when will it be back in stock, and can you ship it to me as soon as it is?"),
  { ...question("Customs & Duties", SHIPPING, "Customs & Duties", "For example: will I pay import duties, or was I charged sales tax correctly?"), flow: "customs" },
  productIssue("Missing Risers", "Missing Parts", "Risers missing", missing, part(2)),
  productIssue("Missing Lids or Panels", "Missing Parts", "Lids or panels missing", missing, part(1), "For example: 3 of 6 lids were received."),
  productIssue("Missing Insert", "Missing Parts", "Foam or insert missing", missing, part(6)),
  productIssue("Missing Free Gift", "Missing Parts", "Free gift missing", missing, part(8)),
  productIssue("Missing Accessory", "Missing Parts", "Accessory missing", missing, part(9), "For example: NFL MagPro labels."),
  productIssue("Missing Item", "Missing Parts", "Item missing from order", missing, "", "For example: the risers weren't in the box, or 3 of 6 lids arrived."),
  productIssue("Defective or Not Working", "Manufacturing Defect", "Defective or not working", broken, "", "For example: only one lock takes the combination, or the lid won't close."),
  wrongItem("Wrong Color or Variant", "Wrong colour or variant"),
  wrongItem("Wrong Product", "Wrong product"),
  wrongItem("Wrong Quantity", "Wrong quantity"),
  productIssue("Broken Riser", "Product Damage", "Broken risers", broken, part(2)),
  productIssue("Cracked Acrylic", "Product Damage", "Cracked acrylic or guard", broken, part(3)),
  productIssue("Dented Case", "Product Damage", "Dented or bent case", broken, part(0)),
  productIssue("Broken Lid", "Product Damage", "Broken lid", broken, part(1)),
  productIssue("Broken Lock or Latch", "Product Damage", "Broken lock or latch", broken, part(4)),
  productIssue("Broken Wheel or Handle", "Product Damage", "Broken wheels or handle", broken, part(5)),
  productIssue("Damaged in Shipping", "Shipping Damage", "Box crushed or dented", broken, "", "Please include a photo of the outer shipping box."),
  productIssue("Scratches", "Manufacturing Defect", "Scratches", broken, "", "Please confirm the protective film has been removed from both sides."),
  productIssue("Lid Not Closing", "Manufacturing Defect", "Lid shifts or won't close", broken, part(1)),
  productIssue("Lock Not Working", "Manufacturing Defect", "Lock won't set or open", broken, part(4), "For example: only one lock accepts the combination."),
  productIssue("Insert Not Fitting", "Manufacturing Defect", "Insert doesn't fit", broken, part(6)),
  productIssue("Uneven Base", "Manufacturing Defect", "Bottom not flat or bowing", broken, part(0)),
  productIssue("Squeaking or Noise", "Manufacturing Defect", "Squeaking or noise", broken),
  productIssue("Other Issue", "Product Damage", "Other damage", broken),
  returnRequest("Return Extra Quantity", "Ordered extra"),
  returnRequest("Ordered Wrong Item", "Ordered the wrong item or colour"),
  returnRequest("Exchange for Another Model", "Exchange for another model", { resolution: "Exchange" }),
  returnRequest("Doesn't Fit My Cards", "Doesn't fit my cards"),
  returnRequest("Not as Expected", "Doesn't meet expectations"),
  question("Refund Status", "Returns", "Refund status", "Please include your order number and the date your return was sent."),
  productIssue("Warranty Claim", "Warranty", "Replacement request", broken, "", "Please describe the issue and your date of purchase."),
  question("Buy Replacement Parts", "Warranty", "Buy a replacement part", "Which part, and for which product?"),
  question("Warranty Claim Status", "Warranty", "Claim status", "Please include your order number and claim details."),
  question("PSA Slab Fit", "Product Compatibility", "PSA slab fit", "Which product are you considering?"),
  question("BGS Slab Fit", "Product Compatibility", "BGS slab fit", "Which product are you considering?"),
  question("CGC Slab Fit", "Product Compatibility", "CGC slab fit", "Which product are you considering?"),
  question("SGC or TAG Slab Fit", "Product Compatibility", "SGC or TAG slab fit", "Which product are you considering?"),
  question("Graded Guard Fit", "Product Compatibility", "Graded guards fit", "Which product are you considering?"),
  question("Top Loader & Sleeve Fit", "Product Compatibility", "Top loader or sleeve fit", "Which size and product are you using?"),
  question("One-Touch & Magnetic Holder Fit", "Product Compatibility", "One Touch or magnetic holder fit", "Which holder and product are you using?"),
  question("Binder Capacity", "Product Compatibility", "Binder: which cards fit"),
  question("Product Dimensions", "Product Compatibility", "Dimensions", "Which product, and which measurements do you need?"),
  question("Removing Protective Film", "Product Education", "Removing protective film"),
  question("Setting the Lock Combination", "Product Education", "Setting the lock code"),
  question("Assembly Help", "Product Education", "Assembly help"),
  question("Wheel Replacement", "Product Education", "Replacing a wheel"),
  question("Cleaning & Care", "Product Education", "Cleaning and care"),
  partner("Wholesale Pricing", "Wholesale Questions", "Dealer pricing", topics[1]),
  partner("Minimum Order (MOQ)", "Wholesale Questions", "Minimum order (MOQ)", topics[1]),
  partner("Wholesale Application Status", "Wholesale Questions", "Application status", topics[1]),
  partner("Tax Exemption & Resale Certificate", "Wholesale Questions", "Tax exemption or resale certificate", topics[1]),
  partner("Bulk Order Discounts", "Wholesale Questions", "Bulk discount", topics[1]),
  partner("Private Label", "Wholesale Questions", "Private label", topics[1]),
  partner("Other Wholesale Question", "Wholesale Questions", "Other wholesale", topics[1]),
  partner("Join the Affiliate Program", "Affiliates & Partnerships", "Join the program", topics[2]),
  partner("Affiliate Support", "Affiliates & Partnerships", "Existing partner support", topics[2]),
  partner("Commissions & Payouts", "Affiliates & Partnerships", "Commission or payout", topics[2]),
  question("Discount Code Not Working", "Website & Checkout", "Discount code not working", "Which code did you use, and what message did you see?"),
  question("Checkout Problem", "Website & Checkout", "Checkout not working", "Please describe what happens at checkout."),
  question("Website Error", "Website & Checkout", "Website error", "Which page, and what error did you see?"),
  question("Account & Login", "Website & Checkout", "Account or login"),
  question("Product Feedback", "Feedback & Ideas", "Bad review or complaint"),
  question("Product Suggestion", "Feedback & Ideas", "New product"),
  question("Packaging Feedback", "Feedback & Ideas", "Packaging suggestion"),
  question("Other Question", "Other", "General question", "How can we assist you?"),
  productIssue("Damaged in transit", "Shipping Damage", "Damaged in transit", broken),
  productIssue("Package opened or wet", "Shipping Damage", "Package opened or wet", broken),
  productIssue("Wheel or handle failed", "Manufacturing Defect", "Wheel or handle failed", broken, part(5)),
  productIssue("Poor quality overall", "Manufacturing Defect", "Poor quality overall", broken),
  wrongItem("Part of the order wrong", "Part of the order wrong"),
  question("Display tips", "Product Education", "Display tips"),
  question("New colour", "Feedback & Ideas", "New colour"),
  question("New size", "Feedback & Ideas", "New size"),
  question("Other idea", "Feedback & Ideas", "Other idea"),
];

const flowFor = (category: string, subcategory: string) => {
  const option = formOptions.find(entry => entry.category === category && entry.subcategory === subcategory);
  if (!option) throw new Error(`Missing storefront flow for ${category}: ${subcategory}`);
  return option;
};

// "How can we help?" offers only the main topics, and each topic's options
// open under it. Orders lists its options by hand, in the customer's words;
// the other topics offer every sub-category of their ticket categories that
// isn't already offered under Orders.
const ORDERS_TOPIC: [label: string, category: string, subcategory: string, description: string][] = [
  ["Track Order", SHIPPING, "Track My Order", "See where your package is right now."],
  ["Cancel Order", ORDERS, "Cancel Order", "Request a cancellation of your whole order before it ships. Our team reviews it, and you can follow it on your request page."],
  ["Modify Address", ORDERS, "Change Shipping Address", "Change where your order is going, before it ships. The new address must be in the same country."],
  ["Lost Package", SHIPPING, "Lost Package", "Your tracking stopped, or the package never arrived."],
];
// Shipping: what it costs and how long it takes to ship products to an address.
const SHIPPING_TOPIC: typeof ORDERS_TOPIC = [
  ["Domestic Shipping", SHIPPING, "Domestic Shipping", "Shipping cost and delivery time anywhere in the U.S., including Hawaii, Alaska and U.S. territories."],
  ["International Shipping", SHIPPING, "International Shipping", "Shipping cost and delivery time to an address outside the U.S."],
  ["Shipping Times", SHIPPING, "Shipping Times", "How long delivery takes, with our shipping options and prices."],
  ["Taxes, Customs & Duties", SHIPPING, "Customs & Duties", "Sales tax, customs and import duties for where you are."],
];
// Product Issues, the way Shopify sorts return reasons (damaged or defective,
// wrong item): a few broad choices. The part and description, asked next,
// give the detail, and the ticket is filed under the exact sub-category.
const PRODUCT_TOPIC: typeof ORDERS_TOPIC = [
  ["Damaged or Defective", "Shipping Damage", "Damaged in transit", "Broken when it arrived, or a part doesn't work as it should."],
  ["Missing Item or Part", "Missing Parts", "Item missing from order", "Something from your order, or a part of it, wasn't in the box."],
  ["Received the Wrong Item", "Wrong Item Received", "Wrong product", "A different product, colour or quantity arrived."],
  ["Warranty Claim", "Warranty", "Replacement request", "A problem that started after using it for a while."],
];
// Damaged and defective ask the same things; one question picks the ticket's
// category, so the team tells a carrier claim (the box was damaged too) from
// damage at packing (the box was fine) and a factory fault.
const DAMAGE_KINDS: NonNullable<FormOption["kinds"]> = [
  { label: "Damaged in shipping", hint: "The outer box was crushed, wet or torn too.", category: "Shipping Damage", subcategory: "Damaged in transit" },
  { label: "Broken on arrival", hint: "The outer box looked fine.", category: "Product Damage", subcategory: "Other damage" },
  { label: "Doesn't work properly", hint: "A lid, lock, wheel or part doesn't work.", category: "Manufacturing Defect", subcategory: "Defective or not working" },
];
const WRONG_KINDS: NonNullable<FormOption["kinds"]> = [
  { label: "Wrong product", hint: "A different product arrived.", category: "Wrong Item Received", subcategory: "Wrong product" },
  { label: "Wrong colour or size", hint: "Right product, wrong variant.", category: "Wrong Item Received", subcategory: "Wrong colour or variant" },
  { label: "Wrong quantity", hint: "Too many or too few.", category: "Wrong Item Received", subcategory: "Wrong quantity" },
];
const PRODUCT_CATEGORIES = ["Product Damage", "Shipping Damage", "Manufacturing Defect", "Missing Parts", "Wrong Item Received", "Warranty"];

// Sub-categories the team can still set on a ticket, but customers don't pick:
// Domestic Shipping covers Hawaii, Alaska and the territories, and a faster
// delivery is asked about with the order (Track Order, Shipping Times),
// pre-orders are no longer offered on the form, and every product issue
// other than the broad choices above.
export const STAFF_ONLY = [[SHIPPING, "Hawaii, Alaska & U.S. Territories"], [SHIPPING, "Expedited Shipping"], [SHIPPING, "Signature Required"], [SHIPPING, "International Pre-Order"],
  ...PRODUCT_CATEGORIES.flatMap((name) => categories.find((entry) => entry.name === name)!.subcategories
    .filter((sub) => !PRODUCT_TOPIC.some(([, category, subcategory]) => category === name && subcategory === sub)).map((sub) => [name, sub]))];
const staffOnly = (category: string, subcategory: string) => STAFF_ONLY.some(([name, sub]) => name === category && sub === subcategory);
const mainTopics: { label: string; hint: string; categories: string[] }[] = [
  { label: "Returns, Exchanges & Refunds", hint: "Send a product back, swap it for another model, or check on a refund.", categories: ["Returns"] },
  { label: "Wholesale Queries", hint: "Dealers and stores: pricing, MOQ, applications and tax certificates.", categories: ["Wholesale Questions"] },
  { label: "Affiliate Queries", hint: "Affiliates and creators: joining, support and payouts.", categories: ["Affiliates & Partnerships"] },
  { label: "Other Queries", hint: "Other order and delivery questions, product fit and how-tos, the website and checkout, feedback, or anything else.",
    categories: [ORDERS, SHIPPING, "Product Compatibility", "Product Education", "Website & Checkout", "Feedback & Ideas", "Other"] },
];
// Options listed by hand (Orders, Shipping) aren't offered again under Other Queries.
const listed = (category: string, subcategory: string) => [...ORDERS_TOPIC, ...SHIPPING_TOPIC, ...PRODUCT_TOPIC].some(([, name, sub]) => name === category && sub === subcategory);

export const formGroups: FormGroup[] = [
  {
    label: "Orders", flat: true,
    hint: "Track, cancel or change an order, or report a delivery problem.",
    options: ORDERS_TOPIC.map(([label, category, subcategory, description]) => ({ ...flowFor(category, subcategory), label, section: category, description })),
  },
  {
    label: "Shipping", flat: true,
    hint: "Shipping costs and delivery times, in the U.S. and worldwide.",
    options: SHIPPING_TOPIC.map(([label, category, subcategory, description]) => ({ ...flowFor(category, subcategory), label, section: category, description })),
  },
  {
    label: "Product Issues", flat: true,
    hint: "Something arrived damaged, defective, missing or wrong, or you need warranty help.",
    options: PRODUCT_TOPIC.map(([label, category, subcategory, description]) => ({ ...flowFor(category, subcategory), label, section: category, description,
      ...(label === "Damaged or Defective" ? { kinds: DAMAGE_KINDS } : label === "Received the Wrong Item" ? { kinds: WRONG_KINDS } : {}) })),
  },
  ...mainTopics.map(topic => ({
    label: topic.label,
    hint: topic.hint,
    options: topic.categories.flatMap(name => categories.find(entry => entry.name === name)!.subcategories
      .filter(subcategory => !listed(name, subcategory) && !staffOnly(name, subcategory))
      .map(subcategory => ({ ...flowFor(name, subcategory), label: subcategory, section: name }))),
  })),
];

// Every category's subcategories are offered under exactly one main topic,
// except the staff-only ones, which aren't offered at all.
for (const category of categories) {
  for (const subcategory of category.subcategories) {
    const count = formGroups.flatMap(group => group.options).filter(option => option.category === category.name && option.subcategory === subcategory).length;
    if (count !== (staffOnly(category.name, subcategory) ? 0 : 1)) throw new Error(`${category.name}: ${subcategory} is offered ${count} times in the storefront form`);
  }
}
