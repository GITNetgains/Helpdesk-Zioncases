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
  const wrap = [...document.querySelectorAll("label")].find((element) => !element.closest(".help-desk-start-pane") && element.querySelector("span")?.textContent?.startsWith(label));
  if (!wrap) throw new Error(`No field labelled "${label}"`);
  return wrap.querySelector("select, input, textarea") as HTMLSelectElement | HTMLInputElement | HTMLTextAreaElement;
}
// The steps' fields (the start question's own panels are tested on their own).
const labels = () => [...document.querySelectorAll("form label > span:first-child")].filter((element) => !element.closest(".help-desk-start-pane")).map((element) => element.textContent!.replace(/\s*\*$/, "").trim());
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
  it("asks a guest to sign in first, without the topics, when the block requires it, but lets them search the help articles", async () => {
    const page = (customer: string) => `<div data-help-desk data-endpoint="/apps/help-desk" data-require-login="true" data-login-url="/account/login" data-register-url="/account/register">
      <div data-help-desk-status></div><div data-help-desk-form></div>${customer}</div>`;
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(config))) as typeof fetch;
    document.body.innerHTML = page("");
    new Function(script)();
    await vi.waitFor(() => expect(document.querySelector(".help-desk-gate")).toBeTruthy());
    expect(document.querySelector("form")).toBeNull();
    expect(document.querySelector(".help-desk-gate strong")?.textContent).toBe("Need to send us a request?");
    expect(document.querySelector(".help-desk-search-input")).toBeTruthy();
    const links = [...document.querySelectorAll<HTMLAnchorElement>(".help-desk-gate a")];
    expect(links.map((link) => link.textContent)).toEqual(["Sign in", "Create an account"]);
    expect(new URL(links[0].href).searchParams.get("return_url")).toBe("/pages/support");
    // Only the help articles are loaded: no orders or requests for a guest.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    // New customer accounts: their own sign-in, back here with return_to.
    document.body.innerHTML = page("").replace('data-login-url="/account/login"', 'data-login-url="/customer_authentication/redirect?locale=en&amp;region_country=US"');
    new Function(script)();
    await vi.waitFor(() => expect(document.querySelector(".help-desk-gate")).toBeTruthy());
    const signIn = new URL((document.querySelector(".help-desk-gate a") as HTMLAnchorElement).href);
    expect(signIn.pathname).toBe("/customer_authentication/login");
    expect(signIn.searchParams.get("return_to")).toBe("/pages/support");
    // Signed in: the form, from its first question.
    document.body.innerHTML = page(`<script type="application/json" data-help-desk-customer>${JSON.stringify({ name: "Sandy", email: "sandy@example.com", orders: [] })}</script>`);
    new Function(script)();
    await vi.waitFor(() => expect(document.querySelector("form")).toBeTruthy());
    expect(document.querySelector(".help-desk-gate")).toBeNull();
    expect(document.querySelector(".help-desk-tile strong")?.textContent).toBe("I have a question about an order");
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
    expect(shown()).toEqual(["Hey! How can we help you?"]);
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
    (document.querySelector(".help-desk-section-request > .help-desk-back") as HTMLButtonElement).click();
    expect(shown()).toEqual(["Your details"]);
    expect(control("Full name").value).toBe("Jordan Lee");
    button("Next").click();
    type("Your Question", "Will I pay import duties?");
    const sent = await submit(posts);
    expect(sent).toMatchObject({ subcategory: "Customs & Duties", name: "Jordan Lee" });
    // A new request starts again at step 1.
    await vi.waitFor(() => expect(shown()).toEqual(["Hey! How can we help you?"]));
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
    (document.querySelector(".help-desk-section-request > .help-desk-back") as HTMLButtonElement).click();
    expect(shown()).toEqual(["What do you need help with?"]);
    card("Taxes, Customs & Duties").click();
    type("Your Question", "Will I pay duties?");
    expect(await submit(posts)).toMatchObject({ name: "Sandy Netgains", email: "sandy@example.com", subcategory: "Customs & Duties" });
  });

  describe("Hey! How can we help you?", () => {
    const sandy = {
      name: "Sandy Netgains", email: "sandy@example.com", phone: "", orders: [
        { name: "#1018", date: "Oct 20, 2026", fulfillment: null, cancelled: false, items: [{ id: "gid://shopify/Product/1", title: "Slab Case X", variant: "Black", quantity: 2, image: "" }] },
        { name: "#1009", date: "Sep 2, 2026", fulfillment: "fulfilled", cancelled: false, items: [{ id: "gid://shopify/Product/2", title: "Vault", variant: "", quantity: 1, image: "" }] },
      ],
    };
    const tileButton = (text: string) => [...document.querySelectorAll(".help-desk-tile")].find((tile) => tile.querySelector("strong")!.textContent === text) as HTMLButtonElement;
    const shown = () => [...document.querySelectorAll(".help-desk-section")].filter((section) => !(section as HTMLElement).hidden).map((section) => section.querySelector("h3")!.textContent);
    const status = () => document.querySelector("[data-help-desk-status]")?.textContent;
    const startField = (label: string) => [...document.querySelectorAll(".help-desk-start-pane label")]
      .find((element) => element.querySelector("span")?.textContent?.startsWith(label))!.querySelector("select, textarea") as HTMLSelectElement & HTMLTextAreaElement;
    const pickStart = (label: string, text: string) => {
      const select = startField(label);
      select.value = [...select.options].find((option) => option.textContent === text)!.value;
      select.dispatchEvent(new Event("change"));
    };

    it("starts with one question, and keeps every topic one click away", async () => {
      await mount();
      expect(shown()).toEqual(["Hey! How can we help you?"]);
      expect([...document.querySelectorAll(".help-desk-start-choices .help-desk-tile strong")].map((element) => element.textContent))
        .toEqual(["I have a question about an order", "My question isn’t about an order"]);
      expect([...document.querySelectorAll(".help-desk-start-pane")].every((pane) => (pane as HTMLElement).hidden)).toBe(true);
      const allTopics = document.querySelector(".help-desk-all-topics") as HTMLElement;
      expect(allTopics.hidden).toBe(true);
      button("See all topics").click();
      expect(allTopics.hidden).toBe(false);
      tileButton("Wholesale Queries").click();
      expect(shown()).toEqual(["What do you need help with?"]);
    });

    it("about an order: the customer picks theirs, sees what's in it, then what they need, and that order is used", async () => {
      const posts = await mount(undefined, { allowed: true, country: "US" }, undefined, sandy);
      tileButton("I have a question about an order").click();
      const cards = [...document.querySelectorAll(".help-desk-order-card")];
      expect(cards.map((card) => card.querySelector("strong")!.textContent)).toEqual(["Order #1018", "Order #1009", "My order isn’t listed"]);
      expect(cards[0].textContent).toContain("Being prepared");
      expect(cards[0].textContent).toContain("Oct 20, 2026 · 2 items");
      expect(cards[1].textContent).toContain("Shipped");
      // What they need waits for the order.
      expect((document.querySelector(".help-desk-start-need") as HTMLElement).hidden).toBe(true);
      button("Continue with this order").click();
      expect(status()).toBe("Choose the order your question is about.");
      // The older order, shipped (no word from the carrier): anything but what only an unshipped order allows.
      const older = cards[1].querySelector("input") as HTMLInputElement;
      older.checked = true;
      older.dispatchEvent(new Event("change"));
      const details = document.querySelector(".help-desk-order-details") as HTMLElement;
      expect(details.hidden).toBe(false);
      expect(details.textContent).toContain("Order #1009");
      expect(details.textContent).toContain("Vault");
      expect(details.querySelector(".help-desk-stage-note")?.textContent).toContain("Shipped");
      // A category, then its sub-categories: only what's about an order (no shipping quotes, wholesale or product questions).
      const need = startField("What would you like to do?");
      expect(need.disabled).toBe(true);
      expect([...startField("Category").options].slice(1).map((option) => option.textContent)).toEqual(["Orders", "Product Issues", "Returns, Exchanges & Refunds", "Other order questions"]);
      button("Continue with this order").click();
      expect(status()).toBe("Choose a category.");
      const offered = () => [...need.options].slice(1).map((option) => option.textContent);
      pickStart("Category", "Product Issues");
      expect(need.disabled).toBe(false);
      expect(offered()).toEqual(["Damaged or Defective", "Missing Item or Part", "Received the Wrong Item", "Product Quality Issue", "Warranty Claim"]);
      pickStart("Category", "Other order questions");
      // Several ticket categories: a heading for each.
      expect([...need.querySelectorAll("optgroup")].map((group) => group.label)).toEqual(expect.arrayContaining(["Orders", "Shipping & Delivery"]));
      expect(offered()).toEqual(expect.arrayContaining(["Payment Issue", "Delivered but Not Received"]));
      expect(offered()).not.toContain("International Shipping");
      expect(offered()).not.toContain("PSA slab fit");
      expect(offered()).not.toContain("Dealer pricing");
      // Shipped: it can be tracked, but no longer changed or cancelled.
      pickStart("Category", "Orders");
      expect(offered()).toEqual(["Track Order", "Lost Package"]);
      // The newer order, not shipped yet: only what can still be done before it ships, all under Orders (picked for them).
      const newer = cards[0].querySelector("input") as HTMLInputElement;
      newer.checked = true;
      newer.dispatchEvent(new Event("change"));
      expect([...startField("Category").options].slice(1).map((option) => option.textContent)).toEqual(["Orders"]);
      expect(startField("Category").value).not.toBe("");
      expect(offered()).toEqual(["Track Order", "Cancel Order", "Modify Address", "Edit Existing Order", "Add Expedited Shipping"]);
      button("Continue with this order").click();
      expect(status()).toBe("Choose what you need help with.");
      pickStart("What would you like to do?", "Cancel Order");
      expect(document.querySelector(".help-desk-start-need .help-desk-hint")?.textContent).toContain("cancellation");
      button("Continue with this order").click();
      // The topic's own flow, with the order they picked already chosen.
      expect(shown()).toEqual(["Cancel Order"]);
      expect((control("Order Number") as HTMLSelectElement).value).toBe("#1018");
      expect(posts).toHaveLength(0);
    });

    it("offers what suits where the order is: on its way, delivered or failed", async () => {
      const item = { id: "gid://shopify/Product/1", title: "Slab Case X", variant: "", quantity: 1, image: "" };
      const order = (name: string, stage: string) => ({ name, date: "Nov 1, 2026", fulfillment: stage === "cancelled" ? null : "fulfilled", cancelled: stage === "cancelled", stage, items: [item] });
      await mount(undefined, undefined, undefined, { ...sandy, orders: [order("#2001", "transit"), order("#2002", "delivered"), order("#2003", "failed")] });
      tileButton("I have a question about an order").click();
      const cards = [...document.querySelectorAll(".help-desk-order-card")];
      expect(cards.slice(0, 3).map((card) => card.querySelector("em")!.textContent)).toEqual(["On its way", "Delivered", "Delivery failed"]);
      const pick = (index: number) => { const radio = cards[index].querySelector("input") as HTMLInputElement; radio.checked = true; radio.dispatchEvent(new Event("change")); };
      const categories = () => [...startField("Category").options].slice(1).map((option) => option.textContent);
      const offered = () => [...startField("What would you like to do?").options].slice(1).map((option) => option.textContent);
      // On its way: where is it, nothing else yet.
      pick(0);
      expect(categories()).toEqual(["Orders"]);
      expect(offered()).toEqual(["Track Order"]);
      // Delivered: everything but what only an unshipped order allows.
      pick(1);
      expect(categories()).toEqual(["Orders", "Product Issues", "Returns, Exchanges & Refunds", "Other order questions"]);
      pickStart("Category", "Orders");
      expect(offered()).toEqual(["Lost Package"]);
      pickStart("Category", "Other order questions");
      expect(offered()).toEqual(expect.arrayContaining(["Delivered but Not Received", "Delivery Attempted or Failed"]));
      expect(offered()).not.toContain("Expedited Shipping");
      // Failed: the same.
      pick(2);
      expect(categories()).toContain("Product Issues");
    });

    it("about an order that isn't listed: its number, date and what it's about go with the request", async () => {
      await mount(undefined, undefined, undefined, sandy);
      tileButton("I have a question about an order").click();
      const other = document.querySelectorAll(".help-desk-order-card input")[2] as HTMLInputElement;
      other.checked = true;
      other.dispatchEvent(new Event("change"));
      expect((document.querySelector(".help-desk-order-details") as HTMLElement).hidden).toBe(true);
      const box = document.querySelector(".help-desk-unlisted") as HTMLElement;
      expect(box.hidden).toBe(false);
      const number = box.querySelector("input:not([name])") as HTMLInputElement;
      const date = box.querySelector("input[name=orderDate]") as HTMLInputElement;
      const note = box.querySelector("textarea[name=orderNote]") as HTMLTextAreaElement;
      expect([number, date, note].every(Boolean)).toBe(true);
      // Every option, as the order's stage isn't known.
      pickStart("Category", "Orders");
      pickStart("What would you like to do?", "Track Order");
      button("Continue with this order").click();
      expect(status()).toContain("Enter your order number");
      number.value = "#2045";
      // A browser keeps a date past max (and flags it); the form still says why.
      date.max = "";
      date.value = "2999-01-01";
      button("Continue with this order").click();
      expect(status()).toBe("The order date can’t be in the future.");
      date.value = "2026-10-05";
      note.value = "Two slab cases, bought as a guest.";
      button("Continue with this order").click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      // The request's own Order Number: "not listed", with the number they typed.
      expect((control("Order Number") as HTMLSelectElement).value).toBe("other");
      expect(labels()).toContain("Enter Order Number");
      expect((document.querySelector("input[name=orderNumber]") as HTMLInputElement).value).toBe("#2045");
      // The date and description go with the request.
      expect(date.disabled || note.disabled).toBe(false);
      // Not about an order after all: they don't.
      tileButton("My question isn’t about an order").click();
      expect(date.disabled && note.disabled).toBe(true);
    });

    it("about an order, without an account: asks to sign in, or to enter the order's number, date and description", async () => {
      await mount();
      tileButton("I have a question about an order").click();
      expect(document.querySelector(".help-desk-start-note")?.textContent).toContain("Sign in to see your orders");
      expect((document.querySelector(".help-desk-start-need") as HTMLElement).hidden).toBe(false);
      const box = document.querySelector(".help-desk-unlisted:not(.help-desk-ask-order)") as HTMLElement;
      expect(box.hidden).toBe(false);
      const date = box.querySelector("input[name=orderDate]") as HTMLInputElement;
      const note = box.querySelector("textarea[name=orderNote]") as HTMLTextAreaElement;
      expect(date.disabled || note.disabled).toBe(false);
      pickStart("Category", "Orders");
      pickStart("What would you like to do?", "Track Order");
      button("Continue with this order").click();
      expect(status()).toContain("Enter your order number");
      (box.querySelector("input:not([name])") as HTMLInputElement).value = "#3001";
      date.value = "2026-10-01";
      note.value = "Bought as a gift.";
      button("Continue with this order").click();
      expect(shown()).toEqual(["Your details"]);
      // Not about an order after all: they don't go with the request.
      tileButton("My question isn’t about an order").click();
      expect(date.disabled && note.disabled).toBe(true);
    });

    it("not about an order: their own words become the question, filed as a general question", async () => {
      const posts = await mount(undefined, undefined, undefined, { ...sandy, orders: [] });
      tileButton("My question isn’t about an order").click();
      button("Continue with my question").click();
      expect(status()).toBe("Tell us what your question is about.");
      startField("Describe your question").value = "Do you take PayPal?";
      button("Continue with my question").click();
      await vi.waitFor(() => expect((control("Your Inquiry") as HTMLTextAreaElement).value).toBe("Do you take PayPal?"));
      const sent = await submit(posts);
      expect(sent).toMatchObject({ category: "Other", subcategory: "General question", query: "Do you take PayPal?" });
      expect(sent.orderDate || "").toBe("");
    });

    it("not about an order: an order it mentions (number and date) can go with the question", async () => {
      const posts = await mount(undefined, undefined, undefined, { ...sandy, orders: [] });
      tileButton("My question isn’t about an order").click();
      const box = document.querySelector(".help-desk-ask-order") as HTMLElement;
      expect(box.querySelector("h4")?.textContent).toBe("About an order? (optional)");
      startField("Describe your question").value = "Can I get an invoice?";
      const number = box.querySelector("input:not([name])") as HTMLInputElement;
      const date = box.querySelector("input[name=orderDate]") as HTMLInputElement;
      number.value = "nope";
      button("Continue with my question").click();
      expect(status()).toContain("or leave it blank");
      number.value = "#4100";
      date.removeAttribute("max");
      date.value = "2999-01-01";
      button("Continue with my question").click();
      expect(status()).toBe("The order date can’t be in the future.");
      date.value = "2026-09-30";
      button("Continue with my question").click();
      await vi.waitFor(() => expect((control("Your Inquiry") as HTMLTextAreaElement).value).toBe("Can I get an invoice?"));
      expect((control("Order Number (optional)") as HTMLInputElement).value).toBe("#4100");
      expect(await submit(posts)).toMatchObject({ subcategory: "General question", orderNumber: "#4100", orderDate: "2026-09-30" });
    });

    it("not about an order: International Shipping and Product Query open their own requests", async () => {
      await mount(undefined, undefined, undefined, { ...sandy, orders: [] });
      tileButton("My question isn’t about an order").click();
      button("International Shipping").click();
      expect(shown()).toEqual(["International Shipping"]);
      // Back to the start: a product question, from the fit and how-to questions.
      (document.querySelector(".help-desk-crumbs button") as HTMLButtonElement).click();
      expect(shown()).toEqual(["Hey! How can we help you?"]);
      const product = button("Product Query");
      product.click();
      expect(product.getAttribute("aria-expanded")).toBe("true");
      const questions = startField("What’s your product question?");
      expect([...questions.querySelectorAll("optgroup")].map((group) => group.label)).toEqual(["Will it fit?", "Using your case"]);
      button("Continue with this question").click();
      expect(status()).toBe("Choose your product question.");
      pickStart("What’s your product question?", "PSA slab fit");
      button("Continue with this question").click();
      expect(shown()).toEqual(["PSA slab fit"]);
    });
  });

  it("asks guests to sign in, or continue as a guest", async () => {
    await mount();
    const link = document.querySelector(".help-desk-login a") as HTMLAnchorElement;
    expect(document.querySelector(".help-desk-login")?.textContent).toContain("Sign in for faster help");
    expect(new URL(link.href).pathname).toBe("/account/login");
    expect(new URL(link.href).searchParams.get("return_url")).toBe("/pages/support");
    expect(labels()).toEqual(expect.arrayContaining(["Full name", "Email address"]));
  });

  describe("Help search above the form", () => {
    const riser = { id: "a1", question: "A riser arrived broken or the pins snapped", answer: "Sorry about that.", keywords: "riser broken, pins broke", collection: "Damaged, Missing or Wrong Items", action: "Product Issues › Damaged or Defective", helpful: 3, source: "article", url: "", image: "" };
    const refund = { id: "a2", question: "Where is my refund?", answer: "5-10 business days.", keywords: "refund status, money back", collection: "Returns & Exchanges", action: "", helpful: 1, source: "article", url: "", image: "" };
    const policy = { id: "policy:REFUND_POLICY:0", question: "Refund policy: Restocking fee", answer: "Opened items carry a fee.", collection: "Store Policies", action: "", source: "policy", url: "https://zion.test/policies/refund-policy", image: "" };
    async function mountSearch(path = "/pages/support", server: unknown[] = [policy]) {
      history.replaceState(null, "", path);
      document.body.innerHTML = `<div data-help-desk data-endpoint="/apps/help-desk"><div data-help-desk-status></div><div data-help-desk-form></div>
        <script type="application/json" data-help-desk-customer>${JSON.stringify({ name: "Sandy Lee", email: "sandy@example.com", orders: [] })}</script></div>`;
      const posts: Record<string, string>[] = [];
      const searches: string[] = [];
      globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
        const target = new URL(String(url), location.origin);
        if (init?.method === "POST") { posts.push(Object.fromEntries((init.body as FormData).entries()) as Record<string, string>); return new Response("{}"); }
        if (target.searchParams.has("answers")) { searches.push(target.searchParams.get("answers")!); return new Response(JSON.stringify({ results: target.searchParams.get("answers") === "zzzz" ? [] : server })); }
        return new Response(JSON.stringify({ ...config, articles: [riser, refund], collections: ["Orders & Delivery", "Damaged, Missing or Wrong Items", "Returns & Exchanges"] }));
      }) as typeof fetch;
      new Function(script)();
      await vi.waitFor(() => expect(document.querySelector("form")).toBeTruthy());
      const panel = document.querySelector(".help-desk-answers") as HTMLElement;
      const input = panel.querySelector(".help-desk-search-input") as HTMLInputElement;
      const type = (text: string) => { input.focus(); input.value = text; input.dispatchEvent(new Event("input")); };
      return { panel, input, type, posts, searches };
    }
    const options = (panel: HTMLElement) => [...panel.querySelectorAll(".help-desk-suggest-option")].map((option) => option.querySelector(".help-desk-suggest-title")!.textContent);
    afterEach(() => history.replaceState(null, "", "/pages/support"));

    it("greets the customer above the form, with popular questions and no topic list", async () => {
      const { panel } = await mountSearch();
      expect(panel.compareDocumentPosition(document.querySelector("form")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(panel.querySelector(".help-desk-hero h3")?.textContent).toBe("Hi Sandy, how can we help?");
      expect(panel.querySelector(".help-desk-hero p")).toBeNull();
      expect(panel.querySelector(".help-desk-answer-list")?.childElementCount).toBe(0);
      expect([...panel.querySelectorAll(".help-desk-popular button")].map((item) => item.textContent)).toEqual([riser.question, refund.question]);
    });

    it("suggests answers as the customer types, then adds the app's", async () => {
      const { panel, input, type, searches } = await mountSearch();
      // Straight away, from the articles already loaded: any word that starts one ("refun").
      type("my refun");
      expect(options(panel)).toEqual([refund.question]);
      expect(input.getAttribute("aria-expanded")).toBe("true");
      expect(panel.querySelector(".help-desk-suggest mark")?.textContent).toBe("refun");
      // Then the app's answers, which also search the store's policies.
      await vi.waitFor(() => expect(options(panel)).toEqual([policy.question, refund.question]));
      expect(searches).toEqual(["my refun"]);
      expect(panel.querySelectorAll(".help-desk-suggest-option small")[0]?.textContent).toBe("Store policy");
      // Half the words are enough: "broken riser on arrival" still finds the riser article.
      type("broken riser on arrival");
      expect(options(panel)).toEqual([riser.question]);
      // Arrow keys move through them; each opens on a page of its own.
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
      const first = panel.querySelector(".help-desk-suggest-option") as HTMLElement;
      expect(first.getAttribute("aria-selected")).toBe("true");
      const href = new URL(first.dataset.href!, location.origin);
      expect([href.pathname, href.searchParams.get("article"), href.searchParams.get("from"), href.searchParams.get("q")]).toEqual(["/apps/help-desk", "a1", "/pages/support", "broken riser on arrival"]);
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(input.getAttribute("aria-expanded")).toBe("false");
    });

    it("never comes back empty: says what it searched instead, or that these are related, and looks harder on Enter", async () => {
      const { panel, input, type, posts } = await mountSearch();
      const asked: URL[] = [];
      globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
        const target = new URL(String(url), location.origin);
        if (init?.method === "POST") { posts.push(Object.fromEntries((init.body as FormData).entries()) as Record<string, string>); return new Response("{}"); }
        asked.push(target);
        const text = target.searchParams.get("answers");
        return new Response(JSON.stringify(text === "refnd" ? { results: [refund], exact: false, correctedTo: "refund" } : { results: [riser], exact: false, related: true }));
      }) as typeof fetch;
      type("refnd");
      await vi.waitFor(() => expect(panel.querySelector(".help-desk-suggest-note")?.textContent).toBe("Showing results for “refund”"));
      expect(options(panel)).toEqual([refund.question]);
      type("qwzx");
      await vi.waitFor(() => expect(panel.querySelector(".help-desk-suggest-note")?.textContent).toBe("No exact match for “qwzx”. These might help:"));
      expect(options(panel)).toEqual([riser.question]);
      // Enter asks again, harder, and lists them under the same note.
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      await vi.waitFor(() => expect(panel.querySelector(".help-desk-answer-heading")?.textContent).toBe("No exact match for “qwzx”. These might help:"));
      expect(asked.at(-1)?.searchParams.get("deep")).toBe("1");
      // Still logged for the team: nothing answered it exactly.
      await vi.waitFor(() => expect(posts).toContainEqual({ intent: "no-answer", question: "qwzx" }), { timeout: 3000 });
    });

    it("lists every answer on Enter, and records a search nothing answers", async () => {
      const { panel, input, type, posts } = await mountSearch();
      type("restocking");
      await vi.waitFor(() => expect(options(panel)).toEqual([policy.question]));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      expect([...panel.querySelectorAll(".help-desk-answer-row strong")].map((item) => item.textContent)).toEqual([policy.question]);
      type("zzzz");
      await vi.waitFor(() => expect(panel.querySelector(".help-desk-suggest-empty")?.textContent).toMatch(/No answers for “zzzz” yet/));
      await vi.waitFor(() => expect(posts).toContainEqual({ intent: "no-answer", question: "zzzz" }), { timeout: 3000 });
    });

    it("comes back from an answer's page to its request, or to a new search", async () => {
      await mountSearch(`/pages/support?start=${encodeURIComponent("Product Issues › Damaged or Defective")}`);
      expect((document.querySelector(".help-desk-answers") as HTMLElement).hidden).toBe(true);
      expect(document.querySelector(".help-desk-chosen span")?.textContent).toBe("Product Issues › Damaged or Defective");
      const { panel, searches } = await mountSearch("/pages/support?q=refund");
      expect((panel.querySelector(".help-desk-search-input") as HTMLInputElement).value).toBe("refund");
      await vi.waitFor(() => expect(searches).toEqual(["refund"]));
    });
  });

  it("asks How can we help? with only the main topics, Orders first", async () => {
    await mount();
    expect(choices("How can we help?")).toEqual(["Orders", "Shipping", "Product Issues", "Returns, Exchanges & Refunds", "Wholesale Queries", "Affiliate Queries", "Other Queries"]);
    expect(labels()).not.toContain("What do you need help with?");
    // Product Issues: a few broad choices, like Shopify's return reasons, without headings.
    choose("How can we help?", "Product Issues");
    expect(choices("What do you need help with?")).toEqual(["Damaged or Defective", "Missing Item or Part", "Received the Wrong Item", "Product Quality Issue", "Warranty Claim"]);
    expect((control("What do you need help with?") as HTMLSelectElement).querySelectorAll("optgroup")).toHaveLength(0);
    expect(document.querySelector(".help-desk-tiles-heading")).toBeNull();
    expect(document.querySelector(".help-desk-category-hint")?.textContent).toBe("Something arrived damaged, defective, missing or wrong, or you need warranty help.");
  });

  describe("Orders", () => {
    it("opens its options in a dropdown, in order, each with its description", async () => {
      await mount();
      choose("How can we help?", "Orders");
      expect(choices("What do you need help with?")).toEqual(["Track Order", "Cancel Order", "Modify Address", "Edit Existing Order", "Add Expedited Shipping", "Lost Package"]);
      choose("How can we help?", "Shipping");
      expect(choices("What do you need help with?")).toEqual(["Domestic Shipping", "International Shipping", "Taxes, Customs & Duties"]);
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

    it("Lost Package: guidelines, the order checked, the missing product, its Shopify status, details and a preference", async () => {
      const items = [
        { id: "gid://shopify/Product/1", title: "Slab Case X", variant: "Black", quantity: 1, image: "" },
        { id: "gid://shopify/Product/2", title: "Riser", variant: "", quantity: 2, image: "" },
      ];
      const shipments = [{ label: "In transit", carrier: "UPS", number: "1Z999", url: "https://ups.example/1Z999", deliveredAt: null }];
      const posts = await mount(undefined, { allowed: true, country: "US", items, status: "Fulfilled", shipments });
      fillContact();
      choose("How can we help?", "Orders");
      choose("What do you need help with?", "Lost Package");
      expect([...document.querySelectorAll(".help-desk-guide li b")].map((step) => step.textContent)).toEqual(
        ["Enter Order Number:", "Select Missing Item:", "Review Order Status:", "Select your further Preference:", "Submit Request:"]);
      type("Order Number", "#1004");
      button("Continue").click();
      await vi.waitFor(() => expect(labels()).toContain("Additional Details"));
      expect(posts.lookups.at(-1)?.searchParams.get("check")).toBe("lost");
      const status = document.querySelector(".help-desk-lost-status")?.textContent;
      expect(status).toContain("Shopify status: Fulfilled");
      expect(status).toContain("In transit · UPS · 1Z999");
      // Nothing picked: Review waits. Then a preference.
      review();
      expect(document.querySelector("[data-help-desk-status]")?.textContent).toBe("Select the missing product.");
      item("Riser").click();
      type("Additional Details", "Tracking stopped a week ago");
      review();
      expect(document.querySelector("[data-help-desk-status]")?.textContent).toContain("sent again or a refund");
      (document.querySelector('input[name=lostPreference][value="Refund"]') as HTMLInputElement).click();
      const sent = await submit(posts);
      expect(sent).toMatchObject({ category: "Shipping & Delivery", subcategory: "Lost Package", delivery: "Package lost", orderNumber: "#1004",
        products: "gid://shopify/Product/2", lostPreference: "Refund", details: "Tracking stopped a week ago" });
      expect(validateHelpDesk(sent, [], [])).toEqual({});
    });

    it("Lost Package stops at an order that hasn't shipped", async () => {
      await mount(undefined, { allowed: false, error: "This order hasn't shipped yet, so it can't be lost in transit. Choose Track Order to see where it stands." });
      fillContact();
      choose("How can we help?", "Orders");
      choose("What do you need help with?", "Lost Package");
      type("Order Number", "#1004");
      button("Continue").click();
      await vi.waitFor(() => expect(document.querySelector(".help-desk-track-error")?.textContent).toContain("hasn't shipped yet"));
      expect(labels()).not.toContain("Additional Details");
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
      // Another country: which one (we ship worldwide, so no "coming soon").
      choose("Shipping To", "Another country");
      expect((document.querySelector(".help-desk-elsewhere") as HTMLElement).hidden).toBe(false);
      expect(document.querySelector(".help-desk-coming-soon")).toBeNull();
      choose("Which country?", "United Kingdom");
      type("Your Question", "Will I pay import duties?");
      const sent = await submit(posts);
      expect(sent).toMatchObject({ category: "Shipping & Delivery", subcategory: "Customs & Duties", topic: "General Inquiry", country: "GB" });
      expect(validateHelpDesk(sent, [], [])).toEqual({});
    });

    // Domestic and International Shipping: products (with how many), the
    // address, every field checked, then Review. No prices on the form: the
    // team replies with shipping options.
    const reviewShown = () => !(document.querySelector(".help-desk-section-review") as HTMLElement).hidden;
    const reviewRows = () => Object.fromEntries([...document.querySelectorAll(".help-desk-review-row")].map((row) => [row.querySelector("span")!.textContent, row.querySelector("strong")!.textContent]));
    async function send(posts: Record<string, string>[]) {
      document.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
      await vi.waitFor(() => expect(posts).toHaveLength(1));
      return posts[0];
    }

    it("International Shipping checks every field, then goes to Review, with no prices on the form", async () => {
      const posts = await mount();
      fillContact();
      choose("How can we help?", "Shipping");
      choose("What do you need help with?", "International Shipping");
      expect([...document.querySelectorAll(".help-desk-guide li b")].map((step) => step.textContent)).toEqual(
        ["Select Product:", "Enter Shipping Address:", "Choose Shipping Method:", "Check Availability:", "Get Shipping Details:"]);
      expect(labels()).toEqual(expect.arrayContaining(["Country", "Street Address", "City", "ZIP / Postal Code"]));
      expect(labels()).not.toContain("Anything Else? (optional)");
      expect(choices("Country")).toEqual(["Canada", "United States", "Another country"]);
      expect(submitButton().hidden).toBe(true);
      const status = () => document.querySelector("[data-help-desk-status]")?.textContent;
      // A product first.
      button("Review Request").click();
      expect(status()).toContain("Select the products you want shipped first.");
      pickProduct("Products You Want Shipped", "slab");
      // Each product with how many they want.
      const count = document.querySelector(".help-desk-quantity-row input") as HTMLInputElement;
      expect(count.value).toBe("1");
      (document.querySelector('.help-desk-stepper button[aria-label="One more"]') as HTMLButtonElement).click();
      expect(count.value).toBe("2");
      // Then the country, and the whole address.
      button("Review Request").click();
      expect(status()).toContain("Please select the country.");
      choose("Country", "Canada");
      type("City", "Toronto");
      choose("Province", "Ontario");
      button("Review Request").click();
      expect(reviewShown()).toBe(false);
      type("Street Address", "1 King St W");
      type("ZIP / Postal Code", "M5H 1A1");
      control("City").dispatchEvent(new Event("input", { bubbles: true }));
      // Then Regular or Expedited shipping.
      button("Review Request").click();
      expect(status()).toContain("Choose Regular or Expedited shipping.");
      (document.querySelector('input[name=shippingMethod][value="Expedited"]') as HTMLInputElement).click();
      button("Review Request").click();
      // Everything on Review, by name; nothing was looked up or sent yet.
      expect(reviewShown()).toBe(true);
      expect(reviewRows()).toMatchObject({ Country: "Canada", Province: "Ontario", Products: "Slab Case X × 2", "Shipping Method": "Expedited Shipping" });
      expect(posts.lookups).toHaveLength(0);
      expect(posts).toHaveLength(0);
      const sent = await send(posts);
      expect(sent).toMatchObject({ category: "Shipping & Delivery", subcategory: "International Shipping", topic: "Shipping Inquiry", country: "CA",
        address: "1 King St W, Toronto, Ontario, M5H 1A1", "itemQty:gid://shopify/Product/1": "2", products: "gid://shopify/Product/1", shippingMethod: "Expedited" });
      expect(validateHelpDesk(sent, ["gid://shopify/Product/1"], [])).toEqual({});
    });

    it("International Shipping takes any country in the world", async () => {
      const posts = await mount();
      fillContact();
      choose("How can we help?", "Shipping");
      choose("What do you need help with?", "International Shipping");
      pickProduct("Products You Want Shipped", "slab");
      choose("Country", "Another country");
      choose("Which country?", "Germany");
      expect(document.querySelector(".help-desk-coming-soon")).toBeNull();
      type("Street Address", "Hauptstrasse 12");
      type("City", "Berlin");
      type("ZIP / Postal Code", "10115");
      control("City").dispatchEvent(new Event("input", { bubbles: true }));
      (document.querySelector('input[name=shippingMethod][value="Regular"]') as HTMLInputElement).click();
      button("Review Request").click();
      expect(reviewShown()).toBe(true);
      expect(reviewRows()).toMatchObject({ Country: "Germany" });
      expect(posts.lookups).toHaveLength(0);
      expect(await send(posts)).toMatchObject({ subcategory: "International Shipping", country: "DE", address: "Hauptstrasse 12, Berlin, 10115" });
    });

    it("Domestic Shipping: the store's own country, the state, then Review", async () => {
      const posts = await mount();
      fillContact();
      choose("How can we help?", "Shipping");
      choose("What do you need help with?", "Domestic Shipping");
      expect(choices("Country")).toEqual(["United States"]);
      expect((control("Country") as HTMLSelectElement).value).toBe("US");
      pickProduct("Products You Want Shipped", "slab");
      type("Street Address", "500 Congress Ave");
      type("City", "Austin");
      type("ZIP / Postal Code", "78701");
      // The state is required.
      button("Review Request").click();
      expect(reviewShown()).toBe(false);
      choose("State", "Texas");
      control("State").dispatchEvent(new Event("change", { bubbles: true }));
      button("Review Request").click();
      expect(reviewShown()).toBe(true);
      expect(reviewRows()).toMatchObject({ State: "Texas", Products: "Slab Case X × 1" });
      expect(posts.lookups).toHaveLength(0);
      expect(await send(posts)).toMatchObject({ subcategory: "Domestic Shipping", topic: "Shipping Inquiry", country: "US", address: "500 Congress Ave, Austin, Texas, 78701" });
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

    it("Cancel Order only sends a request, and asks why when the reason is Other", async () => {
      const posts = await mount();
      fillContact();
      choose("How can we help?", "Orders");
      choose("What do you need help with?", "Cancel Order");
      expect(document.querySelector(".help-desk-cancel-notice")?.textContent).toContain("doesn't cancel your order");
      expect(document.querySelector(".help-desk-cancel-notice")?.textContent).toContain("only what hasn't shipped");
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
      // A one-item order isn't asked what to cancel.
      expect(sent.cancelScope).toBeUndefined();
      expect(validateHelpDesk(sent, [], [])).toEqual({});
    });

    it("Cancel Order lets the customer pick some of the order's items", async () => {
      const items = [
        { id: "gid://shopify/LineItem/11", title: "Slab Case X", variant: "Black", quantity: 2, image: "" },
        { id: "gid://shopify/LineItem/12", title: "Riser", variant: "", quantity: 1, image: "" },
      ];
      const posts = await mount(undefined, { allowed: true, country: "US", items, partial: true });
      fillContact();
      choose("How can we help?", "Orders");
      choose("What do you need help with?", "Cancel Order");
      type("Order Number", "#1006");
      button("Continue").click();
      await vi.waitFor(() => expect(labels()).toContain("Reason for Cancellation"));
      // Part of it has shipped: only what hasn't can be asked about.
      expect(document.querySelector(".help-desk-verified")?.textContent).toContain("Part of this order has shipped");
      expect(document.querySelector("legend")?.textContent).toContain("What would you like to cancel?");
      const scope = (value: string) => {
        const radio = document.querySelector(`[name=cancelScope][value="${value}"]`) as HTMLInputElement;
        radio.checked = true;
        radio.dispatchEvent(new Event("change"));
      };
      scope("Selected items");
      choose("Reason for Cancellation", "Ordered by mistake");
      // Nothing ticked yet: Review isn't opened.
      review();
      expect(document.querySelector("[data-help-desk-status]")?.textContent).toBe("Select the items you want to cancel.");
      const riser = [...document.querySelectorAll(".help-desk-choice")].find((label) => label.textContent?.includes("Riser"))!.querySelector("input") as HTMLInputElement;
      riser.checked = true;
      riser.dispatchEvent(new Event("change"));
      expect(await submit(posts)).toMatchObject({ update: "Cancel Order", cancelScope: "Selected items", products: "gid://shopify/LineItem/12" });
    });

    it("Edit Existing Order: guidelines, the order checked, items picked, changes described and charges accepted", async () => {
      const items = [
        { id: "gid://shopify/LineItem/11", title: "Slab Case X", variant: "Black", quantity: 1, image: "" },
        { id: "gid://shopify/LineItem/12", title: "Riser", variant: "", quantity: 2, image: "" },
      ];
      const posts = await mount(undefined, { allowed: true, country: "US", items });
      fillContact();
      choose("How can we help?", "Orders");
      choose("What do you need help with?", "Edit Existing Order");
      expect([...document.querySelectorAll(".help-desk-guide li b")].map((step) => step.textContent)).toEqual(
        ["Enter Order Number:", "Check Order Status:", "Select Items:", "Describe Changes:", "Review Additional Charges:", "Submit Request:"]);
      type("Order Number", "#1006");
      button("Continue").click();
      await vi.waitFor(() => expect(labels()).toContain("Describe Changes (optional)"));
      expect(posts.lookups.at(-1)?.searchParams.get("check")).toBe("edit");
      expect(document.querySelector(".help-desk-verified")?.textContent).toContain("still at our warehouse");
      // Nothing picked: Review waits.
      review();
      expect(document.querySelector("[data-help-desk-status]")?.textContent).toBe("Select the items you'd like to change, or add a product.");
      // Each item picked asks what to do with it.
      item("Slab Case X").click();
      item("Riser").click();
      review();
      expect(document.querySelector("[data-help-desk-status]")?.textContent).toBe("Choose what you'd like to do with Slab Case X.");
      (document.querySelector('input[name="itemAction:gid://shopify/LineItem/11"][value="Change color or size"]') as HTMLInputElement).click();
      type("Which color or size would you like?", "Blue");
      (document.querySelector('input[name="itemAction:gid://shopify/LineItem/12"][value="Change quantity"]') as HTMLInputElement).click();
      expect((control("New quantity") as HTMLInputElement).value).toBe("2");
      type("New quantity", "1");
      // A product to add, with how many.
      pickProduct("Add Products (optional)", "slab");
      // Then the charges must be accepted.
      review();
      expect(document.querySelector("[data-help-desk-status]")?.textContent).toContain("price difference");
      (document.querySelector("input[name=chargesAccepted]") as HTMLInputElement).click();
      const sent = await submit(posts);
      // Both items go as products (the last one shows here).
      expect(sent).toMatchObject({ update: "Change Product or Quantity", products: "gid://shopify/LineItem/12", chargesAccepted: "Yes", subcategory: "Edit Items, Color or Quantity",
        "itemAction:gid://shopify/LineItem/11": "Change color or size", "itemVariant:gid://shopify/LineItem/11": "Blue", "itemAction:gid://shopify/LineItem/12": "Change quantity", "itemWanted:gid://shopify/LineItem/12": "1",
        addedProducts: "Slab Case X × 1" });
      expect(JSON.parse(sent.addedItems)).toEqual([{ id: "gid://shopify/Product/1", title: "Slab Case X", quantity: 1 }]);
    });

    it("breadcrumbs show where the customer is, by what they chose, and go back when clicked", async () => {
      await mount();
      const crumbs = () => [...document.querySelectorAll(".help-desk-crumbs li")].map((item) => item.textContent);
      const nav = document.querySelector(".help-desk-crumbs") as HTMLElement;
      // Nothing chosen yet: no trail on the first step.
      expect(nav.hidden).toBe(true);
      fillContact();
      choose("How can we help?", "Orders");
      expect(nav.hidden).toBe(false);
      expect(crumbs()).toEqual(["Help Desk", "Orders"]);
      expect(document.querySelector(".help-desk-crumbs [aria-current]")?.textContent).toBe("Orders");
      choose("What do you need help with?", "Edit Existing Order");
      // A guest gives their details first.
      expect(crumbs()).toEqual(["Help Desk", "Orders", "Edit Existing Order", "Your details"]);
      // An earlier step is a link back.
      ([...document.querySelectorAll(".help-desk-crumbs button")].find((link) => link.textContent === "Orders") as HTMLButtonElement).click();
      expect(crumbs()).toEqual(["Help Desk", "Orders"]);
      ([...document.querySelectorAll(".help-desk-crumbs button")].find((link) => link.textContent === "Help Desk") as HTMLButtonElement).click();
      expect(nav.hidden).toBe(true);
    });

    it("Edit Existing Order stops at an order that has left the warehouse", async () => {
      await mount(undefined, { allowed: false, error: "This order has already been dispatched or is being packed at our warehouse, so it can no longer be changed." });
      fillContact();
      choose("How can we help?", "Orders");
      choose("What do you need help with?", "Edit Existing Order");
      type("Order Number", "#1006");
      button("Continue").click();
      await vi.waitFor(() => expect(document.querySelector(".help-desk-track-error")?.textContent).toContain("already been dispatched"));
      expect(labels()).not.toContain("Describe Changes");
    });

    it("switching options clears the previous option's fields", async () => {
      await mount();
      fillContact();
      choose("How can we help?", "Orders");
      choose("What do you need help with?", "Cancel Order");
      type("Order Number", "#1006");
      button("Continue").click();
      await vi.waitFor(() => expect(labels()).toContain("Reason for Cancellation"));
      choose("What do you need help with?", "Track Order");
      expect(labels()).not.toContain("Reason for Cancellation");
      expect(button("Continue")).toBeUndefined();
      expect((document.querySelector('input[name="subcategory"]') as HTMLInputElement).value).toBe("Track My Order");
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
    (document.querySelector(".help-desk-section-request > .help-desk-back") as HTMLButtonElement).click();
    expect(stageOf()).toBe("ask");
  });

  it("Damaged or Defective: damaged at delivery or a manufacturing defect, then what's wrong, ticked, files it and sets the photo tips", async () => {
    await findOrder("Damaged or Defective");
    await vi.waitFor(() => expect(stageOf()).toBe("request"));
    const radios = [...document.querySelectorAll<HTMLInputElement>("input[name=kind]")];
    expect(radios.map((radio) => radio.value)).toEqual(["Damaged at the time of delivery", "Manufacturing defect in the product"]);
    // Nothing is picked to start with, and it must be answered.
    expect(radios.some((radio) => radio.checked)).toBe(false);
    expect(radios[0].required).toBe(true);
    const hidden = (name: string) => (document.querySelector(`input[type=hidden][name=${name}]`) as HTMLInputElement).value;
    const area = document.querySelector(".help-desk-defects") as HTMLElement;
    expect(area.hidden).toBe(true);
    const boxes = () => [...area.querySelectorAll<HTMLInputElement>("input[name=defects]")];
    const tick = (label: string) => { const box = boxes().find((entry) => entry.value === label)!; box.checked = !box.checked; box.dispatchEvent(new Event("change")); };
    radios[1].click();
    expect(area.hidden).toBe(false);
    expect(boxes().map((box) => box.value)).toEqual(["Scratches or marks", "Lid shifts or won't close", "Lock won't set or open", "Insert doesn't fit", "Bottom not flat or bowing", "Squeaking or noise", "Wheel or handle doesn't work", "Something else"]);
    expect([hidden("category"), hidden("subcategory")]).toEqual(["Manufacturing Defect", "Defective or not working"]);
    tick("Lock won't set or open");
    tick("Scratches or marks");
    // The first one ticked (in the list's order) files it.
    expect([hidden("category"), hidden("subcategory")]).toEqual(["Manufacturing Defect", "Scratches"]);
    item("Slab Case X").click();
    expect(document.querySelector(".help-desk-photo-tips")?.textContent).not.toContain("Shipping box");
    // Damaged at delivery: its own list; a broken part with the box fine is product damage.
    radios[0].click();
    expect(boxes().map((box) => box.value)).toContain("Inside of the product is damaged");
    expect(boxes().some((box) => box.checked)).toBe(false);
    expect([hidden("category"), hidden("subcategory")]).toEqual(["Shipping Damage", "Damaged in transit"]);
    tick("Broken lid");
    expect([hidden("category"), hidden("subcategory")]).toEqual(["Product Damage", "Broken lid"]);
    // A damaged outer box too: a carrier claim.
    tick("The outer shipping box was crushed, wet or torn");
    expect([hidden("category"), hidden("subcategory")]).toEqual(["Shipping Damage", "Box crushed or dented"]);
    expect(document.querySelector(".help-desk-photo-tips")?.textContent).toContain("Shipping box and label");
    // No part list: their words, photos and a video say it. A single item asks no quantity. Then what they'd like.
    expect(labels()).toContain("Describe the issue");
    expect(labels()).not.toContain("Which part?");
    expect(labels()).not.toContain("How many are affected?");
    expect([...document.querySelectorAll<HTMLInputElement>("input[name^=\"itemResolution:\"]")].map((radio) => radio.value)).toEqual(["Refund", "Exchange"]);
    // Two of a product: how many are affected.
    item("Graded Card Display").click();
    expect(labels()).toContain("How many are affected?");
    expect((document.querySelector('input[name="itemQty:gid://shopify/Product/2"]') as HTMLInputElement).max).toBe("2");
  });

  it("Damaged or Defective goes all the way: what happened, the part, the photo, its condition and what they'd like, checked on Review and sent", async () => {
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
    [...document.querySelectorAll<HTMLInputElement>("input[name=kind]")].find((radio) => radio.value === "Manufacturing defect in the product")!.click();
    const lid = [...document.querySelectorAll<HTMLInputElement>("input[name=defects]")].find((box) => box.value === "Lid shifts or won't close")!;
    lid.checked = true;
    lid.dispatchEvent(new Event("change"));
    review();
    expect(reviewOpen()).toBe(false);
    // An exchange starts with the product they picked; without any, Review waits.
    const chips = () => [...document.querySelectorAll(".help-desk-replacement .help-desk-selected button")].map((chip) => chip.textContent?.replace("×", "").trim());
    (document.querySelector('input[name^="itemResolution:"][value="Exchange"]') as HTMLInputElement).click();
    expect(chips()).toEqual(["Slab Case X"]);
    (document.querySelector(".help-desk-replacement .help-desk-selected button") as HTMLButtonElement).click();
    expect(chips()).toEqual([]);
    review();
    expect(reviewOpen()).toBe(false);
    expect(document.querySelector("[data-help-desk-status]")?.textContent).toContain("Add the product you'd like instead of Slab Case X.");
    pickProduct("Add product", "slab");
    expect(chips()).toEqual(["Slab Case X"]);
    // Only an unused product in its original packaging can go back.
    const condition = (value: string) => (document.querySelector(`input[name=returnCondition][value="${value}"]`) as HTMLInputElement).click();
    review();
    expect(reviewOpen()).toBe(false);
    condition("No");
    review();
    expect(reviewOpen()).toBe(false);
    expect(document.querySelector("[data-help-desk-status]")?.textContent).toContain("unused products in their original packaging");
    condition("Yes");
    review();
    expect(reviewOpen()).toBe(true);
    const rows = Object.fromEntries([...document.querySelectorAll(".help-desk-review-row")].map((row) => [row.querySelector("span")?.textContent, row.querySelector("strong")?.textContent]));
    expect(rows).toMatchObject({ "What happened?": "Manufacturing defect in the product", "What’s wrong": "Lid shifts or won't close", "Slab Case X · Wants": "Exchange", "Slab Case X · Replacement": "Slab Case X",
      "Is the product unused and in its original packaging?": "Yes",
      "Slab Case X": "The lid won't close", Products: "Slab Case X", Photos: "1 attached" });
    document.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ category: "Manufacturing Defect", subcategory: "Lid shifts or won't close", defects: "Lid shifts or won't close", "itemResolution:gid://shopify/Product/1": "Exchange", "itemReplacement:gid://shopify/Product/1": "Slab Case X",
      products: "gid://shopify/Product/1", "itemNote:gid://shopify/Product/1": "The lid won't close", returnCondition: "Yes" });
  });

  it("Damaged or Defective shows the Process Guidelines, and stops at an order past the return window", async () => {
    const blocker = "Returns are accepted within 6 months of purchase, and this order was placed on Mar 1, 2026. If it stopped working, please send a Warranty Claim instead.";
    await findOrder("Damaged or Defective", { found: { ...orderItems.found, returnBlocker: blocker } });
    expect(document.querySelector(".help-desk-guide strong")?.textContent).toBe("Process Guidelines");
    await vi.waitFor(() => expect(document.querySelector(".help-desk-track-error")?.textContent).toBe(blocker));
    expect(stageOf()).not.toBe("request");
    // A warranty claim isn't a return: its own guidelines, and an old order is fine.
    await findOrder("Warranty Claim", { found: { ...orderItems.found, returnBlocker: blocker } });
    expect([...document.querySelectorAll(".help-desk-guide li b")].map((step) => step.textContent)).toEqual(
      ["Enter Order Number:", "Describe the Issue:", "Check Warranty Eligibility:", "Submit Your Claim:", "Warranty Approval:", "Next Steps:"]);
    await vi.waitFor(() => expect(stageOf()).toBe("request"));
    expect(document.querySelector("input[name=returnCondition]")).toBeNull();
  });

  it("Missing Item or Part: the Procedure Guidelines, nothing picked for them, the missing part in words with a photo, to be replaced", async () => {
    const posts = await findOrder("Missing Item or Part", { found: { ...orderItems.found, items: [orderItems.found.items[0]] } });
    expect(document.querySelector(".help-desk-guide > strong")?.textContent).toBe("Procedure Guidelines");
    expect([...document.querySelectorAll(".help-desk-guide li b")].map((step) => step.textContent)).toEqual(
      ["Enter Order Number:", "Describe the Issue:", "Check Order Status:", "Support Confirmation:", "Replacement Shipping:"]);
    await vi.waitFor(() => expect(stageOf()).toBe("request"));
    // Even a one-item order starts unpicked. It was delivered: no in-transit warning.
    expect(item("Slab Case X").getAttribute("aria-pressed")).toBe("false");
    expect(boxes()).toEqual([]);
    expect(document.querySelector(".help-desk-cancel-notice:not(.help-desk-guide)")).toBeNull();
    item("Slab Case X").click();
    expect(boxes()).toEqual(["Slab Case X"]);
    // Product images are needed.
    expect((document.querySelector('input[name="images:gid://shopify/Product/1"]') as HTMLInputElement).required).toBe(true);
    // No part list or count: their words, photos and a video say it.
    expect(document.querySelector('input[name="videos:gid://shopify/Product/1"]')).toBeTruthy();
    expect(document.querySelector('[name^="itemPart"], [name^="itemQty"]')).toBeNull();
    expect((control("What's missing?") as HTMLTextAreaElement).required).toBe(true);
    type("What's missing?", "The sling bag was not in the box");
    // The part itself is replaced: nothing to choose.
    expect(document.querySelectorAll('input[type=radio][name^="itemResolution:"]')).toHaveLength(0);
    const photo = document.querySelector('input[name="images:gid://shopify/Product/1"]') as HTMLInputElement;
    const transfer = new DataTransfer();
    transfer.items.add(new File(["x"], "box.jpg", { type: "image/jpeg" }));
    photo.files = transfer.files;
    photo.dispatchEvent(new Event("change"));
    const sent = await submit(posts);
    expect(sent).toMatchObject({ category: "Missing Parts", subcategory: "Item missing from order", products: "gid://shopify/Product/1", "itemResolution:gid://shopify/Product/1": "Replacement",
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
    expect(document.querySelector(".help-desk-cancel-notice:not(.help-desk-guide)")?.textContent).toContain("Part of this order hasn't shipped yet.");
  });

  it("Missing Item or Part says the part may still be in transit when the order isn't delivered", async () => {
    await findOrder("Missing Item or Part", { found: { ...orderItems.found, deliveredAt: null } });
    await vi.waitFor(() => expect(stageOf()).toBe("request"));
    expect(document.querySelector(".help-desk-cancel-notice:not(.help-desk-guide)")?.textContent).toContain("may still be in transit");
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
    const photo = document.querySelector('input[name="images:gid://shopify/Product/1"]') as HTMLInputElement;
    const transfer = new DataTransfer();
    transfer.items.add(new File(["x"], "box.jpg", { type: "image/jpeg" }));
    photo.files = transfer.files;
    photo.dispatchEvent(new Event("change"));
    expect(await submit(posts)).toMatchObject({ orderNumber: "#1002", products: "gid://shopify/Product/1", "itemNote:gid://shopify/Product/1": "The whole case", "itemResolution:gid://shopify/Product/1": "Replacement" });
  });

  it("Warranty Claim without a found order asks where and when it was bought", async () => {
    await findOrder("Warranty Claim", { error: "We couldn't find an order with that number and email. Please check both.", notFound: true });
    await vi.waitFor(() => expect(document.querySelector(".help-desk-track-error")?.textContent).toContain("older order"));
    button("Continue without it").click();
    expect(choices("Where did you buy it?")).toEqual(["Zion Cases website", "Amazon", "A store or dealer", "Gift or other"]);
    expect((control("When? (month)") as HTMLInputElement).type).toBe("month");
    pickProduct("Which product has a problem?", "slab");
    // The team decides the solution: nothing to choose, and the photos are needed.
    expect(document.querySelectorAll("input[name^=\"itemResolution:\"]")).toHaveLength(0);
    expect(document.querySelector(".help-desk-product-issue .help-desk-hint")?.textContent).toContain("replacement, repair or other solution");
    expect((document.querySelector('input[name="images:gid://shopify/Product/1"]') as HTMLInputElement).required).toBe(true);
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

  it("Received the Wrong Item: the Process Guidelines, then the same product cards, each asking what came instead with required photos and a video", async () => {
    await findOrder("Received the Wrong Item");
    expect([...document.querySelectorAll(".help-desk-guide li b")].map((step) => step.textContent)).toEqual(
      ["Enter Order Number:", "Describe the Issue:", "Choose a Resolution:", "Check Eligibility:", "Submit Request:"]);
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

  it("Wrong product: a return for a refund or an exchange, and an exchange is a whole product they add", async () => {
    await findOrder("Received the Wrong Item");
    await vi.waitFor(() => expect(stageOf()).toBe("request"));
    kindRadio("Wrong product").click();
    item("Slab Case X").click();
    expect([...document.querySelectorAll<HTMLInputElement>('input[name^="itemResolution:"]')].map((radio) => radio.closest("label")?.textContent)).toEqual(["Return & Refund", "Return & Exchange"]);
    // It goes back only unused, in its packaging.
    expect(document.querySelectorAll("input[name=returnCondition]")).toHaveLength(2);
    pickResolution("Exchange");
    expect(addProductOpen()).toBe(true);
    expect(labels()).toContain("Add product");
  });

  it("Wrong colour or size: they pick the variant they wanted from the product's own list", async () => {
    const posts = await findOrder("Received the Wrong Item");
    await vi.waitFor(() => expect(stageOf()).toBe("request"));
    kindRadio("Wrong colour or size").click();
    item("Slab Case X").click();
    expect(document.querySelector(".help-desk-product-issue .help-desk-hint")?.textContent).toBe("You ordered: Black · Qty 1");
    // The variants come from the app, as chips: the ordered one marked, sold-out ones off.
    const chips = () => [...document.querySelectorAll(".help-desk-variant-chip")].map((chip) => ({
      value: chip.querySelector("span")!.textContent, off: (chip.querySelector("input") as HTMLInputElement).disabled, ordered: Boolean(chip.querySelector("small")),
    }));
    await vi.waitFor(() => expect(chips()).toEqual([{ value: "Black", off: false, ordered: true }, { value: "Blue", off: true, ordered: false }]));
    expect(document.querySelector(".help-desk-variants-title")?.textContent).toBe("Which colour or size do you want?");
    expect(posts.lookups.some((url) => url.searchParams.get("check") === "variants" && url.searchParams.get("product") === "gid://shopify/Product/1")).toBe(true);
    const black = document.querySelector(".help-desk-variant-chip input") as HTMLInputElement;
    expect(black.required).toBe(true);
    black.checked = true;
    black.dispatchEvent(new Event("change"));
    expect((document.querySelector('input[name="itemVariant:gid://shopify/Product/1"]') as HTMLInputElement).value).toBe("Black");
    // The exchange is that variant: no other product to add.
    pickResolution("Exchange");
    expect(addProductOpen()).toBe(false);
    // Switching to Wrong product asks again, and keeps what they wrote.
    type("What did you receive instead?", "A black one");
    kindRadio("Wrong product").click();
    expect(document.querySelector(".help-desk-variants")).toBeNull();
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
    pickResolution("Exchange");
    (document.querySelector('input[name=returnCondition][value="Yes"]') as HTMLInputElement).click();
    expect(addProductOpen()).toBe(false);
    const photo = document.querySelector('input[name="images:gid://shopify/Product/2"]') as HTMLInputElement;
    const transfer = new DataTransfer();
    transfer.items.add(new File(["x"], "box.jpg", { type: "image/jpeg" }));
    photo.files = transfer.files;
    photo.dispatchEvent(new Event("change"));
    const sent = await submit(posts);
    expect(sent).toMatchObject({ category: "Wrong Item Received", subcategory: "Wrong quantity", "itemResolution:gid://shopify/Product/2": "Exchange", returnCondition: "Yes",
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
