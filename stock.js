/* STOCK — phones by IMEI, accessories by quantity, and an IMEI lookup for sold phones
   (warranty claims, "did we sell this phone?"). */
import { A, icon } from '../app.js';
import { $, $$, esc, money, money0, num, toast, modal, confirmBox, dayStr, addDays, prettyDay, cleanDigits, luhnOk, imageToThumb, beep } from '../util.js';
import { openScanner, preloadScanner } from '../scanner.js';
import * as ops from '../ops.js';
import { showInvoice } from '../ui.js';

let tab = 'phones', soldCache = null, elRef = null;
const canAddStock = () => A.isOwner() || !!A.settings().staffCanAddStock;
const BRANDS = ['Samsung', 'Apple', 'Xiaomi', 'Redmi', 'Oppo', 'Vivo', 'Realme', 'Huawei', 'Honor', 'Nokia', 'Tecno', 'Infinix', 'itel', 'Motorola', 'OnePlus', 'Google'];
const WARRANTIES = ['1 year company warranty', '2 years company warranty', '6 months shop warranty', '3 months shop warranty', 'No warranty'];
const ACC_CATS = ['Charger', 'Cable', 'Earphones', 'Back cover', 'Tempered glass', 'Power bank', 'Memory card', 'Smart watch', 'Other'];

