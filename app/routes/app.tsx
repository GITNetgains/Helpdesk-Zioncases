import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useEffect } from "react";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { DARK_CLASS, POLARIS_DARK_CLASS, THEME_BOOT_SCRIPT, useThemeMode } from "../components/help-desk/theme";

const ADMIN_THEME_CSS = `
.hd-admin-shell{position:relative;min-height:100%;color-scheme:light;--hd-surface:#fff;--hd-surface-muted:#f7f8fa;--hd-ink:#20242c;--hd-muted:#667085;--hd-border:#e2e5ea;--hd-canvas:#f6f7f8;--hd-input:#fff;--hd-link:#2458a6;--hd-table-head:#f7f8fa;--hd-grid:#e5e7eb;--hd-heading:#172351;--hd-hover:#f6f7f9;--hd-footer:#f9fafb;--hd-faint:#98a2b3;--hd-link-strong:#2b449e;--hd-accent:#172351;--hd-accent-line:#334fb4;transition:background-color .2s ease,color .2s ease}
.hd-admin-shell>s-app-nav{display:none}
.hd-admin-page{display:grid;gap:18px;color:var(--hd-ink);max-width:1480px;margin:0 auto;padding:0 clamp(12px,2vw,24px) 32px}
.hd-admin-nav{display:flex;align-items:center;gap:12px;margin:0;padding:0;border:0;background:transparent}
.hd-admin-nav-main{flex:1;min-width:0}
.hd-admin-nav nav{border-color:var(--hd-border)!important;min-height:44px}
.hd-admin-nav s-button{flex:none}
.hd-inbox-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;background:transparent!important;border:0!important;box-shadow:none!important}
.hd-inbox-kpi{display:block;min-width:0;margin:0;padding:0;border:0;border-radius:12px;background:transparent;text-align:left;cursor:pointer;font:inherit}
.hd-inbox-kpi .hd-admin-card{height:100%;border-radius:14px;transition:border-color .16s ease,transform .16s ease,box-shadow .16s ease}
.hd-inbox-kpi:hover .hd-admin-card{transform:translateY(-2px);box-shadow:0 10px 24px rgba(16,24,40,.1)}
.hd-inbox-kpi.is-active .hd-admin-card{border-color:var(--hd-accent-line);box-shadow:0 0 0 2px var(--hd-accent-line)}
.hd-inbox-kpi:focus-visible{outline:3px solid #7d94ed;outline-offset:3px;border-radius:15px}
.hd-inbox-workspace{overflow:hidden;background:var(--hd-surface);border:1px solid var(--hd-border);border-radius:16px;box-shadow:0 8px 24px rgba(16,24,40,.06)}
.hd-inbox-workspace> s-section{display:block}
.hd-inbox-controls{display:grid;gap:16px;padding:20px 22px 18px;border-bottom:1px solid var(--hd-border)}
.hd-inbox-search-row{display:flex;flex-wrap:wrap;gap:10px;align-items:end}
.hd-inbox-filter-panel{padding:16px;border:1px solid var(--hd-border);border-radius:12px;background:var(--hd-surface-muted)}
.hd-inbox-footer{padding:13px 22px;border-top:1px solid var(--hd-border);color:var(--hd-muted);font-size:12px}
.hd-inbox-empty{display:grid;justify-items:center;gap:9px;min-height:250px;align-content:center;padding:32px;text-align:center;color:var(--hd-muted)}
.hd-inbox-empty strong{color:var(--hd-ink);font-size:15px}
.hd-admin-callout{display:flex;align-items:center;gap:12px;padding:14px 18px;border:1px solid;border-radius:12px;font-size:13px}
.hd-admin-callout-copy{display:grid;gap:3px;flex:1;min-width:0}
.hd-callout-indicator{flex:none;width:8px;height:8px;border-radius:50%;background:currentColor}
.hd-admin-callout-copy strong{font-size:13px}
.hd-admin-callout-copy span{color:var(--hd-muted);line-height:1.4}
.hd-admin-callout-info{background:#f0f9ff;border-color:#b9e4f5;color:#164e63}
.hd-admin-callout-warning{background:#fff8e8;border-color:#f1d48e;color:#61450a}
.hd-admin-callout .hd-admin-callout-copy span{color:var(--hd-muted)}
.hd-inbox-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding-bottom:14px;border-bottom:1px solid var(--hd-border)}
.hd-inbox-toolbar [role="tab"]{box-shadow:0 1px 2px rgba(16,24,40,.04);transition:transform .14s ease,box-shadow .14s ease}
.hd-inbox-toolbar [role="tab"]:hover{transform:translateY(-1px);box-shadow:0 3px 8px rgba(16,24,40,.1)}
.hd-inbox-results{overflow-x:auto}
.hd-inbox-results s-table{min-width:800px}
.hd-dashboard-grid{align-items:stretch}
.hd-icon-tile{background:var(--hd-icon-soft);color:var(--hd-icon-ink)}
.hd-settings{display:grid;grid-template-columns:232px minmax(0,1fr);gap:24px;align-items:start}
.hd-settings-body{display:grid;gap:16px;min-width:0}
.hd-settings-nav{position:sticky;top:12px;display:grid;gap:14px;padding:12px;border:1px solid var(--hd-border);border-radius:14px;background:var(--hd-surface)}
.hd-settings-group{display:grid;gap:2px}
.hd-settings-group-label{padding:0 10px 4px;color:var(--hd-muted);font-size:11px;font-weight:650;letter-spacing:.04em;text-transform:uppercase}
.hd-settings-link{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border-radius:9px;color:var(--hd-ink);font-size:13px;font-weight:500;text-decoration:none;transition:background .14s ease,color .14s ease}
.hd-settings-link:hover{background:var(--hd-surface-muted)}
.hd-settings-link[aria-current="page"]{background:color-mix(in srgb,var(--hd-accent-line) 12%,transparent);color:var(--hd-ink);font-weight:650;box-shadow:inset 3px 0 0 var(--hd-accent-line)}
.hd-settings-link:focus-visible,.hd-settings-card:focus-visible{outline:2px solid var(--hd-accent-line);outline-offset:2px}
.hd-settings-link i{flex:none;width:8px;height:8px;border-radius:50%}
.hd-settings-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:12px}
.hd-settings-card{display:flex;align-items:flex-start;gap:14px;padding:16px;border:1px solid var(--hd-border);border-radius:12px;background:var(--hd-surface);color:var(--hd-ink);text-decoration:none;transition:border-color .15s ease,box-shadow .15s ease,transform .15s ease}
.hd-settings-card:hover{border-color:var(--hd-accent-line);box-shadow:0 6px 18px rgba(16,24,40,.08);transform:translateY(-1px)}
.hd-settings-card-copy{display:grid;gap:4px;flex:1;min-width:0}
.hd-settings-card-copy strong{font-size:14px;font-weight:650}
.hd-settings-card-copy>span{color:var(--hd-muted);font-size:12.5px;line-height:1.45}
.hd-settings-card-copy em{display:inline-flex;align-items:center;gap:6px;margin-top:4px;color:var(--hd-ink);font-size:12px;font-style:normal;font-weight:600}
.hd-settings-card-copy em i{width:7px;height:7px;border-radius:50%}
.hd-settings-card-arrow{align-self:center;color:var(--hd-muted);font-size:22px;line-height:1;transition:transform .15s ease}
.hd-settings-card:hover .hd-settings-card-arrow{transform:translateX(3px);color:var(--hd-ink)}
.hd-theme-dark .hd-settings-card:hover{box-shadow:0 8px 22px rgba(0,0,0,.5)}
@media(max-width:900px){.hd-settings{grid-template-columns:minmax(0,1fr);gap:14px}.hd-settings-nav{position:static;display:flex;gap:4px;overflow-x:auto;padding:6px;scrollbar-width:thin}.hd-settings-group{display:contents}.hd-settings-group-label{display:none}.hd-settings-link{flex:none;white-space:nowrap}.hd-settings-link[aria-current="page"]{box-shadow:inset 0 -2px 0 var(--hd-accent-line)}}
@media(prefers-reduced-motion:reduce){.hd-settings-card,.hd-settings-card-arrow,.hd-settings-link{transition:none}.hd-settings-card:hover{transform:none}}
@media(prefers-reduced-motion:reduce){.hd-inbox-kpi .hd-admin-card,.hd-inbox-toolbar [role="tab"]{transition:none}.hd-inbox-kpi:hover .hd-admin-card,.hd-inbox-toolbar [role="tab"]:hover{transform:none}}
@media(max-width:900px){.hd-inbox-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:600px){.hd-admin-page{gap:14px;padding:0 12px 24px}.hd-admin-nav{align-items:flex-start;flex-wrap:wrap}.hd-admin-nav-main{width:100%;flex-basis:100%}.hd-inbox-kpis{grid-template-columns:1fr 1fr;gap:8px}.hd-inbox-controls{padding:14px 12px}.hd-inbox-footer{padding:10px 12px}.hd-inbox-toolbar{gap:6px}.hd-admin-callout{align-items:flex-start;padding:12px}.hd-inbox-empty{min-height:210px;padding:22px}}
/* Dark mode: hd-theme-dark is set from the Appearance setting (see components/help-desk/theme.ts). Colours sit on the Polaris dark palette. */
html.hd-theme-dark,html.hd-theme-dark body{background:#0a0a0a;color-scheme:dark}
.hd-admin-shell.hd-theme-dark{color-scheme:dark;background:var(--hd-canvas);--hd-surface:#1a1a1a;--hd-surface-muted:#242424;--hd-ink:#eeeeee;--hd-muted:#aaaaaa;--hd-border:#333333;--hd-canvas:#0a0a0a;--hd-input:#1f1f1f;--hd-link:#c5d0ff;--hd-table-head:#222222;--hd-grid:#2f2f2f;--hd-heading:#eeeeee;--hd-hover:#262626;--hd-footer:#202020;--hd-faint:#8a8a8a;--hd-link-strong:#c5d0ff;--hd-accent:#3b5bdb;--hd-accent-line:#8ea2ff;--hd-tone-red-soft:#3d1813;--hd-tone-red-ink:#ffa194;--hd-tone-navy-soft:#1e2442;--hd-tone-navy-ink:#c5ceff;--hd-tone-blue-soft:#1c2548;--hd-tone-blue-ink:#b3c3ff;--hd-tone-green-soft:#0e2e20;--hd-tone-green-ink:#7ee0a6;--hd-tone-amber-soft:#332a0b;--hd-tone-amber-ink:#f3d88e;--hd-tone-gray-soft:#2a2a2a;--hd-tone-gray-ink:#c4c7cf}
.hd-theme-dark .hd-admin-callout-info{background:#0b2a3d;border-color:#1f4f6b;color:#a8d8ff}.hd-theme-dark .hd-admin-callout-warning{background:#2e2709;border-color:#5c4f12;color:#ffeb78}
.hd-theme-dark .hd-inbox-workspace,.hd-theme-dark .hd-inbox-kpi:hover .hd-admin-card{box-shadow:0 8px 24px rgba(0,0,0,.45)}
.hd-theme-dark ::selection{background:#334fb4;color:#fff}
.hd-theme-dark .hd-admin-card,.hd-theme-dark .hd-inbox-workspace{box-shadow:inset 0 1px 0 rgba(255,255,255,.04)}
.hd-theme-dark .hd-inbox-kpi:hover .hd-admin-card{border-color:#444}
.hd-theme-dark .hd-inbox-toolbar [role="tab"]:hover{box-shadow:0 3px 10px rgba(0,0,0,.5)}
@media(prefers-reduced-motion:reduce){.hd-admin-shell{transition:none}}
/* Live: a beating dot while the screen keeps itself up to date, a flash of "Updated" when a change comes in. */
.hd-live{display:inline-flex;align-items:center;gap:7px;flex:none;height:32px;padding:0 12px;border:1px solid var(--hd-border);border-radius:999px;background:var(--hd-surface);color:var(--hd-ink);font-size:12px;font-weight:650;letter-spacing:.01em;white-space:nowrap}
.hd-live i{position:relative;width:8px;height:8px;border-radius:50%;background:#12b76a}
.hd-live i::after{content:"";position:absolute;inset:0;border-radius:50%;background:#12b76a;animation:hd-live-beat 1.8s cubic-bezier(.2,.6,.3,1) infinite}
.hd-live[data-state="offline"]{color:var(--hd-muted)}
.hd-live[data-state="offline"] i,.hd-live[data-state="offline"] i::after{background:#98a2b3;animation:none}
.hd-live-flash{animation:hd-live-flash 1.2s ease}
@keyframes hd-live-beat{0%{transform:scale(1);opacity:.7}100%{transform:scale(2.8);opacity:0}}
@keyframes hd-live-flash{0%{color:#12b76a}100%{color:inherit}}
/* Switching light and dark: the new look spreads in a circle from the button. */
::view-transition-old(root),::view-transition-new(root){animation:none;mix-blend-mode:normal}
html.hd-theme-switching::view-transition-new(root){animation:hd-theme-reveal .65s cubic-bezier(.65,0,.35,1) both}
@keyframes hd-theme-reveal{from{clip-path:circle(0 at var(--hd-vt-x) var(--hd-vt-y))}to{clip-path:circle(var(--hd-vt-r) at var(--hd-vt-x) var(--hd-vt-y))}}
/* Screens open with their parts rising in, one after another. */
.hd-admin-page>*:not(.hd-admin-nav),.hd-settings-body>*{animation:hd-rise .42s cubic-bezier(.2,.7,.25,1) backwards}
.hd-admin-page>*:nth-child(2),.hd-settings-body>*:nth-child(2){animation-delay:.04s}
.hd-admin-page>*:nth-child(3),.hd-settings-body>*:nth-child(3){animation-delay:.08s}
.hd-admin-page>*:nth-child(4),.hd-settings-body>*:nth-child(4){animation-delay:.12s}
.hd-admin-page>*:nth-child(n+5),.hd-settings-body>*:nth-child(n+5){animation-delay:.16s}
.hd-inbox-kpi:nth-child(1) .hd-admin-card{animation:hd-pop .45s .05s cubic-bezier(.2,.7,.25,1) backwards}
.hd-inbox-kpi:nth-child(2) .hd-admin-card{animation:hd-pop .45s .1s cubic-bezier(.2,.7,.25,1) backwards}
.hd-inbox-kpi:nth-child(3) .hd-admin-card{animation:hd-pop .45s .15s cubic-bezier(.2,.7,.25,1) backwards}
.hd-inbox-kpi:nth-child(4) .hd-admin-card{animation:hd-pop .45s .2s cubic-bezier(.2,.7,.25,1) backwards}
.hd-inbox-kpi:active .hd-admin-card,.hd-settings-card:active{transform:scale(.985)}
@keyframes hd-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes hd-pop{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}
/* Dark, furnished: a soft glow on the canvas, cards lit at the edge, glowing focus and the brand's blue on what's active. */
.hd-admin-shell.hd-theme-dark{background:radial-gradient(1200px 520px at 50% -180px,rgba(59,91,219,.16),transparent 70%),radial-gradient(800px 400px at 100% 0,rgba(239,58,36,.06),transparent 70%),var(--hd-canvas)}
.hd-theme-dark .hd-admin-card,.hd-theme-dark .hd-inbox-workspace,.hd-theme-dark .hd-settings-nav,.hd-theme-dark .hd-settings-card{border-color:#2c2f36;background-image:linear-gradient(180deg,rgba(255,255,255,.025),transparent 60%)}
.hd-theme-dark .hd-inbox-kpi:hover .hd-admin-card,.hd-theme-dark .hd-settings-card:hover{border-color:#4a5cb8;box-shadow:0 0 0 1px rgba(142,162,255,.18),0 14px 34px rgba(0,0,0,.55),0 0 28px rgba(59,91,219,.14)}
.hd-theme-dark .hd-inbox-kpi.is-active .hd-admin-card{box-shadow:0 0 0 2px var(--hd-accent-line),0 0 30px rgba(142,162,255,.2)}
.hd-theme-dark .hd-settings-link[aria-current="page"]{background:linear-gradient(90deg,rgba(142,162,255,.18),rgba(142,162,255,.04))}
.hd-theme-dark .hd-live{background:#17191d;border-color:#2c2f36}
.hd-theme-dark .hd-live:not([data-state="offline"]){box-shadow:0 0 14px rgba(18,183,106,.16)}
.hd-theme-dark *:focus-visible{outline-color:#8ea2ff}
.hd-theme-dark{scrollbar-color:#3a3f4a transparent}
.hd-theme-dark ::-webkit-scrollbar{width:10px;height:10px}.hd-theme-dark ::-webkit-scrollbar-thumb{background:#3a3f4a;border-radius:10px;border:2px solid transparent;background-clip:padding-box}.hd-theme-dark ::-webkit-scrollbar-track{background:transparent}
@media(prefers-reduced-motion:reduce){.hd-admin-page>*,.hd-settings-body>*,.hd-inbox-kpi .hd-admin-card,.hd-live i::after,.hd-live-flash{animation:none!important}html.hd-theme-switching::view-transition-new(root){animation:none}.hd-inbox-kpi:active .hd-admin-card,.hd-settings-card:active{transform:none}}
`;

function AdminThemeShell() {
  const { dark, ready } = useThemeMode();
  useEffect(() => { if (ready) document.documentElement.classList.toggle(DARK_CLASS, dark); }, [dark, ready]);
  return <div className={dark ? `hd-admin-shell ${DARK_CLASS} ${POLARIS_DARK_CLASS}` : "hd-admin-shell"} suppressHydrationWarning>
    <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
    <style>{ADMIN_THEME_CSS}</style>
    <s-app-nav>
      <s-link href="/app/help-desk">Inbox</s-link>
      <s-link href="/app/help-desk/overview">Overview</s-link>
      <s-link href="/app/photo-checks">Photo Checks</s-link>
      <s-link href="/app/help-desk/settings">Settings</s-link>
    </s-app-nav>
    <Outlet />
  </div>;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider apiKey={apiKey} polarisUrl="https://cdn.shopify.com/shopifycloud/polaris-2.js">
      <AdminThemeShell />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
