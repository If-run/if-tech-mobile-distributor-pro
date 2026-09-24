/* =========================================================================
   APP SHELL — shared state, live data subscriptions, navigation, view switching.
   Views live in js/views/*.js; business operations (checkout, payments, stock)
   live in js/ops.js.
   ========================================================================= */
import { $, $$, esc, toast, dayStr, monthStart, setCurrency, toMillis, lsGet, lsSet } from './util.js';
import home from './views/home.js';
import sell from './views/sell.js';
import stock from './views/stock.js';
import customers from './views/customers.js';
import customer from './views/customer.js';
import dues from './views/dues.js';
import reports from './views/reports.js';
import expenses from './views/expenses.js';
import suppliers from './views/suppliers.js';
import settings from './views/settings.js';

const VIEWS = [home, sell, stock, customers, customer, dues, reports, expenses, suppliers, settings];

export const A = {
  data: null,
  user: null,          // { uid, name, email, role, demo }
  shop: {},
  S: { phones: [], accessories: [], customers: [], suppliers: [], salesMonth: [], salesOpen: [], sales: [], payments: [], expenses: [] },
  view: 'home', params: {},
  unsubs: [],
  isOwner() { return this.user && this.user.role === 'owner'; },
  settings() { return (this.shop && this.shop.settings) || {}; },
  licenceEnd() { return toMillis(this.shop && this.shop.paidUntil); },
  canWrite() { return this.user.demo || (this.shop && this.shop.status === 'active' && this.licenceEnd() > Date.now()); },
  guard() {
    if (!this.canWrite()) { toast('Subscription expired — the app is read-only. Please renew to continue.', 'error'); return false; }
    return true;
  },
  go(view, params = {}) { go(view, params); },
  refresh() { scheduleRender(); },
  customerById(id) { return this.S.customers.find(c => c.id === id) || null; },
  onLock: null, onSignOut: null
};
window.__A = A; // handy for debugging from the browser console

