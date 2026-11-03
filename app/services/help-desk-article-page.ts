// A help answer on a page of its own, like a help center article: opened from
// the search at the top of the storefront form. Returned as Liquid through the
// app proxy, so the store's theme wraps it with its header and footer.

export type ArticlePageAnswer = {
  id: string; question: string; answer: string; collection: string; action: string;
  source: "article" | "store" | "policy" | "page" | "product"; url: string; image: string; updatedAt?: Date | null;
};
type Link = { id: string; question: string };
export type ArticlePageExtras = {
  // The store page with the Help Desk form, to go back to, search from, or send a request on.
  home: string;
  // The proxy path the page posts its "Did this answer your question?" vote to.
  endpoint: string;
  related: Link[];
  popular: Link[];
  query: string;
};

// Escapes HTML and Liquid delimiters: the page is rendered by the theme as Liquid.
const escape = (value: string) => value.replace(/[&<>"'{}]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "{": "&#123;", "}": "&#125;" })[char]!);
// Links written in an answer, clickable.
const linked = (text: string) => escape(text).replace(/https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)]/g, (url) => `<a href="${url}" target="_blank" rel="noopener">${url}</a>`);

const SOURCE_LABEL: Record<ArticlePageAnswer["source"], string> = {
  article: "Help article", store: "Live from our store", policy: "Store policy", page: "From our website", product: "Product",
};
const LINK_LABEL: Partial<Record<ArticlePageAnswer["source"], string>> = { policy: "Read the full policy", page: "Open the page", product: "View the product" };

// The answer's text: paragraphs, and lines starting with "-" as a list.
export function articleBody(text: string) {
  return text.split(/\n{2,}/).map((block) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return "";
    if (lines.every((line) => /^[-•*]\s/.test(line))) return `<ul>${lines.map((line) => `<li>${linked(line.replace(/^[-•*]\s+/, ""))}</li>`).join("")}</ul>`;
    return lines.map((line) => /^[-•*]\s/.test(line) ? `<ul><li>${linked(line.replace(/^[-•*]\s+/, ""))}</li></ul>` : `<p>${linked(line)}</p>`).join("");
  }).join("");
}

const withParams = (base: string, params: Record<string, string>) => {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value)).toString();
  return query ? `${base}${base.includes("?") ? "&" : "?"}${query}` : base;
};
export const articleHref = (endpoint: string, id: string, home: string, query = "") => withParams(endpoint, { article: id, from: home, q: query });

