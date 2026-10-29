// @vitest-environment happy-dom
// @vitest-environment-options {"url":"https://zioncases.example/pages/support"}
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelReasons, countries, issueResolutions, issues, productParts, PROVINCES, purchasePlaces, topics, validateHelpDesk } from "../app/services/help-desk";
import { formGroups } from "../app/services/help-desk-form";

// Runs the real storefront script (extensions/help-desk/assets/help-desk.js)
// against the app's form config and clicks through it like a customer.
const script = readFileSync("extensions/help-desk/assets/help-desk.js", "utf8");
const config = { topics, issues, countries, productParts, cancelReasons, issueResolutions, purchasePlaces, provinces: PROVINCES, groups: formGroups, orders: [], tickets: [] };

// track: what the app answers to "Check Order Status" (status code and body).
// check: what the app answers when Cancel Order or Modify Address checks the order.
// shipping: what the app answers to "Check Shipping Times".
async function mount(track: { status: number; body: unknown } = { status: 404, body: { error: "We couldn't find an order with that number and email." } }, check: unknown = { allowed: true, country: "US" }, shipping: unknown = { error: "Shipping times are unavailable right now." }, customer: unknown = null) {
  document.body.innerHTML = `<div data-help-desk data-endpoint="/apps/help-desk">
    <div data-help-desk-status></div><div data-help-desk-form></div>
    <select data-help-desk-products hidden><option value="gid://shopify/Product/1">Slab Case X</option></select>
    ${customer ? `<script type="application/json" data-help-desk-customer>${JSON.stringify(customer)}</script>` : ""}
  </div>`;
  const posts: Record<string, string>[] = [];
  const lookups: URL[] = [];
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const target = new URL(String(url), location.origin);
    if (target.searchParams.get("track")) { lookups.push(target); return new Response(JSON.stringify(track.body), { status: track.status }); }
    // A product's variants, for Wrong colour or size.
    if (target.searchParams.get("check") === "variants") { lookups.push(target); return new Response(JSON.stringify({ variants: [{ title: "Black", available: true }, { title: "Blue", available: false }] })); }
    if (target.searchParams.get("check")) { lookups.push(target); return new Response(JSON.stringify(check)); }
    if (target.searchParams.get("shipping")) { lookups.push(target); return new Response(JSON.stringify(shipping)); }
    if (init?.method === "POST") {
      posts.push(Object.fromEntries([...(init.body as FormData).entries()].filter(([, value]) => typeof value === "string")) as Record<string, string>);
      return new Response(JSON.stringify({ ticketId: "t1", number: 1001, token: "a".repeat(48) }));
    }
    return new Response(JSON.stringify(config));
  }) as typeof fetch;
  new Function(script)();
  await vi.waitFor(() => expect(document.querySelector("form")).toBeTruthy());
  return Object.assign(posts, { lookups });
}
const button = (text: string) => [...document.querySelectorAll("button")].find((element) => element.textContent === text) as HTMLButtonElement;
// The request step's Next (to Review): shown once there's a request to send.
const submitButton = () => document.querySelector(".help-desk-section-request .help-desk-nav button:last-child") as HTMLButtonElement;
// Next on the request step opens Review, where the request is submitted.
function review() { submitButton().click(); }

// The control whose visible label starts with `label`.
function control(label: string) {
  const wrap = [...document.querySelectorAll("label")].find((element) => element.querySelector("span")?.textContent?.startsWith(label));
  if (!wrap) throw new Error(`No field labelled "${label}"`);
  return wrap.querySelector("select, input, textarea") as HTMLSelectElement | HTMLInputElement | HTMLTextAreaElement;
}
const labels = () => [...document.querySelectorAll("form label > span:first-child")].map((element) => element.textContent!.replace(/\s*\*$/, "").trim());
const choices = (label: string) => [...(control(label) as HTMLSelectElement).options].map((option) => option.textContent).slice(1);
function choose(label: string, text: string) {
  const select = control(label) as HTMLSelectElement;
  const option = [...select.options].find((entry) => entry.textContent === text);
  if (!option) throw new Error(`"${label}" has no option "${text}"`);
  select.value = option.value;
  select.dispatchEvent(new Event("change"));
}
const type = (label: string, value: string) => { control(label).value = value; };
async function submit(posts: Record<string, string>[]) {
  review();
  document.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
  await vi.waitFor(() => expect(posts).toHaveLength(1));
  return posts[0];
}
// Types in a product search box and picks the first suggestion.
function pickProduct(label: string, text: string) {
  const input = control(label) as HTMLInputElement;
  input.value = text;
  input.dispatchEvent(new Event("input"));
  (document.querySelector(".help-desk-suggestions [role=option]") as HTMLElement).click();
}
function fillContact() { type("Full name", "Jordan Lee"); type("Email address", "jordan@example.com"); }

afterEach(() => { document.body.innerHTML = ""; });