const ICONS = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  sell: '<circle cx="9" cy="21" r="1.5"/><circle cx="18" cy="21" r="1.5"/><path d="M2 3h3l2.6 12.6a2 2 0 002 1.6h8.8a2 2 0 002-1.6L22 7H6"/>',
  stock: '<path d="M21 8l-9-5-9 5v8l9 5 9-5V8z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/>',
  customers: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.9 3.1-7 7-7s7 3.1 7 7"/><circle cx="17" cy="9" r="2.7"/><path d="M22 20c0-2.8-1.9-5.2-4.5-6.4"/>',
  dues: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M12 14v3l2 1"/>',
  reports: '<path d="M4 20V10M11 20V4M18 20v-7"/>',
  expenses: '<circle cx="12" cy="12" r="9"/><path d="M9.5 15a2.5 2.5 0 002.7 2h.6a2.2 2.2 0 000-4.4h-1.6a2.2 2.2 0 010-4.4h.6a2.5 2.5 0 012.7 2M12 6v1.2M12 16.8V18"/>',
  suppliers: '<path d="M1 7h13v10H1z"/><path d="M14 11h4l3 3v3h-7"/><circle cx="5.5" cy="18.5" r="1.8"/><circle cx="17.5" cy="18.5" r="1.8"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-2.9-1.2l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.7 1.7 0 003 15H3a2 2 0 110-4h.1a1.7 1.7 0 001.2-2.9l-.1-.1a2 2 0 112.8-2.8l.1.1A1.7 1.7 0 0010 3.1V3a2 2 0 114 0v.1a1.7 1.7 0 002.9 1.2l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 001.2 2.9H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 118 0v4"/>',
  scan: '<path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2"/><path d="M7 8v8M10 8v8M13 8v8M16 8v8"/>'
};
export const icon = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] || ''}</svg>`;

const NAV = [
  { id: 'home', label: 'Home' }, { id: 'sell', label: 'Sell' }, { id: 'stock', label: 'Stock' },
  { id: 'customers', label: 'Customers' }, { id: 'dues', label: 'Dues & Cheques' },
  { id: 'reports', label: 'Reports' }, { id: 'expenses', label: 'Expenses', owner: true },
  { id: 'suppliers', label: 'Suppliers' }, { id: 'settings', label: 'Settings' }
];
const MOBILE_NAV = ['home', 'sell', 'stock', 'customers', 'dues'];

/* ---------------- Shell ---------------- */
function buildShell() {
  const app = $('#app');
  app.style.display = 'block';
  app.innerHTML = `
  <div class="shell">
    <aside class="sidebar" id="sidebar">
      <div class="brand"><div class="logo">M</div><div><div class="name" id="shopNameSide"></div><div class="sub" id="userSide"></div></div></div>
      <nav class="nav" id="navMain"></nav>
      <div class="sync-pill"><span class="sync-dot" id="syncDot"></span><span id="syncLabel">Connecting…</span></div>
    </aside>
    <div class="drawer-bg" id="drawerBg"></div>
    <main class="main">
      <header class="topbar">
        <div style="display:flex;align-items:center;gap:10px;min-width:0;">
          <button class="icon-btn only-mobile" id="btnMenu" aria-label="Menu">${icon('more')}</button>
          <h2 id="viewTitle">Home</h2>
        </div>
        <div class="actions">
          <span class="sync-mini only-mobile"><span class="sync-dot" id="syncDot2"></span></span>
          <button class="icon-btn" id="btnLock" title="Lock app" aria-label="Lock app">${icon('lock')}</button>
        </div>
      </header>
      <div id="banner"></div>
      <div class="content" id="content">
        ${VIEWS.map(v => `<section class="view" id="view-${v.id}"></section>`).join('')}
      </div>
    </main>
    <nav class="mobile-nav" id="mobileNav"></nav>
  </div>`;
  $('#btnMenu').onclick = () => document.body.classList.add('drawer-open');
  $('#drawerBg').onclick = () => document.body.classList.remove('drawer-open');
  $('#btnLock').onclick = () => A.onLock && A.onLock();
  if (A.user.demo) { $('#btnLock').title = 'Exit demo'; }
  VIEWS.forEach(v => { v.inited = false; });
}

function buildNav() {
  const items = NAV.filter(n => !n.owner || A.isOwner());
  $('#navMain').innerHTML = items.map(n => `<button class="nav-item${n.id === A.view ? ' active' : ''}" data-nav="${n.id}">${icon(n.id)}<span>${n.label}</span>${n.id === 'dues' ? '<span class="nav-count" id="navDues"></span>' : ''}</button>`).join('');
  $('#mobileNav').innerHTML = MOBILE_NAV.map(id => {
    const n = NAV.find(x => x.id === id);
    return `<button data-nav="${id}" class="${id === A.view ? 'active' : ''}">${icon(id)}<span>${n.label.split(' ')[0]}</span>${id === 'dues' ? '<i class="dot-count" id="navDues2"></i>' : ''}</button>`;
  }).join('');
  $$('[data-nav]').forEach(b => b.onclick = () => { document.body.classList.remove('drawer-open'); go(b.dataset.nav); });
  $('#shopNameSide').textContent = A.shop.name || 'My Shop';
  $('#userSide').textContent = (A.user.name || '') + (A.user.role === 'owner' ? ' · Owner' : ' · Staff');
}

function go(id, params = {}) {
  const v = VIEWS.find(x => x.id === id) || home;
  if (v.ownerOnly && !A.isOwner()) return;
  A.view = v.id; A.params = params;
  $$('.view').forEach(el => el.classList.toggle('active', el.id === 'view-' + v.id));
  const navId = v.id === 'customer' ? 'customers' : v.id;
  $$('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === navId));
  $('#viewTitle').textContent = typeof v.title === 'function' ? v.title() : v.title;
  const el = $('#view-' + v.id);
  if (!v.inited) { v.init && v.init(el); v.inited = true; }
  v.enter && v.enter(el, params);
  v.render(el);
  $('#content').scrollTop = 0;
  try { history.replaceState(null, '', '#' + v.id); } catch { }
}

let raf = 0;
function scheduleRender() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    const v = VIEWS.find(x => x.id === A.view);
    if (v && v.inited) v.render($('#view-' + v.id));
    updateBadges();
  });
}

function updateBadges() {
  const today = dayStr();
  const soon = A.S.salesOpen.filter(s => {
    const d = s.status === 'due' ? s.dueDate : s.chequeDate;
    return d && d <= addDaysSafe(today, 2);
  }).length;
  ['#navDues', '#navDues2'].forEach(sel => { const el = $(sel); if (el) { el.textContent = soon || ''; el.style.display = soon ? '' : 'none'; } });
  // subscription banner
  const b = $('#banner'); if (!b) return;
  if (A.user.demo) { b.innerHTML = `<div class="banner info">Demo mode — sample data stored only in this browser. <button class="linkbtn" data-exit-demo>Exit demo</button></div>`; const x = b.querySelector('[data-exit-demo]'); if (x) x.onclick = () => A.onSignOut(); return; }
  const end = A.licenceEnd(); const daysLeft = Math.ceil((end - Date.now()) / 86400000);
  if (A.shop.status === 'suspended') b.innerHTML = `<div class="banner bad">This shop's account is suspended. The app is read-only.</div>`;
  else if (end && daysLeft <= 0) b.innerHTML = `<div class="banner bad">Subscription expired on ${new Date(end).toLocaleDateString('en-GB')}. The app is read-only until renewed.</div>`;
  else if (end && daysLeft <= 5) b.innerHTML = `<div class="banner warn">${A.shop.plan === 'trial' ? 'Free trial' : 'Subscription'} ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.</div>`;
  else b.innerHTML = '';
}
function addDaysSafe(day, n) { const [y, m, d] = day.split('-').map(Number); const x = new Date(y, m - 1, d + n); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); }

