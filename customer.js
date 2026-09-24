/* CUSTOMER PROFILE — everything about one customer on one page:
   contact, what they owe and when, pending cheques, every bill with IMEIs, payments. */
import { A } from '../app.js';
import { $, esc, money, money0, prettyDay, shortDay, dueLabel, confirmBox, toast, intlPhone, cleanDigits } from '../util.js';
import { customerDialog, paymentDialog, remindDialog, showInvoice, saleBadge, openWhatsApp, payLabel } from '../ui.js';
import * as ops from '../ops.js';

let cid = null, hist = null, pays = null, loadingFor = null;

async function load(id) {
  loadingFor = id; hist = null; pays = null;
  try {
    const [s, p] = await Promise.all([
      A.data.query('sales', { where: [['customerId', '==', id]] }),
      A.data.query('payments', { where: [['customerId', '==', id]] })
    ]);
    if (loadingFor !== id) return;
    hist = s; pays = p;
  } catch (e) { console.error(e); hist = []; pays = []; toast('Could not load full history (offline?) — showing recent data', 'error'); }
  A.refresh();
}

export default {
  id: 'customer', title: () => 'Customer',
  init(el) {
    el.addEventListener('click', async e => {
      const a = e.target.closest('[data-act]'); if (!a) return;
      const c = A.customerById(cid); if (!c) return;
      const sale = a.dataset.id ? allSales().find(s => s.id === a.dataset.id) : null;
      switch (a.dataset.act) {
        case 'back': A.go('customers'); break;
        case 'edit': customerDialog(c); break;
        case 'wa': openWhatsApp(c.phone, `Hello ${c.name}, `); break;
        case 'pay': paymentDialog({ customer: c }); break;
        case 'pay-sale': if (sale) paymentDialog({ sale }); break;
        case 'remind': if (sale) remindDialog(sale); break;
        case 'inv': if (sale) showInvoice(sale); break;
        case 'cq': if (sale && await confirmBox(`Mark cheque ${sale.chequeNo} as ${a.dataset.st}?`, 'Yes', a.dataset.st === 'Returned')) { await ops.setChequeStatus(sale, a.dataset.st); toast('Cheque ' + a.dataset.st.toLowerCase()); load(cid); } break;
        case 'del':
          if ((c.balance || 0) > 0.009 || A.S.salesOpen.some(s => s.customerId === c.id)) return toast('This customer still has open dues or cheques', 'error');
          if (await confirmBox(`Delete ${c.name}? Their past bills stay in reports.`, 'Delete')) { await ops.removeDoc('customers', c.id); toast('Deleted'); A.go('customers'); }
          break;
      }
    });
  },
  enter(el, params) { if (params.id && params.id !== cid) { cid = params.id; load(cid); } else if (params.id) load(cid); },
  render(el) {
    const c = A.customerById(cid);
    if (!c) { el.innerHTML = `<div class="empty">Customer not found. <button class="btn btn-sm" data-act="back">Back</button></div>`; return; }
    const sales = allSales().filter(s => s.status !== 'cancelled');
    const open = A.S.salesOpen.filter(s => s.customerId === c.id).sort((a, b) => ((a.status === 'due' ? a.dueDate : a.chequeDate) || '').localeCompare((b.status === 'due' ? b.dueDate : b.chequeDate) || ''));
    const dues = open.filter(s => s.status === 'due'), cheques = open.filter(s => s.status === 'cheque');
    const bal = dues.reduce((a, s) => a + (s.due || 0), 0);
    const chq = cheques.reduce((a, s) => a + (s.due || 0), 0);
    const total = sales.reduce((a, s) => a + (s.total || 0), 0);
    const phones = sales.flatMap(s => (s.items || []).filter(i => i.imei).map(i => ({ ...i, day: s.day, sale: s })));
    const tel = cleanDigits(c.phone);
    el.innerHTML = `
      <button class="linkbtn" data-act="back" style="margin-bottom:10px;">‹ All customers</button>
      <div class="card pad profile-head">
        <div class="avatar lg">${esc((c.name || '?').trim().charAt(0).toUpperCase())}</div>
        <div class="grow">
          <h3>${esc(c.name)} ${c.type ? `<span class="badge badge-slate">${esc(c.type)}</span>` : ''}</h3>
          <div class="muted">${esc(c.phone || '')}${c.phone2 ? ' · ' + esc(c.phone2) : ''}${c.nic ? ' · NIC ' + esc(c.nic) : ''}</div>
          ${c.address ? `<div class="muted small">${esc(c.address)}</div>` : ''}${c.notes ? `<div class="muted small">📝 ${esc(c.notes)}</div>` : ''}
        </div>
        <div class="profile-actions">
          ${tel ? `<a class="btn" href="tel:${esc(tel)}">📞 Call</a>` : ''}
          <button class="btn btn-wa" data-act="wa">WhatsApp</button>
          ${bal > 0.009 ? '<button class="btn btn-primary" data-act="pay">Receive payment</button>' : ''}
          <button class="btn" data-act="edit">Edit</button>
          ${A.isOwner() ? '<button class="btn btn-red" data-act="del">Delete</button>' : ''}
        </div>
      </div>

      <div class="grid grid-4" style="margin-top:14px;">
        <div class="card stat-card"><div class="label">Owes now</div><div class="value ${bal > 0.009 ? 'txt-amber' : ''}">${money0(bal)}</div></div>
        <div class="card stat-card"><div class="label">Pending cheques</div><div class="value">${money0(chq)}</div><div class="delta">${cheques.length} cheque${cheques.length === 1 ? '' : 's'}</div></div>
        <div class="card stat-card"><div class="label">Total bought</div><div class="value">${money0(hist ? total : c.totalSpent)}</div><div class="delta">${hist ? sales.length : (c.bills || 0)} bills</div></div>
        <div class="card stat-card"><div class="label">Phones bought</div><div class="value">${hist ? phones.length : '…'}</div><div class="delta">${c.lastDay ? 'last ' + esc(prettyDay(c.lastDay)) : ''}</div></div>
      </div>

      ${open.length ? `<div class="section-title">Open dues &amp; cheques</div>
      <div class="card">${open.map(s => {
        const isC = s.status === 'cheque'; const lb = dueLabel(isC ? s.chequeDate : s.dueDate);
        return `<div class="list-row">
          <div class="grow"><b>${money(s.due)}</b> <span class="badge ${lb.cls}">${esc(lb.text)}</span>
            <div class="muted small">${isC ? `Cheque ${esc(s.chequeNo || '')} · ${esc(s.bank || '')} · ${esc(s.chequeStatus || 'Pending')} · date ${esc(prettyDay(s.chequeDate))}` : `${s.chequeStatus === 'Returned' ? 'Returned cheque · ' : 'Credit · '}due ${esc(prettyDay(s.dueDate))}`} · ${esc(s.invoiceNo)}</div>
            ${s.lastReminder ? `<div class="muted small">📩 Auto SMS sent ${esc(shortDay(s.lastReminder.day))}</div>` : ''}</div>
          <div class="row-actions">
            <button class="btn btn-sm" data-act="remind" data-id="${s.id}">Remind</button>
            ${isC ? `<button class="btn btn-sm" data-act="cq" data-st="Cleared" data-id="${s.id}">Cleared</button><button class="btn btn-sm btn-red" data-act="cq" data-st="Returned" data-id="${s.id}">Returned</button>`
                  : `<button class="btn btn-sm btn-primary" data-act="pay-sale" data-id="${s.id}">Receive</button>`}
          </div></div>`;
      }).join('')}</div>` : ''}

      <div class="section-title">Bills</div>
      ${hist === null ? '<p class="muted">Loading history…</p>' : sales.length ? `<div class="card">${sales.sort((a, b) => (b.ts || 0) - (a.ts || 0)).map(s => `
        <div class="list-row click" data-act="inv" data-id="${s.id}">
          <div class="grow"><b>${esc(s.invoiceNo)}</b> <span class="muted small">${esc(prettyDay(s.day))}</span>
            <div class="muted small">${esc((s.items || []).map(i => i.name + (i.qty > 1 ? ' ×' + i.qty : '')).join(', '))}</div></div>
          <div style="text-align:right"><b>${money0(s.total)}</b><div>${saleBadge(s)}</div><div class="muted small">${esc(payLabel(s.payment))}</div></div></div>`).join('')}</div>`
        : '<p class="muted">No bills yet.</p>'}

      ${phones.length ? `<div class="section-title">Phones bought (for warranty)</div>
      <div class="card table-wrap"><table><thead><tr><th>Phone</th><th>IMEI</th><th>Date</th><th>Warranty</th></tr></thead><tbody>
        ${phones.map(p => `<tr><td>${esc(p.name)}</td><td class="mono">${esc(p.imei)}</td><td>${esc(prettyDay(p.day))}</td><td>${esc(p.warranty || '—')}</td></tr>`).join('')}</tbody></table></div>` : ''}

      ${pays && pays.length ? `<div class="section-title">Payments received</div>
      <div class="card">${pays.sort((a, b) => (b.ts || 0) - (a.ts || 0)).map(p => `
        <div class="list-row"><div class="grow"><b>${money(p.amount)}</b> <span class="muted small">${esc(p.method)}</span>
          <div class="muted small">${esc(prettyDay(p.day))} · ${esc(p.invoiceNo || '')}${p.note ? ' · ' + esc(p.note) : ''} · by ${esc(p.by || '')}</div></div></div>`).join('')}</div>` : ''}`;
  }
};

/* History from the one-time query, overlaid with live copies (so a payment just made shows instantly). */
function allSales() {
  const m = new Map();
  (hist || []).forEach(s => m.set(s.id, s));
  A.S.sales.filter(s => s.customerId === cid).forEach(s => m.set(s.id, s));
  return [...m.values()];
}
