import { describe, expect, it } from "vitest";
import { productParts, validateHelpDesk } from "../app/services/help-desk";
import { formGroups, STAFF_ONLY, type FormOption } from "../app/services/help-desk-form";
import { BROAD_SUBCATEGORIES, categories, classifyWithChoice, subcategoriesOf } from "../app/services/help-desk-taxonomy";

const image = { name: "photo.jpg", size: 1024, type: "image/jpeg" };
const product = "gid://shopify/Product/1";

// What a customer fills in after picking each option, as the form would send it.
function submission(option: FormOption) {
  const values: Record<string, string> = { name: "Customer", email: "customer@example.com", ...option.preset };
  const products: string[] = [];
  const received: string[] = [];
  const files: typeof image[] = [];
  switch (option.flow) {
    case "delivery": Object.assign(values, { orderNumber: "#1001" }); break;
    case "orderUpdate": Object.assign(values, { orderNumber: "#1001", details: "Please change it" }); break;
    case "cancel": Object.assign(values, { orderNumber: "#1001", cancelReason: "Ordered by mistake" }); break;
    case "address": Object.assign(values, { orderNumber: "#1001", shipName: "Jordan Lee", shipAddress1: "2 Oak Ave", shipCity: "Austin", shipProvince: "TX", shipZip: "78701", shipCountry: "US" }); break;
    case "productIssue":
      Object.assign(values, { orderNumber: "#1001", details: "It arrived like this", part: option.preset.part ?? productParts[0] });
      files.push(image);
      break;
    case "wrongItem": Object.assign(values, { orderNumber: "#1001" }); products.push(product); received.push(product); files.push(image); break;
    case "return": Object.assign(values, { orderNumber: "#1001", orderDetails: "Order #1001", productDetails: "Slab Case X", details: "Details", resolution: option.preset.resolution ?? "Return" }); break;
    case "international": Object.assign(values, { country: "GB", address: "1 High Street, London" }); products.push(product); break;
    case "partner": Object.assign(values, { existing: "No", query: "Hello" }); break;
    case "customs": Object.assign(values, { country: "GB", query: "Will I pay duties?" }); break;
    case "question": case "shippingTimes": Object.assign(values, { query: "A question" }); break;
  }
  return { values, products, received, files };
}

describe("Storefront form: How can we help you? › Select a category", () => {
  it("offers the main topics, with every category's subcategories under exactly one of them", () => {
    expect(formGroups.map(group => group.label)).toEqual(["Orders", "Shipping", "Product Issues", "Returns, Exchanges & Refunds", "Wholesale Queries", "Affiliate Queries", "Other Queries"]);
    const offered = formGroups.flatMap(group => group.options.map(option => `${option.category} › ${option.subcategory}`));
    const staffOnly = STAFF_ONLY.map(([category, subcategory]) => `${category} › ${subcategory}`);
    expect(offered.sort()).toEqual(categories.flatMap(category => category.subcategories.map(subcategory => `${category.name} › ${subcategory}`)).filter(entry => !staffOnly.includes(entry)).sort());
    for (const group of formGroups) for (const option of group.options) expect(option.section).toBe(option.category);
    // Every issue is offered once.
    const labels = formGroups.flatMap((group) => group.options.map((option) => option.label));
    expect(new Set(labels).size).toBe(labels.length);
  });

  const options = formGroups.flatMap((group) => group.options.map((option) => [group.label, option] as const));

  it.each(options)("%s › %s", (_, option) => {
    // Every option points at a real category and sub-category...
    expect(subcategoriesOf(option.category)).toContain(option.subcategory);
    // ...is accepted once its fields are filled in...
    const { values, products, received, files } = submission(option);
    expect(validateHelpDesk(values, products, files, received)).toEqual({});
    // ...and lands the ticket exactly there; a broad choice may be narrowed by what the customer wrote.
    const filed = classifyWithChoice(values.topic, values, option);
    if (BROAD_SUBCATEGORIES.includes(option.subcategory)) {
      expect(filed.category).toBe(option.category);
      expect(subcategoriesOf(option.category)).toContain(filed.subcategory);
    } else expect(filed).toEqual({ category: option.category, subcategory: option.subcategory });
  });

  it("files a broad choice under the exact problem the customer describes", () => {
    const defect = { topic: "Order Inquiry", orderType: "Product Issues", issue: "Defective product received" };
    expect(classifyWithChoice(defect.topic, { ...defect, part: "Lock or latch", details: "Only one lock takes the combination" }, { category: "Manufacturing Defect", subcategory: "Defective or not working" }))
      .toEqual({ category: "Manufacturing Defect", subcategory: "Lock won't set or open" });
    // Nothing more specific to go on: the broad choice stands.
    expect(classifyWithChoice(defect.topic, { ...defect, part: "Other", details: "It just doesn't feel right" }, { category: "Manufacturing Defect", subcategory: "Defective or not working" }).category).toBe("Manufacturing Defect");
    const missing = { topic: "Order Inquiry", orderType: "Product Issues", issue: "Missing items" };
    expect(classifyWithChoice(missing.topic, { ...missing, part: "Risers", details: "No risers in the box" }, { category: "Missing Parts", subcategory: "Item missing from order" }))
      .toEqual({ category: "Missing Parts", subcategory: "Risers missing" });
  });

  it("asks for photos when something arrived broken, but not for a simple return", () => {
    const group = (label: string) => formGroups.find((entry) => entry.label === label)!;
    const broken = group("Product Issues").options.find(option => option.category === "Shipping Damage")!;
    const { values } = submission(broken);
    expect(validateHelpDesk(values, [], [])).toHaveProperty("images");
    const extra = group("Returns, Exchanges & Refunds").options[0];
    expect(validateHelpDesk(submission(extra).values, [], [])).toEqual({});
  });
});