/* ================= Add phones (bulk, scan one box after another) ================= */
export function openAddStock(prefill = {}) {
  if (!canAddStock()) return toast('Only the owner can add stock (can be changed in Settings)', 'error');
  if (!A.guard()) return;
  preloadScanner();
  const brands = [...new Set([...A.S.phones.map(p => p.brand), ...BRANDS])];
  const models = [...new Set(A.S.phones.map(p => p.model))];
  let units = [], pending = null, dual = true;
  const m = modal({
    title: 'Add phones to stock', wide: true,
    body: `
      <div class="step-title"><span>1</span> Phone details (same for every box you scan)</div>
      <div class="field-row3">
        <div class="field"><label>Brand *</label><input data-f="brand" list="dlBrands" value="${esc(prefill.brand || '')}"></div>
        <div class="field"><label>Model *</label><input data-f="model" list="dlModels" value="${esc(prefill.model || '')}" placeholder="e.g. Galaxy A15"></div>
        <div class="field"><label>Colour</label><input data-f="color" value="${esc(prefill.color || '')}"></div>
      </div>
      <div class="field-row3">
        <div class="field"><label>RAM</label><input data-f="ram" value="${esc(prefill.ram || '')}" placeholder="8GB"></div>
        <div class="field"><label>Storage</label><input data-f="storage" value="${esc(prefill.storage || '')}" placeholder="128GB"></div>
        <div class="field"><label>Warranty</label><input data-f="warranty" list="dlWarr" value="${esc(prefill.warranty || '1 year company warranty')}"></div>
      </div>
      <div class="field-row3">
        <div class="field"><label>Cost price *</label><input data-f="cost" inputmode="decimal" value="${esc(prefill.cost || '')}"></div>
        <div class="field"><label>Selling price *</label><input data-f="sell" inputmode="decimal" value="${esc(prefill.sell || '')}"></div>
        <div class="field"><label>Supplier</label><input data-f="supplierName" list="dlSup" value="${esc(prefill.supplierName || '')}"></div>
      </div>
      <div class="field-row"><div class="field"><label>Photo (optional)</label><input type="file" accept="image/*" data-photo></div>
        <div class="field"><label>Notes</label><input data-f="notes"></div></div>
      <datalist id="dlBrands">${brands.map(b => `<option>${esc(b)}</option>`).join('')}</datalist>
      <datalist id="dlModels">${models.map(b => `<option>${esc(b)}</option>`).join('')}</datalist>
      <datalist id="dlWarr">${WARRANTIES.map(b => `<option>${esc(b)}</option>`).join('')}</datalist>
      <datalist id="dlSup">${A.S.suppliers.map(s => `<option>${esc(s.name)}</option>`).join('')}</datalist>

      <div class="step-title" style="margin-top:8px;"><span>2</span> Scan the IMEI of each box</div>
      <label class="check"><input type="checkbox" data-dual checked> Dual SIM — scan IMEI 1 and IMEI 2 of each box</label>
      <div class="scan-bar" style="margin:10px 0;">
        <button class="btn btn-primary btn-scan" data-scan>${icon('scan')} Scan IMEIs</button>
        <form data-manual style="flex:1;display:flex;gap:8px;"><input data-imei inputmode="numeric" placeholder="or type IMEI / use scanner gun + Enter" autocomplete="off"><button class="btn" type="submit">Add</button></form>
      </div>
      <div data-units></div>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-save>Save</button>`
  });
  const $m = s => m.$(s);
  const tac = i => i.slice(0, 8);

  function allImeis() { return units.flatMap(u => [u.imei1, u.imei2].filter(Boolean)); }
  function add(list) {
    const msgs = []; let ok = true;
    for (const imei of list) {
      if (allImeis().includes(imei)) { ok = false; msgs.push(imei + ' is already in this list'); continue; }
      const st = ops.findInStock(imei);
      if (st) { ok = false; msgs.push(`${imei} is already in stock (${st.brand} ${st.model})`); continue; }
      if (dual && pending && !pending.imei2) {
        // IMEI 1 and 2 of one phone normally share the first 8 digits (model code) — warn if not.
        pending.imei2 = imei;
        msgs.push(`✓ Box ${units.indexOf(pending) + 1} complete` + (tac(pending.imei1) !== tac(imei) ? ' (check: IMEI 2 looks like a different model)' : ''));
        pending = null;
      } else {
        const u = { imei1: imei, imei2: '' }; units.push(u); pending = dual ? u : null;
        msgs.push(`✓ Box ${units.length}: ${imei}${dual ? ' — now scan IMEI 2' : ''}`);
      }
    }
    renderUnits();
    return { ok, msg: msgs.join(' · ') };
  }
  // Two IMEIs read from the same label at once → one dual-SIM box.
  function addPair(list) {
    if (dual && list.length === 2 && !allImeis().some(i => list.includes(i)) && !list.some(i => ops.findInStock(i))) {
      if (pending && !pending.imei2) pending = null;
      units.push({ imei1: list[0], imei2: list[1] }); renderUnits();
      return { ok: true, msg: `✓ Box ${units.length}: both IMEIs read` };
    }
    return add(list);
  }
  function renderUnits() {
    const w = $m('[data-units]');
    w.innerHTML = units.length ? `<table class="tbl-compact"><thead><tr><th>#</th><th>IMEI 1</th>${dual ? '<th>IMEI 2</th>' : ''}<th></th></tr></thead><tbody>
      ${units.map((u, i) => `<tr><td>${i + 1}</td><td class="mono">${esc(u.imei1)}</td>${dual ? `<td class="mono">${u.imei2 ? esc(u.imei2) : (u === pending ? '<span class="badge badge-amber">scan IMEI 2…</span> <button class="linkbtn" data-skip>skip</button>' : '—')}</td>` : ''}
      <td><button class="icon-btn sm" data-del="${i}">✕</button></td></tr>`).join('')}</tbody></table>`
      : `<div class="empty small-empty">No IMEIs yet. Tap “Scan IMEIs” and scan one box after another.</div>`;
    $m('[data-save]').textContent = units.length ? `Save ${units.length} phone${units.length === 1 ? '' : 's'}` : 'Save';
  }
  renderUnits();
  $m('[data-dual]').onchange = e => { dual = e.target.checked; if (!dual) pending = null; renderUnits(); };
  m.el.addEventListener('click', e => {
    const d = e.target.closest('[data-del]'); if (d) { const u = units.splice(Number(d.dataset.del), 1)[0]; if (u === pending) pending = null; renderUnits(); }
    if (e.target.closest('[data-skip]')) { pending = null; renderUnits(); }
  });
  $m('[data-scan]').onclick = () => {
    const f = readBase(); if (!f) return;
    openScanner({
      title: `Scan ${f.brand} ${f.model}`, hint: dual ? 'Scan IMEI 1, then IMEI 2 of the same box' : 'Scan the IMEI barcode of each box',
      multi: true, doneLabel: 'Done', onCode: async list => addPair(list)
    });
  };
  $m('[data-manual]').onsubmit = e => {
    e.preventDefault();
    const inp = $m('[data-imei]'); const d = cleanDigits(inp.value);
    if (d.length !== 15) { beep(false); return toast('IMEI must be 15 digits', 'error'); }
    if (!luhnOk(d) && inp.dataset.warned !== d) { beep(false); inp.dataset.warned = d; return toast('Check digit is wrong — re-check. Press Add again to use it anyway.', 'error'); }
    inp.dataset.warned = ''; const r = add([d]); beep(r.ok); if (!r.ok) toast(r.msg, 'error'); inp.value = ''; inp.focus();
  };
  function readBase() {
    const f = {}; m.el.querySelectorAll('[data-f]').forEach(i => f[i.dataset.f] = i.value.trim());
    if (!f.brand || !f.model) { toast('Enter brand and model first', 'error'); return null; }
    return f;
  }
  $m('[data-save]').onclick = async () => {
    const f = readBase(); if (!f) return;
    if (!num(f.sell)) return toast('Enter the selling price', 'error');
    if (!units.length) return toast('Scan at least one IMEI', 'error');
    const btn = $m('[data-save]'); btn.disabled = true; btn.textContent = 'Checking IMEIs…';
    try {
      const dups = await ops.existingImeis(allImeis());
      if (dups.size) { toast('Already in the system: ' + [...dups].join(', '), 'error'); return; }
      const file = $m('[data-photo]').files[0];
      if (file) f.photo = await imageToThumb(file, 240);
      if (await ops.addPhones(f, units)) { toast(`${units.length} phone${units.length === 1 ? '' : 's'} added to stock`); m.close(); }
    } catch (e) { console.error(e); toast('Could not check IMEIs — are you online? ' + (e.message || ''), 'error'); }
    finally { btn.disabled = false; renderUnits(); }
  };
}

