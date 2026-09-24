/* SELL (point of sale). Phones are always sold by exact IMEI — scan the box, or pick the
   IMEI from the list — so stock, warranty and the invoice all point at the real unit. */
import { A, icon } from '../app.js';
import { $, $$, esc, money, money0, num, toast, dayStr, addDays, cleanDigits, luhnOk, modal, prettyDay } from '../util.js';
import { openScanner, preloadScanner } from '../scanner.js';
import * as ops from '../ops.js';
import { showInvoice, customerDialog } from '../ui.js';

let cart = [], cust = null, pay = 'cash', filter = 'all', elRef = null;

function groupsOf(phones) {
  const g = new Map();
  phones.forEach(p => {
    const key = [p.brand, p.model, p.storage, p.sell].join('|');
    if (!g.has(key)) g.set(key, { key, brand: p.brand, model: p.model, storage: p.storage, ram: p.ram, sell: p.sell, photo: p.photo, units: [] });
    const x = g.get(key); x.units.push(p); if (!x.photo && p.photo) x.photo = p.photo;
  });
  return [...g.values()].sort((a, b) => (a.brand + a.model).localeCompare(b.brand + b.model));
}
const ACC_ICON = { Charger: '🔌', Cable: '🔗', Earphones: '🎧', 'Back cover': '📔', 'Tempered glass': '🛡️', 'Power bank': '🔋', 'Memory card': '💾', 'Smart watch': '⌚' };
const accIcon = a => ACC_ICON[a.category] || '🎁';
const phoneName = p => [p.brand, p.model, p.storage, p.color].filter(Boolean).join(' ');
const inCartPhone = id => cart.some(c => c.type === 'phone' && c.phoneId === id);

function addPhone(p) {
  if (inCartPhone(p.id)) { toast('This phone is already in the bill'); return false; }
  cart.push({ type: 'phone', phoneId: p.id, name: phoneName(p), imei: p.imei1, imei2: p.imei2 || '', price: num(p.sell), cost: num(p.cost), warranty: p.warranty || '', qty: 1 });
  renderCart(); return true;
}
function addAcc(a) {
  const ex = cart.find(c => c.type === 'acc' && c.accId === a.id);
  const inCart = ex ? ex.qty : 0;
  if (inCart + 1 > (a.qty || 0)) { toast('Not enough stock of ' + a.name, 'error'); return; }
  if (ex) ex.qty++; else cart.push({ type: 'acc', accId: a.id, name: a.name, price: num(a.sell), cost: num(a.cost), qty: 1 });
  renderCart();
}

/* Scan one or many phones straight into the bill. */
export function startScanSell() {
  openScanner({
    title: 'Scan phone to sell', hint: 'Scan the IMEI barcode on the box or phone (dial *#06#)', multi: true, doneLabel: 'Done — go to bill',
    onCode: async list => sellByImei(list[0])
  });
}
async function sellByImei(imei) {
  const inCart = cart.find(c => c.imei === imei || c.imei2 === imei);
  if (inCart) return { ok: false, msg: 'Already in this bill: ' + inCart.name };
  const p = ops.findInStock(imei);
  if (p) { addPhone(p); return { ok: true, msg: '✓ Added ' + phoneName(p) + ' — ' + money(p.sell) }; }
  const any = await ops.lookupImei(imei).catch(() => null);
  if (any && any.status === 'Sold') return { ok: false, msg: `Already SOLD — ${any.invoiceNo || ''} to ${any.soldTo || ''} on ${prettyDay(any.soldDay)}` };
  return { ok: false, msg: `IMEI ${imei} is not in stock. Add it in Stock first.` };
}