const STYLES = `<style>
.hda{--ink:#172351;--muted:#5b6275;--soft:#f5f6f9;--line:#e6e8ee;--accent:#ef3a24;max-width:1180px;margin:clamp(20px,3vw,40px) auto clamp(56px,7vw,96px);padding:0 clamp(16px,3vw,24px);color:var(--ink);font-size:16px;line-height:1.6}
.hda *{box-sizing:border-box}
.hda p,.hda ul,.hda ol{margin:0}
.hda h1,.hda h2,.hda h3{margin:0;color:var(--ink);font-family:inherit;font-style:normal;text-transform:none;letter-spacing:-.015em}
.hda a{color:var(--accent);font-weight:600;text-underline-offset:3px}
.hda svg{flex:none}
/* The search band */
.hda-hero{position:relative;display:grid;gap:14px;padding:clamp(24px,3.6vw,40px);border-radius:22px;background:var(--ink);background-image:radial-gradient(110% 140% at 100% 0%,rgba(239,58,36,.42) 0%,transparent 55%),radial-gradient(80% 120% at 0% 100%,rgba(77,104,214,.35) 0%,transparent 60%);color:#fff;overflow:hidden}
.hda .hda-kicker{color:rgba(255,255,255,.7);font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.hda .hda-hero h2{color:#fff;font-size:clamp(22px,2.6vw,30px);font-weight:700;line-height:1.2}
.hda-hero form{display:flex;align-items:center;gap:12px;padding:5px 6px 5px 18px;border-radius:14px;background:#fff;box-shadow:0 14px 40px rgba(0,0,0,.25)}
.hda-hero form:focus-within{box-shadow:0 0 0 4px rgba(239,58,36,.45),0 14px 40px rgba(0,0,0,.25)}
.hda-hero form svg{width:22px;height:22px;color:var(--ink)}
.hda .hda-hero input{flex:1;min-width:0;min-height:54px;margin:0;padding:0!important;border:0!important;border-radius:0!important;outline:none!important;background:transparent!important;box-shadow:none!important;color:var(--ink);font:inherit;font-size:17px}
.hda .hda-hero input::placeholder{color:#8a90a0;opacity:1}
.hda .hda-hero button{min-height:46px;padding:8px 24px;border:0;border-radius:10px;background:var(--accent);color:#fff;font:inherit;font-size:15px;font-weight:650;cursor:pointer;transition:filter .15s}
.hda .hda-hero button:hover{filter:brightness(.92)}
/* Breadcrumb */
.hda-crumbs{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:28px 0 22px;padding:0;list-style:none;color:var(--muted);font-size:14px}
.hda-crumbs li{display:inline-flex;align-items:center;gap:8px}
.hda-crumbs li+li::before{content:"›";color:#a3a8b5;font-size:16px}
.hda .hda-crumbs a{display:inline-flex;align-items:center;gap:6px;color:var(--ink);font-weight:600;text-decoration:none}
.hda .hda-crumbs a:hover{color:var(--accent)}
.hda-crumbs svg{width:16px;height:16px}
.hda-crumbs [aria-current]{max-width:42ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Layout */
.hda-layout{display:grid;gap:24px;align-items:start}
@media(min-width:960px){.hda-layout{grid-template-columns:minmax(0,1fr) 320px;gap:32px}.hda-aside{position:sticky;top:24px}}
.hda-card{display:grid;gap:22px;padding:clamp(22px,3.6vw,44px);border:1px solid var(--line);border-radius:22px;background:#fff;box-shadow:0 1px 2px rgba(23,35,81,.04),0 16px 40px rgba(23,35,81,.06);min-width:0}
.hda-chip{justify-self:start;display:inline-flex;align-items:center;gap:8px;padding:6px 12px 6px 8px;border-radius:999px;background:rgba(239,58,36,.08);color:var(--accent);font-size:13px;font-weight:700}
.hda-chip i{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--accent);color:#fff;font-style:normal;font-size:12px}
.hda h1{font-size:clamp(28px,3.4vw,40px);font-weight:750;line-height:1.15;margin-top:-6px}
.hda-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 16px;margin-top:-8px;color:var(--muted);font-size:14px}
.hda-meta span{display:inline-flex;align-items:center;gap:6px}
.hda-meta svg{width:15px;height:15px}
.hda-product img{width:120px;height:120px;border-radius:14px;object-fit:cover;background:var(--soft)}
.hda-body{display:grid;gap:16px;padding-top:22px;border-top:1px solid var(--line);font-size:17px;line-height:1.75;color:#262b3d}
.hda-body ul{display:grid;gap:10px;padding:0;list-style:none}
.hda-body li{position:relative;padding-left:28px}
.hda-body li::before{content:"";position:absolute;left:4px;top:.62em;width:9px;height:9px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 4px rgba(239,58,36,.12)}
/* The request the answer leads to */
.hda-next{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px;padding:20px 22px;border-radius:16px;background:linear-gradient(135deg,rgba(239,58,36,.08),rgba(23,35,81,.05));border:1px solid rgba(239,58,36,.18)}
.hda-next strong{display:block;font-size:17px}
.hda-next span{color:var(--muted);font-size:14px}
.hda .hda-button{display:inline-flex;align-items:center;gap:8px;min-height:48px;padding:10px 22px;border-radius:12px;background:var(--accent);color:#fff;font-size:15px;font-weight:650;text-decoration:none;white-space:nowrap;transition:filter .15s,transform .15s}
.hda .hda-button:hover{filter:brightness(.93);transform:translateY(-1px)}
.hda .hda-button-secondary{background:#fff;color:var(--ink);border:1px solid #c9ccd5}
.hda .hda-button-dark{background:#fff;color:var(--ink)}
/* Was this helpful? */
.hda-vote{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:14px;padding:18px 20px;border-radius:16px;background:var(--soft)}
.hda-vote>span{font-weight:650}
.hda-vote div{display:flex;gap:10px}
.hda-vote button{display:inline-flex;align-items:center;gap:8px;min-height:42px;padding:8px 18px;border:1px solid #d4d7de;border-radius:999px;background:#fff;color:var(--ink);font:inherit;font-size:15px;font-weight:600;cursor:pointer;transition:border-color .15s,transform .15s}
.hda-vote button:hover{border-color:var(--ink);transform:translateY(-1px)}
.hda-vote[data-done]{justify-content:flex-start;color:var(--muted)}
/* Sidebar */
.hda-aside{display:grid;gap:18px}
.hda-main{display:grid;gap:24px;min-width:0}
@media(min-width:700px){.hda-main .hda-contact{grid-template-columns:minmax(0,1fr) auto;align-items:center;column-gap:28px;padding:26px 30px}.hda-main .hda-contact>*{grid-column:1}.hda-main .hda-contact>div{grid-column:2;grid-row:1 / span 3}}
.hda-box{padding:22px;border:1px solid var(--line);border-radius:18px;background:#fff}
.hda-box h2{margin-bottom:8px;color:var(--muted);font-size:12px;font-weight:750;letter-spacing:.08em;text-transform:uppercase}
.hda-box ul{display:grid;padding:0;list-style:none}
.hda-box li+li{border-top:1px solid #f0f1f4}
.hda .hda-box a{display:flex;align-items:flex-start;gap:10px;padding:11px 0;color:var(--ink);font-weight:550;font-size:15px;line-height:1.4;text-decoration:none}
.hda .hda-box a svg{width:18px;height:18px;margin-top:1px;color:#a3a8b5}
.hda .hda-box a:hover{color:var(--accent)}
.hda .hda-box a:hover svg{color:var(--accent)}
.hda-contact{display:grid;gap:10px;padding:24px;border-radius:18px;background:var(--ink);background-image:radial-gradient(120% 120% at 100% 0%,rgba(239,58,36,.35) 0%,transparent 60%);color:#fff}
.hda .hda-contact h2{color:#fff;font-size:19px;font-weight:700}
.hda-contact p{color:rgba(255,255,255,.78);font-size:14px}
.hda .hda-contact a.hda-back{color:#fff;font-size:14px;font-weight:600}
.hda-missing{display:grid;gap:14px;margin-top:28px;padding:clamp(28px,5vw,56px);border:1px solid var(--line);border-radius:22px;background:#fff;text-align:center;justify-items:center}
@media(max-width:640px){.hda-next{display:grid}.hda-next .hda-button{justify-content:center}.hda-vote{display:grid}.hda-body{font-size:16px}}
</style>`;