/* ================= Edit one phone ================= */
function editPhone(p) {
  const own = A.isOwner();
  const m = modal({
    title: 'Edit phone',
    body: `
      <div class="field-row"><div class="field"><label>Brand</label><input data-f="brand" value="${esc(p.brand)}"></div><div class="field"><label>Model</label><input data-f="model" value="${esc(p.model)}"></div></div>
      <div class="field-row3"><div class="field"><label>Colour</label><input data-f="color" value="${esc(p.color)}"></div><div class="field"><label>RAM</label><input data-f="ram" value="${esc(p.ram)}"></div><div class="field"><label>Storage</label><input data-f="storage" value="${esc(p.storage)}"></div></div>
      <div class="field"><label>IMEI 1</label><div class="input-btn"><input data-f="imei1" inputmode="numeric" value="${esc(p.imei1)}"><button class="btn" data-scan="imei1">${icon('scan')}</button></div></div>
      <div class="field"><label>IMEI 2</label><div class="input-btn"><input data-f="imei2" inputmode="numeric" value="${esc(p.imei2)}"><button class="btn" data-scan="imei2">${icon('scan')}</button></div></div>
      <div class="field-row">${own ? `<div class="field"><label>Cost price</label><input data-f="cost" inputmode="decimal" value="${esc(p.cost)}"></div>` : ''}<div class="field"><label>Selling price</label><input data-f="sell" inputmode="decimal" value="${esc(p.sell)}"></div></div>
      <div class="field-row"><div class="field"><label>Warranty</label><input data-f="warranty" value="${esc(p.warranty)}"></div><div class="field"><label>Supplier</label><input data-f="supplierName" value="${esc(p.supplierName)}"></div></div>
      <div class="field"><label>Notes</label><input data-f="notes" value="${esc(p.notes)}"></div>
      <p class="hint">Added ${esc(prettyDay(p.addedDay))} by ${esc(p.addedBy || '')}</p>`,
    foot: `${own ? '<button class="btn btn-red" data-del style="margin-right:auto">Delete</button>' : ''}<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-ok>Save</button>`
  });
  m.el.addEventListener('click', e => {
    const s = e.target.closest('[data-scan]'); if (!s) return;
    openScanner({ title: 'Scan ' + s.dataset.scan.toUpperCase(), onCode: async list => { m.$(`[data-f="${s.dataset.scan}"]`).value = list[0]; if (list[1] && s.dataset.scan === 'imei1') m.$('[data-f="imei2"]').value = list[1]; return { ok: true, msg: list.join(' / ') }; } });
  });
  m.$('[data-ok]').onclick = async () => {
    const d = {}; m.el.querySelectorAll('[data-f]').forEach(i => d[i.dataset.f] = i.value.trim());
    d.imei1 = cleanDigits(d.imei1); d.imei2 = cleanDigits(d.imei2);
    if (d.imei1.length !== 15) return toast('IMEI 1 must be 15 digits', 'error');
    if (d.imei2 && d.imei2.length !== 15) return toast('IMEI 2 must be 15 digits', 'error');
    const changed = [d.imei1, d.imei2].filter(i => i && !(p.imeis || []).includes(i));
    if (changed.length) {
      const dups = await ops.existingImeis(changed).catch(() => new Set());
      if (dups.size) return toast('Already in the system: ' + [...dups].join(', '), 'error');
    }
    if (d.cost != null) d.cost = num(d.cost); d.sell = num(d.sell);
    if (await ops.updatePhone(p.id, d)) { toast('Saved'); m.close(); }
  };
  const del = m.$('[data-del]');
  if (del) del.onclick = async () => { if (await confirmBox(`Delete ${p.brand} ${p.model} (IMEI ${p.imei1}) from stock?`, 'Delete')) { if (await ops.deletePhone(p)) { toast('Deleted'); m.close(); } } };
}