function pickUnitDialog(g) {
  const units = g.units.filter(u => !inCartPhone(u.id));
  if (!units.length) { toast('All units of this model are already in the bill'); return; }
  if (units.length === 1) { addPhone(units[0]); return; }
  const m = modal({
    title: esc(g.brand + ' ' + g.model + (g.storage ? ' ' + g.storage : '')),
    body: `<button class="btn btn-primary btn-block" data-scan style="margin-bottom:12px;">${icon('scan')} Scan the IMEI of the box you are selling</button>
      <p class="hint" style="margin-bottom:8px;">…or tap the unit:</p>
      ${units.map(u => `<div class="list-row click" data-id="${u.id}"><div class="grow"><b class="mono">${esc(u.imei1)}</b>
        <div class="muted small">${esc(u.color || '')}${u.imei2 ? ' · IMEI2 ' + esc(u.imei2) : ''} · in stock since ${esc(prettyDay(u.addedDay))}</div></div><span class="btn btn-sm">Add</span></div>`).join('')}`
  });
  m.el.addEventListener('click', e => {
    const r = e.target.closest('[data-id]'); if (r) { const u = units.find(x => x.id === r.dataset.id); if (u && addPhone(u)) m.close(); }
    if (e.target.closest('[data-scan]')) { m.close(); startScanSell(); }
  });
}

function renderGrid() {
  const el = elRef; if (!el) return;
  const q = ($('#posSearch', el).value || '').trim().toLowerCase();
  const brands = [...new Set(A.S.phones.map(p => p.brand))].sort();
  $('#posChips', el).innerHTML = ['all', ...brands, 'Accessories'].map(f => `<button class="chip ${filter === f ? 'active' : ''}" data-filter="${esc(f)}">${f === 'all' ? 'All' : esc(f)}</button>`).join('');
  let items = [];
  if (filter !== 'Accessories') {
    let ph = A.S.phones; if (filter !== 'all') ph = ph.filter(p => p.brand === filter);
    if (q) ph = ph.filter(p => [p.brand, p.model, p.color, p.storage, ...(p.imeis || [])].join(' ').toLowerCase().includes(q));
    items = groupsOf(ph).map(g => ({ kind: 'g', g }));
  }
  if (filter === 'all' || filter === 'Accessories') {
    let acc = A.S.accessories.filter(a => (a.qty || 0) > 0);
    if (q) acc = acc.filter(a => [a.name, a.category].join(' ').toLowerCase().includes(q));
    items = items.concat(acc.map(a => ({ kind: 'a', a })));
  }
  $('#posGrid', el).innerHTML = items.length ? items.map((it, i) => {
    if (it.kind === 'g') {
      const g = it.g, left = g.units.filter(u => !inCartPhone(u.id)).length;
      return `<div class="prod-card" data-i="${i}"><span class="stock-tag ${left <= 2 ? 'low' : ''}">${left} left</span>
        <div class="prod-thumb">${g.photo ? `<img src="${esc(g.photo)}" alt="">` : '📱'}</div>
        <div class="prod-name">${esc(g.brand + ' ' + g.model)}</div><div class="prod-meta">${esc([g.ram, g.storage].filter(Boolean).join(' / '))}</div>
        <div class="prod-price">${money0(g.sell)}</div></div>`;
    }
    const a = it.a;
    return `<div class="prod-card" data-i="${i}"><span class="stock-tag ${a.qty <= (a.min ?? 2) ? 'low' : ''}">${a.qty} left</span>
      <div class="prod-thumb">${a.photo ? `<img src="${esc(a.photo)}" alt="">` : accIcon(a)}</div>
      <div class="prod-name">${esc(a.name)}</div><div class="prod-meta">${esc(a.category || '')}</div><div class="prod-price">${money0(a.sell)}</div></div>`;
  }).join('') : `<div class="empty" style="grid-column:1/-1;"><div class="e-icon">📦</div>${A.S.phones.length || A.S.accessories.length ? 'Nothing matches' : 'No stock yet — add phones in Stock'}</div>`;
  $('#posGrid', el).onclick = e => {
    const c = e.target.closest('[data-i]'); if (!c) return;
    const it = items[Number(c.dataset.i)]; if (!it) return;
    if (it.kind === 'g') pickUnitDialog(it.g); else addAcc(it.a);
  };
}