describe("Storefront Help Desk form", () => {
  it("asks a guest to sign in first, without the topics, when the block requires it", async () => {
    const page = (customer: string) => `<div data-help-desk data-endpoint="/apps/help-desk" data-require-login="true" data-login-url="/account/login" data-register-url="/account/register">
      <div data-help-desk-status></div><div data-help-desk-form></div>${customer}</div>`;
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(config))) as typeof fetch;
    document.body.innerHTML = page("");
    new Function(script)();
    await vi.waitFor(() => expect(document.querySelector(".help-desk-gate")).toBeTruthy());
    expect(document.querySelector("form")).toBeNull();
    expect(document.querySelector(".help-desk-gate strong")?.textContent).toBe("Sign in to get help");
    const links = [...document.querySelectorAll<HTMLAnchorElement>(".help-desk-gate a")];
    expect(links.map((link) => link.textContent)).toEqual(["Sign in", "Create an account"]);
    expect(new URL(links[0].href).searchParams.get("return_url")).toBe("/pages/support");
    expect(globalThis.fetch).not.toHaveBeenCalled();
    // New customer accounts: their own sign-in, back here with return_to.
    document.body.innerHTML = page("").replace('data-login-url="/account/login"', 'data-login-url="/customer_authentication/redirect?locale=en&amp;region_country=US"');
    new Function(script)();
    await vi.waitFor(() => expect(document.querySelector(".help-desk-gate")).toBeTruthy());
    const signIn = new URL((document.querySelector(".help-desk-gate a") as HTMLAnchorElement).href);
    expect(signIn.pathname).toBe("/customer_authentication/login");
    expect(signIn.searchParams.get("return_to")).toBe("/pages/support");
    // Signed in: the form, from the first topic.
    document.body.innerHTML = page(`<script type="application/json" data-help-desk-customer>${JSON.stringify({ name: "Sandy", email: "sandy@example.com", orders: [] })}</script>`);
    new Function(script)();
    await vi.waitFor(() => expect(document.querySelector("form")).toBeTruthy());
    expect(document.querySelector(".help-desk-gate")).toBeNull();
    expect(document.querySelector(".help-desk-tile strong")?.textContent).toBe(formGroups[0].label);
  });

  it("shows only the selected topic's options for every topic", async () => {
    await mount();
    for (const group of formGroups) {
      choose("How can we help?", group.label);
      expect(choices("What do you need help with?")).toEqual(group.options.map(option => option.label));
      expect((control("What do you need help with?") as HTMLSelectElement).value).toBe(group.options.length === 1 ? "0" : "");
    }
  });

  it("clears the selected flow when a topic or subcategory is reset", async () => {
    const posts = await mount();
    choose("How can we help?", "Other Queries");
    choose("What do you need help with?", "Payment Issue");
    expect(document.querySelector('input[name="subcategory"]')).toBeTruthy();
    const subcategory = control("What do you need help with?");
    subcategory.value = "";
    subcategory.dispatchEvent(new Event("change"));
    expect(document.querySelector('input[name="subcategory"]')).toBeNull();
    document.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(posts).toHaveLength(0);
    choose("What do you need help with?", "Payment Issue");
    const topic = control("How can we help?");
    topic.value = "";
    topic.dispatchEvent(new Event("change"));
    expect(labels()).not.toContain("What do you need help with?");
    expect(document.querySelector('input[name="category"]')).toBeNull();
  });

  it("goes one step at a time: topic, issue, your details, then the request", async () => {
    const posts = await mount();
    const shown = () => [...document.querySelectorAll(".help-desk-section")].filter((section) => !(section as HTMLElement).hidden).map((section) => section.querySelector("h3")!.textContent);
    const progress = () => [...document.querySelectorAll(".help-desk-progress li")].map((item) => (item as HTMLElement).dataset.state);
    const card = (text: string) => [...document.querySelectorAll(".help-desk-tile")].find((tile) => tile.querySelector("strong")!.textContent === text) as HTMLButtonElement;
    expect(shown()).toEqual(["How can we help?"]);
    expect(progress()).toEqual(["current", "", "", "", ""]);
    card("Shipping").click();
    expect(shown()).toEqual(["What do you need help with?"]);
    expect(document.querySelector(".help-desk-category-hint")?.textContent).toBe("Shipping costs and delivery times, in the U.S. and worldwide.");
    card("Taxes, Customs & Duties").click();
    expect(shown()).toEqual(["Your details"]);
    expect(progress()).toEqual(["done", "done", "current", "", ""]);
    // Name and email first.
    button("Next").click();
    expect(shown()).toEqual(["Your details"]);
    fillContact();
    button("Next").click();
    expect(shown()).toEqual(["Taxes, Customs & Duties"]);
    expect(progress()).toEqual(["done", "done", "done", "current", ""]);
    // Back keeps what was filled in.
    (document.querySelector(".help-desk-section-request .help-desk-nav button") as HTMLButtonElement).click();
    expect(shown()).toEqual(["Your details"]);
    expect(control("Full name").value).toBe("Jordan Lee");
    button("Next").click();
    type("Your Question", "Will I pay import duties?");
    const sent = await submit(posts);
    expect(sent).toMatchObject({ subcategory: "Customs & Duties", name: "Jordan Lee" });
    // A new request starts again at step 1.
    await vi.waitFor(() => expect(shown()).toEqual(["How can we help?"]));
  });

  it("skips Your details for a signed-in customer: their account fills it in", async () => {
    const posts = await mount(undefined, undefined, undefined, { name: "Sandy Netgains", email: "sandy@example.com", phone: "", orders: [] });
    const shown = () => [...document.querySelectorAll(".help-desk-section")].filter((section) => !(section as HTMLElement).hidden).map((section) => section.querySelector("h3")!.textContent);
    const card = (text: string) => [...document.querySelectorAll(".help-desk-tile")].find((tile) => tile.querySelector("strong")!.textContent === text) as HTMLButtonElement;
    expect([...document.querySelectorAll(".help-desk-progress li")].filter((item) => !(item as HTMLElement).hidden).map((item) => item.textContent)).toEqual(["Topic", "Issue", "Request", "Review"]);
    expect(document.querySelector(".help-desk-login")).toBeNull();
    card("Shipping").click();
    card("Taxes, Customs & Duties").click();
    expect(shown()).toEqual(["Taxes, Customs & Duties"]);
    (document.querySelector(".help-desk-section-request .help-desk-nav button") as HTMLButtonElement).click();
    expect(shown()).toEqual(["What do you need help with?"]);
    card("Taxes, Customs & Duties").click();
    type("Your Question", "Will I pay duties?");
    expect(await submit(posts)).toMatchObject({ name: "Sandy Netgains", email: "sandy@example.com", subcategory: "Customs & Duties" });
  });

  it("asks guests to sign in, or continue as a guest", async () => {
    await mount();
    const link = document.querySelector(".help-desk-login a") as HTMLAnchorElement;
    expect(document.querySelector(".help-desk-login")?.textContent).toContain("Sign in for faster help");
    expect(new URL(link.href).pathname).toBe("/account/login");
    expect(new URL(link.href).searchParams.get("return_url")).toBe("/pages/support");
    expect(labels()).toEqual(expect.arrayContaining(["Full name", "Email address"]));
  });

  it("asks How can we help? with only the main topics, Orders first", async () => {
    await mount();
    expect(choices("How can we help?")).toEqual(["Orders", "Shipping", "Product Issues", "Returns, Exchanges & Refunds", "Wholesale Queries", "Affiliate Queries", "Other Queries"]);
    expect(labels()).not.toContain("What do you need help with?");
    // Product Issues: a few broad choices, like Shopify's return reasons, without headings.
    choose("How can we help?", "Product Issues");
    expect(choices("What do you need help with?")).toEqual(["Damaged or Defective", "Missing Item or Part", "Received the Wrong Item", "Warranty Claim"]);
    expect((control("What do you need help with?") as HTMLSelectElement).querySelectorAll("optgroup")).toHaveLength(0);
    expect(document.querySelector(".help-desk-tiles-heading")).toBeNull();
    expect(document.querySelector(".help-desk-hint")?.textContent).toBe("Something arrived damaged, defective, missing or wrong, or you need warranty help.");
  });

  describe("Orders", () => {
    it("opens its options in a dropdown, in order, each with its description", async () => {
      await mount();
      choose("How can we help?", "Orders");
      expect(choices("What do you need help with?")).toEqual(["Track Order", "Cancel Order", "Modify Address", "Lost Package"]);
      choose("How can we help?", "Shipping");
      expect(choices("What do you need help with?")).toEqual(["Domestic Shipping", "International Shipping", "Shipping Times", "International Pre-Order", "Taxes, Customs & Duties"]);
      choose("How can we help?", "Orders");
      // Nothing to fill in until an option is picked.
      expect(document.querySelector('input[name="category"]')).toBeNull();
      const hint = document.querySelector(".help-desk-option-hint") as HTMLElement;
      expect(hint.hidden).toBe(true);
      choose("What do you need help with?", "Lost Package");
      expect(hint.hidden).toBe(false);
      expect(hint.textContent).toBe("Your tracking stopped, or the package never arrived.");
    });

    it("Track Order answers from the order's live tracking, without a request", async () => {
      const posts = await mount({ status: 200, body: { tracking: {
        order: "#1001", cancelled: false, shipped: true, onHold: false,
        shipments: [{ label: "In transit", carrier: "UPS", number: "1Z999", url: "https://www.ups.com/track?tracknum=1Z999", deliveredAt: null, estimatedAt: "2026-10-28T00:00:00Z" }],
      } } });
      fillContact();
      choose("How can we help?", "Orders");
      choose("What do you need help with?", "Track Order");
      // Only the order number, and no request to submit until it's needed.
      expect(labels()).toEqual(["How can we help?", "What do you need help with?", "Full name", "Email address", "Phone number (optional)", "Order Number", "Leave this blank"]);
      expect(submitButton().hidden).toBe(true);
      type("Order Number", "#1001");
      button("Check Order Status").click();
      await vi.waitFor(() => expect(document.querySelector(".help-desk-track-card")).toBeTruthy());
      expect(posts.lookups[0].searchParams.get("order")).toBe("#1001");
      expect(posts.lookups[0].searchParams.get("email")).toBe("jordan@example.com");
      const card = document.querySelector(".help-desk-track-card")!;
      expect(card.textContent).toContain("In transit");
      expect(card.textContent).toContain("Shipped with UPS1Z999");
      // The progress bar stops at Shipped, the step the order is on.
      expect(card.querySelector("[aria-current=step]")?.textContent).toContain("Shipped");
      expect(card.querySelector("a")?.getAttribute("href")).toBe("https://www.ups.com/track?tracknum=1Z999");
      expect(posts).toHaveLength(0);
    });

    it("I Still Need Help turns the tracking check into a request with the right category", async () => {
      const posts = await mount({ status: 200, body: { tracking: { order: "#1001", cancelled: false, shipped: false, onHold: false, shipments: [] } } });
      fillContact();
      choose("How can we help?", "Orders");
      choose("What do you need help with?", "Track Order");
      type("Order Number", "#1001");
      button("Check Order Status").click();
      await vi.waitFor(() => expect(document.querySelector(".help-desk-track-card")?.textContent).toContain("hasn't shipped yet"));
      button("I Still Need Help").click();
      expect(submitButton().hidden).toBe(false);
      type("How can we help with this order?", "It has been two weeks");
      const sent = await submit(posts);
      expect(sent).toMatchObject({ category: "Shipping & Delivery", subcategory: "Track My Order", topic: "Order Inquiry", orderNumber: "#1001" });
      // The choices themselves aren't sent, only what they stand for.
      expect(sent).not.toHaveProperty("group");
      expect(sent).not.toHaveProperty("option");
      expect(validateHelpDesk(sent, [], [])).toEqual({});
    });

    it("checking needs the email and order number first", async () => {
      const posts = await mount();
      choose("How can we help?", "Orders");
      choose("What do you need help with?", "Track Order");
      button("Check Order Status").click();
      expect(document.querySelector("[data-help-desk-status]")?.textContent).toContain("enter your email address and order number");
      expect(posts.lookups).toHaveLength(0);
    });

    it("Lost Package checks the tracking first, then opens a request", async () => {
      const posts = await mount();
      fillContact();
      choose("How can we help?", "Orders");
      choose("What do you need help with?", "Lost Package");
      expect(submitButton().hidden).toBe(true);
      type("Order Number", "#1004");
      button("Check Order Status").click();
      await vi.waitFor(() => expect(document.querySelector(".help-desk-track-error")?.textContent).toContain("couldn't find an order"));
      type("How can we help with this order?", "Tracking stopped a week ago");
      const sent = await submit(posts);
      expect(sent).toMatchObject({ category: "Shipping & Delivery", subcategory: "Lost Package", delivery: "Package lost", orderNumber: "#1004" });
      expect(validateHelpDesk(sent, [], [])).toEqual({});
    });

    // Each option, filled in as a customer would: the fields it asks for and what it sends.
    it.each([
      ["Cancel Order", ["Order Number", "Reason for Cancellation", "Additional Details (optional)"], { "Reason for Cancellation": "Ordered by mistake" }, { category: "Orders", subcategory: "Cancel Order", update: "Cancel Order", cancelReason: "Ordered by mistake" }],
      ["Modify Address", ["Order Number", "Recipient Name", "Street Address", "City", "State", "ZIP / Postal Code", "Country", "Anything Else? (optional)"],
        { "Recipient Name": "Jordan Lee", "Street Address": "2 Oak Ave", City: "Austin", State: "TX", "ZIP / Postal Code": "78701" },
        { category: "Orders", subcategory: "Change Shipping Address", update: "Update Shipping Details", shipAddress1: "2 Oak Ave", shipCity: "Austin", shipProvince: "TX", shipZip: "78701", shipCountry: "US" }],
    ] as const)("%s asks for %j and files the ticket there", async (title, asked, answers, expected) => {
      const posts = await mount();
      fillContact();
      choose("How can we help?", "Orders");
      choose("What do you need help with?", title);
      if (asked[0] === "Order Number") type("Order Number", "#1005");
      // Cancel Order and Modify Address open their fields once the order checks out.
      if (button("Continue")) {
        expect(submitButton().hidden).toBe(true);
        button("Continue").click();
        await vi.waitFor(() => expect(submitButton().hidden).toBe(false));
      }
      expect(labels()).toEqual(expect.arrayContaining([...asked]));
      for (const [label, value] of Object.entries(answers)) type(label, value);
      const sent = await submit(posts);
      expect(sent).toMatchObject(expected);
      expect(sent).not.toHaveProperty("option");
      expect(validateHelpDesk(sent, [], [])).toEqual({});
    });

    it("Shipping Times answers from the store's rates, then opens a question only if needed", async () => {
      const shipping = {
        country: "US", countryName: "United States", province: "TX", ships: true, processing: [1, 2], shipsBy: ["2026-11-03", "2026-11-04"], note: "Orders after 2 pm ship the next day.",
        rates: [
          { name: "Express", price: "$25.00", condition: "", days: [1, 2], arrives: ["2026-11-05", "2026-11-06"] },
          { name: "Standard", price: "Free", condition: "On orders of $75.00 or more", days: [3, 4], arrives: ["2026-11-09", "2026-11-10"] },
        ],
      };
      const order = { order: "#1010", method: "Standard", placedAt: "2026-11-02T09:00:00Z", status: "processing", date: null, arrives: ["2026-11-09", "2026-11-10"], trackingUrl: "" };
      const posts = await mount(undefined, undefined, { shipping, order });
      // Dates are shown in the shopper's own locale.
      const day = (value: string) => new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(value));
      fillContact();
      choose("How can we help?", "Shipping");
      choose("What do you need help with?", "Shipping Times");
      expect(labels()).toEqual(expect.arrayContaining(["Shipping To", "State (optional)", "Order Number (optional)"]));
      expect(submitButton().hidden).toBe(true);
      // Only the United States and Canada for now, then "Another country".
      expect(choices("Shipping To")).toEqual(["Canada", "United States", "Another country"]);
      choose("Shipping To", "Canada");
      expect(labels()).toContain("Province (optional)");
      choose("Shipping To", "Another country");
      expect(labels()).not.toContain("Province (optional)");
      choose("Shipping To", "United States");
      choose("State (optional)", "Texas");
      type("Order Number (optional)", "#1010");
      button("Check Shipping Times").click();
      await vi.waitFor(() => expect(document.querySelectorAll(".help-desk-track-card")).toHaveLength(2));
      expect(Object.fromEntries(posts.lookups[0].searchParams)).toMatchObject({ shipping: "1", country: "US", province: "TX", order: "#1010", email: "jordan@example.com" });
      const [orderCard, destination] = document.querySelectorAll(".help-desk-track-card");
      expect(orderCard.textContent).toContain("Order #1010 · Standard");
      expect(orderCard.textContent).toContain(`Expected to arrive ${day("2026-11-09")} – ${day("2026-11-10")}`);
      expect(destination.textContent).toContain("Shipping to Texas, United States");
      expect(destination.textContent).toContain("Orders ship within 1–2 business days");
      expect([...destination.querySelectorAll(".help-desk-ship-rates li")].map((item) => [...item.querySelectorAll("strong, small")].map((part) => part.textContent))).toEqual([
        ["Express", "$25.00", `${day("2026-11-05")} – ${day("2026-11-06")}`, "1–2 business days in transit"],
        ["Standard", "Free · On orders of $75.00 or more", `${day("2026-11-09")} – ${day("2026-11-10")}`, "3–4 business days in transit"],
      ]);
      expect(destination.textContent).toContain("Orders after 2 pm ship the next day.");
      expect(posts).toHaveLength(0);
      button("I Still Need Help").click();
      expect(control("Your Question").value).toBe("Shipping to Texas, United States.\n");
      type("Your Question", "Shipping to Texas. Will it arrive before Saturday?");
      const sent = await submit(posts);
      expect(sent).toMatchObject({ category: "Shipping & Delivery", subcategory: "Shipping Times", orderNumber: "#1010" });
      expect(validateHelpDesk(sent, [], [])).toEqual({});
    });

    it("Shipping Times says other countries are coming soon, and takes their details", async () => {
      const posts = await mount();
      fillContact();
      choose("How can we help?", "Shipping");
      choose("What do you need help with?", "Shipping Times");
      choose("Shipping To", "Another country");
      button("Check Shipping Times").click();
      // Answered on the spot: nothing to look up.
      expect(posts.lookups).toHaveLength(0);
      const card = document.querySelector(".help-desk-track-card")!;
      expect(card.textContent).toContain("Coming soon");
      expect(card.textContent).toContain("Right now we ship to the United States and Canada.");
      expect(document.querySelector(".help-desk-section-request [data-fields]")?.getAttribute("data-stage")).toBe("answer");
      button("I Still Need Help").click();
      type("Your Country and Question", "I'm in Germany. Can you ship the Slab Case X here?");
      expect(await submit(posts)).toMatchObject({ subcategory: "Shipping Times", query: "I'm in Germany. Can you ship the Slab Case X here?" });
    });

    it("Shipping Times falls back to a question when shipping times are unavailable", async () => {
      const posts = await mount();
      fillContact();
      choose("How can we help?", "Shipping");
      choose("What do you need help with?", "Shipping Times");
      button("Check Shipping Times").click();
      await vi.waitFor(() => expect(document.querySelector(".help-desk-track-error")?.textContent).toContain("unavailable"));
      type("Your Question", "How long to Texas?");
      expect((await submit(posts)).subcategory).toBe("Shipping Times");
    });

    it("Taxes, Customs & Duties asks where it ships to, then the question", async () => {
      const posts = await mount();
      fillContact();
      choose("How can we help?", "Shipping");
      choose("What do you need help with?", "Taxes, Customs & Duties");
      expect(labels()).toEqual(expect.arrayContaining(["Shipping To", "Order Number (optional)", "Your Question"]));
      // The United States and Canada for now, then any other country.
      expect(choices("Shipping To")).toEqual(["Canada", "United States", "Another country"]);
      expect((control("Shipping To") as HTMLSelectElement).value).toBe("US");
      const hints = () => [...document.querySelectorAll(".help-desk-hint")].map((hint) => hint.textContent);
      expect(hints()).toContain("We'll answer about the sales tax on your order.");
      choose("Shipping To", "Canada");
      expect(hints()).toContain("Import duties and taxes depend on the country. We'll check what applies to orders shipped to you.");
      // Another country: which one, and that shipping there is coming soon.
      choose("Shipping To", "Another country");
      expect((document.querySelector(".help-desk-elsewhere") as HTMLElement).hidden).toBe(false);
      expect(document.querySelector(".help-desk-coming-soon")?.textContent).toContain("Right now we ship to the United States and Canada.");
      choose("Which country?", "United Kingdom");
      type("Your Question", "Will I pay import duties?");
      const sent = await submit(posts);
      expect(sent).toMatchObject({ category: "Shipping & Delivery", subcategory: "Customs & Duties", topic: "General Inquiry", country: "GB" });
      expect(validateHelpDesk(sent, [], [])).toEqual({});
    });

    it("International Pre-Order uses the shipping request, with its own hint", async () => {
      await mount();
      choose("How can we help?", "Shipping");
      choose("What do you need help with?", "International Pre-Order");
      expect(choices("Country")).toEqual(["Canada", "United States", "Another country"]);
      pickProduct("Products You Want Shipped", "slab");
      choose("Country", "Canada");
      type("City", "Toronto");
      choose("Province", "Ontario");
      button("Check Shipping Cost & Time").click();
      await vi.waitFor(() => expect(submitButton().hidden).toBe(false));
      expect((control("Anything Else? (optional)") as HTMLTextAreaElement).placeholder).toContain("back in stock");
    });

    it("International Shipping answers with the shipping cost first, and opens a request only if still needed", async () => {
      const shipping = { country: "CA", countryName: "Canada", province: "ON", ships: true, quoted: true, processing: [1, 2], shipsBy: ["2026-11-03", "2026-11-04"], note: "",
        rates: [{ name: "Standard International", price: "$40.00", condition: "", days: [6, 12], arrives: ["2026-11-11", "2026-11-19"] }] };
      const posts = await mount(undefined, undefined, { shipping, order: null });
      fillContact();
      choose("How can we help?", "Shipping");
      choose("What do you need help with?", "International Shipping");
      expect(labels()).toEqual(expect.arrayContaining(["Country", "Street Address (optional)", "City", "ZIP / Postal Code (optional)"]));
      // The United States and Canada for now, then any other country.
      expect(choices("Country")).toEqual(["Canada", "United States", "Another country"]);
      // The answer comes first: no request to send yet.
      expect(submitButton().hidden).toBe(true);
      choose("Country", "Canada");
      type("City", "Toronto");
      choose("Province", "Ontario");
      button("Check Shipping Cost & Time").click();
      expect(document.querySelector("[data-help-desk-status]")?.textContent).toContain("Select the products you want shipped first.");
      expect(posts.lookups).toHaveLength(0);
      // No list until they type; then suggestions to pick from.
      expect(document.querySelector(".help-desk-suggestions")?.hasAttribute("hidden")).toBe(true);
      pickProduct("Products You Want Shipped", "slab");
      expect(document.querySelector(".help-desk-selected")?.textContent).toContain("Slab Case X");
      button("Check Shipping Cost & Time").click();
      await vi.waitFor(() => expect(document.querySelector(".help-desk-ship-rates")?.textContent).toContain("Standard International"));
      expect(Object.fromEntries(posts.lookups[0].searchParams)).toMatchObject({ shipping: "1", country: "CA", province: "ON", city: "Toronto", products: "gid://shopify/Product/1" });
      // The answer is its own screen, with no request yet.
      expect(document.querySelector(".help-desk-section-request [data-fields]")?.getAttribute("data-stage")).toBe("answer");
      expect(document.querySelector(".help-desk-section-request h3")?.textContent).toBe("Shipping options");
      expect(posts).toHaveLength(0);
      button("I Still Need Help").click();
      expect(submitButton().hidden).toBe(false);
      type("Street Address (optional)", "1 King St W");
      type("ZIP / Postal Code (optional)", "M5H 1A1");
      control("City").dispatchEvent(new Event("input", { bubbles: true }));
      type("Anything Else? (optional)", "Can it arrive by the 20th?");
      const sent = await submit(posts);
      expect(sent).toMatchObject({ category: "Shipping & Delivery", subcategory: "International Shipping", topic: "Shipping Inquiry", country: "CA", address: "1 King St W, Toronto, Ontario, M5H 1A1", otherDetails: "Can it arrive by the 20th?" });
      expect(validateHelpDesk(sent, ["gid://shopify/Product/1"], [])).toEqual({});
    });

    it("International Shipping to another country says it's coming soon, and still takes the request", async () => {
      const posts = await mount();
      fillContact();
      choose("How can we help?", "Shipping");
      choose("What do you need help with?", "International Shipping");
      pickProduct("Products You Want Shipped", "slab");
      choose("Country", "Another country");
      choose("Which country?", "Germany");
      type("City", "Berlin");
      button("Check Shipping Cost & Time").click();
      // Answered on the spot, without asking for prices.
      expect(posts.lookups).toHaveLength(0);
      expect(document.querySelector(".help-desk-section-request [data-fields]")?.getAttribute("data-stage")).toBe("answer");
      expect(document.querySelector(".help-desk-track-card")?.textContent).toContain("Coming soon");
      button("I Still Need Help").click();
      control("City").dispatchEvent(new Event("input", { bubbles: true }));
      const sent = await submit(posts);
      expect(sent).toMatchObject({ subcategory: "International Shipping", country: "DE", address: "Berlin" });
    });

    it.each([
      ["we don't ship there", { shipping: { country: "US", countryName: "United States", province: "TX", ships: false, quoted: true, processing: null, shipsBy: null, note: "", rates: [] }, order: null }],
      ["shipping can't be worked out", { error: "Shipping times are unavailable right now." }],
    ])("Domestic Shipping opens the request for a quote when %s", async (_, answer) => {
      const posts = await mount(undefined, undefined, answer);
      fillContact();
      choose("How can we help?", "Shipping");
      choose("What do you need help with?", "Domestic Shipping");
      expect(choices("Country")).toEqual(["United States"]);
      expect((control("Country") as HTMLSelectElement).value).toBe("US");
      pickProduct("Products You Want Shipped", "slab");
      type("City", "Austin");
      choose("State", "Texas");
      control("State").dispatchEvent(new Event("change", { bubbles: true }));
      // State is required before checking.
      button("Check Shipping Cost & Time").click();
      await vi.waitFor(() => expect(submitButton().hidden).toBe(false));
      expect(document.querySelector(".help-desk-section-request [data-fields]")?.getAttribute("data-stage")).toBe("request");
      expect(document.querySelector(".help-desk-track-error")?.textContent).toBe(("error" in answer ? answer.error : undefined) ?? "We can't show shipping for this address online. Send your request and our team will reply with a quote.");
      const sent = await submit(posts);
      expect(sent).toMatchObject({ subcategory: "Domestic Shipping", topic: "Shipping Inquiry", country: "US", address: "Austin, Texas" });
    });

    it.each([
      ["Cancel Order", "This order has already shipped, so it can no longer be cancelled.", "Reason for Cancellation"],
      ["Modify Address", "This order has already shipped or is being packed, so its address can no longer be changed.", "Street Address"],
    ] as const)("%s keeps its fields closed for an order that has shipped", async (title, reason, field) => {
      const posts = await mount(undefined, { error: reason });
      fillContact();
      choose("How can we help?", "Orders");
      choose("What do you need help with?", title);
      // Nothing to fill in, and nothing to send, until the order is checked.
      expect(labels()).not.toContain(field);
      expect(submitButton().hidden).toBe(true);
      button("Continue").click();
      expect(document.querySelector('.help-desk-track-error[role="alert"]')?.textContent).toBe("Please enter your email address and order number first.");
      type("Order Number", "#1009");
      button("Continue").click();
      await vi.waitFor(() => expect(document.querySelector('.help-desk-track-error[role="alert"]')?.textContent).toBe(reason));
      expect(posts.lookups.at(-1)?.searchParams.get("check")).toBe(title === "Cancel Order" ? "cancel" : "address");
      expect(posts.lookups.at(-1)?.searchParams.get("email")).toBe("jordan@example.com");
      expect(labels()).not.toContain(field);
      expect(submitButton().hidden).toBe(true);
    });

    it("Modify Address offers only the order's own country, and closes again when the order changes", async () => {
      await mount(undefined, { allowed: true, country: "CA" });
      fillContact();
      choose("How can we help?", "Orders");
      choose("What do you need help with?", "Modify Address");
      type("Order Number", "#1010");
      button("Continue").click();
      await vi.waitFor(() => expect(labels()).toContain("Street Address"));
      expect(choices("Country")).toEqual(["Canada"]);
      // Canada's provinces, as Shopify's codes.
      expect(choices("Province")).toContain("Ontario");
      expect([...(control("Province") as HTMLSelectElement).options].find((option) => option.textContent === "Ontario")?.value).toBe("ON");
      control("Order Number").dispatchEvent(new Event("input", { bubbles: true }));
      expect(labels()).not.toContain("Street Address");
      expect(submitButton().hidden).toBe(true);
    });

    it("Cancel Order says the whole order is cancelled and asks why when the reason is Other", async () => {
      const posts = await mount();
      fillContact();
      choose("How can we help?", "Orders");
      choose("What do you need help with?", "Cancel Order");
      expect(document.querySelector(".help-desk-cancel-notice")?.textContent).toContain("whole order");
      type("Order Number", "#1006");
      button("Continue").click();
      await vi.waitFor(() => expect(labels()).toContain("Reason for Cancellation"));
      expect(choices("Reason for Cancellation")).toEqual(cancelReasons);
      type("Additional Details (optional)", "Sorry!");
      choose("Reason for Cancellation", "Other");
      // The note typed so far is kept, and now it's required.
      expect(control("Tell Us Why").required).toBe(true);
      expect(control("Tell Us Why").value).toBe("Sorry!");
      type("Tell Us Why", "Moving house next week");
      const sent = await submit(posts);
      expect(sent).toMatchObject({ update: "Cancel Order", cancelReason: "Other", details: "Moving house next week" });
      expect(validateHelpDesk(sent, [], [])).toEqual({});
    });

    it("switching options clears the previous option's fields", async () => {
      await mount();
      fillContact();
      choose("How can we help?", "Orders");
      choose("What do you need help with?", "Cancel Order");
      type("Order Number", "#1006");
      button("Continue").click();
      await vi.waitFor(() => expect(labels()).toContain("Reason for Cancellation"));
      choose("What do you need help with?", "Lost Package");
      expect(labels()).not.toContain("Reason for Cancellation");
      expect(button("Continue")).toBeUndefined();
      expect((document.querySelector('input[name="subcategory"]') as HTMLInputElement).value).toBe("Lost Package");
    });
  });

  it("an order number and email that don't match open the request straight away", async () => {
    await mount();
    fillContact();
    choose("How can we help?", "Other Queries");
    choose("What do you need help with?", "Shipment Delayed");
    type("Order Number", "#9999");
    button("Check Order Status").click();
    await vi.waitFor(() => expect(document.querySelector(".help-desk-track-error")?.textContent).toContain("couldn't find an order"));
    expect(submitButton().hidden).toBe(false);
    expect(labels()).toContain("How can we help with this order?");
  });

  // The order's items, as the app returns them for a product issue.
  const orderItems = { found: { order: "#1002", deliveredAt: "2026-10-20T10:00:00Z", items: [
    { id: "gid://shopify/Product/1", title: "Slab Case X", variant: "Black", quantity: 1, image: "" },
    { id: "gid://shopify/Product/2", title: "Graded Card Display", variant: "", quantity: 2, image: "" },
  ] } };
  const item = (title: string) => [...document.querySelectorAll(".help-desk-item")].find((card) => card.querySelector("strong")?.textContent === title) as HTMLButtonElement;
  const stageOf = () => document.querySelector(".help-desk-section-request [data-fields]")?.getAttribute("data-stage");
  const boxes = () => [...document.querySelectorAll(".help-desk-product-issue")].map((box) => box.querySelector("strong")?.textContent);
  const findOrder = async (option: string, answer: unknown = orderItems) => {
    const posts = await mount(undefined, answer);
    fillContact();
    choose("How can we help?", "Product Issues");
    choose("What do you need help with?", option);
    type("Order Number", "#1002");
    button("Continue").click();
    return posts;
  };

  it("Damaged or Defective: finds the order, then a box for each product with a problem", async () => {
    const posts = await findOrder("Damaged or Defective");
    await vi.waitFor(() => expect(stageOf()).toBe("request"));
    expect(Object.fromEntries(posts.lookups[0].searchParams)).toMatchObject({ check: "items", order: "#1002", email: "jordan@example.com" });
    expect(document.querySelector(".help-desk-verified")?.textContent).toContain("Order #1002");
    // The order's products to pick from; no part list, no product named until picked.
    expect([...document.querySelectorAll(".help-desk-item strong")].map((title) => title.textContent)).toEqual(["Slab Case X", "Graded Card Display"]);
    expect(document.querySelector('input[name="part"]')).toBeNull();
    expect(boxes()).toEqual([]);
    // An item must be picked before Review.
    submitButton().click();
    expect(document.querySelector("[data-help-desk-status]")?.textContent).toContain("Select the product with the problem.");
    // Each product picked gets its own box: what's wrong, its photos and its video.
    item("Slab Case X").click();
    item("Graded Card Display").click();
    expect(boxes()).toEqual(["Slab Case X", "Graded Card Display"]);
    expect(labels().filter((label) => label === "Describe the issue")).toHaveLength(2);
    expect(document.querySelector('input[name="images:gid://shopify/Product/1"]')).toBeTruthy();
    expect((document.querySelector('input[name="images:gid://shopify/Product/2"]') as HTMLInputElement).required).toBe(true);
    expect(document.querySelector('input[name="videos:gid://shopify/Product/2"]')).toBeTruthy();
    // Unpicking a product removes its box.
    item("Graded Card Display").click();
    expect(boxes()).toEqual(["Slab Case X"]);
    type("Describe the issue", "Only one lock takes the combination");
    // Without its photo, Next doesn't open Review.
    submitButton().click();
    expect((document.querySelector(".help-desk-section-review") as HTMLElement).hidden).toBe(true);
    expect(posts).toHaveLength(0);
    // Back returns to the order.
    (document.querySelector(".help-desk-section-request .help-desk-nav button") as HTMLButtonElement).click();
    expect(stageOf()).toBe("ask");
  });

  it("Damaged or Defective: What happened? files it as shipping damage, damage at packing or a defect, and sets the photo tips", async () => {
    await findOrder("Damaged or Defective");
    await vi.waitFor(() => expect(stageOf()).toBe("request"));
    const radios = [...document.querySelectorAll<HTMLInputElement>("input[name=kind]")];
    expect(radios.map((radio) => radio.value)).toEqual(["Damaged in shipping", "Broken on arrival", "Doesn't work properly"]);
    // Nothing is picked to start with, and it must be answered.
    expect(radios.some((radio) => radio.checked)).toBe(false);
    expect(radios[0].required).toBe(true);
    const hidden = (name: string) => (document.querySelector(`input[type=hidden][name=${name}]`) as HTMLInputElement).value;
    radios[2].click();
    expect([hidden("category"), hidden("subcategory")]).toEqual(["Manufacturing Defect", "Defective or not working"]);
    item("Slab Case X").click();
    expect(document.querySelector(".help-desk-photo-tips")?.textContent).not.toContain("Shipping box");
    radios[1].click();
    expect([hidden("category"), hidden("subcategory")]).toEqual(["Product Damage", "Other damage"]);
    radios[0].click();
    expect([hidden("category"), hidden("subcategory")]).toEqual(["Shipping Damage", "Damaged in transit"]);
    expect(document.querySelector(".help-desk-photo-tips")?.textContent).toContain("Shipping box and label");
    // No part list: their words, photos and a video say it. A single item asks no quantity. Then what they'd like.
    expect(labels()).toContain("Describe the issue");
    expect(labels()).not.toContain("Which part?");
    expect(labels()).not.toContain("How many are affected?");
    expect([...document.querySelectorAll<HTMLInputElement>("input[name^=\"itemResolution:\"]")].map((radio) => radio.value)).toEqual(["Replacement", "Refund"]);
    // Two of a product: how many are affected.
    item("Graded Card Display").click();
    expect(labels()).toContain("How many are affected?");
    expect((document.querySelector('input[name="itemQty:gid://shopify/Product/2"]') as HTMLInputElement).max).toBe("2");
  });

  it("Damaged or Defective goes all the way: what happened, the part, the photo and what they'd like, checked on Review and sent", async () => {
    const posts = await findOrder("Damaged or Defective");
    await vi.waitFor(() => expect(stageOf()).toBe("request"));
    const reviewOpen = () => !(document.querySelector(".help-desk-section-review") as HTMLElement).hidden;
    item("Slab Case X").click();
    type("Describe the issue", "The lid won't close");
    const photo = document.querySelector('input[name="images:gid://shopify/Product/1"]') as HTMLInputElement;
    const transfer = new DataTransfer();
    transfer.items.add(new File(["x"], "lid.jpg", { type: "image/jpeg" }));
    photo.files = transfer.files;
    photo.dispatchEvent(new Event("change"));
    expect(photo.files?.length).toBe(1);
    // Each question must be answered before Review: what happened, then what they'd like.
    review();
    expect(reviewOpen()).toBe(false);
    [...document.querySelectorAll<HTMLInputElement>("input[name=kind]")].find((radio) => radio.value === "Doesn't work properly")!.click();
    review();
    expect(reviewOpen()).toBe(false);
    // A replacement starts with the product they picked; without any, Review waits.
    const chips = () => [...document.querySelectorAll(".help-desk-replacement .help-desk-selected button")].map((chip) => chip.textContent?.replace("×", "").trim());
    (document.querySelector('input[name^="itemResolution:"][value="Replacement"]') as HTMLInputElement).click();
    expect(chips()).toEqual(["Slab Case X"]);
    (document.querySelector(".help-desk-replacement .help-desk-selected button") as HTMLButtonElement).click();
    expect(chips()).toEqual([]);
    review();
    expect(reviewOpen()).toBe(false);
    expect(document.querySelector("[data-help-desk-status]")?.textContent).toContain("Add the product you'd like instead of Slab Case X.");
    pickProduct("Add product", "slab");
    expect(chips()).toEqual(["Slab Case X"]);
    review();
    expect(reviewOpen()).toBe(true);
    const rows = Object.fromEntries([...document.querySelectorAll(".help-desk-review-row")].map((row) => [row.querySelector("span")?.textContent, row.querySelector("strong")?.textContent]));
    expect(rows).toMatchObject({ "What happened?": "Doesn't work properly", "Slab Case X · Wants": "Replacement", "Slab Case X · Replacement": "Slab Case X",
      "Slab Case X": "The lid won't close", Products: "Slab Case X", Photos: "1 attached" });
    document.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ category: "Manufacturing Defect", subcategory: "Defective or not working", "itemResolution:gid://shopify/Product/1": "Replacement", "itemReplacement:gid://shopify/Product/1": "Slab Case X",
      products: "gid://shopify/Product/1", "itemNote:gid://shopify/Product/1": "The lid won't close" });
  });

  it("Missing Item or Part: nothing is picked for them, they say what's missing in words, a photo or a video", async () => {
    const posts = await findOrder("Missing Item or Part", { found: { ...orderItems.found, items: [orderItems.found.items[0]] } });
    await vi.waitFor(() => expect(stageOf()).toBe("request"));
    // Even a one-item order starts unpicked.
    expect(item("Slab Case X").getAttribute("aria-pressed")).toBe("false");
    expect(boxes()).toEqual([]);
    expect(document.querySelector(".help-desk-cancel-notice")).toBeNull();
    item("Slab Case X").click();
    expect(boxes()).toEqual(["Slab Case X"]);
    expect((document.querySelector('input[name="images:gid://shopify/Product/1"]') as HTMLInputElement).required).toBe(false);
    // No part list or count: their words, photos and a video say it.
    expect(document.querySelector('input[name="videos:gid://shopify/Product/1"]')).toBeTruthy();
    expect(document.querySelector('[name^="itemPart"], [name^="itemQty"]')).toBeNull();
    expect((control("What's missing?") as HTMLTextAreaElement).required).toBe(true);
    type("What's missing?", "The sling bag was not in the box");
    expect([...document.querySelectorAll<HTMLInputElement>("input[name^=\"itemResolution:\"]")].map((radio) => radio.closest("label")?.textContent)).toEqual(["Replacement", "Refund"]);
    (document.querySelector('input[name^="itemResolution:"][value="Replacement"]') as HTMLInputElement).click();
    const sent = await submit(posts);
    expect(sent).toMatchObject({ category: "Missing Parts", subcategory: "Item missing from order", products: "gid://shopify/Product/1", "itemResolution:gid://shopify/Product/1": "Replacement", "itemReplacement:gid://shopify/Product/1": "Slab Case X",
      "itemTitle:gid://shopify/Product/1": "Slab Case X", "itemNote:gid://shopify/Product/1": "The sling bag was not in the box" });
  });

  it("a chosen video can be removed again, and any video format can be picked", async () => {
    await findOrder("Damaged or Defective");
    await vi.waitFor(() => expect(stageOf()).toBe("request"));
    item("Slab Case X").click();
    const video = document.querySelector('input[name="videos:gid://shopify/Product/1"]') as HTMLInputElement;
    expect(video.accept.split(",")).toEqual(expect.arrayContaining(["video/*", ".mkv", ".avi", ".mts", ".3gp"]));
    const remove = [...document.querySelectorAll<HTMLButtonElement>(".help-desk-remove-video")].find((button) => button.closest(".help-desk-upload")?.contains(video))!;
    expect(remove.hidden).toBe(true);
    const transfer = new DataTransfer();
    transfer.items.add(new File(["x"], "clip.mkv", { type: "" }));
    video.files = transfer.files;
    video.dispatchEvent(new Event("change"));
    // An MKV the browser gave no type is still a video.
    expect(video.validationMessage).toBe("");
    expect(remove.hidden).toBe(false);
    expect(video.closest(".help-desk-upload")?.querySelector("strong")?.textContent).toBe("clip.mkv");
    remove.click();
    expect(video.files?.length ?? 0).toBe(0);
    expect(remove.hidden).toBe(true);
    expect(video.closest(".help-desk-upload")?.querySelector("strong")?.textContent).toBe("Upload a video");
  });

  it("Missing Item or Part warns when part of the order hasn't shipped yet", async () => {
    await findOrder("Missing Item or Part", { found: { ...orderItems.found, partial: true } });
    await vi.waitFor(() => expect(stageOf()).toBe("request"));
    expect(document.querySelector(".help-desk-cancel-notice")?.textContent).toContain("Part of this order hasn't shipped yet.");
  });

  it("an order the app can't find (an old one, say) can continue by searching for the product", async () => {
    const posts = await findOrder("Missing Item or Part", { error: "We couldn't find an order with that number and email. Please check both.", notFound: true });
    await vi.waitFor(() => expect(document.querySelector(".help-desk-track-error")?.textContent).toContain("older order"));
    expect(stageOf()).not.toBe("request");
    button("Continue without it").click();
    expect(stageOf()).toBe("request");
    pickProduct("Which product has a problem?", "slab");
    expect(boxes()).toEqual(["Slab Case X"]);
    type("What's missing?", "The whole case");
    const refundNote = document.querySelector(".help-desk-refund-note") as HTMLElement;
    expect(refundNote.hidden).toBe(true);
    (document.querySelector('input[name^="itemResolution:"][value="Refund"]') as HTMLInputElement).click();
    expect(refundNote.hidden).toBe(false);
    expect(refundNote.textContent).toContain("original payment method");
    (document.querySelector('input[name^="itemResolution:"][value="Replacement"]') as HTMLInputElement).click();
    expect(refundNote.hidden).toBe(true);
    (document.querySelector('input[name^="itemResolution:"][value="Refund"]') as HTMLInputElement).click();
    expect(await submit(posts)).toMatchObject({ orderNumber: "#1002", products: "gid://shopify/Product/1", "itemNote:gid://shopify/Product/1": "The whole case", "itemResolution:gid://shopify/Product/1": "Refund" });
  });

  it("Warranty Claim without a found order asks where and when it was bought", async () => {
    await findOrder("Warranty Claim", { error: "We couldn't find an order with that number and email. Please check both.", notFound: true });
    await vi.waitFor(() => expect(document.querySelector(".help-desk-track-error")?.textContent).toContain("older order"));
    button("Continue without it").click();
    expect(choices("Where did you buy it?")).toEqual(["Zion Cases website", "Amazon", "A store or dealer", "Gift or other"]);
    expect((control("When? (month)") as HTMLInputElement).type).toBe("month");
    pickProduct("Which product has a problem?", "slab");
    expect([...document.querySelectorAll<HTMLInputElement>("input[name^=\"itemResolution:\"]")].map((radio) => radio.value)).toEqual(["Replacement", "Refund"]);
  });

  it("Warranty Claim with a found order doesn't ask where it was bought", async () => {
    await findOrder("Warranty Claim");
    await vi.waitFor(() => expect(stageOf()).toBe("request"));
    expect(labels()).not.toContain("Where did you buy it?");
  });

  it("a signed-in customer picks from their order's products even when the app can't check it, each with its own box under it", async () => {
    const customer = { name: "Sandy Netgains", email: "sandy@example.com", phone: "", orders: [
      { name: "#1002", date: "Oct 20, 2026", fulfillment: "fulfilled", items: orderItems.found.items },
    ] };
    const posts = await mount(undefined, { error: "We couldn't check your order right now.", unavailable: true }, undefined, customer);
    choose("How can we help?", "Product Issues");
    choose("What do you need help with?", "Damaged or Defective");
    button("Continue").click();
    await vi.waitFor(() => expect(stageOf()).toBe("request"));
    expect([...document.querySelectorAll(".help-desk-item strong")].map((title) => title.textContent)).toEqual(["Slab Case X", "Graded Card Display"]);
    expect(labels()).toContain("Search other products");
    item("Graded Card Display").click();
    // The box sits right under the product it's for.
    expect(item("Graded Card Display").parentElement!.querySelector(".help-desk-product-issue strong")?.textContent).toBe("Graded Card Display");
    expect(item("Slab Case X").parentElement!.querySelector(".help-desk-product-issue")).toBeNull();
    type("Describe the issue", "Cracked corner");
    expect(document.querySelector('input[name="images:gid://shopify/Product/2"]')).toBeTruthy();
    expect(posts).toHaveLength(0);
  });

  const kindRadio = (value: string) => [...document.querySelectorAll<HTMLInputElement>("input[name=kind]")].find((radio) => radio.value === value)!;
  const pickResolution = (value: string) => (document.querySelector(`input[name^="itemResolution:"][value="${value}"]`) as HTMLInputElement).click();
  const addProductOpen = () => !(document.querySelector(".help-desk-replacement") as HTMLElement).hidden;

  it("Received the Wrong Item: the same product cards, each asking what came instead with required photos and a video", async () => {
    await findOrder("Received the Wrong Item");
    await vi.waitFor(() => expect(stageOf()).toBe("request"));
    expect(document.querySelector(".help-desk-pick-title")?.textContent).toContain("Which product was wrong?");
    expect(boxes()).toEqual([]);
    submitButton().click();
    expect(document.querySelector("[data-help-desk-status]")?.textContent).toContain("Select the product that was wrong.");
    expect([...document.querySelectorAll<HTMLInputElement>("input[name=kind]")].map((radio) => radio.value)).toEqual(["Wrong product", "Wrong colour or size", "Wrong quantity"]);
    item("Graded Card Display").click();
    expect(labels()).toContain("What did you receive instead?");
    expect(labels()).not.toContain("Which part?");
    expect((document.querySelector('input[name="images:gid://shopify/Product/2"]') as HTMLInputElement).required).toBe(true);
    expect(document.querySelector('input[name="videos:gid://shopify/Product/2"]')).toBeTruthy();
  });

  it("Wrong product: a replacement is a whole product they add", async () => {
    await findOrder("Received the Wrong Item");
    await vi.waitFor(() => expect(stageOf()).toBe("request"));
    kindRadio("Wrong product").click();
    item("Slab Case X").click();
    pickResolution("Replacement");
    expect(addProductOpen()).toBe(true);
    expect(labels()).toContain("Add product");
  });

  it("Wrong colour or size: they pick the variant they wanted from the product's own list", async () => {
    const posts = await findOrder("Received the Wrong Item");
    await vi.waitFor(() => expect(stageOf()).toBe("request"));
    kindRadio("Wrong colour or size").click();
    item("Slab Case X").click();
    expect(document.querySelector(".help-desk-product-issue .help-desk-hint")?.textContent).toBe("You ordered: Black · Qty 1");
    // The variants come from the app, sold-out ones marked.
    await vi.waitFor(() => expect(choices("Which colour or size do you want?")).toEqual(["Black", "Blue (sold out)"]));
    expect(posts.lookups.some((url) => url.searchParams.get("check") === "variants" && url.searchParams.get("product") === "gid://shopify/Product/1")).toBe(true);
    choose("Which colour or size do you want?", "Blue (sold out)");
    expect((control("Which colour or size do you want?") as HTMLSelectElement).name).toBe("itemVariant:gid://shopify/Product/1");
    // The replacement is that variant: no other product to add.
    pickResolution("Replacement");
    expect(addProductOpen()).toBe(false);
    // Switching to Wrong product asks again, and keeps what they wrote.
    type("What did you receive instead?", "A black one");
    kindRadio("Wrong product").click();
    expect(labels()).not.toContain("Which colour or size do you want?");
    expect((control("What did you receive instead?") as HTMLTextAreaElement).value).toBe("A black one");
    expect(addProductOpen()).toBe(true);
  });

  it("Wrong colour or size falls back to typing it when the variants can't be loaded", async () => {
    await findOrder("Received the Wrong Item");
    globalThis.fetch = vi.fn(async (url: unknown) => new URL(String(url), location.origin).searchParams.get("check") === "variants"
      ? new Response(JSON.stringify({ unavailable: true })) : new Response(JSON.stringify(orderItems))) as typeof fetch;
    await vi.waitFor(() => expect(stageOf()).toBe("request"));
    kindRadio("Wrong colour or size").click();
    item("Graded Card Display").click();
    await vi.waitFor(() => expect((control("Which colour or size do you want?") as HTMLInputElement).tagName).toBe("INPUT"));
  });

  it("Wrong quantity: how many arrived and how many they want, sent with the product", async () => {
    const posts = await findOrder("Received the Wrong Item");
    await vi.waitFor(() => expect(stageOf()).toBe("request"));
    kindRadio("Wrong quantity").click();
    item("Graded Card Display").click();
    expect(document.querySelector(".help-desk-product-issue .help-desk-hint")?.textContent).toBe("You ordered: Qty 2");
    expect(labels()).toEqual(expect.arrayContaining(["Qty arrived", "Qty you want", "Details (optional)"]));
    expect((control("Qty you want") as HTMLInputElement).value).toBe("2");
    type("Qty arrived", "1");
    pickResolution("Replacement");
    expect(addProductOpen()).toBe(false);
    const photo = document.querySelector('input[name="images:gid://shopify/Product/2"]') as HTMLInputElement;
    const transfer = new DataTransfer();
    transfer.items.add(new File(["x"], "box.jpg", { type: "image/jpeg" }));
    photo.files = transfer.files;
    photo.dispatchEvent(new Event("change"));
    const sent = await submit(posts);
    expect(sent).toMatchObject({ category: "Wrong Item Received", subcategory: "Wrong quantity", "itemResolution:gid://shopify/Product/2": "Replacement",
      "itemReceived:gid://shopify/Product/2": "1", "itemWanted:gid://shopify/Product/2": "2" });
    expect(sent["itemReplacement:gid://shopify/Product/2"] ?? "").toBe("");
  });

  it("Product Compatibility › PSA slab fit is a simple inquiry", async () => {
    const posts = await mount();
    fillContact();
    choose("How can we help?", "Other Queries");
    choose("What do you need help with?", "PSA slab fit");
    expect(labels()).toContain("Order Number (optional)");
    type("Your Inquiry", "Will a PSA slab fit the Goliath case?");
    const sent = await submit(posts);
    expect(sent).toMatchObject({ category: "Product Compatibility", subcategory: "PSA slab fit", topic: "General Inquiry" });
    expect(validateHelpDesk(sent, [], [])).toEqual({});
  });

  it("changing the topic clears the previous issue's fields", async () => {
    await mount();
    choose("How can we help?", "Product Issues");
    choose("What do you need help with?", "Damaged or Defective");
    choose("How can we help?", "Wholesale Queries");
    expect(labels()).not.toContain("Describe the Issue");
    expect(choices("What do you need help with?")).toContain("Dealer pricing");
  });

  it("confirms the request professionally", async () => {
    const posts = await mount();
    fillContact();
    choose("How can we help?", "Other Queries");
    choose("What do you need help with?", "General question");
    type("Your Inquiry", "Hello");
    await submit(posts);
    await vi.waitFor(() => expect(document.querySelector("[data-help-desk-status]")?.textContent).toContain("Thank you. Your request #1001 has been received."));
  });
});
