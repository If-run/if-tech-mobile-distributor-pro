/* Shared dialogs used by several screens: invoice, payment, customer form, reminders. */
import { A } from './app.js';
import { esc, money, modal, toast, prettyDay, prettyTime, num, intlPhone, cleanDigits, confirmBox, dayStr, dueLabel, shortDay, toCsv, downloadFile } from './util.js';
import * as ops from './ops.js';

/* ---------- Invoice ---------- */
export function invoiceText(s) {
  const st = A.settings(), shop = A.shop.name || 'Shop';
  const L = [];
  L.push('*' + shop + '*');
  if (st.phone) L.push('Tel: ' + st.phone);
  L.push(`Invoice ${s.invoiceNo} · ${prettyDay(s.day)} ${prettyTime(s.ts)}`);
  L.push('Customer: ' + s.customerName);
  L.push('--------------------------');
  (s.items || []).forEach(i => {
    L.push(`${i.name}${i.qty > 1 ? ' x' + i.qty : ''}  ${money(i.price * i.qty)}`);
    if (i.imei) L.push('  IMEI: ' + i.imei + (i.imei2 ? ' / ' + i.imei2 : ''));
    if (i.warranty) L.push('  Warranty: ' + i.warranty);
  });
  L.push('--------------------------');
  if (s.discount) L.push('Discount: -' + money(s.discount));
  L.push('*TOTAL: ' + money(s.total) + '*');
  if (s.status === 'cancelled') L.push('*** CANCELLED ***');
  if (s.payment === 'credit') { L.push('Paid: ' + money(s.paid)); if (s.due > 0) L.push(`Balance: ${money(s.due)} (due ${prettyDay(s.dueDate)})`); }
  else if (s.payment === 'cheque') L.push(`Cheque: ${s.chequeNo || '-'} / ${s.bank || '-'} / ${prettyDay(s.chequeDate)}`);
  else L.push('Paid by ' + s.payment);
  if (st.footer) L.push('', st.footer);
  return L.join('\n');
}
export function invoiceHtml(s) {
  const st = A.settings();
  const rows = (s.items || []).map(i => `
    <div class="inv-row"><span>${esc(i.name)}${i.qty > 1 ? ' ×' + i.qty : ''}</span><span>${money(i.price * i.qty)}</span></div>
    ${i.imei ? `<div class="inv-sub">IMEI ${esc(i.imei)}${i.imei2 ? ' / ' + esc(i.imei2) : ''}</div>` : ''}
    ${i.warranty ? `<div class="inv-sub">Warranty: ${esc(i.warranty)}</div>` : ''}`).join('');
  return `<div class="invoice-box">
    <div style="text-align:center;margin-bottom:10px;">
      <h3 style="font-size:17px;">${esc(A.shop.name || 'Shop')}</h3>
      ${st.address ? `<div class="inv-sub">${esc(st.address)}</div>` : ''}${st.phone ? `<div class="inv-sub">Tel: ${esc(st.phone)}</div>` : ''}
      <div class="inv-sub" style="margin-top:6px;">Invoice <b>${esc(s.invoiceNo)}</b> · ${prettyDay(s.day)} ${prettyTime(s.ts)}</div>
      ${s.status === 'cancelled' ? '<div class="badge badge-red" style="margin-top:6px;">CANCELLED</div>' : ''}
    </div>
    <div class="inv-row"><span>Customer</span><span>${esc(s.customerName)}</span></div>
    <hr>${rows}<hr>
    ${s.discount ? `<div class="inv-row"><span>Discount</span><span>- ${money(s.discount)}</span></div>` : ''}
    <div class="inv-row inv-total"><span>Total</span><span>${money(s.total)}</span></div>
    ${s.payment === 'credit' ? `<div class="inv-row"><span>Paid</span><span>${money(s.paid)}</span></div>
      ${s.due > 0 ? `<div class="inv-row"><span>Balance due</span><span><b>${money(s.due)}</b></span></div><div class="inv-row"><span>Due date</span><span>${prettyDay(s.dueDate)}</span></div>` : ''}` : ''}
    ${s.payment === 'cheque' ? `<div class="inv-row"><span>Cheque</span><span>${esc(s.chequeNo || '—')} · ${esc(s.bank || '')}</span></div><div class="inv-row"><span>Cheque date</span><span>${prettyDay(s.chequeDate)}</span></div>` : ''}
    ${['cash', 'card', 'bank'].includes(s.payment) ? `<div class="inv-row"><span>Payment</span><span style="text-transform:capitalize">${esc(s.payment === 'bank' ? 'Bank transfer' : s.payment)}</span></div>` : ''}
    <p class="inv-foot">${esc(st.footer || 'Thank you for your business!')}</p>
    <p class="inv-sub" style="text-align:center">Served by ${esc(s.by || '')}</p>
  </div>`;
}
export function showInvoice(s) {
  const m = modal({
    title: 'Invoice ' + esc(s.invoiceNo),
    body: invoiceHtml(s),
    foot: `${A.isOwner() && s.status !== 'cancelled' ? '<button class="btn btn-red" data-cancel style="margin-right:auto">Cancel bill</button>' : ''}
      <button class="btn" data-copy>Copy</button>
      <button class="btn" data-print>Print</button>
      <button class="btn btn-wa" data-wa>WhatsApp</button>`
  });
  m.$('[data-copy]').onclick = async () => { try { await navigator.clipboard.writeText(invoiceText(s).replace(/\*/g, '')); toast('Invoice copied'); } catch { toast('Could not copy'); } };
  m.$('[data-print]').onclick = () => printHtml(invoiceHtml(s));
  m.$('[data-wa]').onclick = () => openWhatsApp(s.customerPhone || (A.customerById(s.customerId) || {}).phone, invoiceText(s));
  const c = m.$('[data-cancel]');
  if (c) c.onclick = async () => {
    if (!await confirmBox(`Cancel bill ${s.invoiceNo}? Phones go back into stock and the customer's balance is reversed. Payments already received stay recorded.`, 'Cancel bill')) return;
    if (await ops.cancelSale(s)) { toast('Bill cancelled'); m.close(); }
  };
}
export function printHtml(html) {
  let area = document.getElementById('printArea');
  if (!area) { area = document.createElement('div'); area.id = 'printArea'; document.body.appendChild(area); }
  area.innerHTML = html;
  document.body.classList.add('printing');
  setTimeout(() => { window.print(); setTimeout(() => { document.body.classList.remove('printing'); area.innerHTML = ''; }, 500); }, 50);
}
export function openWhatsApp(phone, text) {
  const p = phone ? intlPhone(phone) : '';
  window.open(`https://wa.me/${p}?text=${encodeURIComponent(text)}`, '_blank');
}
export function openSms(phone, text) {
  const sep = /iPhone|iPad|iPod/.test(navigator.userAgent) ? '&' : '?';
  location.href = `sms:${cleanDigits(phone)}${sep}body=${encodeURIComponent(text)}`;
}