function totals() {
  const sub = cart.reduce((a, c) => a + num(c.price) * c.qty, 0);
  const disc = num($('#posDisc', elRef)?.value);
  return { sub, disc, total: Math.max(0, sub - disc) };
}
function renderCart() {
  const el = elRef; if (!el) return;
  const wrap = $('#cartItems', el);
  wrap.innerHTML = cart.length ? cart.map((c, i) => `
    <div class="cart-item">
      <div class="info"><div class="n">${esc(c.name)}</div>${c.imei ? `<div class="p mono">IMEI ${esc(c.imei)}</div>` : ''}</div>
      ${c.type === 'acc' ? `<div class="qty-ctrl"><button data-q="-1" data-i="${i}">−</button><span>${c.qty}</span><button data-q="1" data-i="${i}">+</button></div>` : ''}
      <input class="price-in" inputmode="decimal" value="${c.price}" data-price="${i}" aria-label="Price">
      <button class="icon-btn sm" data-rm="${i}" aria-label="Remove">✕</button>
    </div>`).join('') : `<div class="empty small-empty">${icon('scan')}<div>Scan a phone or tap a product</div></div>`;
  const cb = $('#custBox', el);
  if (cust) {
    const c = A.customerById(cust.id) || cust;
    cb.innerHTML = `<div class="cust-chip"><div class="grow"><b>${esc(c.name)}</b><div class="muted small">${esc(c.phone || '')}${c.balance > 0 ? ` · <span class="txt-amber">owes ${money0(c.balance)}</span>` : ''}</div></div><button class="icon-btn sm" data-clear-cust>✕</button></div>`;
  } else {
    cb.innerHTML = `<div class="cust-search"><input id="custIn" placeholder="Customer name or phone (optional for cash)" autocomplete="off"><button class="btn btn-sm" data-new-cust>+ New</button><div class="dropdown" id="custDrop"></div></div>`;
  }
  $$('#paySeg button', el).forEach(b => b.classList.toggle('active', b.dataset.v === pay));
  $('#creditBox', el).style.display = pay === 'credit' ? '' : 'none';
  $('#chequeBox', el).style.display = pay === 'cheque' ? '' : 'none';
  const t = totals();
  $('#cartSub', el).textContent = money(t.sub);
  $('#cartTotal', el).textContent = money(t.total);
  if (pay === 'credit') {
    const adv = num($('#advance', el).value);
    $('#creditBal', el).textContent = money(Math.max(0, t.total - adv));
  }
  $('#btnCheckout', el).textContent = cart.length ? `Complete sale · ${money0(t.total)}` : 'Complete sale';
  const cnt = $('#cartCount', el); cnt.textContent = cart.length ? `(${cart.reduce((a, c) => a + c.qty, 0)})` : '';
  // mobile floating bar
  const fb = $('#cartFab', el);
  fb.style.display = cart.length ? '' : 'none';
  fb.innerHTML = `${cart.length} item${cart.length === 1 ? '' : 's'} · <b>${money0(t.total)}</b> — View bill ↓`;
}

function custSearch() {
  const inp = $('#custIn', elRef), drop = $('#custDrop', elRef); if (!inp) return;
  const q = inp.value.trim().toLowerCase(), qd = cleanDigits(q);
  if (!q) { drop.style.display = 'none'; return; }
  const list = A.S.customers.filter(c => c.name.toLowerCase().includes(q) || (qd.length >= 3 && cleanDigits(c.phone).includes(qd))).slice(0, 8);
  drop.innerHTML = list.map(c => `<div class="dd-opt" data-cid="${c.id}"><b>${esc(c.name)}</b> <span class="muted">· ${esc(c.phone || '')}</span>${c.balance > 0 ? ` <span class="badge badge-amber">${money0(c.balance)}</span>` : ''}</div>`).join('')
    + `<div class="dd-opt dd-add" data-addnew>+ Add “${esc(inp.value.trim())}” as new customer</div>`;
  drop.style.display = 'block';
}

