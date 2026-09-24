import { A } from '../app.js';
import { $, $$, esc, money0, cleanDigits, dayStr, addDays, prettyDay } from '../util.js';
import { customerDialog } from '../ui.js';

let filter = 'all';

export default {
  id: 'customers', title: 'Customers',
  init(el) {
    el.innerHTML = `
      <div class="toolbar">
        <div class="search-wrap"><input id="custSearch" placeholder="Search name, phone or NIC" autocomplete="off"></div>
        <button class="btn btn-primary" id="btnNewCust">+ New customer</button>
      </div>
      <div class="chip-row" id="custChips"></div>
      <div id="custBody"></div>`;
    $('#custSearch', el).addEventListener('input', () => this.render(el));
    $('#btnNewCust', el).onclick = () => customerDialog(null, c => A.go('customer', { id: c.id }));
    $('#custChips', el).onclick = e => { const c = e.target.closest('[data-f]'); if (c) { filter = c.dataset.f; this.render(el); } };
    el.addEventListener('click', e => { const r = e.target.closest('[data-cust]'); if (r) A.go('customer', { id: r.dataset.cust }); });
  },
  render(el) {
    const q = ($('#custSearch', el).value || '').trim().toLowerCase(), qd = cleanDigits(q);
    const soon = addDays(dayStr(), 2);
    const dueSoonIds = new Set(A.S.salesOpen.filter(s => { const d = s.status === 'due' ? s.dueDate : s.chequeDate; return d && d <= soon; }).map(s => s.customerId));
    const chequeIds = new Set(A.S.salesOpen.filter(s => s.status === 'cheque').map(s => s.customerId));
    const counts = {
      all: A.S.customers.length,
      owes: A.S.customers.filter(c => (c.balance || 0) > 0.009).length,
      soon: A.S.customers.filter(c => dueSoonIds.has(c.id)).length,
      cheque: A.S.customers.filter(c => chequeIds.has(c.id)).length
    };
    $('#custChips', el).innerHTML = [['all', 'All'], ['owes', 'Owes money'], ['soon', 'Due in 2 days'], ['cheque', 'Pending cheques']]
      .map(([k, l]) => `<button class="chip ${filter === k ? 'active' : ''}" data-f="${k}">${l} <span class="chip-n">${counts[k]}</span></button>`).join('');
    let list = A.S.customers.filter(c => !q || c.name.toLowerCase().includes(q) || (qd.length >= 3 && cleanDigits(c.phone + ' ' + (c.phone2 || '')).includes(qd)) || (c.nic || '').toLowerCase().includes(q));
    if (filter === 'owes') list = list.filter(c => (c.balance || 0) > 0.009);
    if (filter === 'soon') list = list.filter(c => dueSoonIds.has(c.id));
    if (filter === 'cheque') list = list.filter(c => chequeIds.has(c.id));
    list.sort(filter === 'owes' ? (a, b) => (b.balance || 0) - (a.balance || 0) : (a, b) => a.name.localeCompare(b.name));
    const receivable = A.S.customers.reduce((a, c) => a + Math.max(0, c.balance || 0), 0);
    $('#custBody', el).innerHTML = `<p class="muted small" style="margin-bottom:10px;">${A.S.customers.length} customers · total to collect ${money0(receivable)}</p>` +
      (list.length ? `<div class="card">${list.slice(0, 300).map(c => `
        <div class="list-row click" data-cust="${c.id}">
          <div class="avatar">${esc((c.name || '?').trim().charAt(0).toUpperCase())}</div>
          <div class="grow"><b>${esc(c.name)}</b> ${c.type && c.type !== 'Retail' ? `<span class="badge badge-slate">${esc(c.type)}</span>` : ''}
            <div class="muted small">${esc(c.phone || '')}${c.lastDay ? ' · last bill ' + esc(prettyDay(c.lastDay)) : ''}</div></div>
          <div style="text-align:right">${(c.balance || 0) > 0.009 ? `<span class="badge ${dueSoonIds.has(c.id) ? 'badge-red' : 'badge-amber'}">owes ${money0(c.balance)}</span>` : '<span class="muted small">—</span>'}
            ${chequeIds.has(c.id) ? '<div><span class="badge badge-slate">cheque</span></div>' : ''}</div>
          <span class="chev">›</span>
        </div>`).join('')}</div>` : `<div class="empty"><div class="e-icon">👥</div>${q ? 'No customer matches' : 'No customers yet'}</div>`);
  }
};