/* ---------- Reminder text (same wording the automatic SMS uses) ---------- */
export function reminderText(s) {
  const shop = A.shop.name || 'our shop';
  const st = A.settings();
  if (s.status === 'cheque') {
    return `Dear ${s.customerName}, this is a reminder from ${shop}: your cheque no ${s.chequeNo || ''} (${s.bank || ''}) for ${money(s.total)} will be deposited on ${prettyDay(s.chequeDate)}. Please keep funds available. Thank you.${st.phone ? ' ' + st.phone : ''}`;
  }
  const lb = dueLabel(s.dueDate);
  if (lb.d < 0) return `Dear ${s.customerName}, ${money(s.due)} for invoice ${s.invoiceNo} from ${shop} was due on ${prettyDay(s.dueDate)}. Please settle it as soon as possible. Thank you.${st.phone ? ' ' + st.phone : ''}`;
  return `Dear ${s.customerName}, a friendly reminder from ${shop}: ${money(s.due)} for invoice ${s.invoiceNo} is due on ${prettyDay(s.dueDate)}. Thank you.${st.phone ? ' ' + st.phone : ''}`;
}
export function remindDialog(s) {
  const phone = s.customerPhone || (A.customerById(s.customerId) || {}).phone || '';
  const text = reminderText(s);
  const m = modal({
    title: 'Send reminder',
    body: `<div class="field"><label>To</label><input value="${esc(phone)}" data-ph></div>
      <div class="field"><label>Message</label><textarea rows="5" data-tx>${esc(text)}</textarea></div>
      <p class="hint">Automatic SMS reminders (2 days before, and on the day) are set in Settings → SMS reminders. This button sends one yourself, free, from this phone.</p>`,
    foot: `<button class="btn" data-sms>SMS</button><button class="btn btn-wa" data-wa>WhatsApp</button>`
  });
  m.$('[data-wa]').onclick = () => openWhatsApp(m.$('[data-ph]').value, m.$('[data-tx]').value);
  m.$('[data-sms]').onclick = () => openSms(m.$('[data-ph]').value, m.$('[data-tx]').value);
}

