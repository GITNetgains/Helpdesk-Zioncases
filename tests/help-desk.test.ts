import { describe, expect, it } from "vitest";
import { addressBlockers, addressChangeChecks, addressProblems, cancelReasons, sameAddress, countries, deliveryIssues, imagesRequired, issues, looksLikeVideo, orderTypes, productParts, topics, updates, validateHelpDesk, videoFormat } from "../app/services/help-desk";

const contact = { name: "Test Customer", email: "customer@example.com" };
const image = { name: "damage.jpg", size: 1024, type: "image/jpeg" };
describe("Help desk validation", () => {
  it("requires contact information and a known topic, but no phone number", () => {
    expect(Object.keys(validateHelpDesk({}, [], []))).toEqual(["name", "email", "topic"]);
    expect(validateHelpDesk({ ...contact, topic: topics[0], country: "IN", address: "Test address" }, ["product-1"], [])).toEqual({});
  });
  it("requires products, country and address for shipping", () => {
    expect(Object.keys(validateHelpDesk({ ...contact, topic: topics[0] }, [], []))).toEqual(["products", "country", "address"]);
  });
  it.each([topics[1], topics[2]])("handles existing and new partners for %s", topic => {
    expect(validateHelpDesk({ ...contact, topic, existing: "Yes", query: "Help" }, [], [])).toHaveProperty("registeredEmail");
    expect(validateHelpDesk({ ...contact, topic, existing: "Yes", registeredEmail: "registered@example.com", query: "Help" }, [], [])).toEqual({});
    expect(validateHelpDesk({ ...contact, topic, existing: "No", query: "Interested in joining" }, [], [])).toEqual({});
    expect(validateHelpDesk({ ...contact, topic, existing: "Maybe", query: "Help" }, [], [])).toHaveProperty("existing");
  });
  it("asks why the whole order should be cancelled, with details only for Other", () => {
    const values = { ...contact, topic: topics[3], orderType: orderTypes[0], orderNumber: "#1001", update: updates[2] };
    expect(Object.keys(validateHelpDesk(values, [], []))).toEqual(["cancelReason"]);
    expect(validateHelpDesk({ ...values, cancelReason: "Not a reason" }, [], [])).toHaveProperty("cancelReason");
    expect(validateHelpDesk({ ...values, cancelReason: cancelReasons[0] }, [], [])).toEqual({});
    expect(validateHelpDesk({ ...values, cancelReason: "Other" }, [], [])).toHaveProperty("details");
    expect(validateHelpDesk({ ...values, cancelReason: "Other", details: "Moving house" }, [], [])).toEqual({});
  });
  it("requires update details for a product or quantity change", () => {
    const values = { ...contact, topic: topics[3], orderType: orderTypes[0], orderNumber: "#1001", update: updates[0] };
    expect(validateHelpDesk(values, [], [])).toHaveProperty("details");
    expect(validateHelpDesk({ ...values, details: "Requested change" }, [], [])).toEqual({});
  });
  it("asks for the new shipping address part by part", () => {
    const values = { ...contact, topic: topics[3], orderType: orderTypes[0], orderNumber: "#1001", update: updates[1] };
    expect(Object.keys(validateHelpDesk(values, [], [])).sort()).toEqual(["shipAddress1", "shipCity", "shipCountry", "shipName", "shipZip"]);
    const address = { shipName: "Jordan Lee", shipAddress1: "2 Oak Ave", shipCity: "Austin", shipProvince: "TX", shipZip: "78701", shipCountry: "US" };
    expect(validateHelpDesk({ ...values, ...address, shipProvince: "" }, [], [])).toHaveProperty("shipProvince");
    expect(validateHelpDesk({ ...values, ...address }, [], [])).toEqual({});
    expect(validateHelpDesk({ ...values, ...address, shipCountry: "XX" }, [], [])).toHaveProperty("shipCountry");
  });
  it("checks a new address the way Shopify will", () => {
    const good = { name: "Jordan Lee", address1: "2 Oak Ave", address2: "", city: "Austin", province: "TX", zip: "78701", country: "US", phone: "+1 (512) 555-0100" };
    expect(addressProblems(good)).toEqual({});
    expect(addressProblems({ ...good, zip: "78701-1234", province: "tx" })).toEqual({});
    expect(Object.keys(addressProblems({ ...good, province: "Texas" }))).toEqual(["province"]);
    expect(Object.keys(addressProblems({ ...good, province: "" }))).toEqual(["province"]);
    expect(Object.keys(addressProblems({ ...good, zip: "787" }))).toEqual(["zip"]);
    expect(Object.keys(addressProblems({ ...good, phone: "call me" }))).toEqual(["phone"]);
    expect(addressProblems({ ...good, country: "CA", province: "ON", zip: "M5V 2T6" })).toEqual({});
    expect(Object.keys(addressProblems({ ...good, country: "CA", province: "ON", zip: "78701" }))).toEqual(["zip"]);
    // No state list or postal format known: anything reasonable goes.
    expect(addressProblems({ ...good, country: "NZ", province: "", zip: "6011" })).toEqual({});
    expect(Object.keys(addressProblems({ ...good, name: " ", address1: "", city: "", zip: "", country: "" })).sort()).toEqual(["address1", "city", "country", "name", "zip"]);
  });
  it("recognises the same address however it was typed", () => {
    const address = { address1: "2 Oak Ave.", address2: "Apt 4", city: "Austin", zip: "78701", country: "US" };
    expect(sameAddress(address, { address1: "2 oak ave", address2: "APT 4", city: "AUSTIN", zip: "78701", country: "US" })).toBe(true);
    expect(sameAddress(address, { ...address, address2: "Apt 5" })).toBe(false);
  });
  it("only lets an address change go ahead before the order ships, in the same country", () => {
    const order = { cancelled: false, fulfillmentStatus: "UNFULFILLED", shipments: 0, requiresShipping: true, hasShippingAddress: true, country: "US", verified: true };
    const failing = (overrides: Partial<typeof order>, country = "US") => addressChangeChecks({ ...order, ...overrides }, country).filter((check) => !check.ok).map((check) => check.id);
    expect(failing({})).toEqual([]);
    expect(failing({ fulfillmentStatus: "ON_HOLD" })).toEqual([]);
    expect(failing({ fulfillmentStatus: "IN_PROGRESS" })).toEqual(["shipped"]);
    expect(failing({ fulfillmentStatus: "PARTIALLY_FULFILLED", shipments: 1 })).toEqual(["shipped"]);
    expect(failing({ shipments: 1 })).toEqual(["shipped"]);
    expect(failing({ cancelled: true })).toEqual(["cancelled"]);
    expect(failing({ requiresShipping: false })).toEqual(["shipping"]);
    expect(failing({}, "CA")).toEqual(["country"]);
    // A different email only needs staff to confirm; it doesn't block.
    const unverified = addressChangeChecks({ ...order, verified: false }, "US");
    expect(unverified.find((check) => check.id === "verified")?.ok).toBe(false);
    expect(addressBlockers(unverified)).toEqual([]);
    expect(addressChangeChecks(null, "US").map((check) => [check.id, check.ok])).toEqual([["found", false]]);
  });
  it("asks what's wrong with a delivery, with details optional", () => {
    const values = { ...contact, topic: topics[3], orderType: orderTypes[3], orderNumber: "#1001" };
    expect(Object.keys(validateHelpDesk(values, [], []))).toEqual(["delivery"]);
    expect(validateHelpDesk({ ...values, delivery: deliveryIssues[1] }, [], [])).toEqual({});
  });
  it.each(issues.slice(0, 3))("enforces the image rule for order issue %s", issue => {
    const values = { ...contact, topic: topics[3], orderType: orderTypes[1], orderNumber: "#1001", details: "Details", issue, part: productParts[2] };
    expect(imagesRequired(values)).toBe(issue !== issues[2]);
    expect(Boolean(validateHelpDesk(values, [], []).images)).toBe(issue !== issues[2]);
    expect(validateHelpDesk(values, [], [image])).toEqual({});
    // The part is optional (customers describe the problem), but must be a real one when given.
    expect(validateHelpDesk({ ...values, part: "" }, [], [image])).toEqual({});
    expect(validateHelpDesk({ ...values, part: "Spoiler" }, [], [image])).toHaveProperty("part");
  });
  it.each(issues.slice(0, 3))("requires images when a returned item is broken, wrong or incomplete: %s", issue => {
    const values = { ...contact, topic: topics[4], orderNumber: "#1001", orderDetails: "Order details", productDetails: "Product", details: "Issue details", issue, resolution: "Refund" };
    expect(validateHelpDesk(values, [], [])).toHaveProperty("images");
    expect(validateHelpDesk(values, [], [image])).toEqual({});
    expect(validateHelpDesk({ ...values, resolution: "Invalid" }, [], [image])).toHaveProperty("resolution");
  });
  it("handles wrongly ordered products without requiring issue images", () => {
    const wrong = { ...contact, topic: topics[3], orderType: orderTypes[2], orderNumber: "#1001", details: "Received the small case instead of the large one" };
    expect(validateHelpDesk(wrong, ["gid://shopify/Product/1"], [{ name: "case.jpg", size: 10, type: "image/jpeg" }], ["gid://shopify/Product/2"])).toEqual({});
    expect(Object.keys(validateHelpDesk({ ...wrong, details: "" }, [], []))).toEqual(["receivedProducts", "products", "images"]);
  });
  it("knows every common video format by its bytes, and nothing else", () => {
    const bytes = (...parts: (string | number[])[]) => new Uint8Array(parts.flatMap((part) => typeof part === "string" ? [...part].map((char) => char.charCodeAt(0)) : part));
    const ts = new Uint8Array(400); ts[0] = ts[188] = ts[376] = 0x47;
    const mts = new Uint8Array(400); mts[4] = mts[196] = mts[388] = 0x47;
    expect([
      bytes([0, 0, 0, 24], "ftypisom"), bytes([0, 0, 0, 20], "ftypqt  "), bytes([0, 0, 0, 20], "ftyp3gp4"), bytes([0, 0, 0, 20], "ftypM4V "), bytes([0, 0, 0, 8], "moov"),
      bytes([0x1a, 0x45, 0xdf, 0xa3], "....webm"), bytes([0x1a, 0x45, 0xdf, 0xa3], "....matroska"), bytes("RIFF", [0, 0, 0, 0], "AVI "),
      bytes([0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11]), bytes([0, 0, 1, 0xba]), ts, mts, bytes("FLV", [1]),
    ].map(videoFormat)).toEqual(["video/mp4", "video/quicktime", "video/3gpp", "video/x-m4v", "video/quicktime", "video/webm", "video/x-matroska",
      "video/x-msvideo", "video/x-ms-wmv", "video/mpeg", "video/mp2t", "video/mp2t", "video/x-flv"]);
    // Not videos: text (even starting with G), a JPEG, a WAV (RIFF but not AVI), a PDF.
    for (const other of [bytes("Garbage text"), bytes([255, 216, 255, 0]), bytes("RIFF", [0, 0, 0, 0], "WAVE"), bytes("%PDF-1.7")]) expect(videoFormat(other)).toBeNull();
    // Uploads: a video type, or a video extension when the browser gave none.
    expect([looksLikeVideo({ name: "a.mkv", type: "" }), looksLikeVideo({ name: "a.MTS", type: "" }), looksLikeVideo({ name: "a", type: "video/x-anything" }), looksLikeVideo({ name: "a.pdf", type: "application/pdf" })])
      .toEqual([true, true, true, false]);
  });
  it("rejects oversized, empty, unsupported and excessive images", () => {
    const values = { ...contact, topic: topics[3], orderType: orderTypes[1], issue: issues[2], orderNumber: "#1001", details: "Details" };
    for (const files of [[{ ...image, size: 11 * 1024 * 1024 }], [{ ...image, size: 0 }], [{ ...image, type: "image/svg+xml" }], Array(6).fill(image)]) {
      expect(validateHelpDesk(values, [], files)).toHaveProperty("images");
    }
  });
  it("ignores hidden fields and attachments from other topics", () => {
    expect(validateHelpDesk({ ...contact, topic: topics[1], existing: "No", query: "Help", issue: issues[0] }, [], [{ ...image, size: 0 }])).toEqual({});
  });
  it("includes countries and territories with unique codes", () => {
    expect(countries).toHaveLength(249);
    expect(new Set(countries.map(country => country.code)).size).toBe(249);
  });
});
