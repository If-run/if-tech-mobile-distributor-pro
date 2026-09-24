/* DUES & CHEQUES — every open credit bill and pending cheque, soonest first,
   with one-tap reminder (WhatsApp/SMS), receive payment, and cheque status. */
import { A } from '../app.js';
import { $, $$, esc, money, money0, dayStr, addDays, dueLabel, prettyDay, shortDay, confirmBox, toast, modal } from '../util.js';
import { paymentDialog, remindDialog, showInvoice } from '../ui.js';
import * as ops from '../ops.js';

let tab = 'credit';

function dateDialog(s) {
  const isC = s.status === 'cheque';
  const m = modal({
    title: isC ? 'Change cheque date' : 'Change due date',
    body: `<div class="field"><label>${isC ? 'Cheque date' : 'New due date'}</label><input type="date" data-d value="${esc(isC ? s.chequeDate : s.dueDate)}"></div>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-ok>Save</button>`
  });
  m.$('[data-ok]').onclick = async () => { const v = m.$('[data-d]').value; if (!v) return; if (await ops.changeDueDate(s, v)) { toast('Date changed'); m.close(); } };
}

export default {
  id: 'dues', title: 'Dues & Cheques',
  init(el) {
    el.innerHTML = `<div id="duesStats" class="grid grid-4"></div>
      <div class="tabs" id="duesTabs" style="margin-top:16px;"><div class="tab" data-tab="credit">Credit dues</div><div class="tab" data-tab="cheque">Cheques</div></div>
      <div id="duesBody"></div>
      <p class="hint" style="margin-top:14px;" id="duesHint"></p>`;
    $('#duesTabs', el).onclick = e => { const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; this.render(el); } };
    el.addEventListener('click', async e => {
      const a = e.target.closest('[data-act]'); if (!a) return;
      const s = A.S.salesOpen.find(x => x.id === a.dataset.id); if (!s) return;
      if (a.dataset.act === 'pay') paymentDialog({ sale: s });
      if (a.dataset.act === 'remind') remindDialog(s);
      if (a.dataset.act === 'inv') showInvoice(s);
      if (a.dataset.act === 'date') dateDialog(s);
      if (a.dataset.act === 'cust' && s.customerId) A.go('customer', { id: s.customerId });
      if (a.dataset.act === 'cq') {
        const st = a.dataset.st;
        const msg = st === 'Returned' ? `Cheque ${s.chequeNo} RETURNED? It becomes a credit debt of ${money(s.total)} due in 7 days, and reminders continue.` : `Mark cheque ${s.chequeNo} as ${st}?`;
        if (await confirmBox(msg, 'Yes', st === 'Returned')) { await ops.setChequeStatus(s, st); toast('Cheque ' + st.toLowerCase()); }
      }
    });
  },
  render(el) {
    const today = dayStr(), in2 = addDays(today, 2), in7 = addDays(today, 7);
    const credit = A.S.salesOpen.filter(s => s.status === 'due').sort((a, b) => (a.dueDate || '9').localeCompare(b.dueDate || '9'));
    const cheques = A.S.salesOpen.filter(s => s.status === 'cheque').sort((a, b) => (a.chequeDate || '9').localeCompare(b.chequeDate || '9'));
    const sum = arr => arr.reduce((a, s) => a + (s.due || 0), 0);
    const overdue = credit.filter(s => s.dueDate && s.dueDate < today);
    const soon = credit.filter(s => s.dueDate && s.dueDate >= today && s.dueDate <= in2);
    const cqWeek = cheques.filter(s => s.chequeDate && s.chequeDate <= in7);
    $('#duesStats', el).innerHTML = `
      <div class="card stat-card"><div class="label">Total credit to collect</div><div class="value">${money0(sum(credit))}</div><div class="delta">${credit.length} bills</div></div>
      <div class="card stat-card"><div class="label">Overdue</div><div class="value txt-red">${money0(sum(overdue))}</div><div class="delta">${overdue.length} bills</div></div>
      <div class="card stat-card"><div class="label">Due in next 2 days</div><div class="value txt-amber">${money0(sum(soon))}</div><div class="delta">${soon.length} bills</div></div>
      <div class="card stat-card"><div class="label">Cheques within 7 days</div><div class="value">${money0(sum(cqWeek))}</div><div class="delta">${cheques.length} pending in total</div></div>`;
    $$('#duesTabs .tab', el).forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    const list = tab === 'credit' ? credit : cheques;
    $('#duesBody', el).innerHTML = list.length ? `<div class="card">${list.map(s => {
      const isC = s.status === 'cheque'; const lb = dueLabel(isC ? s.chequeDate : s.dueDate, today);
      return `<div class="list-row due-row">
        <div class="grow">
          <div><b class="click" data-act="cust" data-id="${s.id}">${esc(s.customerName)}</b> <span class="badge ${lb.cls}">${esc(lb.text)}</span>${s.chequeStatus === 'Returned' ? ' <span class="badge badge-red">Returned cheque</span>' : ''}</div>
          <div class="muted small">${isC ? `Cheque <b>${esc(s.chequeNo || '—')}</b> · ${esc(s.bank || '')} · ${esc(s.chequeStatus || 'Pending')} · date ${esc(prettyDay(s.chequeDate))}` : `Due ${esc(prettyDay(s.dueDate))} · paid ${money0(s.paid)} of ${money0(s.total)}`}
            · <span class="click u" data-act="inv" data-id="${s.id}">${esc(s.invoiceNo)}</span> · ${esc(s.customerPhone || '')}</div>
          ${s.lastReminder ? `<div class="muted small">📩 Auto SMS sent ${esc(shortDay(s.lastReminder.day))}</div>` : ''}
        </div>
        <div class="due-amt">${money0(s.due)}</div>
        <div class="row-actions">
          <button class="btn btn-sm" data-act="remind" data-id="${s.id}">💬 Remind</button>
          <button class="btn btn-sm" data-act="date" data-id="${s.id}">Date</button>
          ${isC ? `${s.chequeStatus !== 'Deposited' ? `<button class="btn btn-sm" data-act="cq" data-st="Deposited" data-id="${s.id}">Deposited</button>` : ''}
                   <button class="btn btn-sm btn-primary" data-act="cq" data-st="Cleared" data-id="${s.id}">Cleared</button>
                   <button class="btn btn-sm btn-red" data-act="cq" data-st="Returned" data-id="${s.id}">Returned</button>`
                : `<button class="btn btn-sm btn-primary" data-act="pay" data-id="${s.id}">Receive</button>`}
        </div></div>`;
    }).join('')}</div>` : `<div class="empty"><div class="e-icon">✅</div>${tab === 'credit' ? 'No credit dues' : 'No pending cheques'}</div>`;
    const auto = A.shop.smsEnabled;
    $('#duesHint', el).innerHTML = auto
      ? `📩 Automatic SMS reminders are ON — customers get an SMS ${A.settings().daysBefore ?? 2} days before, and on the day. You get a daily summary.`
      : `Automatic SMS reminders are OFF. ${A.isOwner() ? 'Turn them on in Settings → SMS reminders.' : 'Ask the owner to turn them on.'} You can still send reminders yourself with the 💬 button.`;
  }
};