/* ================= Accessories ================= */
function accDialog(a = null) {
  if (!canAddStock()) return toast('Only the owner can change stock', 'error');
  const m = modal({
    title: a ? 'Edit accessory' : 'New accessory',
    body: `<div class="field-row"><div class="field"><label>Category</label><input data-f="category" list="dlCats" value="${esc(a?.category || '')}"></div><div class="field"><label>Name *</label><input data-f="name" value="${esc(a?.name || '')}" placeholder="e.g. Type-C 25W charger"></div></div>
      <div class="field-row"><div class="field"><label>Cost price</label><input data-f="cost" inputmode="decimal" value="${esc(a?.cost ?? '')}"></div><div class="field"><label>Selling price *</label><input data-f="sell" inputmode="decimal" value="${esc(a?.sell ?? '')}"></div></div>
      <div class="field-row"><div class="field"><label>Quantity in stock</label><input data-f="qty" inputmode="numeric" value="${esc(a?.qty ?? '')}"></div><div class="field"><label>Warn when below</label><input data-f="min" inputmode="numeric" value="${esc(a?.min ?? 2)}"></div></div>
      <div class="field-row"><div class="field"><label>Supplier</label><input data-f="supplierName" list="dlSup2" value="${esc(a?.supplierName || '')}"></div><div class="field"><label>Photo</label><input type="file" accept="image/*" data-photo></div></div>
      <datalist id="dlCats">${ACC_CATS.map(c => `<option>${c}</option>`).join('')}</datalist>
      <datalist id="dlSup2">${A.S.suppliers.map(s => `<option>${esc(s.name)}</option>`).join('')}</datalist>`,
    foot: `${a && A.isOwner() ? '<button class="btn btn-red" data-del style="margin-right:auto">Delete</button>' : ''}<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-ok>Save</button>`
  });
  m.$('[data-ok]').onclick = async () => {
    const d = {}; m.el.querySelectorAll('[data-f]').forEach(i => d[i.dataset.f] = i.value.trim());
    if (!d.name) return toast('Name is required', 'error');
    d.cost = num(d.cost); d.sell = num(d.sell); d.qty = Math.round(num(d.qty)); d.min = Math.round(num(d.min));
    const file = m.$('[data-photo]').files[0]; if (file) d.photo = await imageToThumb(file, 240);
    if (await ops.saveAccessory(a?.id, d)) { toast('Saved'); m.close(); }
  };
  const del = m.$('[data-del]');
  if (del) del.onclick = async () => { if (await confirmBox('Delete ' + a.name + '?', 'Delete')) { if (await ops.removeDoc('accessories', a.id)) { toast('Deleted'); m.close(); } } };
}
function restockDialog(a) {
  if (!canAddStock()) return toast('Only the owner can change stock', 'error');
  const m = modal({
    title: 'Restock ' + esc(a.name),
    body: `<p class="muted" style="margin-bottom:10px;">Now in stock: <b>${a.qty}</b></p>
      <div class="field-row"><div class="field"><label>Quantity received</label><input data-q inputmode="numeric"></div>
      ${A.isOwner() ? `<div class="field"><label>New cost price (optional)</label><input data-c inputmode="decimal" placeholder="${esc(a.cost)}"></div>` : ''}</div>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-ok>Add to stock</button>`
  });
  m.$('[data-ok]').onclick = async () => {
    const q = Math.round(num(m.$('[data-q]').value)); if (!q) return toast('Enter quantity', 'error');
    if (await ops.restockAccessory(a, q, m.$('[data-c]') ? m.$('[data-c]').value : '')) { toast(`+${q} ${a.name}`); m.close(); }
  };
}

