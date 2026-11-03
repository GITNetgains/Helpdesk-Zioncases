// The request page assistant's messages. Each store can reword them in
// Settings › Help articles; these are the words used until it does.
// {first_name} is the customer's first name (or left out when unknown).

export const ASSISTANT_COPY = {
  greeting: "Hi {first_name}! I'm the assistant. Ask me about your order, shipping, returns or our products and I'll answer straight away. If you'd rather talk to a person, just say so.",
  followUp: "Did that answer your question? If not, reply \"talk to a person\" and someone from our team will take over.",
  thanks: "You're welcome! If there's anything else, just ask here.",
  handoffAsked: "Of course. I've let our team know you'd like to talk to a person. Someone will reply here as soon as they can, and we'll email you when they do.",
  notSure: "I'm not sure I've understood that yet. Could you tell me a little more, like what happened and which product or order it's about?",
  notHelped: "Sorry that didn't help. What's still not right? Tell me a bit more and I'll find the right answer.",
  teamHasIt: "Thanks {first_name}! Our team has your message and will reply here as soon as they can.",
  photosReceived: "Thanks {first_name}, we've got them. They're added to your request for our team to look at.",
  personHint: "If you'd rather talk to a person from our team, reply \"talk to a person\".",
};
export type AssistantCopy = typeof ASSISTANT_COPY;
export type AssistantCopyKey = keyof AssistantCopy;

// What each message is for, in Settings.
export const ASSISTANT_COPY_FIELDS: { key: AssistantCopyKey; label: string; details: string }[] = [
  { key: "greeting", label: "When the customer says hello", details: "{first_name} is replaced with the customer's first name." },
  { key: "followUp", label: "Under every answer", details: "Tell customers how to reach a person if the answer isn't enough." },
  { key: "thanks", label: "When the customer says thanks", details: "" },
  { key: "handoffAsked", label: "When the customer asks for a person", details: "Your team is emailed and the request is flagged Waiting for a person." },
  { key: "notSure", label: "When the assistant isn't sure what they mean", details: "It only answers when it's sure. Otherwise it asks this, and lists the closest answers." },
  { key: "notHelped", label: "When an answer didn't help", details: "It asks what's still wrong instead of passing the chat on." },
  { key: "teamHasIt", label: "While your team has the chat", details: "When the assistant can't answer a message after the chat went to your team, so the customer always hears back." },
  { key: "photosReceived", label: "When the customer sends photos or a video", details: "" },
  { key: "personHint", label: "How to reach a person", details: "Shown when the assistant isn't sure. The chat only goes to your team when the customer asks." },
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
