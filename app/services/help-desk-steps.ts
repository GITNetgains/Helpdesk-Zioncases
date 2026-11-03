import { formGroups, type FormOption } from "./help-desk-form";

// How to do something with the Help Desk form, step by step, the way the form
// asks for it. An answer's action ("Orders › Cancel Order") names the topic
// and option; the steps follow that option's flow, so they always match what
// the customer will see on the form.

const PICK_ORDER = "Check it's the right order (signed in, it's the one you picked; otherwise enter your email and order number), then press Continue.";
const SUBMIT = "Press Submit Request. You'll get a request number and a private page like this one to follow it, and we'll email you each reply.";

function flowSteps(option: FormOption & { kinds?: FormOption["kinds"] }): string[] {
  switch (option.flow) {
    case "delivery":
      return option.selfService === "tracking"
        ? [PICK_ORDER, "You'll see your order's live status and tracking straight away.", `Still need help? Add the details and ${SUBMIT.charAt(0).toLowerCase()}${SUBMIT.slice(1)}`]
        : [PICK_ORDER, "Tell us what happened with the delivery.", SUBMIT];
    case "cancel":
      return [PICK_ORDER, "We check that it hasn't shipped yet, so it can still be cancelled.", "Choose the whole order or just some items, and give the reason for cancelling.", SUBMIT, "Our team reviews it and confirms the cancellation; the refund goes back to your original payment method."];
    case "edit":
      return [PICK_ORDER, "We check with our warehouse that it hasn't been packed or shipped yet.", "Choose the items to change, remove or add, and describe the change (a colour, size or quantity).", "If the change costs more or less, you'll see the difference before you send it.", SUBMIT];
    case "address":
      return [PICK_ORDER, "We check that it hasn't shipped yet, so the address can still change.", "Enter the new address (in the same country as the order).", SUBMIT];
    case "lost":
      return [PICK_ORDER, "We show you the latest tracking for the package.", "Tell us whether you'd like the products sent again or a refund, and add any details.", SUBMIT];
    case "productIssue":
      return [
        PICK_ORDER,
        ...(option.kinds ? [`Choose what happened: ${option.kinds.map((kind) => kind.label).join(", ")}.`] : []),
        "Pick the product (and the part, if it's asked) with the problem.",
        "Describe it and add clear photos, or a short video if something doesn't work properly.",
        SUBMIT,
      ];
    case "wrongItem":
      return [PICK_ORDER, ...(option.kinds ? [`Choose what happened: ${option.kinds.map((kind) => kind.label).join(", ")}.`] : []), "Pick what you ordered and tell us what arrived instead, with a photo.", SUBMIT];
    case "return":
      return [PICK_ORDER, "Pick the product, describe the reason and add photos.", "Choose a refund or an exchange (returns: within 6 months of purchase, unused and in the original packaging).", SUBMIT, "Once our team approves it, we send the return instructions. Please don't ship anything back before that."];
    case "international":
      return option.region === "domestic"
        ? ["Pick the products and enter your address.", "You'll see each shipping option with its price and delivery date.", "Have a question about it? Add it and press Submit Request."]
        : ["Pick the products you'd like and enter your full address.", "Choose regular or expedited shipping.", SUBMIT, "Our team replies with the shipping method, delivery date, cost and any taxes."];
    case "customs":
      return ["Choose the country it ships to, and add your order number if you have one.", "Write your question.", SUBMIT];
    case "partner":
      return ["Tell us whether you're already a partner.", "Write your question, with your store or channel details.", SUBMIT];
    case "question":
    case "shippingTimes":
    default:
      return ["Add your order number if it's about an order.", "Write your question, with a photo if it helps.", SUBMIT];
  }
}

// The form starts with "Hey! How can we help you?": a question about an
// order picks the order, then what they need; anything else has its own
// buttons, and every topic is under "See all topics". Kept in step with
// extensions/help-desk/assets/help-desk.js.
const ORDER_FLOWS = ["delivery", "lost", "orderUpdate", "edit", "cancel", "address", "productIssue", "wrongItem", "return"];
const ORDER_SECTIONS = ["Orders", "Shipping & Delivery", "Returns", "Warranty"];
const aboutAnOrder = (option: FormOption & { section: string }) => ORDER_FLOWS.includes(option.flow) || (option.flow === "question" && ORDER_SECTIONS.includes(option.section));
const PRODUCT_SECTIONS = ["Product Compatibility", "Product Education"];

// How to reach an option from the start of the form.
function startSteps(groupLabel: string, option: FormOption & { section: string }): string[] {
  if (aboutAnOrder(option)) return [
    "On our Help Desk page, choose \"I have a question about an order\".",
    `Pick your order (or "My order isn't listed").`,
    `Choose ${groupLabel === "Other Queries" ? "Other order questions" : groupLabel} as the category and ${option.label} under "What would you like to do?", then press Continue with this order.`,
  ];
  if (option.flow === "international" && option.region === "international") return ["On our Help Desk page, choose \"My question isn't about an order\".", "Press International Shipping."];
  if (PRODUCT_SECTIONS.includes(option.section)) return [
    "On our Help Desk page, choose \"My question isn't about an order\".",
    `Press Product Query, choose ${option.label} and press Continue with this question.`,
  ];
  return [`On our Help Desk page, press "See all topics" and choose ${groupLabel}.`, `Choose ${option.label}.`];
}

// The steps for an answer's action, or none when the action isn't on the form.
export function requestSteps(action: string): string[] {
  const [groupLabel, optionLabel] = action.split(" › ").map((part) => part.trim());
  const group = formGroups.find((entry) => entry.label === groupLabel);
  if (!group) return [];
  const option = optionLabel ? group.options.find((entry) => entry.label === optionLabel) : undefined;
  if (!option) return optionLabel ? [] : [`On our Help Desk page, press "See all topics" and choose ${group.label}.`, "Choose the option that fits your question, and follow the steps it shows.", SUBMIT];
  return [...startSteps(group.label, option), ...flowSteps(option)];
}

// "How do I...", "can I...", "what are the steps": the customer wants to know how to do it.
const ASKS_HOW = /\b(how|steps?|process|procedure|way to|ways to|where (do|can|should) i|what (do|should) i (do|need)|can i|could i|is it possible|kaise|kese|kaise karu|kya karu)\b/i;
export const asksHow = (text: string) => ASKS_HOW.test(text);

// "I want to cancel my order", "change my address please", "return karna hai":
// they want to do something the form can do, so the steps help as much as the answer.
const DOING = "cancel|change|edit|modify|update|return|exchange|swap|refund|replace|report|claim|track|remove|add|send back|fix";
const WANTS_TO = new RegExp(`\\b(i('d| would)? (want|like|need|wish)|i'm trying|i am trying|need to|want to|wanna|have to|help me|let me|please|pls|plz|mujhe|muje)\\b.{0,40}\\b(${DOING})|^\\s*(${DOING})\\b|\\b(${DOING})\\w*\\b.{0,30}\\b(karna|karni|karwana|karwani|krna|krni|chahta|chahti|chahiye|hai kya)\\b`, "i");
export const wantsToDo = (text: string) => WANTS_TO.test(text);
export const wantsSteps = (text: string) => asksHow(text) || wantsToDo(text);

// The steps as the end of the assistant's answer.
export function stepsText(action: string): string {
  const steps = requestSteps(action);
  return steps.length ? `How to do it:\n\n${steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}` : "";
}