/* ================= IMEI lookup ================= */
async function lookupAndShow(imei) {
  const p = await ops.lookupImei(imei).catch(e => { toast('Lookup failed — are you online?', 'error'); return undefined; });
  if (p === undefined) return;
  const box = $('#lookupResult', elRef);
  if (!p) { box.innerHTML = `<div class="card pad"><b>IMEI ${esc(imei)}</b><p class="muted">Not found in this shop's records.</p></div>`; return; }
  box.innerHTML = `<div class="card pad lookup-card">
    <div class="card-head"><h4>${esc(p.brand + ' ' + p.model)} ${esc(p.storage || '')} ${esc(p.color || '')}</h4>${p.status === 'Sold' ? '<span class="badge badge-slate">Sold</span>' : '<span class="badge badge-green">In stock</span>'}</div>
    <div class="kv"><span>IMEI 1</span><b class="mono">${esc(p.imei1)}</b></div>${p.imei2 ? `<div class="kv"><span>IMEI 2</span><b class="mono">${esc(p.imei2)}</b></div>` : ''}
    <div class="kv"><span>Stock in</span><b>${esc(prettyDay(p.addedDay))}${p.supplierName ? ' · ' + esc(p.supplierName) : ''}</b></div>
    ${p.status === 'Sold' ? `<div class="kv"><span>Sold</span><b>${esc(prettyDay(p.soldDay))} · ${esc(p.soldTo || '')}</b></div>
      <div class="kv"><span>Invoice</span><b>${esc(p.invoiceNo || '')}</b></div>
      <div class="kv"><span>Warranty</span><b>${esc(p.warranty || '—')}</b></div>
      ${p.saleId ? `<button class="btn btn-sm" data-open-sale="${esc(p.saleId)}" style="margin-top:10px;">Open invoice</button>` : ''}` : `<div class="kv"><span>Price</span><b>${money(p.sell)}</b></div>`}
  </div>`;
}