export function setSyncState(st) {
  const map = { synced: ['ok', 'All changes saved to cloud'], pending: ['busy', 'Saving to cloud…'], offline: ['off', 'Offline — saved on this device'], demo: ['', 'Demo — this browser only'] };
  const [cls, label] = map[st] || ['', st];
  ['#syncDot', '#syncDot2'].forEach(s => { const el = $(s); if (el) el.className = 'sync-dot ' + cls; });
  const l = $('#syncLabel'); if (l) l.textContent = label;
}

/* ---------------- Live data ----------------
   Only what the screens need is kept live, to stay well inside Firestore's free
   50,000 reads/day even after years of sales:
   • phones in stock (sold phones are looked up on demand)
   • all accessories, customers, suppliers (small lists)
   • this month's sales/payments/expenses + every sale still open (credit/cheque)
   Older data is fetched only when a report or customer page asks for it. */
function subscribe() {
  A.unsubs.forEach(u => u()); A.unsubs = [];
  const D = A.data, S = A.S, ms = monthStart();
  const set = key => docs => { S[key] = docs; if (key === 'salesMonth' || key === 'salesOpen') mergeSales(); scheduleRender(); };
  A.unsubs.push(D.watch('phones', { where: [['status', '==', 'Available']] }, set('phones')));
  A.unsubs.push(D.watch('accessories', {}, set('accessories')));
  A.unsubs.push(D.watch('customers', {}, set('customers')));
  A.unsubs.push(D.watch('suppliers', {}, set('suppliers')));
  A.unsubs.push(D.watch('sales', { where: [['day', '>=', ms]] }, set('salesMonth')));
  A.unsubs.push(D.watch('sales', { where: [['open', '==', true]] }, set('salesOpen')));
  A.unsubs.push(D.watch('payments', { where: [['day', '>=', ms]] }, set('payments')));
  if (A.isOwner()) A.unsubs.push(D.watch('expenses', { where: [['day', '>=', ms]] }, set('expenses')));
  A.unsubs.push(D.watchShop(shop => {
    if (!shop) return;
    A.shop = shop; setCurrency(A.settings().currency || 'Rs');
    document.body.setAttribute('data-theme', lsGet('mdp_theme', 'light'));
    const n = $('#shopNameSide'); if (n) n.textContent = shop.name || 'My Shop';
    scheduleRender();
  }));
}
function mergeSales() {
  const m = new Map();
  [...A.S.salesMonth, ...A.S.salesOpen].forEach(s => m.set(s.id, s));
  A.S.sales = [...m.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

export function startApp({ data, user, shop }) {
  A.data = data; A.user = user; A.shop = shop || {};
  setCurrency(A.settings().currency || 'Rs');
  document.body.setAttribute('data-theme', lsGet('mdp_theme', 'light'));
  buildShell(); buildNav(); subscribe();
  const start = (location.hash || '').slice(1);
  go(VIEWS.some(v => v.id === start && v.id !== 'customer') ? start : (A.isOwner() ? 'home' : 'sell'));
}
export function stopApp() {
  A.unsubs.forEach(u => u()); A.unsubs = [];
  const app = $('#app'); app.style.display = 'none'; app.innerHTML = '';
  $$('.overlay,.scan-ov').forEach(o => o.remove());
}