const SEARCH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>`;
const HOME_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/></svg>`;
const DOC_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>`;
const CLOCK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;
const CALENDAR_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>`;

const page = (title: string, body: string) => `{% layout 'theme' %}${STYLES}<section class="hda" aria-label="${escape(title)}">${body}</section>`;

// The search band at the top: searching goes back to the Help Desk page, which answers it.
const hero = (home: string, query: string) => `<div class="hda-hero"><p class="hda-kicker">Help Center</p><h2>How can we help?</h2>
<form method="get" action="${escape(home)}" role="search">${SEARCH_ICON}
<input type="search" name="q" value="${escape(query)}" placeholder="Search for answers, like &quot;where is my order?&quot;" aria-label="Search for answers" autocomplete="off" maxlength="300">
<button type="submit">Search</button></form></div>`;

const linkList = (title: string, links: Link[], endpoint: string, home: string) => links.length
  ? `<div class="hda-box"><h2>${escape(title)}</h2><ul>${links.map((link) => `<li><a href="${escape(articleHref(endpoint, link.id, home))}">${DOC_ICON}<span>${escape(link.question)}</span></a></li>`).join("")}</ul></div>` : "";

// About how long the answer takes to read, at 200 words a minute.
const readingTime = (text: string) => Math.max(1, Math.round(text.split(/\s+/).filter(Boolean).length / 200));