/* ---------- Receive payment ---------- */
export function paymentDialog({ sale, customer }) {
  const due = sale ? sale.due : ops.openDuesFor(customer.id).reduce((a, s) => a + s.due, 0);
  const who = sale ? `${esc(sale.customerName)} · ${esc(sale.invoiceNo)}` : esc(customer.name);
  const m = modal({
    title: 'Receive payment',
    body: `<p style="margin-bottom:12px;">${who}<br><span class="muted">Balance due: <b>${money(due)}</b></span></p>
      <div class="field"><label>Amount received</label><input inputmode="decimal" data-amt value="${due}"></div>
      <div class="field"><label>Method</label><div class="seg" data-seg>
        <button class="active" data-v="cash">Cash</button><button data-v="bank">Bank</button><button data-v="card">Card</button></div></div>
      <div class="field"><label>Note (optional)</label><input data-note placeholder="e.g. paid by son"></div>
      ${!sale ? '<p class="hint">Applied to the oldest bills first.</p>' : ''}`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-ok>Save payment</button>`
  });
  let method = 'cash';
  m.$('[data-seg]').onclick = e => { const b = e.target.closest('[data-v]'); if (!b) return; method = b.dataset.v; m.el.querySelectorAll('[data-seg] button').forEach(x => x.classList.toggle('active', x === b)); };
  m.$('[data-ok]').onclick = async () => {
    const amt = num(m.$('[data-amt]').value), note = m.$('[data-note]').value.trim();
    const ok = sale ? await ops.receivePayment(sale, amt, method, note) : await ops.receiveCustomerPayment(customer, amt, method, note);
    if (ok) { toast('Payment saved — ' + money(amt)); m.close(); }
  };
}

/* ---------- Customer form ---------- */
export function customerDialog(c = null, onSaved) {
  const m = modal({
    title: c?.id ? 'Edit customer' : 'New customer',
    body: `<div class="field"><label>Name *</label><input data-f="name" value="${esc(c?.name)}"></div>
      <div class="field-row">
        <div class="field"><label>Mobile number *</label><input data-f="phone" inputmode="tel" value="${esc(c?.phone)}" placeholder="07X XXX XXXX"></div>
        <div class="field"><label>Type</label><select data-f="type">${['Retail', 'Wholesale', 'Dealer'].map(t => `<option ${c?.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      </div>
      <div class="field-row">
        <div class="field"><label>NIC</label><input data-f="nic" value="${esc(c?.nic)}"></div>
        <div class="field"><label>Second number</label><input data-f="phone2" inputmode="tel" value="${esc(c?.phone2)}"></div>
      </div>
      <div class="field"><label>Address</label><input data-f="address" value="${esc(c?.address)}"></div>
      <div class="field"><label>Notes</label><input data-f="notes" value="${esc(c?.notes)}"></div>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-ok>Save</button>`
  });
  m.$('[data-ok]').onclick = async () => {
    const d = {}; m.el.querySelectorAll('[data-f]').forEach(i => d[i.dataset.f] = i.value.trim());
    if (!d.name) return toast('Name is required', 'error');
    const digits = cleanDigits(d.phone);
    if (digits.length < 9) return toast('Enter a valid mobile number — reminders are sent to it', 'error');
    const dup = A.S.customers.find(x => x.id !== c?.id && cleanDigits(x.phone).slice(-9) === digits.slice(-9));
    if (dup && !await confirmBox(`${dup.name} already has this number. Save anyway?`, 'Save anyway', false)) return;
    const id = await ops.saveCustomer(c?.id, d);
    if (id) { toast('Customer saved'); m.close(); onSaved && onSaved({ id, ...(c || {}), ...d }); }
  };
}

/* ---------- Status badge for a sale ---------- */
export function saleBadge(s) {
  if (s.status === 'cancelled') return '<span class="badge badge-slate">Cancelled</span>';
  if (s.status === 'paid') return `<span class="badge badge-green">${s.payment === 'cheque' ? 'Cheque cleared' : 'Paid'}</span>`;
  if (s.status === 'cheque') return `<span class="badge badge-amber">Cheque ${esc((s.chequeStatus || 'Pending').toLowerCase())}</span>`;
  const lb = dueLabel(s.dueDate);
  return `<span class="badge ${lb.cls}">${s.chequeStatus === 'Returned' ? 'Returned cheque · ' : ''}${esc(lb.text)}</span>`;
}
export function payLabel(p) { return ({ cash: 'Cash', card: 'Card', bank: 'Bank', credit: 'Credit', cheque: 'Cheque' })[p] || p; }

export function exportSalesCsv(sales, name) {
  const rows = [['Invoice', 'Date', 'Time', 'Customer', 'Phone', 'Items', 'IMEIs', 'Total', 'Discount', 'Cost', 'Profit', 'Payment', 'Paid', 'Due', 'Status', 'Sold by']];
  sales.slice().sort((a, b) => (a.ts || 0) - (b.ts || 0)).forEach(s => rows.push([
    s.invoiceNo, s.day, prettyTime(s.ts), s.customerName, s.customerPhone || '',
    (s.items || []).map(i => i.name + (i.qty > 1 ? ' x' + i.qty : '')).join(' | '),
    (s.items || []).filter(i => i.imei).map(i => i.imei).join(' | '),
    s.total, s.discount || 0, A.isOwner() ? s.cost : '', A.isOwner() ? s.profit : '', s.payment, s.paid, s.due, s.status, s.by
  ]));
  downloadFile(name || `sales-${dayStr()}.csv`, toCsv(rows), 'text/csv');
}
export { shortDay };
