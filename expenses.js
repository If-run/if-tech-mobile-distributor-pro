import { A } from '../app.js';
import { $, esc, money, money0, dayStr, monthStart, prettyDay, num, toast, modal, confirmBox } from '../util.js';
import * as ops from '../ops.js';

const CATS = ['Rent', 'Electricity', 'Water', 'Salary', 'Transport', 'Telephone / Internet', 'Repairs', 'Advertising', 'Tea / Food', 'Other'];

function addDialog() {
  const m = modal({
    title: 'Add expense',
    body: `<div class="field-row"><div class="field"><label>Category</label><select data-f="category">${CATS.map(c => `<option>${c}</option>`).join('')}</select></div>
      <div class="field"><label>Amount *</label><input data-f="amount" inputmode="decimal"></div></div>
      <div class="field-row"><div class="field"><label>Date</label><input type="date" data-f="day" value="${dayStr()}"></div><div class="field"><label>Note</label><input data-f="note"></div></div>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-ok>Save</button>`
  });
  m.$('[data-ok]').onclick = async () => {
    const d = {}; m.el.querySelectorAll('[data-f]').forEach(i => d[i.dataset.f] = i.value.trim());
    d.amount = num(d.amount); if (!d.amount) return toast('Enter the amount', 'error');
    d.day = d.day || dayStr();
    if (await ops.addExpense(d)) { toast('Expense saved'); m.close(); }
  };
}

export default {
  id: 'expenses', title: 'Expenses', ownerOnly: true,
  init(el) {
    el.innerHTML = `<div class="toolbar"><div id="expSum" class="grow"></div><button class="btn btn-primary" id="btnAddExp">+ Add expense</button></div><div id="expBody"></div>`;
    $('#btnAddExp', el).onclick = addDialog;
    el.addEventListener('click', async e => {
      const d = e.target.closest('[data-del]'); if (!d) return;
      if (await confirmBox('Delete this expense?', 'Delete')) { await ops.removeDoc('expenses', d.dataset.del); toast('Deleted'); }
    });
  },
  render(el) {
    const list = A.S.expenses.slice().sort((a, b) => b.day.localeCompare(a.day) || (b.ts || 0) - (a.ts || 0));
    const live = A.S.salesMonth.filter(s => s.status !== 'cancelled');
    const total = list.reduce((a, e) => a + num(e.amount), 0), profit = live.reduce((a, s) => a + num(s.profit), 0);
    $('#expSum', el).innerHTML = `<div class="grid grid-3">
      <div class="card stat-card"><div class="label">Expenses this month</div><div class="value">${money0(total)}</div></div>
      <div class="card stat-card"><div class="label">Gross profit this month</div><div class="value">${money0(profit)}</div></div>
      <div class="card stat-card"><div class="label">Net profit</div><div class="value ${profit - total < 0 ? 'txt-red' : ''}">${money0(profit - total)}</div></div></div>`;
    $('#expBody', el).innerHTML = list.length ? `<div class="card table-wrap" style="margin-top:14px;"><table><thead><tr><th>Date</th><th>Category</th><th>Note</th><th>Amount</th><th></th></tr></thead><tbody>
      ${list.map(e => `<tr><td>${esc(prettyDay(e.day))}</td><td>${esc(e.category)}</td><td>${esc(e.note || '—')}</td><td>${money(e.amount)}</td><td><button class="icon-btn sm" data-del="${e.id}">🗑</button></td></tr>`).join('')}
      </tbody></table></div><p class="hint">Older months: see Reports → Last month / Custom.</p>` : `<div class="empty"><div class="e-icon">🧾</div>No expenses this month</div>`;
  }
};
