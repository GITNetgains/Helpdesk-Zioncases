// The request page assistant's messages. Each store can reword them in
// Settings › Help articles; these are the words used until it does.
// {first_name} is the customer's first name (or left out when unknown).

export const ASSISTANT_COPY = {
  greeting: "Hi {first_name}! I'm the assistant. Ask me about your order, shipping, returns or our products and I'll answer straight away. If I can't help, I'll pass you to our team.",
  followUp: "Did that answer your question? If not, reply \"talk to a person\" and someone from our team will take over.",
  thanks: "You're welcome! If there's anything else, just ask here.",
  handoffAsked: "Of course. I've let our team know you'd like to talk to a person. Someone will reply here as soon as they can, and we'll email you when they do.",
  handoffUnsure: "I couldn't find an answer to that, so I've passed your message to our team. A person will reply here as soon as they can, and we'll email you when they do.",
  handoffUnhelpful: "Sorry that didn't help. I've passed your message to our team, and a person will reply here as soon as they can. We'll email you when they do.",
};
export type AssistantCopy = typeof ASSISTANT_COPY;
export type AssistantCopyKey = keyof AssistantCopy;

// What each message is for, in Settings.
export const ASSISTANT_COPY_FIELDS: { key: AssistantCopyKey; label: string; details: string }[] = [
  { key: "greeting", label: "When the customer says hello", details: "{first_name} is replaced with the customer's first name." },
  { key: "followUp", label: "Under every answer", details: "Tell customers how to reach a person if the answer isn't enough." },
  { key: "thanks", label: "When the customer says thanks", details: "" },
  { key: "handoffAsked", label: "When the customer asks for a person", details: "Your team is emailed and the request is flagged Waiting for a person." },
  { key: "handoffUnsure", label: "When the assistant can't find an answer", details: "It only answers when it's sure, and passes everything else to your team." },
  { key: "handoffUnhelpful", label: "When an answer didn't help", details: "" },
];
export const MAX_ASSISTANT_COPY = 600;

// The store's wording, over the defaults: blank or missing messages use the default.
export function readAssistantCopy(json: string | null | undefined): AssistantCopy {
  let saved: Record<string, unknown> = {};
  try { saved = JSON.parse(json || "{}") ?? {}; } catch { saved = {}; }
  return Object.fromEntries((Object.keys(ASSISTANT_COPY) as AssistantCopyKey[]).map((key) => {
    const value = saved[key];
    return [key, typeof value === "string" && value.trim() ? value.trim().slice(0, MAX_ASSISTANT_COPY) : ASSISTANT_COPY[key]];
  })) as AssistantCopy;
}

export const withFirstName = (text: string, firstName: string) =>
  text.replace(/\s*\{\s*first_name\s*\}/g, firstName ? ` ${firstName}` : "").replace(/^\s+/, "");
