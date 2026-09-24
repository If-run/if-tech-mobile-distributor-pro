import { A } from '../app.js';
import { $, $$, esc, money0, dayStr, addDays, monthStart, prettyDay, shortDay, num, toast } from '../util.js';
import { exportSalesCsv, printHtml, payLabel } from '../ui.js';

let range = 'today', from = dayStr(), to = dayStr(), cache = {}, current = null;

function rangeDates(r) {
  const t = dayStr();
  if (r === 'today') return [t, t];
  if (r === 'yesterday') return [addDays(t, -1), addDays(t, -1)];
  if (r === '7d') return [addDays(t, -6), t];
  if (r === 'month') return [monthStart(t), t];
  if (r === 'lastmonth') { const lm = addDays(monthStart(t), -1); return [monthStart(lm), lm]; }
  return [from, to];
}
async function getData(f, t) {
  const ms = monthStart();
  const inRange = x => x.day >= f && x.day <= t;
  if (f >= ms) return { sales: A.S.salesMonth.filter(inRange), payments: A.S.payments.filter(inRange), expenses: A.S.expenses.filter(inRange) };
  const key = f + '_' + t;
  if (!cache[key]) {
    const spec = { where: [['day', '>=', f], ['day', '<=', t]] };
    const [sales, payments, expenses] = await Promise.all([
      A.data.query('sales', spec), A.data.query('payments', spec), A.isOwner() ? A.data.query('expenses', spec) : Promise.resolve([])
    ]);
    cache[key] = { sales, payments, expenses };
  }
  return cache[key];
}
function bars(rows, fmt = money0) {
  const max = Math.max(1, ...rows.map(r => r[1]));
  return rows.length ? rows.map(([l, v, sub]) => `<div class="bar-row"><div class="lbl" title="${esc(l)}">${esc(l)}</div><div class="bar-track"><div class="bar-fill" style="width:${(v / max * 100).toFixed(1)}%"></div></div><div class="bar-val">${fmt(v)}${sub ? `<span class="muted small"> ${esc(sub)}</span>` : ''}</div></div>`).join('') : '<p class="muted small">No data for this period</p>';
}

