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
  photosReceived: "Thanks {first_name}, we've got them. They're added to your request for our team to look at.",
  personHint: "If you'd rather talk to a person from our team, reply \"talk to a person\".",
  // Small talk: what the customer says that isn't a question about the store.
  howAreYou: "I'm doing great, thanks for asking {first_name}! How can I help you today? I can help with your order, shipping, returns, a damaged or missing item, or any of our products.",
  whoAreYou: "I'm the Zion Cases virtual assistant. I answer questions about your order, shipping, returns and our products straight away, any time of day. If you'd rather talk to a person from our team, just say so.",
  whatCanYouDo: "Of course! Tell me what's going on in a sentence or two, for example:\n- Where is my order?\n- My case arrived damaged\n- How do I return or exchange something?\n- Will my slabs fit in the case?\nI'll find the answer, or the right next step for you.",
  stillThere: "Yes, I'm here {first_name}! What can I help you with?",
  goodbye: "Thanks for chatting {first_name}! If anything else comes up, just write here. Have a great day!",
  sorry: "No worries at all! Take your time, and tell me what you need help with.",
  upset: "I'm really sorry about this {first_name}, I understand how frustrating it is. Tell me what happened, and I'll find the quickest way to sort it out. If you'd rather talk to a person from our team, just say \"talk to a person\".",
  filler: "I'm here {first_name}! What can I help you with? You can ask about your order, shipping, returns, a damaged or missing item, or any of our products.",
  chatCleared: "Done {first_name}, I've cleared the chat. Your request is still saved with our team. What can I help you with?",
  orderInProcess: "Thanks {first_name}! Your request is submitted and in process. We'll let you know here as soon as there's any update on it. Thanks for your patience.",
};
export type AssistantCopy = typeof ASSISTANT_COPY;
export type AssistantCopyKey = keyof AssistantCopy;

// What each message is for, in Settings.
export const ASSISTANT_COPY_FIELDS: { key: AssistantCopyKey; label: string; details: string }[] = [
  { key: "greeting", label: "When the customer says hello", details: "{first_name} is replaced with the customer's first name." },
  { key: "followUp", label: "Under every answer", details: "Tell customers how to reach a person if the answer isn't enough." },
  { key: "thanks", label: "When the customer says thanks", details: "" },
  { key: "handoffAsked", label: "When the customer asks for a person", details: "Your team is emailed and the request is flagged Waiting for a person. From then on, and once anyone from your team replies, the assistant stays out of the chat." },
  { key: "notSure", label: "When the assistant isn't sure what they mean", details: "It only answers when it's sure. Otherwise it asks this, and lists the closest answers." },
  { key: "notHelped", label: "When an answer didn't help", details: "It asks what's still wrong instead of passing the chat on." },
  { key: "photosReceived", label: "When the customer sends photos or a video", details: "" },
  { key: "personHint", label: "How to reach a person", details: "Shown when the assistant isn't sure. The chat only goes to your team when the customer asks." },
  { key: "howAreYou", label: "When the customer asks how it is", details: "\"How are you?\", \"what's up\", \"kaise ho\"." },
  { key: "whoAreYou", label: "When the customer asks who they're talking to", details: "\"Who are you?\", \"are you a bot?\", \"is this a real person?\". The chat still goes to your team only when they ask for a person." },
  { key: "whatCanYouDo", label: "When the customer asks for help without saying what with", details: "\"Can you help me?\", \"I have a question\", \"help\"." },
  { key: "stillThere", label: "When the customer asks if anyone's there", details: "\"Are you there?\", \"anyone there?\"." },
  { key: "goodbye", label: "When the customer says goodbye", details: "\"Bye\", \"that's all\", \"have a good day\"." },
  { key: "sorry", label: "When the customer apologises", details: "\"Sorry\", \"my bad\"." },
  { key: "upset", label: "When the customer is upset", details: "\"Worst service\", \"this is ridiculous\", \"bakwas\". It apologises, then asks what happened." },
  { key: "filler", label: "When the customer hasn't asked anything yet", details: "\"Hmm\", \"lol\", \"?\", \"haan\"." },
  { key: "orderInProcess", label: "On an order request, when the assistant can't answer", details: "Asked where their order is, the assistant shows its live status from Shopify instead." },
  { key: "chatCleared", label: "When the customer clears the chat", details: "\"Clear chat\", \"start over\". Only their view is cleared: your team still sees the whole conversation." },
];
export const MAX_ASSISTANT_COPY = 600;

// The note left on a request where the customer cleared their chat: the page
// and the assistant start from there (help-desk.server.ts, clearCustomerChat).
export const CHAT_CLEARED = "Customer cleared their chat.";

// The customer asking to clear the chat: the whole message is the request
// ("clear chat", "start over", "chat clear karo"), not a question that uses the word.
const CLEAR_CHAT = /^\s*(please\s+)?(clear|reset|delete|erase|wipe|restart|refresh)\s+(the\s+|this\s+|my\s+|all\s+)?(chat|chats|conversation|messages|history|chat history)(\s+(please|pls|plz))?\s*[.!]*\s*$|^\s*(clear|new chat|start over|start again|chat clear(\s+(karo|kar do|kardo|kr do|krdo))?|clear\s+(karo|kar do|kardo|kr do|krdo))\s*[.!]*\s*$/i;
export const asksToClearChat = (text: string) => CLEAR_CHAT.test(text);

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
