import { A, icon } from '../app.js';
import { esc, money0, dayStr, addDays, dueLabel, prettyTime, shortDay } from '../util.js';
import { showInvoice, saleBadge, customerDialog, remindDialog } from '../ui.js';
import { startScanSell } from './sell.js';
import { openAddStock } from './stock.js';

export default {
  id: 'home', title: 'Home',
  init(el) {
    el.addEventListener('click', e => {
      const a = e.target.closest('[data-act]'); if (!a) return;
      const act = a.dataset.act, id = a.dataset.id;
      if (act === 'scan-sell') { A.go('sell'); startScanSell(); }
      if (act === 'add-stock') openAddStock();
      if (act === 'dues') A.go('dues');
      if (act === 'new-cust') customerDialog(null, c => A.go('customer', { id: c.id }));
      if (act === 'inv') { const s = A.S.sales.find(x => x.id === id); if (s) showInvoice(s); }
      if (act === 'remind') { const s = A.S.sales.find(x => x.id === id); if (s) remindDialog(s); }
      if (act === 'go') A.go(a.dataset.view);
    });
  },
  render(el) {
    const S = A.S, today = dayStr(), own = A.isOwner();
    const live = S.salesMonth.filter(s => s.status !== 'cancelled');
    const tSales = live.filter(s => s.day === today);
    const sum = (arr, f) => arr.reduce((a, b) => a + (Number(b[f]) || 0), 0);
    const cashToday = sum(tSales, 'paidAtSale') + sum(S.payments.filter(p => p.day === today), 'amount');
    const soon = addDays(today, 2);
    const attention = S.salesOpen.filter(s => {
      const d = s.status === 'due' ? s.dueDate : s.chequeDate; return d && d <= soon;
    }).sort((a, b) => ((a.status === 'due' ? a.dueDate : a.chequeDate) || '').localeCompare((b.status === 'due' ? b.dueDate : b.chequeDate) || ''));
    const lowAcc = S.accessories.filter(a => (a.qty || 0) <= (a.min ?? 2));
    const totalDue = sum(S.salesOpen.filter(s => s.status === 'due'), 'due');

    el.innerHTML = `
      <div class="quick">
        <button class="quick-btn primary" data-act="scan-sell">${icon('scan')}<span>Scan &amp; Sell</span></button>
        <button class="quick-btn" data-act="add-stock">${icon('stock')}<span>Add stock</span></button>
        <button class="quick-btn" data-act="dues">${icon('dues')}<span>Dues</span></button>
        <button class="quick-btn" data-act="new-cust">${icon('customers')}<span>New customer</span></button>
      </div>
      <div class="grid grid-4" style="margin-top:14px;">
        <div class="card stat-card"><div class="label">Sales today</div><div class="value">${money0(sum(tSales, 'total'))}</div><div class="delta">${tSales.length} bill${tSales.length === 1 ? '' : 's'}</div></div>
        <div class="card stat-card"><div class="label">Cash in today</div><div class="value">${money0(cashToday)}</div><div class="delta">sales + collections</div></div>
        ${own ? `<div class="card stat-card"><div class="label">Profit today</div><div class="value">${money0(sum(tSales, 'profit'))}</div><div class="delta">Month: ${money0(sum(live, 'profit'))}</div></div>`
             : `<div class="card stat-card"><div class="label">Phones in stock</div><div class="value">${S.phones.length}</div></div>`}
        <div class="card stat-card"><div class="label">This month</div><div class="value">${money0(sum(live, 'total'))}</div><div class="delta">${live.length} bills</div></div>
      </div>

      <div class="grid grid-2" style="margin-top:14px;align-items:start;">
        <div class="card pad">
          <div class="card-head"><h4>Needs attention</h4><button class="btn btn-sm" data-act="dues">All dues (${money0(totalDue)})</button></div>
          ${attention.length ? attention.slice(0, 8).map(s => {
            const isCq = s.status === 'cheque'; const lb = dueLabel(isCq ? s.chequeDate : s.dueDate);
            return `<div class="list-row">
              <div class="grow"><b>${esc(s.customerName)}</b><div class="muted small">${isCq ? 'Cheque ' + esc(s.chequeNo || '') : 'Credit'} · ${esc(s.invoiceNo)}</div></div>
              <div style="text-align:right"><b>${money0(s.due)}</b><div><span class="badge ${lb.cls}">${esc(lb.text)}</span></div></div>
              <button class="icon-btn" data-act="remind" data-id="${s.id}" title="Send reminder">💬</button></div>`;
          }).join('') : '<p class="muted small">Nothing due in the next 2 days. 👍</p>'}
          ${lowAcc.length ? `<div class="list-row" style="cursor:pointer" data-act="go" data-view="stock"><div class="grow"><b>${lowAcc.length} accessor${lowAcc.length === 1 ? 'y' : 'ies'} low on stock</b><div class="muted small">${esc(lowAcc.slice(0, 4).map(a => a.name).join(', '))}</div></div><span class="badge badge-red">Low</span></div>` : ''}
        </div>
        <div class="card pad">
          <div class="card-head"><h4>Recent bills</h4><button class="btn btn-sm" data-act="go" data-view="reports">Reports</button></div>
          ${S.sales.slice(0, 7).map(s => `<div class="list-row click" data-act="inv" data-id="${s.id}">
              <div class="grow"><b>${esc(s.customerName)}</b><div class="muted small">${esc(s.invoiceNo)} · ${shortDay(s.day)} ${prettyTime(s.ts)}</div></div>
              <div style="text-align:right"><b>${money0(s.total)}</b><div>${saleBadge(s)}</div></div></div>`).join('') || '<p class="muted small">No bills yet — tap “Scan &amp; Sell”.</p>'}
        </div>
      </div>`;
  }
};