export function renderArticlePage(answer: ArticlePageAnswer, extras: ArticlePageExtras) {
  const { home, endpoint, related, popular, query } = extras;
  const where = answer.source === "article" ? answer.collection || "Help articles" : SOURCE_LABEL[answer.source];
  const option = answer.action.split(" › ")[1] || "";
  const request = answer.action ? withParams(home, { start: answer.action }) : withParams(home, { request: "1" });
  const outside = answer.url && /^https?:\/\//.test(answer.url) ? `<div><a class="hda-button hda-button-secondary" href="${escape(answer.url)}" target="_blank" rel="noopener">${escape(LINK_LABEL[answer.source] ?? "Read more")} &#8599;</a></div>` : "";
  const updated = answer.updatedAt ? `Updated ${new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(answer.updatedAt)}`
    : answer.source === "store" ? "Live from our store settings" : "";
  const minutes = readingTime(answer.answer);
  // The request the answer leads to, right under it: the quickest way on.
  const next = answer.action ? `<div class="hda-next"><div><strong>${escape(option ? `Ready? ${option}` : "Ready to send us a request?")}</strong>
<span>It only takes a minute, and our team takes it from there.</span></div><a class="hda-button" href="${escape(request)}">${escape(option || answer.action)} &rarr;</a></div>` : "";
  return page(answer.question, `${hero(home, query)}
<ol class="hda-crumbs" aria-label="Breadcrumb"><li><a href="${escape(home)}">${HOME_ICON}Help Center</a></li><li>${escape(where)}</li><li aria-current="page">${escape(answer.question)}</li></ol>
<div class="hda-layout">
<div class="hda-main">
<article class="hda-card">
<span class="hda-chip"><i aria-hidden="true">?</i>${escape(where)}</span>
<h1>${escape(answer.question)}</h1>
<p class="hda-meta">${updated ? `<span>${CALENDAR_ICON}${escape(updated)}</span>` : ""}<span>${CLOCK_ICON}${minutes} min read</span></p>
${answer.image ? `<div class="hda-product"><img src="${escape(answer.image)}" alt="" width="120" height="120"></div>` : ""}
<div class="hda-body">${articleBody(answer.answer)}</div>
${outside}
${next}
${answer.source === "article" ? `<div class="hda-vote" data-hda-vote="${escape(answer.id)}" data-hda-endpoint="${escape(endpoint)}"><span>Was this answer helpful?</span>
<div><button type="button" data-helpful="yes">&#128077; Yes</button><button type="button" data-helpful="no">&#128078; No</button></div></div>` : ""}
</article>
<div class="hda-contact"><h2>Still need help?</h2><p>Send us a request and our team will take it from there. You'll get a private page to follow it and chat with us.</p>
<div><a class="hda-button hda-button-dark" href="${escape(request)}">${escape(option || "Send us a request")}</a></div>
<a class="hda-back" href="${escape(home)}">&larr; Back to the Help Center</a></div>
</div>
<aside class="hda-aside">
${linkList(answer.source === "article" ? `More in ${answer.collection || "this topic"}` : "Related answers", related, endpoint, home)}
${linkList("Popular questions", popular, endpoint, home)}
</aside>
</div>
<script>
(() => {
  const vote = document.querySelector('[data-hda-vote]');
  if (!vote) return;
  vote.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-helpful]');
    if (!button) return;
    const body = new FormData();
    body.set('intent', 'answer-vote');
    body.set('id', vote.dataset.hdaVote);
    body.set('helpful', button.dataset.helpful);
    fetch(vote.dataset.hdaEndpoint, { method: 'POST', body, headers: { Accept: 'application/json' } }).catch(() => {});
    vote.dataset.done = 'true';
    vote.textContent = button.dataset.helpful === 'yes' ? 'Thanks for letting us know!' : 'Sorry about that. Use Still need help and our team will sort it out.';
  });
})();
</script>`);
}

export function renderMissingArticle(home: string, query = "") {
  return page("Answer not found", `${hero(home, query)}
<div class="hda-missing"><h1 style="font-size:28px">This answer isn't available any more</h1>
<p class="hda-meta" style="margin:0">Search for another answer above, or go back to the Help Center.</p>
<a class="hda-button" href="${escape(home)}">&larr; Back to the Help Center</a></div>`);
}
