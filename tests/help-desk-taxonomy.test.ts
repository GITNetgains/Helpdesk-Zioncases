import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHAT_TOPIC, deliveryIssues, issues, orderTypes, productParts, topics, updates } from "../app/services/help-desk";
import { categories, classifyTicket, classifyWithChoice, groupMacros, rootCauses, subcategoriesOf, teamFor } from "../app/services/help-desk-taxonomy";

const label = ({ category, subcategory }: { category: string; subcategory: string }) => subcategory ? `${category} › ${subcategory}` : category;

describe("Help Desk ticket classification", () => {
  it("classifies from the form choices", () => {
    expect(label(classifyTicket(topics[0], {}))).toBe("Shipping & Delivery › International Shipping");
    expect(label(classifyTicket(topics[3], { orderType: orderTypes[0], update: updates[1] }))).toBe("Orders › Change Shipping Address");
    expect(label(classifyTicket(topics[3], { orderType: orderTypes[0], update: updates[2], details: "Found it cheaper" }))).toBe("Orders › Cancel Order");
    expect(label(classifyTicket(topics[3], { orderType: orderTypes[2] }))).toBe("Wrong Item Received › Wrong product");
    expect(label(classifyTicket(topics[3], { orderType: orderTypes[3], delivery: deliveryIssues[1] }))).toBe("Shipping & Delivery › Delivered but Not Received");
    expect(label(classifyTicket(topics[3], { orderType: orderTypes[3], delivery: deliveryIssues[2] }))).toBe("Shipping & Delivery › Partial Delivery");
    expect(label(classifyTicket(topics[4], { issue: issues[3] }))).toBe("Returns › Ordered the wrong item or colour");
    expect(label(classifyTicket(topics[2], { existing: "No" }))).toBe("Affiliates & Partnerships › Join the program");
  });

  it("uses the part the customer picked for broken and missing items", () => {
    const issue = (index: number, part: string, details = "") => label(classifyTicket(topics[3], { orderType: orderTypes[1], issue: issues[index], part, details }));
    expect(issue(0, productParts[2], "One came broken")).toBe("Product Damage › Broken risers");
    expect(issue(0, productParts[3], "Arrived like this")).toBe("Product Damage › Cracked acrylic or guard");
    expect(issue(0, productParts[1], "Scratches all over after peeling the film")).toBe("Manufacturing Defect › Scratches");
    expect(issue(0, productParts[4], "Only one lock takes the code")).toBe("Manufacturing Defect › Lock won't set or open");
    expect(issue(0, productParts[0], "It arrived broken and the box was crushed")).toBe("Shipping Damage › Box crushed or dented");
    expect(issue(2, productParts[2])).toBe("Missing Parts › Risers missing");
    expect(issue(2, productParts[8])).toBe("Missing Parts › Free gift missing");
    expect(issue(2, productParts[10], "MagPro labels not in the box")).toBe("Missing Parts › Accessory missing");
  });

  // Real requests from Zion Cases' daily issues list, as they'd arrive by chat or email.
  it.each([
    ["I could purchase replaceable wheels for my zion case. A couple wheels cracked", "Warranty › Buy a replacement part"],
    ["One of my risers came brok.", "Product Damage › Broken risers"],
    ["Horizontal Display Case(with risers) arrived wihout risers", "Missing Parts › Risers missing"],
    ["Upon peeling the wrappers there seems to be scratches on it", "Manufacturing Defect › Scratches"],
    ["During our flight one of the wheels completely fell off", "Manufacturing Defect › Wheel or handle failed"],
    ["They don't accommodate graded guards. Was looking to return the Slab Case X", "Returns › Doesn't fit my cards"],
    ["Order coming in fragments, so confirming over tracking number", "Shipping & Delivery › Partial Delivery"],
    ["3 out 5 is incorrect product", "Wrong Item Received › Part of the order wrong"],
    ["Goliath Case arrived with broken handle", "Product Damage › Broken wheels or handle"],
    ["Unable to open case", "Manufacturing Defect › Lock won't set or open"],
    ["Needed only one case , ordered 2, 1 is returned", "Returns › Ordered extra"],
    ["Hawai", "Shipping & Delivery › Hawaii, Alaska & U.S. Territories"],
    ["bottom of the zion display case is bowing out", "Manufacturing Defect › Bottom not flat or bowing"],
    ["Cracked acrylic gaurd", "Product Damage › Cracked acrylic or guard"],
    ["Exterior : dent on slab case", "Product Damage › Dented or bent case"],
    ["Order delayed for 3 1/2 month and now requested to cancel it.", "Orders › Cancel Order"],
    ["Red instead of black display case + ordered White sling bag and got blue", "Wrong Item Received › Wrong colour or variant"],
    ["I received my zion case without carbon fiber/foam inserts", "Missing Parts › Foam or insert missing"],
    ["NFL MagPro labels is missing from order", "Missing Parts › Accessory missing"],
    ["3 cases ordered, delivered none, order marked as delivered on 16 oct", "Shipping & Delivery › Delivered but Not Received"],
    ["The lid shifts left and right a bit and it causes the case not to close smoothly", "Manufacturing Defect › Lid shifts or won't close"],
    ["Free Sling Bag is missing from order", "Missing Parts › Free gift missing"],
    ["Placing pre order request for the titanium 4 to singapore", "Shipping & Delivery › International Pre-Order"],
    ["Only 3 out 6 lids is delivered", "Missing Parts › Lids or panels missing"],
    ["Ordered Horizontal display case instead of vertical ones.", "Returns › Ordered the wrong item or colour"],
    ["Order Black variant instead of Blue one", "Orders › Edit Items, Color or Quantity"],
    ["Ordered on oct 7, no updates seen by user", "Shipping & Delivery › Track My Order"],
    ["Cancel Armorship", "Orders › Cancel Shipping Protection"],
    ["Discount code failed", "Website & Checkout › Discount code not working"],
    ["Overall, its not a great product.", "Feedback & Ideas › Bad review or complaint"],
    ["Will my PSA slab fit the Goliath case?", "Product Compatibility › PSA slab fit"],
  ])("%s", (text, expected) => {
    expect(label(classifyTicket(CHAT_TOPIC, { transcript: text }))).toBe(expected);
  });

  it("uses the category and sub-category the customer picked, filling in what they left out", () => {
    const details = { orderType: orderTypes[1], issue: issues[0], part: productParts[2], details: "One riser came broken" };
    expect(label(classifyWithChoice(topics[3], details, { category: "Warranty", subcategory: "Replacement request" }))).toBe("Warranty › Replacement request");
    expect(label(classifyWithChoice(topics[3], details, { category: "Product Damage" }))).toBe("Product Damage › Broken risers");
    // Not in the taxonomy: the automatic classification stands.
    expect(label(classifyWithChoice(topics[3], details, { category: "Made up", subcategory: "Nope" }))).toBe("Product Damage › Broken risers");
    expect(label(classifyWithChoice(topics[3], details, { category: "Missing Parts", subcategory: "Box crushed or dented" }))).toBe("Missing Parts › Risers missing");
  });

  it("falls back to Other when nothing matches", () => {
    expect(classifyTicket(CHAT_TOPIC, { transcript: "Hello" })).toEqual({ category: "Other", subcategory: "" });
  });

  it("only suggests sub-categories that belong to the category, and every root cause has a team", () => {
    for (const topic of [...topics, CHAT_TOPIC]) for (const issue of issues) for (const part of productParts) {
      const { category, subcategory } = classifyTicket(topic, { orderType: orderTypes[1], issue, part, details: "broken scratched missing PSA fit late riser" });
      expect(categories.map((entry) => entry.name)).toContain(category);
      if (subcategory) expect(subcategoriesOf(category)).toContain(subcategory);
    }
    for (const cause of rootCauses) expect(teamFor(cause)).not.toBe("");
  });

  it("suggests saved replies for the ticket's category, exact sub-category first", () => {
    const macros = [
      { id: "general", category: "", subcategory: "" },
      { id: "missing", category: "Missing Parts", subcategory: "" },
      { id: "risers", category: "Missing Parts", subcategory: "Risers missing" },
      { id: "gift", category: "Missing Parts", subcategory: "Free gift missing" },
      { id: "damage", category: "Product Damage", subcategory: "" },
    ];
    const groups = groupMacros(macros, { category: "Missing Parts", subcategory: "Risers missing" });
    expect(groups.suggested.map((macro) => macro.id)).toEqual(["risers", "missing"]);
    expect(groups.general.map((macro) => macro.id)).toEqual(["general"]);
    expect(groups.other.map((macro) => macro.id)).toEqual(["gift", "damage"]);
  });
});

// Every request in Zion Cases' daily issues list (tests/fixtures/daily-issues.json:
// date, order, description, the team's issue type) lands in a real category.
describe("Daily issues list", () => {
  const rows = JSON.parse(readFileSync("tests/fixtures/daily-issues.json", "utf8")) as string[][];
  const classified = rows.map(([, , description, type]) => classifyTicket(CHAT_TOPIC, { transcript: [description, type].filter(Boolean).join(". ") }));
  it("puts no request in Other", () => {
    expect(classified.filter((entry) => entry.category === "Other")).toEqual([]);
  });
  it("gives almost every request a sub-category", () => {
    expect(classified.filter((entry) => entry.subcategory).length / rows.length).toBeGreaterThan(0.95);
  });
});