async function doCheckout() {
  if (!cart.length) return toast('The bill is empty', 'error');
  for (const c of cart) {
    if (c.type === 'phone' && !A.S.phones.some(p => p.id === c.phoneId)) {
      return toast(`${c.name} (IMEI ${c.imei}) was just sold on another device. Remove it from the bill.`, 'error');
    }
    if (c.type === 'acc') { const a = A.S.accessories.find(x => x.id === c.accId); if (!a || a.qty < c.qty) return toast('Not enough stock of ' + c.name, 'error'); }
  }
  if ((pay === 'credit' || pay === 'cheque') && !cust) return toast('Choose or add the customer — credit and cheque sales need a name and phone number for reminders', 'error');
  const t = totals();
  const payload = { cart, customer: cust ? (A.customerById(cust.id) || cust) : null, payment: pay, discount: t.disc };
  if (pay === 'credit') {
    payload.dueDate = $('#dueDate', elRef).value; payload.paidNow = num($('#advance', elRef).value);
    if (!payload.dueDate) return toast('Choose the due date', 'error');
    if (payload.paidNow >= t.total) return toast('Advance covers the full amount — use Cash instead', 'error');
  }
  if (pay === 'cheque') {
    payload.cheque = { no: $('#chqNo', elRef).value.trim(), bank: $('#chqBank', elRef).value.trim(), date: $('#chqDate', elRef).value };
    if (!payload.cheque.no || !payload.cheque.date) return toast('Enter cheque number and cheque date', 'error');
  }
  const btn = $('#btnCheckout', elRef); btn.disabled = true;
  try {
    const sale = await ops.checkout(payload);
    if (!sale) return;
    cart = []; cust = null; pay = 'cash';
    ['#posDisc', '#advance', '#chqNo', '#chqBank'].forEach(s => { const i = $(s, elRef); if (i) i.value = ''; });
    $('#dueDate', elRef).value = addDays(dayStr(), 30); $('#chqDate', elRef).value = dayStr();
    renderCart(); renderGrid();
    toast('Sale completed — ' + sale.invoiceNo);
    showInvoice(sale);
  } catch (e) { console.error(e); toast('Could not complete the sale: ' + (e.message || e), 'error'); }
  finally { btn.disabled = false; }
}

