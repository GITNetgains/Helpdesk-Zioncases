import { addressFromValues, addressLines, cancelScopes, countryName, fieldLabels, VIDEO_EXTENSIONS, type ShippingAddress, parseEditRequest } from "./help-desk";
import { ASSISTANT_AVATAR, nameInitial } from "./help-desk-avatar";
import { REFUND_DISCLAIMER } from "./help-desk-form";

// The customer-facing pages served through the app proxy: the private request
// page and the lookup page. They are returned as Liquid so the store's theme
// wraps them with its own header, footer and fonts; the styles below pin the
// typography so a theme's heading styles can't distort the layout.

// Escapes HTML and Liquid delimiters: these pages are rendered by the theme as Liquid.
const escape = (value: string) => value.replace(/[&<>"'{}]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "{": "&#123;", "}": "&#125;" })[char]!);
const multiline = (value: string) => escape(value).replace(/\r?\n/g, "<br>");
// Rendered in UTC on the server, then switched to the shopper's own time zone by the page script.
const time = (value: Date, style: "full" | "date" | "clock" = "full") => `<time datetime="${value.toISOString()}" data-hdt-time="${style}">${escape(new Intl.DateTimeFormat("en", style === "date" ? { dateStyle: "medium", timeZone: "UTC" } : style === "clock" ? { timeStyle: "short", timeZone: "UTC" } : { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(value))}</time>`;

const STATUS_COPY: Record<string, { title: string; text: string }> = {
  Open: { title: "We've got your request", text: "Our team will look at it and reply soon. We'll email you as soon as they do." },
  "In progress": { title: "Our team is working on it", text: "We're sorting this out for you and will update you here and by email." },
  "Waiting on customer": { title: "We've replied: it's your turn", text: "Read our reply below and send us your answer so we can keep going." },
  Resolved: { title: "This request is resolved", text: "Thanks for your patience. If you still need help, please send us a new request." },
};
const STEPS = [
  { label: "Received", status: "Open" },
  { label: "In progress", status: "In progress" },
  { label: "Your reply", status: "Waiting on customer" },
  { label: "Resolved", status: "Resolved" },
];
// Short facts go in the summary; what the customer wrote goes in their message.
// The form's broad request types (orderType, update, issue) aren't shown: the request's own issue is.
const SUMMARY_FIELDS = ["orderNumber", "orderDate", "cancelReason", "defects", "resolution", "existing", "registeredEmail", "country"];
const MESSAGE_FIELDS = ["orderNote", "details", "query", "orderDetails", "productDetails", "quantities", "address", "otherDetails"];

const STYLES = `<style>
.hdt{--ink:#172351;--muted:#5b6275;--line:#e6e8ee;--soft:#f3f3f3;--accent:#ef3a24;--accent-dark:#d22d18;--blue:#334fb4;--ok:#0c7a43;max-width:1040px;margin:clamp(24px,4vw,48px) auto clamp(48px,6vw,80px);padding:0 16px;color:var(--ink);font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased}
.hdt *{box-sizing:border-box}
.hdt p,.hdt dl,.hdt dd,.hdt ol,.hdt ul{margin:0}
.hdt h1,.hdt h2,.hdt h3{margin:0;color:var(--ink);font-family:inherit;font-style:normal;text-transform:none;letter-spacing:-.01em}
.hdt h1{font-size:clamp(26px,3.4vw,36px);font-weight:500;line-height:1.15}
.hdt h2{font-size:17px;font-weight:700;line-height:1.3}
.hdt-card{border:1px solid var(--line);border-radius:20px;overflow:hidden;background:#fff;box-shadow:0 1px 2px rgba(25,33,61,.04),0 12px 32px rgba(25,33,61,.06)}
.hdt-pad{padding:clamp(20px,3vw,30px)}
.hdt-hero{position:relative;overflow:hidden;padding:clamp(22px,3.4vw,34px)}
.hdt-hero::before{content:"";position:absolute;inset:0 0 auto;height:4px;background:linear-gradient(90deg,var(--accent),#ff8a5c)}
.hdt-top{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:16px}
.hdt-eyebrow{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:10px;color:var(--muted);font-size:13px}
.hdt-chip{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;background:var(--soft);color:var(--ink);font-size:12px;font-weight:600}
.hdt-pill{display:inline-flex;align-items:center;gap:8px;padding:7px 14px;border-radius:999px;font-size:13px;font-weight:700;white-space:nowrap}
.hdt-pill i{width:8px;height:8px;border-radius:50%;background:currentColor}
.hdt-pill[data-status="Open"]{background:#fff4d6;color:#7a5600}
.hdt-pill[data-status="In progress"]{background:#e6effc;color:#1d4f94}
.hdt-pill[data-status="Waiting on customer"]{background:#fde8e5;color:#b3261e}
.hdt-pill[data-status="Resolved"]{background:#e3f5ea;color:var(--ok)}
.hdt .hdt-lead{margin-top:8px;color:var(--muted);font-size:15px;max-width:620px}
.hdt-steps{display:grid;grid-template-columns:repeat(4,1fr);margin-top:30px;padding:0;list-style:none}
.hdt-steps li{position:relative;display:flex;flex-direction:column;align-items:center;gap:8px;color:var(--muted);font-size:13px;text-align:center}
.hdt-steps li::before{content:"";position:absolute;top:13px;left:-50%;right:50%;height:3px;border-radius:3px;background:var(--line)}
.hdt-steps li:first-child::before{display:none}
.hdt-steps b{position:relative;z-index:1;display:grid;place-items:center;width:28px;height:28px;border-radius:50%;border:2px solid var(--line);background:#fff;font-size:12px;font-weight:700;color:var(--muted)}
.hdt-steps li[data-done],.hdt-steps li[data-current]{color:var(--ink)}
.hdt-steps li[data-done]::before,.hdt-steps li[data-current]::before{background:var(--ink)}
.hdt-steps li[data-done] b{border-color:var(--ink);background:var(--ink);color:#fff}
.hdt-steps li[data-current]{font-weight:700}
.hdt-steps li[data-current] b{border-color:var(--accent);background:var(--accent);color:#fff;box-shadow:0 0 0 5px rgba(239,58,36,.15)}
.hdt-layout{display:block;margin-top:22px}
.hdt-aside{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:16px;align-items:start}
.hdt-chat-head{display:grid!important;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:16px;padding:16px 18px;background:#172351;color:#fff;border-bottom:1px solid rgba(255,255,255,.08)}
.hdt-chat-brand{display:grid;grid-template-columns:46px minmax(0,1fr);align-items:center;gap:13px;min-width:0}
.hdt-chat-brand>div{min-width:0}
.hdt-chat-avatar{display:grid;place-items:center;width:46px;height:46px;border-radius:50%;background:var(--accent);color:#fff;box-shadow:0 0 0 3px rgba(239,58,36,.22)}
.hdt-chat-avatar svg{width:22px;height:22px}
.hdt{--hdt-bot-face:url(${ASSISTANT_AVATAR})}
.hdt-chat-avatar[data-bot]{background:#000 var(--hdt-bot-face) center/cover no-repeat;box-shadow:0 0 0 2px rgba(255,255,255,.22),0 2px 10px rgba(0,0,0,.35)}
.hdt-chat-avatar[data-person]{font-size:19px;font-weight:800}
.hdt-ava{display:grid;place-items:center;flex:0 0 30px;width:30px;height:30px;margin:0 8px 0 0;align-self:flex-start;border-radius:50%;background:var(--accent);color:#fff;font-size:13px;font-weight:800;line-height:1;box-shadow:0 0 0 2px rgba(255,255,255,.12)}
.hdt-ava[data-bot]{width:34px;height:34px;flex-basis:34px;background:#000 var(--hdt-bot-face) center/cover no-repeat;box-shadow:0 0 0 1.5px rgba(255,255,255,.25)}
.hdt-msg[data-grouped] .hdt-ava{visibility:hidden;height:0}
.hdt .hdt-typing .hdt-ava{flex-basis:24px;width:24px;height:24px;margin:0;font-size:11px}
.hdt .hdt-theme{flex:none;display:grid;place-items:center;width:36px!important;min-width:36px!important;height:36px;margin:0;padding:7px;border:1px solid rgba(255,255,255,.2);border-radius:9px;background:rgba(255,255,255,.08);color:#fff;box-shadow:none}
.hdt .hdt-theme:hover{background:rgba(255,255,255,.18);transform:none;box-shadow:none}
.hdt .hdt-theme svg{width:18px;height:18px}
.hdt .hdt-theme-dark,.hdt[data-chat-theme="light"] .hdt-theme-light{display:none}
.hdt[data-chat-theme="light"] .hdt-theme-dark{display:block}
/* Until the request is resolved the chat stays open: beside the page on wide screens, in it on narrow ones. */
@media(min-width:1100px){.hdt[data-chat-locked][data-chat-open]:not([data-chat-expanded]){max-width:1530px;padding-right:486px}}
@media(max-width:1099px){.hdt[data-chat-locked][data-chat-open]:not([data-chat-expanded]) .hdt-chatbox{position:relative;right:auto;bottom:auto;z-index:auto;width:100%;height:min(600px,78dvh);min-height:420px;margin:16px 0;box-shadow:0 12px 34px rgba(7,13,31,.2)}}
/* The chat's own background, so its rounded corners never show the page behind. */
.hdt .hdt-chatbox{background:#141e3d}
.hdt-chatbox .hdt-foot{border-radius:0}
/* The assistant is online: a dot on its picture. */
.hdt-chat-avatar{position:relative}
.hdt-chat-head:not([data-closed]) .hdt-chat-avatar::after{content:"";position:absolute;right:0;bottom:1px;width:11px;height:11px;border-radius:50%;background:#3ddc84;box-shadow:0 0 0 2.5px #172351}
.hdt[data-chat-theme="light"] .hdt-chat-head:not([data-closed]) .hdt-chat-avatar::after{box-shadow:0 0 0 2.5px #fff}
/* Suggested questions in an answer, and quick replies under the latest one. */
.hdt-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.hdt-quick{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px;margin:10px 0 2px}
.hdt button.hdt-chip{display:inline-flex;align-items:center;width:auto;min-width:0;max-width:100%;height:auto;margin:0;padding:7px 13px;border:1px solid rgba(157,176,255,.42);border-radius:999px;background:rgba(157,176,255,.1);color:#dbe3ff;font:inherit;font-size:13px;font-weight:600;line-height:1.3;text-align:left;white-space:normal;box-shadow:none;cursor:pointer;transition:background .15s ease,border-color .15s ease}
.hdt button.hdt-chip:hover{background:rgba(157,176,255,.22);border-color:rgba(157,176,255,.7);transform:none;box-shadow:none}
.hdt button.hdt-chip:focus-visible{outline:2px solid #9db0ff;outline-offset:2px}
.hdt button.hdt-chip[disabled]{opacity:.5;cursor:default}
.hdt[data-chat-theme="light"] button.hdt-chip{border-color:#c9d3f5;background:#eef2ff;color:#334fb4}
.hdt[data-chat-theme="light"] button.hdt-chip:hover{background:#e0e7ff;border-color:#9fb1ec}
.hdt[data-chat-theme="light"] .hdt-chatbox{background:#fff}
/* Light chat: chosen in the chat's header, or the device's light setting. */
.hdt[data-chat-theme="light"] .hdt-chatbox{border-color:#dfe3ee;background:#fff;box-shadow:0 22px 70px rgba(23,35,81,.18)}
.hdt[data-chat-theme="light"] .hdt-chat-head{background:#fff;color:var(--ink);border-bottom-color:#e8ebf2}
.hdt[data-chat-theme="light"] .hdt-chat-head h2{color:var(--ink)}
.hdt[data-chat-theme="light"] .hdt-chat-head h2 small,.hdt[data-chat-theme="light"] .hdt-chat-head p{color:var(--muted)}
.hdt[data-chat-theme="light"] .hdt-count{background:#f1f3f8;color:var(--ink)}
.hdt[data-chat-theme="light"] .hdt-expand,.hdt[data-chat-theme="light"] .hdt-theme,.hdt[data-chat-theme="light"] .hdt-chat-close{border-color:#dfe3ee;background:#f6f7fb;color:var(--ink)}
.hdt[data-chat-theme="light"] .hdt-expand:hover,.hdt[data-chat-theme="light"] .hdt-theme:hover,.hdt[data-chat-theme="light"] .hdt-chat-close:hover{background:#eceff6}
.hdt[data-chat-theme="light"] .hdt-chat-avatar[data-bot]{box-shadow:0 0 0 2px #fff,0 0 0 3.5px #e3e6ee,0 2px 8px rgba(23,35,81,.15)}
.hdt[data-chat-theme="light"] .hdt-thread{background:#f4f6fa radial-gradient(rgba(23,35,81,.06) 1px,transparent 1px);background-size:16px 16px;scrollbar-color:#c5cbdb transparent}
.hdt[data-chat-theme="light"] .hdt-thread::-webkit-scrollbar-thumb{background:#c5cbdb}
.hdt[data-chat-theme="light"] .hdt-body{background:#fff;border-color:#e3e7f0;color:#1d2433;box-shadow:0 1px 3px rgba(23,35,81,.08)}
.hdt[data-chat-theme="light"] .hdt-msg[data-kind="customer"] .hdt-body{background:#334fb4;border-color:#334fb4;color:#fff}
.hdt[data-chat-theme="light"] .hdt-msg[data-kind="bot"] .hdt-body{border:1px dashed #c9d0e0}
.hdt[data-chat-theme="light"] .hdt-who{color:#334fb4}
.hdt[data-chat-theme="light"] .hdt-msg[data-kind="customer"] .hdt-who{color:#dce3ff}
.hdt[data-chat-theme="light"] .hdt-tag{background:#eef1f8;color:#334fb4}
.hdt[data-chat-theme="light"] .hdt-meta{color:#8a92a6}
.hdt[data-chat-theme="light"] .hdt-msg[data-kind="customer"] .hdt-meta{color:rgba(255,255,255,.8)}
.hdt[data-chat-theme="light"] .hdt-ava{box-shadow:0 0 0 2px #fff}
.hdt[data-chat-theme="light"] .hdt-day{background:#e8ebf3;color:#4a5370}
.hdt[data-chat-theme="light"] .hdt-system{color:#6b7389}
.hdt[data-chat-theme="light"] .hdt-system::before,.hdt[data-chat-theme="light"] .hdt-system::after{background:#dfe3ee}
.hdt[data-chat-theme="light"] .hdt-typing{background:#fff;border-color:#e3e7f0;color:#6b7389;box-shadow:0 1px 3px rgba(23,35,81,.08)}
.hdt[data-chat-theme="light"] .hdt-connecting{background:#eef2ff;border-color:#c9d3f5;color:var(--ink)}
.hdt[data-chat-theme="light"] .hdt-connecting strong{color:var(--ink)!important}
.hdt[data-chat-theme="light"] .hdt-connecting div>span{color:#4a5370!important}
.hdt[data-chat-theme="light"] .hdt-connecting .hdt-dots{background:#fff;border-color:#d7ddf0}
.hdt[data-chat-theme="light"] .hdt-dots i{background:#334fb4;box-shadow:none}
.hdt[data-chat-theme="light"] .hdt-foot{background:#fff;border-top-color:#e8ebf2;color:var(--muted)}
.hdt[data-chat-theme="light"] .hdt-foot label{color:var(--ink)}
.hdt[data-chat-theme="light"] .hdt-foot textarea{border-color:#d9deea;background:#f6f7fb}
.hdt[data-chat-theme="light"] .hdt-foot .hdt-drop{background:#f6f7fb;border-color:#d9deea}
.hdt .hdt-chat-head h2{display:grid;gap:1px;min-width:0;color:#fff;font-size:16px;line-height:1.25;letter-spacing:-.01em}
.hdt .hdt-chat-head h2 small{color:#c9d1ea;font-size:11.5px;font-weight:500;letter-spacing:0}
.hdt .hdt-chat-head h2 span,.hdt .hdt-chat-head h2{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hdt-chatbox{container-type:inline-size}
@container (max-width:460px){.hdt-count{display:none}}
.hdt .hdt-chat-head p{display:flex;align-items:center;gap:7px;margin-top:4px;color:#c9d1ea;font-size:12.5px;line-height:1.4}
.hdt-chat-actions{display:flex;align-items:center;gap:10px;flex:none}
.hdt-live{flex:none;width:8px;height:8px;border-radius:50%;background:#3ddc84;box-shadow:0 0 0 3px rgba(61,220,132,.22)}
.hdt-chat-head[data-closed] .hdt-live{background:#8a93ad;box-shadow:none}
.hdt-count{padding:7px 12px;border-radius:999px;background:rgba(255,255,255,.1);color:#e8ebf5;font-size:12px;font-weight:650;white-space:nowrap}
.hdt .hdt-expand{flex:none;display:grid;place-items:center;width:36px!important;min-width:36px!important;height:36px;margin:0;padding:7px;border:1px solid rgba(255,255,255,.2);border-radius:9px;background:rgba(255,255,255,.08);color:#fff;box-shadow:none}
.hdt .hdt-expand:hover{background:rgba(255,255,255,.18);transform:none;box-shadow:none}
.hdt .hdt-expand svg{width:19px;height:19px}
.hdt .hdt-expand-close,.hdt[data-chat-expanded] .hdt-expand-open{display:none}
.hdt[data-chat-expanded] .hdt-expand-close{display:block}
.hdt .hdt-connecting{display:flex;align-items:center;gap:12px;align-self:flex-start;max-width:min(560px,88%);margin:12px 0 4px;padding:12px 15px;border:1px solid #50639b;border-radius:4px 16px 16px 16px;background:#26365f;color:#fff;box-shadow:0 4px 18px rgba(0,0,0,.22)}
.hdt .hdt-connecting strong,.hdt .hdt-connecting span{display:block}
.hdt .hdt-connecting strong{font-size:13px;color:#fff!important}
.hdt .hdt-connecting div>span{margin-top:2px;color:#e0e7ff!important;font-size:12px;line-height:1.45}
.hdt .hdt-connecting .hdt-dots{display:flex;flex:none;align-items:center;gap:4px;padding:8px;border:1px solid rgba(255,255,255,.15);border-radius:999px;background:rgba(255,255,255,.09)}
.hdt .hdt-dots i{display:block;width:7px;height:7px;border-radius:50%;background:#b9c8ff;box-shadow:0 0 8px rgba(185,200,255,.55);animation:hdt-dot 1.2s infinite ease-in-out}
.hdt-dots i:nth-child(2){animation-delay:.15s}.hdt-dots i:nth-child(3){animation-delay:.3s}
@keyframes hdt-dot{0%,60%,100%{opacity:.35;transform:translateY(0)}30%{opacity:1;transform:translateY(-4px)}}
.hdt .hdt-typing{display:flex;align-items:center;gap:9px;align-self:flex-start;margin-top:8px;padding:10px 13px;border:1px solid rgba(255,255,255,.08);border-radius:4px 16px 16px 16px;background:#1f2a4d;color:rgba(242,244,250,.7);font-size:12px;box-shadow:0 2px 8px rgba(0,0,0,.25);animation:hdt-typing-in .18s ease-out}
.hdt .hdt-typing .hdt-dots{display:inline-flex;align-items:center;gap:4px}
@keyframes hdt-typing-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.hdt-thread{display:flex;flex-direction:column;gap:2px;max-height:min(64vh,640px);overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#3e4c7a transparent;padding:16px clamp(12px,2.4vw,22px) 20px;background:#0f1730 radial-gradient(rgba(255,255,255,.045) 1px,transparent 1px);background-size:16px 16px}
.hdt-thread::-webkit-scrollbar{width:6px}.hdt-thread::-webkit-scrollbar-thumb{background:#3e4c7a;border-radius:6px}.hdt-thread::-webkit-scrollbar-track{background:transparent}
.hdt-msg{display:flex;margin-top:8px}
.hdt-msg[data-grouped]{margin-top:2px}
.hdt-msg[data-kind="customer"]{justify-content:flex-end}
.hdt-body{max-width:min(560px,84%);min-width:110px;padding:9px 13px 6px;border:1px solid rgba(255,255,255,.08);border-radius:4px 16px 16px 16px;background:#1f2a4d;color:#f2f4fa;box-shadow:0 2px 8px rgba(0,0,0,.25);overflow-wrap:anywhere;font-size:14.5px;line-height:1.5}
.hdt-msg[data-kind="customer"] .hdt-body{background:#334fb4;border-color:#4a66cc;color:#fff;border-radius:16px 4px 16px 16px}
.hdt-msg[data-kind="customer"] .hdt-meta{color:rgba(255,255,255,.78)}
.hdt-msg[data-kind="customer"] .hdt-group h3{color:rgba(255,255,255,.75)}
.hdt-msg[data-kind="customer"] .hdt-product{color:var(--ink)}
.hdt-msg[data-kind="customer"] .hdt-facts span,.hdt-msg[data-kind="customer"] .hdt-files{background:rgba(255,255,255,.14);border-color:rgba(255,255,255,.3);color:#fff}
.hdt-msg[data-grouped] .hdt-body{border-radius:16px}
.hdt-msg[data-kind="bot"] .hdt-body{border:1px dashed rgba(255,255,255,.28)}
.hdt-who{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:2px;font-size:12.5px;font-weight:700;color:#9db0ff}
.hdt-msg[data-kind="customer"] .hdt-who{color:#dce3ff}
.hdt-tag{padding:0 7px;border-radius:999px;background:rgba(255,255,255,.14);color:#fff;font-size:10.5px;font-weight:700}
.hdt-meta{display:block;margin-top:2px;text-align:right;color:rgba(242,244,250,.6);font-size:11px;line-height:1.2}
.hdt-day{align-self:center;margin:10px 0 2px;padding:4px 12px;border-radius:8px;background:rgba(255,255,255,.1);color:#e8ebf5;font-size:12px;font-weight:600}
.hdt-body p+p{margin-top:10px}
/* The store's theme may colour paragraphs or their lines: never inside a bubble. */
.hdt .hdt-body p{background:transparent;box-shadow:none;color:inherit}
.hdt-facts{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.hdt-facts span{padding:3px 10px;border-radius:999px;background:#fff;border:1px solid var(--line);font-size:12px;font-weight:600}
.hdt-products{display:grid;gap:8px}
.hdt-group{margin-top:16px}
.hdt .hdt-group h3{margin-bottom:8px;color:var(--muted);font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
.hdt-product{display:flex;align-items:center;gap:12px;padding:8px;border-radius:12px;background:#fff;border:1px solid var(--line)}
.hdt-product img,.hdt-product i{flex:none;width:48px;height:48px;border-radius:9px;object-fit:cover;background:var(--soft)}
.hdt-product strong{font-size:14px;font-weight:600}
.hdt-files{display:inline-flex;align-items:center;gap:6px;margin-top:12px;padding:5px 12px;border-radius:999px;background:#fff;border:1px solid var(--line);font-size:12px;font-weight:600}
.hdt-system{display:flex;align-items:center;gap:12px;width:100%;margin-top:12px;color:#c9d1ea;font-size:12px;font-weight:600}
.hdt-system::before,.hdt-system::after{content:"";flex:1;height:1px;background:rgba(255,255,255,.15)}
.hdt-foot{padding:14px clamp(14px,2.4vw,22px) 18px;border-top:1px solid rgba(255,255,255,.08);background:#141e3d;color:#c9d1ea;border-radius:0 0 20px 20px}
.hdt .hdt-foot label{color:#e8ebf5}
.hdt .hdt-foot .hdt-drop{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.25)}
.hdt .hdt-foot .hdt-drop:hover,.hdt .hdt-foot .hdt-drop:focus-within{border-color:#9db0ff}
.hdt-foot .hdt-drop i,.hdt-foot .hdt-wait i{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.12)}
.hdt-foot .hdt-drop small,.hdt-foot .hdt-wait p{color:#a9b3d3}
.hdt-foot .hdt-wait strong{color:#fff}
.hdt-wait{display:flex;gap:14px;align-items:flex-start}
.hdt-wait i{flex:none;display:grid;place-items:center;width:42px;height:42px;border-radius:12px;background:#fff;border:1px solid var(--line);font-style:normal;font-size:20px}
.hdt-wait strong{display:block;font-size:15px}
.hdt-wait p{margin-top:2px;color:var(--muted);font-size:14px}
.hdt label{display:grid;gap:6px;font-size:14px;font-weight:600}
.hdt textarea,.hdt input:not([type=file]){width:100%;margin:0;padding:13px 18px;border:1px solid #c4c7d0;border-radius:30px;background:#fff;color:var(--ink);font:inherit;font-weight:400}
.hdt textarea{min-height:84px;resize:vertical;border-radius:20px}
.hdt textarea:focus,.hdt input:focus{outline:none;border-color:var(--ink);box-shadow:0 0 0 4px rgba(25,33,61,.12)}
.hdt .hdt-drop{position:relative;display:flex;gap:12px;align-items:center;margin-top:12px;padding:12px 14px;border:1.5px dashed #c9ccd6;border-radius:20px;background:#fff;cursor:pointer;font-weight:400}
.hdt .hdt-drop:hover,.hdt .hdt-drop:focus-within{border-color:var(--ink)}
.hdt-drop input{position:absolute;inset:0;opacity:0;cursor:pointer}
.hdt-drop i{flex:none;display:grid;place-items:center;width:36px;height:36px;border-radius:10px;background:var(--soft);font-style:normal;font-size:18px}
.hdt-drop strong{display:block;font-size:14px}.hdt-drop small{color:var(--muted);font-size:12px}
.hdt-actions{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:10px;margin-top:14px}
.hdt-actions:empty{display:none}
.hdt .hdt-person{background:#fff;color:var(--ink);border:1px solid #c9ccd5;box-shadow:none}
.hdt .hdt-person:hover{border-color:var(--ink)}
.hdt-waiting{margin-right:auto;color:var(--muted);font-size:13.5px}
.hdt button{min-width:170px;margin:0;padding:14px 28px;border:0;border-radius:6px;background:var(--accent);color:#fff;font:inherit;font-weight:600;letter-spacing:.02em;text-transform:none;cursor:pointer;box-shadow:0 4px 5px rgba(0,0,0,.2);transition:transform .15s ease,background-color .15s ease,box-shadow .15s ease}
.hdt button:hover{background:var(--accent-dark);transform:translateY(-1px);box-shadow:0 8px 16px rgba(239,58,36,.28)}
.hdt button:focus-visible{outline:3px solid rgba(239,58,36,.45);outline-offset:2px}
.hdt-aside{display:grid;gap:22px}
/* The conversation opens from a floating launcher so ticket details stay clear. */
.hdt-chatbox{display:none;position:fixed;right:24px;bottom:24px;z-index:10001;width:min(420px,calc(100vw - 32px));height:min(620px,calc(100dvh - 48px));min-height:360px;max-height:none;margin:0;border:1px solid #2a3965;border-radius:18px;box-shadow:0 22px 70px rgba(7,13,31,.42);flex-direction:column;overflow:hidden}
.hdt[data-chat-open] .hdt-chatbox{display:flex;animation:hdt-chat-in .18s ease-out}
.hdt[data-chat-open] .hdt-chat-launcher{display:none}
.hdt button.hdt-chat-launcher{position:fixed;right:24px;bottom:24px;z-index:10000;display:grid;place-items:center;width:64px;height:64px;min-width:64px;max-width:64px;padding:0;border:0;border-radius:50%;background:var(--accent);color:#fff;box-shadow:0 8px 24px rgba(23,35,81,.32),0 0 0 5px rgba(239,58,36,.12);cursor:pointer;font:inherit;transition:transform .18s ease,box-shadow .18s ease;animation:hdt-launcher-pulse 2.8s ease-in-out infinite,hdt-launcher-beat 3s ease-in-out infinite;overflow:visible}
.hdt button.hdt-chat-launcher::before,.hdt button.hdt-chat-launcher::after{content:"";position:absolute;inset:0;border-radius:50%;border:3px solid var(--accent);pointer-events:none;animation:hdt-launcher-ring 2s cubic-bezier(.2,.6,.35,1) infinite}
.hdt button.hdt-chat-launcher::after{animation-delay:1s}
@keyframes hdt-launcher-ring{0%{transform:scale(1);opacity:.85}100%{transform:scale(1.8);opacity:0}}
@keyframes hdt-launcher-beat{0%,40%,100%{transform:scale(1)}8%{transform:scale(1.12)}16%{transform:scale(.97)}24%{transform:scale(1.06)}32%{transform:scale(1)}}
.hdt button.hdt-chat-launcher:hover{background:var(--accent-dark);transform:translateY(-3px) scale(1.03);box-shadow:0 12px 30px rgba(23,35,81,.38),0 0 0 7px rgba(239,58,36,.14);animation:none}
.hdt button.hdt-chat-launcher:hover::before,.hdt button.hdt-chat-launcher:hover::after{animation-play-state:paused;opacity:0}
@keyframes hdt-launcher-pulse{0%,100%{box-shadow:0 8px 24px rgba(23,35,81,.32),0 0 0 5px rgba(239,58,36,.12)}50%{box-shadow:0 10px 28px rgba(23,35,81,.36),0 0 0 9px rgba(239,58,36,.06)}}
.hdt-chat-launcher:focus-visible{outline:3px solid #7e9cff;outline-offset:3px}
.hdt-chat-launcher-icon{display:grid;place-items:center;width:64px;height:64px;border-radius:50%}
.hdt-chat-launcher-icon svg{width:29px;height:29px}
.hdt-chat-launcher-copy{display:none}
.hdt .hdt-chat-close{flex:none;display:grid;place-items:center;width:36px!important;min-width:36px!important;height:36px!important;max-width:36px;padding:0;border:1px solid rgba(255,255,255,.2);border-radius:9px;background:rgba(255,255,255,.08);color:white;cursor:pointer;margin:0;box-shadow:none}
.hdt .hdt-chat-close:hover{background:rgba(255,255,255,.18);transform:none;box-shadow:none}
.hdt-chat-close svg{width:17px;height:17px}
@keyframes hdt-chat-in{from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:none}}
.hdt-chatbox .hdt-thread{flex:1;min-height:0;max-height:none}
.hdt-chatbox .hdt-foot{flex:none}
.hdt-chatbox .hdt-thread{width:100%;min-width:0}
.hdt-chatbox .hdt-foot{width:100%;min-width:0}
@media(max-width:600px){.hdt-chatbox{right:12px;bottom:12px;width:min(420px,calc(100vw - 24px));height:min(620px,calc(100dvh - 40px));min-height:300px}.hdt button.hdt-chat-launcher{right:18px;bottom:28px;width:60px;height:60px;min-width:60px;max-width:60px}.hdt-chat-launcher-icon{width:60px;height:60px}.hdt-chat-head{gap:10px;padding:13px 12px}.hdt-chat-brand{grid-template-columns:38px minmax(0,1fr);gap:10px}.hdt-chat-avatar{width:38px;height:38px}.hdt-chat-actions{gap:7px}.hdt-count{display:none}.hdt .hdt-chat-close{width:34px!important;min-width:34px!important;height:34px!important;max-width:34px}.hdt .hdt-expand{display:none}.hdt .hdt-chat-head h2{font-size:14px}.hdt .hdt-chat-head p{font-size:11px}}
.hdt[data-chat-expanded] .hdt-chatbox{display:flex;position:fixed;inset:16px;z-index:10002;width:auto;height:auto;min-height:0;max-height:none;margin:0;border-radius:18px;box-shadow:0 20px 80px rgba(7,13,31,.6)}
.hdt[data-chat-expanded] .hdt-thread{max-height:none}
.hdt-chat-backdrop{display:none}
.hdt[data-chat-expanded]::before{content:"";position:fixed;inset:0;z-index:9999;background:rgba(8,13,28,.68);backdrop-filter:blur(3px)}
.hdt-compose{display:flex;align-items:flex-end;gap:10px;margin-top:6px}
.hdt .hdt-compose textarea{flex:1;height:50px;min-height:50px;max-height:160px;padding:13px 18px;border-radius:25px;resize:none;line-height:1.45;overflow-x:hidden;overflow-y:hidden;scrollbar-width:none}
.hdt .hdt-compose textarea::-webkit-scrollbar{display:none}
.hdt .hdt-send{flex:none;display:grid;place-items:center;width:50px;min-width:0;height:50px;padding:0;border-radius:50%}
.hdt .hdt-send svg{width:21px;height:21px;margin-left:-2px}
.hdt .hdt-person{min-width:0;padding:9px 16px;font-size:13.5px}
.hdt-hint{margin-left:auto;color:#8f9bc2;font-size:12px}
.hdt-chatbox .hdt-actions{justify-content:flex-start;margin-top:10px}
.hdt dl{display:grid}
.hdt dl div{display:flex;justify-content:space-between;gap:16px;padding:11px 0;border-bottom:1px solid var(--line)}
.hdt dl div:last-child{border-bottom:0;padding-bottom:0}
.hdt dt{color:var(--muted);font-size:13px}
.hdt dd{font-size:14px;font-weight:600;text-align:right;overflow-wrap:anywhere}
.hdt-help p{color:var(--muted);font-size:14px}.hdt-help p+p{margin-top:10px}
.hdt-help h2{margin-bottom:10px}
.hdt-track{margin-top:14px}.hdt .hdt-track a{display:inline-block;padding:10px 18px;border-radius:6px;background:var(--ink);color:#fff;text-decoration:none}
.hdt a{color:var(--ink);font-weight:700;text-underline-offset:3px}
.hdt-note{position:relative;margin-bottom:14px;padding:12px 14px 12px 42px;border:1px solid transparent;border-radius:12px;font-size:14px;font-weight:500;line-height:1.5;animation:hdt-note-in .22s ease-out both}
.hdt-note::before{content:"";position:absolute;top:13px;left:14px;width:18px;height:18px;background:currentColor;-webkit-mask:var(--hdt-note-icon) center/contain no-repeat;mask:var(--hdt-note-icon) center/contain no-repeat}
.hdt-note[data-tone="success"]{--hdt-note-icon:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Cpath d='M10 1.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17Zm3.7 5.3a1 1 0 0 0-1.4 0L8.9 10.2 7.7 9a1 1 0 1 0-1.4 1.4l1.9 1.9a1 1 0 0 0 1.4 0l4.1-4.1a1 1 0 0 0 0-1.4Z'/%3E%3C/svg%3E");border-color:#b7e2c8;background:#f1faf4;color:#14532d}
.hdt-note[data-tone="error"]{--hdt-note-icon:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Cpath d='M10 1.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17Zm0 11.75a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2ZM10 5a1 1 0 0 0-1 1v5a1 1 0 1 0 2 0V6a1 1 0 0 0-1-1Z'/%3E%3C/svg%3E");border-color:#f5c6be;background:#fff6f4;color:#7c1d10}
.hdt-note[data-tone="error"]::before{background:#d92d20}.hdt-note[data-tone="success"]::before{background:#1f9254}
@keyframes hdt-note-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
@media(prefers-reduced-motion:reduce){.hdt-note{animation:none}}
.hdt-cancel{border-top:4px solid #f0b400}
.hdt-cancel[data-status="Approved"]{border-top-color:var(--blue)}.hdt-cancel[data-status="Rejected"]{border-top-color:#b3261e}.hdt-cancel[data-status="Cancelled"],.hdt-cancel[data-status="Updated"],.hdt-cancel[data-status="Received"]{border-top-color:var(--ok)}.hdt-cancel[data-status="Label sent"]{border-top-color:var(--blue)}.hdt-cancel[data-status="Shipped"]{border-top-color:var(--ok)}
.hdt-button{display:inline-block;padding:12px 22px;border-radius:6px;background:var(--accent);color:#fff;font-weight:600;text-decoration:none}
.hdt-pill[data-status="Updated"]{background:#e3f5ea;color:var(--ok)}
.hdt-cancel-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.hdt-pill[data-status="Pending"]{background:#fff4d6;color:#7a5600}.hdt-pill[data-status="Approved"]{background:#e6effc;color:#1d4f94}
.hdt-pill[data-status="Rejected"]{background:#fde8e5;color:#b3261e}.hdt-pill[data-status="Cancelled"]{background:#e3f5ea;color:var(--ok)}
.hdt-cancel ol{display:grid;gap:10px;margin-top:16px;padding:0;list-style:none}
.hdt-cancel li{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:14px}
.hdt-cancel li b{display:grid;place-items:center;flex:none;width:24px;height:24px;border-radius:50%;border:2px solid var(--line);font-size:11px}
.hdt-cancel li[data-done]{color:var(--ink)}.hdt-cancel li[data-done] b{border-color:var(--ok);background:var(--ok);color:#fff}
.hdt-cancel li[data-current]{color:var(--ink);font-weight:700}.hdt-cancel li[data-current] b{border-color:var(--accent);background:var(--accent);color:#fff}
.hdt-cancel li[data-rejected] b{border-color:#b3261e;background:#b3261e;color:#fff}
.hdt .hdt-cancel p{margin-top:12px;color:var(--muted);font-size:14px}
.hdt-cancel blockquote{margin:12px 0 0;padding:12px 14px;border-radius:12px;background:var(--soft);font-size:14px;overflow-wrap:anywhere}
.hdt-lookup{max-width:500px;margin:0 auto}
.hdt-lookup form{display:grid;gap:14px;margin-top:20px}
@media (max-width:880px){.hdt-chatbox .hdt-thread{max-height:none}}
@media (max-width:560px){.hdt-steps li{font-size:11px}.hdt button{width:100%}.hdt .hdt-send{width:50px}.hdt-actions{display:block}.hdt-hint{display:none}.hdt-body{max-width:90%}.hdt-chatbox{right:12px;bottom:12px;width:min(420px,calc(100vw - 24px));height:min(620px,calc(100dvh - 40px));min-height:300px}.hdt-chat-launcher{right:16px;bottom:16px}}
.hdt-toast{position:fixed;left:50%;bottom:24px;z-index:9999;transform:translateX(-50%);padding:12px 20px;border-radius:999px;background:#172351;color:#fff;font-size:14px;font-weight:600;box-shadow:0 10px 30px rgba(23,35,81,.3);transition:opacity .4s ease,transform .4s ease}
.hdt-toast[data-hide]{opacity:0;transform:translate(-50%,10px)}
.hdt-msg[data-fresh] .hdt-body{animation:hdt-fresh 2.4s ease}
.hdt-msg[data-pending] .hdt-body{opacity:.75}
@keyframes hdt-fresh{0%{box-shadow:0 0 0 4px rgba(239,58,36,.35)}100%{box-shadow:0 0 0 0 rgba(239,58,36,0)}}
@media (prefers-reduced-motion:reduce){.hdt button,.hdt-toast{transition:none}.hdt button.hdt-chat-launcher,.hdt button.hdt-chat-launcher::before,.hdt button.hdt-chat-launcher::after{animation:none}.hdt button.hdt-chat-launcher::before,.hdt button.hdt-chat-launcher::after{display:none}.hdt[data-chat-open] .hdt-chatbox{animation:none}.hdt-msg[data-fresh] .hdt-body,.hdt-dots i,.hdt .hdt-typing{animation:none}}
</style>`;

// Live like a chat: local times, photo counts, replies sent without a reload,
// and new messages from the team appearing on their own. Without JavaScript
// the page and its form still work as plain HTML.
const SCRIPT = `<script>
(function () {
  var full = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  var day = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
  var clock = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });
  var weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  function dayLabel(value) {
    var today = new Date();
    var yesterday = new Date(today.getTime() - 86400000);
    if (value.toDateString() === today.toDateString()) return 'Today';
    if (value.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return value.getFullYear() === today.getFullYear() ? weekday.format(value) : day.format(value);
  }
  // Day dividers in the shopper's own time zone, like a chat app.
  function dividers(scope) {
    var thread = scope.querySelector('.hdt-thread');
    if (!thread) return;
    thread.querySelectorAll('.hdt-day').forEach(function (node) { node.remove(); });
    var last = '';
    thread.querySelectorAll('.hdt-msg[data-at]').forEach(function (node) {
      var value = new Date(node.getAttribute('data-at'));
      if (isNaN(value) || value.toDateString() === last) return;
      last = value.toDateString();
      var label = document.createElement('p');
      label.className = 'hdt-day';
      label.textContent = dayLabel(value);
      thread.insertBefore(label, node);
      node.removeAttribute('data-grouped');
    });
  }
  function toBottom(smooth) {
    var thread = root && root.querySelector('.hdt-thread');
    if (thread) thread.scrollTo({ top: thread.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }
  function atBottom() {
    var thread = root && root.querySelector('.hdt-thread');
    return !thread || thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
  }
  function enhance(scope) {
    scope.querySelectorAll('[data-hdt-time]').forEach(function (node) {
      var value = new Date(node.getAttribute('datetime'));
      var style = node.getAttribute('data-hdt-time');
      if (!isNaN(value)) node.textContent = (style === 'date' ? day : style === 'clock' ? clock : full).format(value);
    });
    dividers(scope);
    scope.querySelectorAll('.hdt-drop input').forEach(function (input) {
      if (input.dataset.hdtBound) return;
      input.dataset.hdtBound = '1';
      input.addEventListener('change', function () {
        var label = input.closest('.hdt-drop').querySelector('strong');
        var count = input.files ? input.files.length : 0;
        var video = input.name === 'videos';
        label.textContent = video ? (count ? 'Video selected' : 'Add a video') : count ? count + (count === 1 ? ' photo selected' : ' photos selected') : 'Add photos';
      });
    });
    bindForm(scope);
  }

  var root = document.querySelector('.hdt[data-hdt-stamp]');
  var stamp = root ? root.getAttribute('data-hdt-stamp') : '';
  var token = root ? root.getAttribute('data-hdt-token') : '';
  var base = window.location.pathname;
  var busy = false;

  function toast(text) {
    var node = document.createElement('div');
    node.className = 'hdt-toast';
    node.setAttribute('role', 'status');
    node.textContent = text;
    node.addEventListener('click', function () { toBottom(true); node.remove(); });
    document.body.appendChild(node);
    setTimeout(function () { node.setAttribute('data-hide', ''); }, 3500);
    setTimeout(function () { node.remove(); }, 4200);
  }

  function note(foot, tone, text) {
    var old = foot.querySelector('.hdt-note');
    if (old) old.remove();
    var node = document.createElement('div');
    node.className = 'hdt-note';
    node.setAttribute('data-tone', tone);
    node.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    node.textContent = text;
    foot.insertBefore(node, foot.firstChild);
  }

  function typing() {
    var text = root.querySelector('.hdt-foot textarea');
    var file = root.querySelector('.hdt-foot input[type=file]');
    return Boolean((text && text.value.trim()) || (file && file.files && file.files.length));
  }

  // Swaps in the latest conversation; a reply being typed is never thrown away.
  function refresh(fromTeam) {
    if (busy) return Promise.resolve();
    busy = true;
    return fetch(base + '?ticket=' + encodeURIComponent(token) + '&live=1', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (response) { return response.text(); })
      .then(function (html) {
        var next = new DOMParser().parseFromString(html, 'text/html').querySelector('.hdt[data-hdt-stamp]');
        if (!next) return;
        // The app was updated since this page opened: load it afresh, styles and all.
        if (next.getAttribute('data-hdt-version') !== root.getAttribute('data-hdt-version') && !typing()) { location.reload(); return; }
        var stick = !fromTeam || atBottom();
        var thread = root.querySelector('.hdt-thread');
        var keep = thread ? thread.scrollTop : 0;
        ['.hdt-hero', '.hdt-chat-head', '.hdt-thread', '.hdt-aside', '.hdt-chat-launcher'].forEach(function (selector) {
          var current = root.querySelector(selector);
          var fresh = next.querySelector(selector);
          if (current && fresh) current.innerHTML = fresh.innerHTML;
        });
        var foot = root.querySelector('.hdt-foot');
        var freshFoot = next.querySelector('.hdt-foot');
        if (foot && freshFoot && !typing()) foot.innerHTML = freshFoot.innerHTML;
        stamp = next.getAttribute('data-hdt-stamp');
        root.setAttribute('data-hdt-stamp', stamp);
        enhance(root);
        themeButton(root.getAttribute('data-chat-theme'));
        renderTyping();
        if (stick) toBottom(true);
        else if (root.querySelector('.hdt-thread')) root.querySelector('.hdt-thread').scrollTop = keep;
        if (fromTeam) {
          toast(stick ? 'New message from our team' : 'New message from our team ↓');
          var last = root.querySelector('.hdt-thread > .hdt-msg:last-of-type');
          if (last) last.setAttribute('data-fresh', '');
        }
      })
      .catch(function () {})
      .then(function () { busy = false; });
  }

  // "Our team is typing" / "Assistant is typing": three dots at the end of the
  // chat. sendingName covers the wait after the customer sends, while the
  // assistant works on its reply.
  var typingName = '';
  var sendingName = '';
  function renderTyping() {
    var thread = root && root.querySelector('.hdt-thread');
    if (!thread) return;
    var name = sendingName || typingName;
    var bubble = thread.querySelector('.hdt-typing');
    if (!name) { if (bubble) bubble.remove(); return; }
    if (!bubble) {
      bubble = document.createElement('div');
      bubble.className = 'hdt-typing';
      bubble.setAttribute('role', 'status');
      var dots = document.createElement('span');
      dots.className = 'hdt-dots';
      dots.setAttribute('aria-hidden', 'true');
      dots.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
      var label = document.createElement('span');
      label.className = 'hdt-typing-name';
      var face = document.createElement('span');
      face.className = 'hdt-ava';
      face.setAttribute('aria-hidden', 'true');
      bubble.append(face, dots, label);
    }
    // The assistant's logo, or the first letter of the person's name, as a capital.
    var ava = bubble.querySelector('.hdt-ava');
    if (name === 'Assistant') { ava.setAttribute('data-bot', ''); ava.textContent = ''; }
    else {
      ava.removeAttribute('data-bot');
      var first = '?';
      for (var i = 0; i < name.length; i++) {
        var ch = name.charAt(i);
        if (ch.toUpperCase() !== ch.toLowerCase() || (ch >= '0' && ch <= '9')) { first = ch.toUpperCase(); break; }
      }
      ava.textContent = first;
    }
    bubble.querySelector('.hdt-typing-name').textContent = name + ' is typing';
    var stick = atBottom();
    thread.append(bubble);
    if (stick) toBottom(true);
  }

  // Tells the team the customer is typing, at most every couple of seconds.
  var lastTypingPing = 0;
  function pingTyping() {
    if (!token || Date.now() - lastTypingPing < 2000) return;
    lastTypingPing = Date.now();
    fetch(base + '?ticket=' + encodeURIComponent(token) + '&typing=1', { headers: { Accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store' }).catch(function () {});
  }

  function check() {
    if (!root || busy || document.visibilityState !== 'visible') return;
    fetch(base + '?ticket=' + encodeURIComponent(token) + '&pulse=1', { headers: { Accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store' })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) {
        if (!data) return;
        var next = typeof data.typing === 'string' ? data.typing : '';
        if (next !== typingName) { typingName = next; renderTyping(); }
        if (data.stamp && data.stamp !== stamp) refresh(true);
      })
      .catch(function () {});
  }

  // Sends a reply in the background and shows it straight away.
  function bindForm(scope) {
    var form = scope.querySelector('.hdt-foot form');
    if (!form || form.dataset.hdtBound || !root) return;
    form.dataset.hdtBound = '1';
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var foot = form.closest('.hdt-foot');
      // The button pressed: Send, or Talk to a person (sent along as person=1).
      var button = event.submitter || form.querySelector('.hdt-send');
      var body = new FormData(form);
      if (button && button.name) body.set(button.name, button.value);
      var text = form.querySelector('textarea');
      // Nothing written or attached: nothing to send.
      if (!(button && button.name) && !typing()) { if (text) text.focus(); return; }
      var buttons = form.querySelectorAll('button[type=submit]');
      buttons.forEach(function (each) { each.disabled = true; });
      form.setAttribute('aria-busy', 'true');
      // The message appears in the chat at once, marked as sending, and is
      // swapped for the saved one when the server answers.
      var thread = root.querySelector('.hdt-thread');
      var pending = null;
      if (thread && text && text.value.trim()) {
        pending = document.createElement('div');
        pending.className = 'hdt-msg';
        pending.setAttribute('data-kind', 'customer');
        pending.setAttribute('data-pending', '');
        var bubble = document.createElement('div');
        bubble.className = 'hdt-body';
        var who = document.createElement('div');
        who.className = 'hdt-who';
        who.textContent = 'You';
        var said = document.createElement('p');
        said.style.whiteSpace = 'pre-wrap';
        said.textContent = text.value.trim();
        var meta = document.createElement('span');
        meta.className = 'hdt-meta';
        meta.textContent = 'Sending...';
        bubble.append(who, said, meta);
        pending.append(bubble);
        thread.append(pending);
        toBottom(true);
        sendingName = 'Assistant';
        renderTyping();
      }
      fetch(form.action, { method: 'POST', body: body, headers: { Accept: 'application/json' }, credentials: 'same-origin' })
        .then(function (response) {
          return response.text().then(function (text) {
            var data = null;
            try { data = JSON.parse(text); } catch (error) { data = null; }
            return { ok: response.ok, data: data };
          });
        })
        .then(function (result) {
          if (!result.ok) {
            if (pending) pending.remove();
            var errors = result.data && result.data.errors ? Object.keys(result.data.errors).map(function (key) { return result.data.errors[key]; }) : [];
            note(foot, 'error', errors[0] || 'Your message could not be sent. Please try again.');
            return;
          }
          form.reset();
          return refresh(false).then(function () {
            sendingName = '';
            renderTyping();
            var box = root.querySelector('.hdt-foot textarea');
            if (box) box.focus({ preventScroll: true });
          });
        })
        .catch(function () { if (pending) pending.remove(); note(foot, 'error', 'Your message could not be sent. Check your connection and try again.'); })
        .then(function () { if (sendingName) { sendingName = ''; renderTyping(); } })
        .then(function () { buttons.forEach(function (each) { each.disabled = false; }); form.removeAttribute('aria-busy'); });
    });
  }

  // Enter sends, Shift + Enter starts a new line; the box grows with the message.
  function grow(box) {
    box.style.height = 'auto';
    var height = Math.max(50, Math.min(box.scrollHeight + 2, 160));
    box.style.height = height + 'px';
    box.style.overflowY = box.scrollHeight > 160 ? 'auto' : 'hidden';
  }
  // The chat's light or dark look: the customer's choice, else their device's.
  function themeButton(theme) {
    var button = root.querySelector('.hdt-theme');
    if (!button) return;
    var label = theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
  }
  function setTheme(theme, save) {
    root.setAttribute('data-chat-theme', theme);
    themeButton(theme);
    if (save) { try { localStorage.setItem('hdt-chat-theme', theme); } catch (error) { /* private mode */ } }
  }
  if (root) {
    var savedTheme = null;
    try { savedTheme = localStorage.getItem('hdt-chat-theme'); } catch (error) { /* private mode */ }
    setTheme(savedTheme === 'light' || savedTheme === 'dark' ? savedTheme
      : window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark', false);
    root.addEventListener('click', function (event) {
      if (event.target.closest && event.target.closest('.hdt-theme')) {
        setTheme(root.getAttribute('data-chat-theme') === 'light' ? 'dark' : 'light', true);
        return;
      }
      // A suggested question or quick reply: sent as the customer's message.
      var chip = event.target.closest && event.target.closest('.hdt-chip');
      if (chip) {
        var box = root.querySelector('.hdt-foot textarea');
        var replyForm = box && box.form;
        if (!replyForm || chip.disabled) return;
        box.value = chip.getAttribute('data-ask') || chip.textContent;
        root.querySelectorAll('.hdt-chip').forEach(function (other) { other.disabled = true; });
        if (replyForm.requestSubmit) replyForm.requestSubmit(); else replyForm.submit();
        return;
      }
      var closeChat = event.target.closest && event.target.closest('.hdt-chat-close');
      if (closeChat) {
        root.removeAttribute('data-chat-open');
        root.removeAttribute('data-chat-expanded');
        document.body.style.overflow = '';
        var launcher = root.querySelector('.hdt-chat-launcher');
        if (launcher) { launcher.setAttribute('aria-expanded', 'false'); launcher.focus(); }
        return;
      }
      var openChat = event.target.closest && event.target.closest('.hdt-chat-launcher');
      if (openChat) {
        root.setAttribute('data-chat-open', '');
        openChat.setAttribute('aria-expanded', 'true');
        toBottom(false);
        var input = root.querySelector('.hdt-chatbox .hdt-foot textarea');
        if (input) window.setTimeout(function () { input.focus({ preventScroll: true }); }, 30);
        return;
      }
      var button = event.target.closest && event.target.closest('.hdt-expand');
      if (!button) return;
      var expanded = root.hasAttribute('data-chat-expanded');
      if (expanded) {
        root.removeAttribute('data-chat-expanded');
        document.body.style.overflow = '';
      } else {
        root.setAttribute('data-chat-expanded', '');
        document.body.style.overflow = 'hidden';
        toBottom(false);
      }
      button.setAttribute('aria-pressed', String(!expanded));
      button.setAttribute('aria-label', expanded ? 'Full screen' : 'Exit full screen');
      button.setAttribute('title', expanded ? 'Full screen' : 'Exit full screen');
    });
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape' || (!root.hasAttribute('data-chat-expanded') && !root.hasAttribute('data-chat-open'))) return;
      var wasExpanded = root.hasAttribute('data-chat-expanded');
      root.removeAttribute('data-chat-expanded');
      var closable = Boolean(root.querySelector('.hdt-chat-close'));
      if (closable) root.removeAttribute('data-chat-open');
      document.body.style.overflow = '';
      var launcher = root.querySelector('.hdt-chat-launcher');
      if (launcher && closable) { launcher.setAttribute('aria-expanded', 'false'); launcher.focus(); }
      if (!wasExpanded) return;
      var button = root.querySelector('.hdt-expand');
      if (button) {
        button.setAttribute('aria-pressed', 'false');
        button.setAttribute('aria-label', 'Full screen');
        button.setAttribute('title', 'Full screen');
      }
    });
    root.addEventListener('keydown', function (event) {
      var box = event.target;
      if (!box.matches || !box.matches('.hdt-foot textarea')) return;
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      var form = box.form;
      var send = form && form.querySelector('.hdt-send');
      if (send && !send.disabled) form.requestSubmit(send);
    });
    root.addEventListener('input', function (event) {
      if (event.target.matches && event.target.matches('.hdt-foot textarea')) {
        grow(event.target);
        if (event.target.value.trim()) pingTyping();
      }
    });
  }

  // Pinned under the store's header when the theme keeps it on screen.
  function pinUnderHeader() {
    if (!root) return;
    var top = 16;
    document.querySelectorAll('header, .header, .site-header, sticky-header, .shopify-section-header, .section-header').forEach(function (node) {
      var style = getComputedStyle(node);
      var rect = node.getBoundingClientRect();
      if ((style.position === 'fixed' || style.position === 'sticky') && rect.top <= 1 && rect.bottom > 0 && rect.height < window.innerHeight / 3) top = Math.max(top, Math.round(rect.bottom) + 12);
    });
    root.style.setProperty('--hdt-top', top + 'px');
  }
  pinUnderHeader();
  window.addEventListener('resize', pinUnderHeader);
  window.addEventListener('scroll', function () { if (!pinUnderHeader.queued) { pinUnderHeader.queued = true; requestAnimationFrame(function () { pinUnderHeader.queued = false; pinUnderHeader(); }); } }, { passive: true });

  enhance(document.querySelector('.hdt') || document);
  toBottom(false);
  if (root && token) {
    setInterval(check, 1000);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
  }
})();
</script>`;

// The page's look and script, as a short fingerprint: an open page whose live
// refresh brings a different one reloads, so new markup never meets old styles.
const PAGE_VERSION = (() => {
  let hash = 0;
  for (const char of STYLES + SCRIPT) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
  return (hash >>> 0).toString(36);
})();
const page = (title: string, body: string, attributes = "") => `{% layout 'theme' %}${STYLES}
<section class="hdt" aria-label="${escape(title)}" data-hdt-version="${PAGE_VERSION}"${attributes}>${body}</section>${SCRIPT}`;

// What the live check compares: the status, how many public messages there are and the newest one.
// photos: staff allowed photo uploads, so the reply box changes too; decisions: cancellation|address decisions.
// videos: staff allowed a video too.
export const liveStamp = (status: string, count: number, latestId = "", photos = false, cancel = "", videos = false) => `${status}:${count}:${latestId}:${photos ? 1 : 0}${videos ? "v" : ""}:${cancel}`;

const note = (state: { sent?: boolean; error?: string }) => state.sent ? `<div class="hdt-note" data-tone="success" role="status">Thanks, your message has been sent to our team.</div>`
  : state.error ? `<div class="hdt-note" data-tone="error" role="alert">${escape(state.error)}</div>` : "";

// Finding a request without its link: ticket number plus email.
// Buttons that send their words as the customer's message (the page script).
const chips = (asks: string[], className: string, label: string) => asks.length
  ? `<div class="${className}" role="group" aria-label="${escape(label)}">${asks.map((ask) => `<button type="button" class="hdt-chip" data-ask="${escape(ask)}">${escape(ask)}</button>`).join("")}</div>` : "";
// Ways to start a chat, and to answer the assistant's answer.
const STARTERS = ["Where is my order?", "Cancel my order", "Return or exchange", "Talk to a person"];
const FOLLOW_UPS = ["That helped, thanks", "Talk to a person"];

// The assistant's message: its paragraphs, and the questions it offers ("It
// might be one of these:", "for example:" and a "- " list) as buttons to ask them.
const SUGGESTIONS_LEAD = /(one of these|for example)[^:\n]*:\s*$/i;
function botBody(text: string) {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let paragraph: string[] = [];
  const flush = () => { if (paragraph.length) out.push(`<p>${paragraph.map(escape).join("<br>")}</p>`); paragraph = []; };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (SUGGESTIONS_LEAD.test(line) && lines[index + 1]?.startsWith("- ")) {
      paragraph.push(line);
      flush();
      const asks: string[] = [];
      while (lines[index + 1]?.startsWith("- ")) asks.push(lines[++index].slice(2).trim());
      out.push(chips(asks.filter(Boolean).slice(0, 6), "hdt-chips", "Suggested questions"));
    } else if (!line.trim()) flush();
    else paragraph.push(line);
  }
  flush();
  return out.join("");
}

export function renderLookupPage(state: { error?: string; number?: string; email?: string } = {}) {
  return page("Find your request", `
<div class="hdt-card hdt-hero hdt-lookup">
<p class="hdt-eyebrow"><span class="hdt-chip">Help Desk</span></p>
<h1>Find your request</h1>
<p class="hdt-lead">Enter the request number from your confirmation email and the email address you used.</p>
<form method="post" action="?ticket=">
${note(state)}
<input type="hidden" name="intent" value="lookup">
<label>Request number<input name="number" required inputmode="numeric" placeholder="e.g. 1001" value="${escape(state.number ?? "")}"></label>
<label>Email<input name="email" type="email" required autocomplete="email" placeholder="name@example.com" value="${escape(state.email ?? "")}"></label>
<div class="hdt-actions"><button type="submit">Find my request</button></div>
</form></div>`);
}

export type PageProduct = { id: string; title: string; image: string };
export type RequestPageTicket = {
  number: number; topic: string; status: string; channel: string; createdAt: Date; accessToken: string; details: string;
  // What the request is about, as the team files it ("Lost Package"): the tag on the customer's first message.
  subcategory?: string;
  // Staff turned on photo uploads for this request.
  allowPhotos?: boolean;
  // When the customer was passed to the team by the chat assistant, until someone replies.
  humanRequestedAt?: Date | null;
  // ...and a video.
  allowVideos?: boolean;
  // An order cancellation request: Pending, Approved, Rejected or Cancelled, and what the team said.
  cancelStatus?: string; cancelNote?: string; cancelDecidedAt?: Date | null;
  // A shipping address change: Pending, Updated or Rejected, the team's note and the address set in Shopify (JSON).
  addressStatus?: string; addressNote?: string; addressApplied?: string; addressDecidedAt?: Date | null;
  // A damaged or defective item sent back: Pending, Label sent, Received or Rejected, the team's note and the label it sent.
  returnStatus?: string; returnNote?: string; returnLabelId?: string; returnDecidedAt?: Date | null;
  // An order edit: Pending, Updated or Rejected, and what the team said.
  editStatus?: string; editNote?: string; editDecidedAt?: Date | null;
  // A missing part: Pending, Approved, Shipped or Rejected, the team's note and the replacement's tracking.
  replacementStatus?: string; replacementNote?: string; replacementCarrier?: string; replacementTracking?: string; replacementTrackingUrl?: string; replacementDecidedAt?: Date | null;
  // missing or warranty, and the solution approved for a warranty claim.
  replacementKind?: string; replacementSolution?: string;
  // An international shipping quote: Pending, Quoted or Unavailable, and what the team sent.
  quoteStatus?: string; quoteCarrier?: string; quoteDelivery?: string; quoteShipping?: string; quoteTaxes?: string; quoteNote?: string; quoteDecidedAt?: Date | null;
  messages: { id: string; kind: string; author: string; body: string; createdAt: Date }[];
};
// The order's latest shipment, shown only when the order was placed with the
// request's email (orderVerified), so a typed order number never reveals
// someone else's delivery.
export type PageShipment = { order: string; status: string; carrier: string; number: string; url: string };
export type RequestPageExtras = {
  imageCounts: Map<string, number>; requestImages: number; products: PageProduct[]; receivedProducts: PageProduct[];
  canReply: boolean; maxImages: number; maxLength: number; state?: { sent?: boolean; error?: string; draft?: string };
  shipment?: PageShipment | null;
};

const safeUrl = (url: string) => /^https:\/\//i.test(url) ? url : "";
function shipmentCard(shipment: PageShipment | null | undefined) {
  if (!shipment || !(shipment.status || shipment.number)) return "";
  const rows = [
    ["Order", shipment.order], ["Status", shipment.status], ["Carrier", shipment.carrier], ["Tracking number", shipment.number],
  ].filter(([, value]) => value).map(([label, value]) => `<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join("");
  const link = safeUrl(shipment.url);
  return `<div class="hdt-card hdt-pad"><h2>Shipment</h2><dl style="margin-top:8px">${rows}</dl>${link ? `<p class="hdt-track"><a href="${escape(link)}" target="_blank" rel="noopener">Track package</a></p>` : ""}</div>`;
}

const CANCEL_COPY: Record<string, string> = {
  Pending: "Pending review: your order has not been cancelled yet. Our team will check that it hasn't shipped, then let you know here and by email.",
  Approved: "Your cancellation is approved. We're cancelling it now and will confirm here and by email when it's done.",
  Rejected: "We weren't able to cancel this order.",
  Cancelled: "Cancelled. If a refund is due, it's on its way: refunds to a card usually appear within 5-10 business days.",
};

const ADDRESS_COPY: Record<string, string> = {
  Pending: "Pending review: your shipping address has not been changed yet. Our team will check that your order hasn't been packed or labelled, then let you know here and by email.",
  Updated: "Your order's shipping address has been updated. It will be delivered to:",
  Rejected: "We weren't able to change the shipping address of this order.",
};

// Where the customer's shipping address change stands, with the address.
function addressCard(ticket: RequestPageTicket, values: Record<string, string>) {
  const status = ticket.addressStatus;
  if (!status) return "";
  let applied: Partial<ShippingAddress> | null = null;
  try { applied = ticket.addressApplied ? JSON.parse(ticket.addressApplied) as Partial<ShippingAddress> : null; } catch { applied = null; }
  const lines = addressLines(status === "Updated" && applied ? applied : addressFromValues(values));
  return `<div class="hdt-card hdt-pad hdt-cancel" data-status="${escape(status)}" data-kind="address">
<div class="hdt-cancel-head"><h2>Address change</h2><span class="hdt-pill" data-status="${escape(status)}"><i></i>${escape(status)}</span></div>
<p>${escape(ADDRESS_COPY[status] ?? "")}</p>${lines.length ? `<blockquote>${lines.map(escape).join("<br>")}</blockquote>` : ""}
${ticket.addressNote ? `<blockquote>${multiline(ticket.addressNote)}</blockquote>` : ""}
${ticket.addressDecidedAt ? `<p>Updated ${time(ticket.addressDecidedAt)}</p>` : ""}</div>`;
}

const RETURN_COPY: Record<string, string> = {
  Pending: "Pending review: our team is checking that your return meets the conditions (unused, in its original packaging). Please wait for our confirmation before sending anything back: once it's approved, we'll send your return label here and by email.",
  "Label sent": "Your return is approved. Print the label, attach it to the package and send it to our warehouse. Once received, our team will inspect the product and proceed with your refund or exchange.",
  Received: "We've received your return and inspected the product. We're now proceeding with your refund or exchange.",
  Rejected: "We weren't able to accept this return.",
};

// Where the customer's return stands, with its label once it's approved.
function returnCard(ticket: RequestPageTicket, order: string) {
  const status = ticket.returnStatus;
  if (!status) return "";
  const rejected = status === "Rejected";
  const steps = rejected ? ["Requested", "Not accepted"] : ["Requested", "Label sent", "Received", "Refund or exchange"];
  const current = rejected ? 1 : ["", "Pending", "Label sent", "Received"].indexOf(status);
  const list = steps.map((label, index) => {
    const done = index < current;
    const attributes = rejected && index === 1 ? " data-rejected" : done ? " data-done" : index === current ? " data-current" : "";
    return `<li${attributes}><b>${rejected && index === 1 ? "✕" : done ? "✓" : index + 1}</b>${label}</li>`;
  }).join("");
  const label = status === "Label sent" && ticket.returnLabelId
    ? `<div class="hdt-actions"><a class="hdt-button" href="?ticket=${escape(ticket.accessToken)}&amp;label=1" download>Download return label</a></div>` : "";
  return `<div class="hdt-card hdt-pad hdt-cancel" data-status="${escape(status)}" data-kind="return">
<div class="hdt-cancel-head"><h2>Return</h2><span class="hdt-pill" data-status="${escape(status)}"><i></i>${escape(status)}</span></div>
${order ? `<p>${escape(order)}</p>` : ""}<ol aria-label="Return progress">${list}</ol>
<p>${escape(RETURN_COPY[status] ?? "")}</p>${label}${ticket.returnNote ? `<blockquote>${multiline(ticket.returnNote)}</blockquote>` : ""}
${ticket.returnDecidedAt ? `<p>Updated ${time(ticket.returnDecidedAt)}</p>` : ""}</div>`;
}

// A return for a refund: when the money comes back.
function refundCard(values: Record<string, string>) {
  if (values.resolution !== "Refund") return "";
  return `<div class="hdt-card hdt-pad hdt-help"><h2>Your refund</h2><p>${escape(REFUND_DISCLAIMER)}</p><p>We refund to your original payment method once the product is received and checked.</p></div>`;
}

const EDIT_COPY: Record<string, string> = {
  Pending: "Pending review: your order hasn't been changed yet. Our team will check it's still at our warehouse and confirm any price difference with you before updating it.",
  Updated: "Your order has been updated with the changes below.",
  Rejected: "We weren't able to change this order.",
};

// Where the customer's order edit stands, with the changes asked for.
function editCard(ticket: RequestPageTicket, values: Record<string, string>) {
  const status = ticket.editStatus;
  if (!status) return "";
  const changes = parseEditRequest(values.editRequest);
  const lines = [
    ...changes.lines.map((line) => `${line.title}: ${line.action === "Remove" ? "remove" : line.action === "Change quantity" ? `quantity ${line.quantity}` : `change to ${line.variant}`}`),
    ...changes.adds.map((add) => `Add ${add.title} × ${add.quantity}`),
  ];
  return `<div class="hdt-card hdt-pad hdt-cancel" data-status="${escape(status)}" data-kind="edit">
<div class="hdt-cancel-head"><h2>Order changes</h2><span class="hdt-pill" data-status="${escape(status)}"><i></i>${escape(status)}</span></div>
<p>${escape(EDIT_COPY[status] ?? "")}</p>${lines.length ? `<blockquote>${lines.map(escape).join("<br>")}</blockquote>` : ""}
${ticket.editNote ? `<blockquote>${multiline(ticket.editNote)}</blockquote>` : ""}
${ticket.editDecidedAt ? `<p>Updated ${time(ticket.editDecidedAt)}</p>` : ""}</div>`;
}

const REPLACEMENT_COPY: Record<string, string> = {
  Pending: "Pending review: our team is checking whether the part is still in transit or was in the original shipment, and will confirm your replacement here and by email.",
  Approved: "Your replacement is approved. We're arranging the shipment and will share the tracking details here and by email.",
  Shipped: "Your replacement part is on its way.",
  Rejected: "We weren't able to send a replacement for this part.",
};

const LOST_COPY: Record<string, string> = {
  Pending: "Pending review: our team is checking your order's shipment with the carrier, and will confirm the next steps here and by email.",
  Approved: "Your request is approved. We'll share the next steps (and the tracking, if we're sending it again) here and by email.",
  Shipped: "Here are the next steps for your lost package.",
  Rejected: "We weren't able to approve this request.",
};
const WARRANTY_COPY: Record<string, string> = {
  Pending: "Pending review: our team is checking the purchase date and warranty coverage, and will confirm here and by email whether a replacement, repair or other solution is available.",
  Approved: "Your warranty claim is approved. We'll share the instructions and shipping details here and by email.",
  Shipped: "Here are the next steps for your warranty claim.",
  Rejected: "We weren't able to approve this warranty claim.",
};

// Where the customer's missing part (or warranty claim) stands, with the tracking.
function replacementCard(ticket: RequestPageTicket) {
  const status = ticket.replacementStatus;
  if (!status) return "";
  const warranty = ticket.replacementKind === "warranty";
  const lost = ticket.replacementKind === "lost";
  const rejected = status === "Rejected";
  const steps = rejected ? ["Requested", "Not possible"] : ["Requested", "Approved", warranty || lost ? "Next steps" : "Shipped"];
  const current = rejected ? 1 : ["", "Pending", "Approved", "Shipped"].indexOf(status);
  const list = steps.map((label, index) => {
    const done = index < current || (status === "Shipped" && index === 2);
    const attributes = rejected && index === 1 ? " data-rejected" : done ? " data-done" : index === current ? " data-current" : "";
    return `<li${attributes}><b>${rejected && index === 1 ? "✕" : done ? "✓" : index + 1}</b>${label}</li>`;
  }).join("");
  const link = safeUrl(ticket.replacementTrackingUrl ?? "");
  const tracking = ticket.replacementTracking ? `<dl style="margin-top:8px">${ticket.replacementCarrier ? `<div><dt>Carrier</dt><dd>${escape(ticket.replacementCarrier)}</dd></div>` : ""}<div><dt>Tracking number</dt><dd>${escape(ticket.replacementTracking)}</dd></div></dl>${link ? `<p class="hdt-track"><a href="${escape(link)}" target="_blank" rel="noopener">Track shipment</a></p>` : ""}` : "";
  return `<div class="hdt-card hdt-pad hdt-cancel" data-status="${escape(status)}" data-kind="replacement">
<div class="hdt-cancel-head"><h2>${warranty ? "Warranty claim" : lost ? "Lost package" : "Replacement part"}</h2><span class="hdt-pill" data-status="${escape(status)}"><i></i>${escape((warranty || lost) && status === "Shipped" ? "Next steps" : status)}</span></div>
<ol aria-label="${warranty ? "Warranty claim" : lost ? "Lost package" : "Replacement"} progress">${list}</ol>
<p>${escape((warranty ? WARRANTY_COPY : lost ? LOST_COPY : REPLACEMENT_COPY)[status] ?? "")}</p>${(warranty || lost) && ticket.replacementSolution && status !== "Rejected" ? `<p><strong>${lost && status === "Pending" ? "You asked for" : "Solution"}:</strong> ${escape(ticket.replacementSolution)}</p>` : ""}${tracking}${ticket.replacementNote ? `<blockquote>${multiline(ticket.replacementNote)}</blockquote>` : ""}
${ticket.replacementDecidedAt ? `<p>Updated ${time(ticket.replacementDecidedAt)}</p>` : ""}</div>`;
}

const QUOTE_COPY: Record<string, string> = {
  Pending: "Pending review: our team is checking product availability and shipping carrier options for your address, and will share the estimated delivery date, shipping costs and taxes here and by email.",
  Quoted: "Here are the shipping details for your address.",
  Unavailable: "We weren't able to ship these products to your address.",
};

// Where the customer's international shipping quote stands, with the details sent.
function quoteCard(ticket: RequestPageTicket) {
  const status = ticket.quoteStatus;
  if (!status) return "";
  const rows = status === "Quoted" ? [["Carrier", ticket.quoteCarrier], ["Estimated delivery", ticket.quoteDelivery], ["Shipping cost", ticket.quoteShipping], ["Taxes and duties", ticket.quoteTaxes]]
    .filter(([, value]) => value).map(([label, value]) => `<div><dt>${label}</dt><dd>${escape(value ?? "")}</dd></div>`).join("") : "";
  return `<div class="hdt-card hdt-pad hdt-cancel" data-status="${escape(status === "Quoted" ? "Updated" : status === "Unavailable" ? "Rejected" : status)}" data-kind="quote">
<div class="hdt-cancel-head"><h2>Shipping details</h2><span class="hdt-pill" data-status="${escape(status)}"><i></i>${escape(status)}</span></div>
<p>${escape(QUOTE_COPY[status] ?? "")}</p>${rows ? `<dl style="margin-top:8px">${rows}</dl>` : ""}${ticket.quoteNote ? `<blockquote>${multiline(ticket.quoteNote)}</blockquote>` : ""}
${ticket.quoteDecidedAt ? `<p>Updated ${time(ticket.quoteDecidedAt)}</p>` : ""}</div>`;
}

// Where the customer's order cancellation request stands.
function cancellationCard(ticket: RequestPageTicket, order: string, items: boolean) {
  const status = ticket.cancelStatus;
  if (!status) return "";
  const rejected = status === "Rejected";
  const steps = rejected ? ["Requested", "Not possible"] : ["Requested", "Approved", "Cancelled"];
  // The step being waited on: the request itself is done once it's sent.
  const current = rejected ? 1 : ["", "Pending", "Approved", "Cancelled"].indexOf(status);
  const list = steps.map((label, index) => {
    const done = index < current;
    const attributes = rejected && index === 1 ? " data-rejected" : done ? " data-done" : index === current ? " data-current" : "";
    return `<li${attributes}><b>${rejected && index === 1 ? "✕" : done ? "✓" : index + 1}</b>${label}</li>`;
  }).join("");
  return `<div class="hdt-card hdt-pad hdt-cancel" data-status="${escape(status)}">
<div class="hdt-cancel-head"><h2>Order cancellation</h2><span class="hdt-pill" data-status="${escape(status)}"><i></i>${escape(status)}</span></div>
${order ? `<p>${escape(order)} · ${items ? "selected items" : "whole order"}</p>` : ""}<ol aria-label="Cancellation progress">${list}</ol>
<p>${escape(CANCEL_COPY[status] ?? "")}</p>${ticket.cancelNote ? `<blockquote>${multiline(ticket.cancelNote)}</blockquote>` : ""}
${ticket.cancelDecidedAt ? `<p>Updated ${time(ticket.cancelDecidedAt)}</p>` : ""}</div>`;
}

const fieldValue = (key: string, value: string) => key === "country" ? countryName(value) : value;
const files = (count: number) => count ? `<span class="hdt-files">📎 ${count} file${count === 1 ? "" : "s"} attached</span>` : "";
const productList = (heading: string, products: PageProduct[]) => products.length ? `<div class="hdt-group"><h3>${escape(heading)}</h3><div class="hdt-products">${products.map((product) => `<div class="hdt-product">${product.image ? `<img src="${escape(product.image)}" alt="" loading="lazy">` : "<i></i>"}<strong>${escape(product.title)}</strong></div>`).join("")}</div></div>` : "";

export function renderRequestPage(ticket: RequestPageTicket, extras: RequestPageExtras) {
  const state = extras.state ?? {};
  const values = JSON.parse(ticket.details) as Record<string, string>;
  const chat = ticket.channel === "chat";
  const copy = STATUS_COPY[ticket.status] ?? { title: ticket.status, text: "" };
  const current = STEPS.findIndex((step) => step.status === ticket.status);
  const resolved = ticket.status === "Resolved";
  const steps = STEPS.map((step, index) => {
    const done = index < current || resolved;
    return `<li${done ? " data-done" : ""}${index === current && !resolved ? " data-current" : ""}><b>${done ? "✓" : index + 1}</b>${step.label}</li>`;
  }).join("");

  // WhatsApp-style bubbles: the customer's own on the right, the team's and the assistant's on the left.
  // Consecutive messages from the same person are grouped; the page script adds day dividers in local time.
  // The customer's own carry no name: they know who they are.
  let previous = "";
  const message = (kind: string, author: string, at: Date, body: string) => {
    const who = kind === "bot" ? "Assistant" : author;
    const tag = kind === "reply" ? `<span class="hdt-tag">Support team</span>` : kind === "bot" ? `<span class="hdt-tag">Automated</span>` : "";
    const grouped = previous === `${kind}:${author}`;
    previous = `${kind}:${author}`;
    // The assistant's logo, or the first letter of the team member's name.
    const avatar = kind === "bot" ? `<span class="hdt-ava" data-bot aria-hidden="true"></span>`
      : kind === "reply" ? `<span class="hdt-ava" aria-hidden="true">${escape(nameInitial(author))}</span>` : "";
    const name = grouped || kind === "customer" ? "" : `<div class="hdt-who">${escape(who)}${tag}</div>`;
    return `<div class="hdt-msg" data-kind="${kind}" data-at="${at.toISOString()}"${grouped ? " data-grouped" : ""}>${avatar}<div class="hdt-body">${name}${body}<span class="hdt-meta">${time(at, "clock")}</span></div></div>`;
  };

  // The customer's original request, as the first message of the conversation.
  const written = MESSAGE_FIELDS.filter((key) => values[key]).map((key) => `<p>${multiline(values[key])}</p>`).join("");
  // Tagged with what it's about, not the form's broad request type (every delivery question was "Where is my order?").
  const facts = [ticket.subcategory ?? "", values.cancelReason, values.resolution].filter(Boolean).map((value) => `<span>${escape(value)}</span>`).join("");
  const wrongItem = extras.receivedProducts.length > 0;
  const requestBody = `${facts ? `<div class="hdt-facts">${facts}</div>` : ""}${written || (facts ? "" : `<p>${escape(ticket.topic)}</p>`)}
${productList("Received", extras.receivedProducts)}${productList(wrongItem ? "Wanted instead" : "Products", extras.products)}${files(extras.requestImages)}`;

  // "Clear chat": the customer sees only what came after they last cleared it
  // (the team still sees everything). The page loads that note as an event.
  let clearedAt = -1;
  ticket.messages.forEach((entry, index) => { if (entry.kind === "event") clearedAt = index; });
  const cleared = clearedAt >= 0;
  const shown = ticket.messages.slice(clearedAt + 1).filter((entry) => entry.kind !== "event");

  // Handed to the team: "Connecting you to a person" until someone joins; then who's chatting.
  const connecting = Boolean(ticket.humanRequestedAt) && !resolved;
  const lastReply = [...ticket.messages].reverse().find((entry) => entry.kind === "reply");
  const agent = !connecting && !resolved && lastReply && Date.now() - lastReply.createdAt.getTime() < 2 * 60 * 60_000 ? lastReply.author : "";
  const advisorStatus = agent
    ? `<p class="hdt-advisor-status" role="status"><i class="hdt-live" aria-hidden="true"></i>Online</p>`
    : connecting ? `<p class="hdt-connecting-status" role="status">Connecting you to a person...</p>`
      : resolved ? `<p class="hdt-advisor-status">Request resolved</p>`
        : `<p class="hdt-advisor-status"><i class="hdt-live" aria-hidden="true"></i>Online</p>`;
  // Quick replies under the assistant's latest message, while it has the chat
  // (never once a person from the team is on the request): ways to start, or
  // to say whether its answer helped.
  const human = Boolean(ticket.humanRequestedAt) || ticket.messages.some((entry) => entry.kind === "reply");
  const quick = extras.canReply && !resolved && !human && shown.at(-1)?.kind === "bot"
    ? chips(shown.some((entry) => entry.kind === "customer") || !chat ? FOLLOW_UPS : STARTERS, "hdt-quick", "Quick replies") : "";
  const thread = [
    ...(chat || cleared ? [] : [message("customer", "", ticket.createdAt, requestBody)]),
    ...shown.map((entry) => message(entry.kind, entry.author, entry.createdAt, `${entry.kind === "bot" ? botBody(entry.body) : `<p>${multiline(entry.body)}</p>`}${files(extras.imageCounts.get(entry.id) ?? 0)}`)),
    quick,
    ...(connecting ? [`<div class="hdt-connecting" role="status"><span class="hdt-dots" aria-hidden="true"><i></i><i></i><i></i></span><div><strong>Connecting you to a person...</strong><span>Someone from our team will join this chat shortly. Keep writing here if you like: they'll see everything, and we'll email you when they reply.</span></div></div>`] : []),
    ...(resolved ? [`<p class="hdt-system">Request resolved</p>`] : []),
  ].join("");

  const foot = extras.canReply ? `<div class="hdt-foot" id="reply">${note(state)}
<form method="post" action="?ticket=${escape(ticket.accessToken)}#reply" enctype="multipart/form-data">
<input type="hidden" name="intent" value="reply"><input type="hidden" name="token" value="${escape(ticket.accessToken)}">
<div class="hdt-compose"><textarea id="hdt-body" aria-label="${ticket.status === "Waiting on customer" ? "Reply to our team" : "Ask a question or add a message"}" name="body" rows="1" maxlength="${extras.maxLength}" enterkeyhint="send" placeholder="${ticket.status === "Waiting on customer" ? "Write your reply..." : "Write a message..."}">${escape(state.draft ?? "")}</textarea>
<button type="submit" class="hdt-send" aria-label="Send" title="Send"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg></button></div>
${ticket.allowPhotos ? `<label class="hdt-drop"><i aria-hidden="true">📷</i><span><strong>Add photos</strong><small>Optional · JPG, PNG or WebP · up to ${extras.maxImages}, 10 MB each</small></span>
<input type="file" name="images" accept="image/jpeg,image/png,image/webp" multiple aria-label="Add photos"></label>` : ""}
${ticket.allowVideos ? `<label class="hdt-drop"><i aria-hidden="true">🎥</i><span><strong>Add a video</strong><small>Optional · any video format · 1 video, up to 50 MB</small></span>
<input type="file" name="videos" accept="video/*,${VIDEO_EXTENSIONS.map((extension) => `.${extension}`).join(",")}" aria-label="Add a video"></label>` : ""}
<div class="hdt-actions">${ticket.humanRequestedAt ? `<p class="hdt-waiting" role="status">Our team has been told you'd like to talk to a person. Someone will reply here soon.</p>` : ""}</div>
</form></div>`
    : `<div class="hdt-foot" id="reply">${note(state)}<div class="hdt-wait"><i aria-hidden="true">${resolved ? "✅" : "⏳"}</i><div>
<strong>${resolved ? "This request is closed" : "Our team will reply soon"}</strong>
<p>${resolved ? "If you still need help, please send us a new request." : "You can reply here once our team responds. We'll email you when they do."}</p></div></div></div>`;

  const summary = [
    `<div><dt>Request</dt><dd>#${ticket.number}</dd></div>`,
    `<div><dt>Submitted</dt><dd>${time(ticket.createdAt, "date")}</dd></div>`,
    ...(ticket.subcategory ? [`<div><dt>Issue</dt><dd>${escape(ticket.subcategory)}</dd></div>`] : []),
    ...SUMMARY_FIELDS.filter((key) => values[key]).map((key) => `<div><dt>${escape(fieldLabels[key] ?? key)}</dt><dd>${escape(fieldValue(key, values[key]))}</dd></div>`),
  ].join("");
  const count = shown.length + (chat || cleared ? 0 : 1);

  const stamp = liveStamp(ticket.status, ticket.messages.length, ticket.messages.at(-1)?.id, ticket.allowPhotos, `${ticket.cancelStatus ?? ""}${ticket.addressStatus ? `|${ticket.addressStatus}` : ""}${ticket.returnStatus ? `|${ticket.returnStatus}` : ""}${ticket.editStatus ? `|e:${ticket.editStatus}` : ""}${ticket.replacementStatus ? `|r:${ticket.replacementStatus}` : ""}${ticket.quoteStatus ? `|q:${ticket.quoteStatus}` : ""}`, ticket.allowVideos);
  return page(`Request #${ticket.number}`, `
<div class="hdt-card hdt-hero">
<div class="hdt-top"><div>
<p class="hdt-eyebrow"><span class="hdt-chip">Request #${ticket.number}</span>${chat ? `<span class="hdt-chip">Live Chat</span>` : ""}<span>Submitted ${time(ticket.createdAt)}</span></p>
<h1>${escape(ticket.topic)}</h1>
<p class="hdt-lead"><strong style="color:var(--ink)">${escape(copy.title)}.</strong> ${escape(copy.text)}</p>
</div><span class="hdt-pill" data-status="${escape(ticket.status)}"><i></i>${escape(ticket.status === "Waiting on customer" ? "Awaiting your reply" : ticket.status)}</span></div>
<ol class="hdt-steps" aria-label="Request progress">${steps}</ol>
</div>
<div class="hdt-layout">
<div class="hdt-card hdt-chatbox" id="hdt-chatbox">
<div class="hdt-chat-head"${resolved ? " data-closed" : ""}${connecting ? " data-connecting" : ""}><div class="hdt-chat-brand">${agent ? `<span class="hdt-chat-avatar" data-person aria-hidden="true">${escape(nameInitial(agent))}</span>` : `<span class="hdt-chat-avatar" data-bot aria-hidden="true"></span>`}
<div><h2>${agent ? `<small>You're chatting with</small><span title="${escape(agent)}">${escape(agent)}</span>` : "Customer Support"}</h2>${advisorStatus}</div>
 </div><div class="hdt-chat-actions"><span class="hdt-count">${count} message${count === 1 ? "" : "s"}</span>
<button type="button" class="hdt-theme" aria-label="Switch to light mode" title="Switch to light mode"><svg class="hdt-theme-light" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/></svg><svg class="hdt-theme-dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7z"/></svg></button>
<button type="button" class="hdt-expand" aria-label="Full screen" title="Full screen" aria-pressed="false"><svg class="hdt-expand-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg><svg class="hdt-expand-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/></svg></button>
<button type="button" class="hdt-chat-close" aria-label="Close chat window" title="${resolved ? "Close chat" : "Close chat window (the chat stays open: reopen it any time)"}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div></div>
<div class="hdt-thread">${thread}</div>
${foot}
</div>
<button type="button" class="hdt-chat-launcher" aria-label="Open chat with our support team" title="Chat with our support team" aria-controls="hdt-chatbox" aria-expanded="false"><span class="hdt-chat-launcher-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span></button>
<aside class="hdt-aside">
${cancellationCard(ticket, values.orderNumber ? `Order ${values.orderNumber}` : "", values.cancelScope === cancelScopes[1])}${addressCard(ticket, values)}${returnCard(ticket, values.orderNumber ? `Order ${values.orderNumber}` : "")}${refundCard(values)}${editCard(ticket, values)}${replacementCard(ticket)}${quoteCard(ticket)}
<div class="hdt-card hdt-pad"><h2>Request summary</h2><dl style="margin-top:8px">${summary}</dl></div>
${shipmentCard(extras.shipment)}
<div class="hdt-card hdt-pad hdt-help"><h2>Good to know</h2>
<p>This page is private to you. Keep the link to yourself: anyone with it can see this request.</p>
<p>Looking for another request? <a href="?ticket=">Find it with its number</a>.</p></div>
</aside>
</div>`, ` data-hdt-stamp="${escape(stamp)}" data-hdt-token="${escape(ticket.accessToken)}"${resolved ? "" : " data-chat-open data-chat-locked"}`);
}