/* ================= View ================= */
export default {
  id: 'stock', title: 'Stock',
  init(el) {
    elRef = el;
    el.innerHTML = `
      <div class="tabs" id="stockTabs"><div class="tab" data-tab="phones">Phones</div><div class="tab" data-tab="acc">Accessories</div><div class="tab" data-tab="lookup">IMEI lookup / sold</div></div>
      <div class="toolbar" id="stockToolbar">
        <div class="search-wrap"><input id="stockSearch" placeholder="Search model or IMEI" autocomplete="off"></div>
        <button class="btn btn-primary" id="btnAddStock">+ Add phones</button>
        <button class="btn btn-primary" id="btnAddAcc" style="display:none">+ New accessory</button>
      </div>
      <div id="lookupBar" class="scan-bar" style="display:none">
        <button class="btn btn-primary btn-scan" id="btnLookupScan">${icon('scan')} Scan IMEI</button>
        <form id="lookupForm" style="flex:1;display:flex;gap:8px;"><input id="lookupIn" inputmode="numeric" placeholder="Type IMEI to find any phone (sold or in stock)"><button class="btn" type="submit">Find</button></form>
      </div>
      <div id="lookupResult"></div>
      <div id="stockBody"></div>`;
    $('#stockTabs', el).onclick = e => { const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; this.render(el); } };
    $('#stockSearch', el).addEventListener('input', () => this.render(el));
    $('#btnAddStock', el).onclick = () => openAddStock();
    $('#btnAddAcc', el).onclick = () => accDialog();
    $('#btnLookupScan', el).onclick = () => openScanner({ title: 'Find phone by IMEI', onCode: async l => { $('#lookupIn', el).value = l[0]; lookupAndShow(l[0]); return { ok: true, msg: l[0] }; } });
    $('#lookupForm', el).onsubmit = e => { e.preventDefault(); const d = cleanDigits($('#lookupIn', el).value); if (d.length !== 15) return toast('IMEI must be 15 digits', 'error'); lookupAndShow(d); };
    el.addEventListener('click', async e => {
      const t = e.target;
      const ed = t.closest('[data-edit-phone]'); if (ed) { const p = A.S.phones.find(x => x.id === ed.dataset.editPhone); if (p) editPhone(p); }
      const ea = t.closest('[data-edit-acc]'); if (ea) { const a = A.S.accessories.find(x => x.id === ea.dataset.editAcc); if (a) accDialog(a); }
      const ra = t.closest('[data-restock]'); if (ra) { const a = A.S.accessories.find(x => x.id === ra.dataset.restock); if (a) restockDialog(a); }
      const ad = t.closest('[data-add-like]'); if (ad) { const p = A.S.phones.find(x => x.id === ad.dataset.addLike); if (p) openAddStock(p); }
      const os = t.closest('[data-open-sale]'); if (os) { const s = A.S.sales.find(x => x.id === os.dataset.openSale) || await A.data.get('sales', os.dataset.openSale).catch(() => null); if (s) showInvoice(s); }
      const sold = t.closest('[data-sold-imei]'); if (sold) { $('#lookupIn', el).value = sold.dataset.soldImei; lookupAndShow(sold.dataset.soldImei); window.scrollTo(0, 0); $('#content').scrollTop = 0; }
    });
  },
  enter() { soldCache = null; },
  render(el) {
    const own = A.isOwner();
    $$('#stockTabs .tab', el).forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    $('#stockToolbar', el).style.display = tab === 'lookup' ? 'none' : '';
    $('#lookupBar', el).style.display = tab === 'lookup' ? '' : 'none';
    $('#lookupResult', el).style.display = tab === 'lookup' ? '' : 'none';
    $('#btnAddStock', el).style.display = tab === 'phones' && canAddStock() ? '' : 'none';
    $('#btnAddAcc', el).style.display = tab === 'acc' && canAddStock() ? '' : 'none';
    const q = ($('#stockSearch', el).value || '').trim().toLowerCase();
    const body = $('#stockBody', el);

    if (tab === 'phones') {
      const list = A.S.phones.filter(p => !q || [p.brand, p.model, p.color, p.storage, p.supplierName, ...(p.imeis || [])].join(' ').toLowerCase().includes(q))
        .sort((a, b) => (a.brand + a.model + a.storage).localeCompare(b.brand + b.model + b.storage) || (a.addedAt || 0) - (b.addedAt || 0));
      const value = A.S.phones.reduce((a, p) => a + num(p.cost), 0);
      const groups = new Map();
      list.forEach(p => { const k = [p.brand, p.model, p.storage].join(' '); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); });
      body.innerHTML = `<p class="muted small" style="margin-bottom:10px;">${A.S.phones.length} phones in stock${own ? ' · stock value ' + money0(value) : ''}</p>` + (list.length ? [...groups.entries()].map(([k, ps]) => `
        <div class="card group-card">
          <div class="group-head"><div><b>${esc(k)}</b> <span class="badge badge-teal">${ps.length}</span></div>
            <div style="display:flex;gap:8px;align-items:center;"><span class="muted small">Sell ${money0(ps[0].sell)}</span>${canAddStock() ? `<button class="btn btn-sm" data-add-like="${ps[0].id}">+ More</button>` : ''}</div></div>
          <div class="table-wrap"><table><tbody>${ps.map(p => `<tr>
            <td class="mono">${esc(p.imei1)}${p.imei2 ? `<div class="muted small mono">${esc(p.imei2)}</div>` : ''}</td>
            <td>${esc(p.color || '')}</td>${own ? `<td class="muted small">Cost ${money0(p.cost)}</td>` : ''}<td class="muted small">${esc(prettyDay(p.addedDay))}</td>
            <td style="text-align:right"><button class="btn btn-sm" data-edit-phone="${p.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>
        </div>`).join('') : `<div class="empty"><div class="e-icon">📱</div>${q ? 'No phone matches' : 'No phones in stock yet.'}${canAddStock() && !q ? '<br><br><button class="btn btn-primary" onclick="document.getElementById(\'btnAddStock\').click()">+ Add phones by scanning</button>' : ''}</div>`);
    }

    if (tab === 'acc') {
      const list = A.S.accessories.filter(a => !q || [a.name, a.category].join(' ').toLowerCase().includes(q)).sort((a, b) => (a.category + a.name).localeCompare(b.category + b.name));
      body.innerHTML = list.length ? `<div class="card table-wrap"><table><thead><tr><th></th><th>Item</th><th>Qty</th>${own ? '<th>Cost</th>' : ''}<th>Price</th><th></th></tr></thead><tbody>
        ${list.map(a => `<tr><td style="width:46px">${a.photo ? `<img class="thumb" src="${esc(a.photo)}" alt="">` : ({ Charger: '🔌', Cable: '🔗', Earphones: '🎧', 'Back cover': '📔', 'Tempered glass': '🛡️', 'Power bank': '🔋', 'Memory card': '💾', 'Smart watch': '⌚' }[a.category] || '🎁')}</td>
          <td><b>${esc(a.name)}</b><div class="muted small">${esc(a.category || '')}</div></td>
          <td>${(a.qty || 0) <= (a.min ?? 2) ? `<span class="badge badge-red">${a.qty || 0}</span>` : a.qty}</td>
          ${own ? `<td>${money0(a.cost)}</td>` : ''}<td>${money0(a.sell)}</td>
          <td style="white-space:nowrap;text-align:right">${canAddStock() ? `<button class="btn btn-sm" data-restock="${a.id}">+ Stock</button> <button class="btn btn-sm" data-edit-acc="${a.id}">Edit</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div>` : `<div class="empty"><div class="e-icon">🎧</div>No accessories yet</div>`;
    }

    if (tab === 'lookup') {
      if (!soldCache) {
        soldCache = 'loading';
        body.innerHTML = '<p class="muted">Loading recent sold phones…</p>';
        A.data.query('phones', { where: [['soldDay', '>=', addDays(dayStr(), -60)]] })
          .then(r => { soldCache = r.filter(p => p.status === 'Sold').sort((a, b) => (b.soldAt || 0) - (a.soldAt || 0)); this.render(el); })
          .catch(() => { soldCache = []; body.innerHTML = '<p class="muted">Could not load (offline?).</p>'; });
        return;
      }
      if (soldCache === 'loading') return;
      body.innerHTML = `<div class="section-title">Sold in the last 60 days (${soldCache.length})</div>` + (soldCache.length ? `<div class="card table-wrap"><table><thead><tr><th>Phone</th><th>IMEI</th><th>Customer</th><th>Date</th><th>Invoice</th></tr></thead><tbody>
        ${soldCache.map(p => `<tr class="click" data-sold-imei="${esc(p.imei1)}"><td>${esc(p.brand + ' ' + p.model)}</td><td class="mono">${esc(p.imei1)}</td><td>${esc(p.soldTo || '')}</td><td>${esc(prettyDay(p.soldDay))}</td><td>${esc(p.invoiceNo || '')}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="muted">No phones sold in the last 60 days.</p>');
    }
  }
};