export default {
  id: 'sell', title: 'Sell',
  init(el) {
    elRef = el;
    el.innerHTML = `
    <div class="pos-wrap">
      <div>
        <div class="scan-bar">
          <button class="btn btn-primary btn-scan" id="btnScanSell">${icon('scan')} Scan IMEI</button>
          <div class="search-wrap"><input id="posSearch" placeholder="Search model, IMEI, accessory… (scanner gun works here)" autocomplete="off"></div>
        </div>
        <div class="chip-row" id="posChips"></div>
        <div class="prod-grid" id="posGrid"></div>
        <button class="cart-fab only-mobile" id="cartFab" style="display:none"></button>
      </div>
      <div class="card pad cart-panel" id="cartPanel">
        <div class="card-head"><h4>Bill <span id="cartCount" class="muted"></span></h4><button class="btn btn-sm btn-ghost" id="btnClear">Clear</button></div>
        <div id="custBox"></div>
        <div id="cartItems" class="cart-items"></div>
        <div class="tot-row"><span>Subtotal</span><span id="cartSub"></span></div>
        <div class="tot-row"><span>Discount</span><input id="posDisc" inputmode="decimal" placeholder="0" class="price-in"></div>
        <div class="tot-row big"><span>Total</span><span id="cartTotal"></span></div>
        <label style="margin-top:12px;">Payment</label>
        <div class="seg seg5" id="paySeg">
          <button data-v="cash">Cash</button><button data-v="card">Card</button><button data-v="bank">Bank</button><button data-v="credit">Credit</button><button data-v="cheque">Cheque</button>
        </div>
        <div id="creditBox" class="sub-box">
          <div class="field"><label>Due date</label><input type="date" id="dueDate">
            <div class="chip-row tight" style="margin:6px 0 0;"><button class="chip" data-due="7">1 week</button><button class="chip" data-due="14">2 weeks</button><button class="chip" data-due="30">1 month</button><button class="chip" data-due="60">2 months</button></div></div>
          <div class="field-row"><div class="field"><label>Advance paid now</label><input id="advance" inputmode="decimal" placeholder="0"></div>
            <div class="field"><label>Balance on credit</label><div class="static-val" id="creditBal"></div></div></div>
        </div>
        <div id="chequeBox" class="sub-box">
          <div class="field-row"><div class="field"><label>Cheque no *</label><input id="chqNo" inputmode="numeric"></div><div class="field"><label>Bank</label><input id="chqBank" list="bankList"></div></div>
          <div class="field"><label>Cheque date *</label><input type="date" id="chqDate"></div>
          <datalist id="bankList">${['BOC', "People's Bank", 'Commercial Bank', 'HNB', 'Sampath', 'Seylan', 'NSB', 'DFCC', 'NDB', 'Pan Asia', 'Union Bank', 'Amana', 'Cargills Bank', 'HSBC', 'Standard Chartered'].map(b => `<option>${b}</option>`).join('')}</datalist>
        </div>
        <button class="btn btn-primary btn-block btn-lg" id="btnCheckout">Complete sale</button>
      </div>
    </div>`;
    $('#dueDate', el).value = addDays(dayStr(), 30); $('#chqDate', el).value = dayStr();
    $('#btnScanSell', el).onclick = startScanSell;
    $('#btnScanSell', el).addEventListener('pointerenter', preloadScanner, { once: true });
    const search = $('#posSearch', el);
    search.addEventListener('input', renderGrid);
    search.addEventListener('keydown', async e => {
      if (e.key !== 'Enter') return;
      const d = cleanDigits(search.value);
      if (d.length === 15) { // barcode gun or typed IMEI
        e.preventDefault();
        if (!luhnOk(d)) { toast('That IMEI has a wrong check digit — scan again', 'error'); return; }
        const r = await sellByImei(d); toast(r.msg, r.ok ? '' : 'error'); if (r.ok) { search.value = ''; renderGrid(); }
      }
    });
    $('#posChips', el).onclick = e => { const c = e.target.closest('[data-filter]'); if (c) { filter = c.dataset.filter; renderGrid(); } };
    $('#btnClear', el).onclick = () => { cart = []; cust = null; renderCart(); renderGrid(); };
    $('#cartFab', el).onclick = () => $('#cartPanel', el).scrollIntoView({ behavior: 'smooth' });
    $('#btnCheckout', el).onclick = doCheckout;
    $('#posDisc', el).addEventListener('input', renderCartTotalsOnly);
    $('#advance', el).addEventListener('input', renderCartTotalsOnly);
    const panel = $('#cartPanel', el);
    panel.addEventListener('click', e => {
      const t = e.target;
      if (t.closest('[data-rm]')) { cart.splice(Number(t.closest('[data-rm]').dataset.rm), 1); renderCart(); renderGrid(); }
      else if (t.closest('[data-q]')) {
        const b = t.closest('[data-q]'), c = cart[Number(b.dataset.i)], d = Number(b.dataset.q);
        const a = A.S.accessories.find(x => x.id === c.accId);
        if (c.qty + d < 1) cart.splice(Number(b.dataset.i), 1);
        else if (a && c.qty + d > a.qty) toast('Not enough stock', 'error'); else c.qty += d;
        renderCart();
      }
      else if (t.closest('#paySeg button')) { pay = t.closest('button').dataset.v; renderCart(); }
      else if (t.closest('[data-due]')) { $('#dueDate', el).value = addDays(dayStr(), Number(t.closest('[data-due]').dataset.due)); }
      else if (t.closest('[data-clear-cust]')) { cust = null; renderCart(); }
      else if (t.closest('[data-new-cust]') || t.closest('[data-addnew]')) {
        const typed = ($('#custIn', el)?.value || '').trim(); const digits = cleanDigits(typed);
        customerDialog(digits.length >= 9 ? { phone: typed } : { name: typed }, c => { cust = c; renderCart(); });
      }
      else if (t.closest('[data-cid]')) { cust = A.customerById(t.closest('[data-cid]').dataset.cid); renderCart(); }
    });
    panel.addEventListener('input', e => {
      if (e.target.id === 'custIn') custSearch();
      if (e.target.dataset.price != null) { cart[Number(e.target.dataset.price)].price = num(e.target.value); renderCartTotalsOnly(); }
    });
    panel.addEventListener('focusout', e => { if (e.target.id === 'custIn') setTimeout(() => { const d = $('#custDrop', el); if (d) d.style.display = 'none'; }, 180); });
    function renderCartTotalsOnly() {
      const t = totals(); $('#cartSub', el).textContent = money(t.sub); $('#cartTotal', el).textContent = money(t.total);
      if (pay === 'credit') $('#creditBal', el).textContent = money(Math.max(0, t.total - num($('#advance', el).value)));
      $('#btnCheckout', el).textContent = cart.length ? `Complete sale · ${money0(t.total)}` : 'Complete sale';
    }
  },
  render() {
    renderGrid();
    // don't redraw the bill while someone is typing in it (a sync from another device would steal focus)
    if (!$('#cartPanel', elRef).contains(document.activeElement)) renderCart();
  }
};