export default {
  id: 'reports', title: 'Reports',
  init(el) {
    el.innerHTML = `
      <div class="chip-row" id="repRange">
        ${[['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', 'Last 7 days'], ['month', 'This month'], ['lastmonth', 'Last month'], ['custom', 'Custom']].map(([k, l]) => `<button class="chip" data-r="${k}">${l}</button>`).join('')}
      </div>
      <div id="repCustom" class="toolbar" style="display:none"><input type="date" id="repFrom"><span class="muted">to</span><input type="date" id="repTo"><button class="btn" id="repGo">Show</button></div>
      <div id="repBody"><p class="muted">Loading…</p></div>`;
    $('#repRange', el).onclick = e => { const c = e.target.closest('[data-r]'); if (c) { range = c.dataset.r; this.render(el); } };
    $('#repFrom', el).value = addDays(dayStr(), -30); $('#repTo', el).value = dayStr();
    $('#repGo', el).onclick = () => { from = $('#repFrom', el).value; to = $('#repTo', el).value; if (from > to) return toast('Start date is after end date', 'error'); this.render(el); };
    el.addEventListener('click', e => {
      if (e.target.closest('[data-csv]') && current) exportSalesCsv(current.sales, `sales-${current.f}-to-${current.t}.csv`);
      if (e.target.closest('[data-print]') && current) printHtml(`<div class="print-report"><h2>${esc(A.shop.name || '')} — Report</h2><p>${esc(prettyDay(current.f))} to ${esc(prettyDay(current.t))}</p>${$('#repBody', el).innerHTML}</div>`);
    });
  },
  enter() { cache = {}; },
  async render(el) {
    $$('#repRange .chip', el).forEach(c => c.classList.toggle('active', c.dataset.r === range));
    $('#repCustom', el).style.display = range === 'custom' ? '' : 'none';
    const [f, t] = rangeDates(range);
    let d;
    try { d = await getData(f, t); } catch (e) { $('#repBody', el).innerHTML = '<p class="muted">Could not load this period — are you online?</p>'; return; }
    const own = A.isOwner();
    const sales = d.sales.filter(s => s.status !== 'cancelled');
    const cancelled = d.sales.filter(s => s.status === 'cancelled');
    const sum = (arr, k) => arr.reduce((a, x) => a + num(x[k]), 0);
    const revenue = sum(sales, 'total'), profit = sum(sales, 'profit'), exp = sum(d.expenses, 'amount');
    const cashIn = sum(sales, 'paidAtSale') + sum(d.payments, 'amount');
    const phonesSold = sales.flatMap(s => (s.items || []).filter(i => i.type === 'phone'));
    current = { f, t, sales };

    const byModel = {}; sales.forEach(s => (s.items || []).forEach(i => { const k = i.type === 'phone' ? i.name.split(' ').slice(0, 3).join(' ') : i.name; byModel[k] = byModel[k] || [0, 0]; byModel[k][0] += num(i.price) * (i.qty || 1); byModel[k][1] += i.qty || 1; }));
    const topModels = Object.entries(byModel).sort((a, b) => b[1][0] - a[1][0]).slice(0, 8).map(([k, v]) => [k, v[0], '×' + v[1]]);
    const pay = {}; sales.forEach(s => { pay[payLabel(s.payment)] = (pay[payLabel(s.payment)] || 0) + s.total; });
    const staff = {}; sales.forEach(s => { staff[s.by || '—'] = (staff[s.by || '—'] || 0) + s.total; });
    const daily = {}; if (f !== t) { for (let x = f; x <= t; x = addDays(x, 1)) daily[x] = 0; sales.forEach(s => { daily[s.day] = (daily[s.day] || 0) + s.total; }); }
    const expCat = {}; d.expenses.forEach(e => { expCat[e.category] = (expCat[e.category] || 0) + num(e.amount); });

    $('#repBody', el).innerHTML = `
      <p class="muted small" style="margin-bottom:10px;">${esc(prettyDay(f))}${f !== t ? ' — ' + esc(prettyDay(t)) : ''} · ${sales.length} bills${cancelled.length ? ` · ${cancelled.length} cancelled` : ''}</p>
      <div class="grid grid-4">
        <div class="card stat-card"><div class="label">Sales</div><div class="value">${money0(revenue)}</div><div class="delta">${sales.length} bills · avg ${money0(sales.length ? revenue / sales.length : 0)}</div></div>
        <div class="card stat-card"><div class="label">Cash in</div><div class="value">${money0(cashIn)}</div><div class="delta">at sale + collections</div></div>
        ${own ? `<div class="card stat-card"><div class="label">Gross profit</div><div class="value">${money0(profit)}</div><div class="delta">${revenue ? (profit / revenue * 100).toFixed(1) : 0}% margin</div></div>
        <div class="card stat-card"><div class="label">Net profit</div><div class="value ${profit - exp < 0 ? 'txt-red' : ''}">${money0(profit - exp)}</div><div class="delta">after ${money0(exp)} expenses</div></div>`
        : `<div class="card stat-card"><div class="label">Phones sold</div><div class="value">${phonesSold.length}</div></div>`}
      </div>
      <div class="grid grid-2" style="margin-top:14px;align-items:start;">
        <div class="card pad"><h4 style="margin-bottom:12px;">Top sellers</h4>${bars(topModels)}</div>
        <div class="card pad"><h4 style="margin-bottom:12px;">Payment types</h4>${bars(Object.entries(pay).sort((a, b) => b[1] - a[1]))}
          <h4 style="margin:18px 0 12px;">By staff</h4>${bars(Object.entries(staff).sort((a, b) => b[1] - a[1]))}</div>
      </div>
      ${f !== t ? `<div class="card pad" style="margin-top:14px;"><h4 style="margin-bottom:12px;">Daily sales</h4>${bars(Object.entries(daily).map(([k, v]) => [shortDay(k), v]))}</div>` : ''}
      ${own && d.expenses.length ? `<div class="card pad" style="margin-top:14px;"><h4 style="margin-bottom:12px;">Expenses</h4>${bars(Object.entries(expCat).sort((a, b) => b[1] - a[1]))}</div>` : ''}
      ${own ? `<div class="card pad" style="margin-top:14px;"><h4 style="margin-bottom:8px;">Stock right now</h4>
        <div class="kv"><span>Phones in stock</span><b>${A.S.phones.length} · cost ${money0(sum(A.S.phones, 'cost'))} · sale value ${money0(sum(A.S.phones, 'sell'))}</b></div>
        <div class="kv"><span>Accessories</span><b>${A.S.accessories.reduce((a, x) => a + (x.qty || 0), 0)} pcs · cost ${money0(A.S.accessories.reduce((a, x) => a + num(x.cost) * (x.qty || 0), 0))}</b></div>
        <div class="kv"><span>Credit to collect</span><b>${money0(A.S.salesOpen.filter(s => s.status === 'due').reduce((a, s) => a + s.due, 0))}</b></div>
        <div class="kv"><span>Cheques pending</span><b>${money0(A.S.salesOpen.filter(s => s.status === 'cheque').reduce((a, s) => a + s.due, 0))}</b></div></div>` : ''}
      <div class="toolbar no-print" style="margin-top:14px;"><button class="btn" data-csv>⬇ Excel (CSV)</button><button class="btn" data-print>🖨 Print / PDF</button></div>`;
  }
};
