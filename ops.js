/* =========================================================================
   BUSINESS OPERATIONS — every change that touches more than one record is written
   as ONE atomic batch (all or nothing), so stock, sales and customer balances can
   never get out of step, even if the phone loses signal half way.
   Stock and balances use increment(), so two devices selling at the same time
   don't overwrite each other.
   ========================================================================= */
import { A } from './app.js';
import { INC, UNION } from './data.js';
import { dayStr, addDays, nextInvoiceNo, num, luhnOk, toast } from './util.js';

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const who = () => ({ by: A.user.name || A.user.email || 'User', byUid: A.user.uid });

/* ---------- IMEI lookup (for selling and for "where is this phone?") ---------- */
export function findInStock(imei) {
  return A.S.phones.find(p => (p.imeis || []).includes(imei)) || null;
}
export async function lookupImei(imei) {
  const local = findInStock(imei);
  if (local) return local;
  const r = await A.data.query('phones', { where: [['imeis', 'array-contains', imei]], limit: 5 });
  return r.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))[0] || null;
}
/* Returns the IMEIs from `list` that already exist anywhere in the shop (in stock or sold). */
export async function existingImeis(list) {
  const found = new Set();
  list.forEach(i => { if (findInStock(i)) found.add(i); });
  const rest = list.filter(i => !found.has(i));
  for (let i = 0; i < rest.length; i += 30) {
    const chunk = rest.slice(i, i + 30);
    const r = await A.data.query('phones', { where: [['imeis', 'array-contains-any', chunk]] });
    r.forEach(p => (p.imeis || []).forEach(x => { if (chunk.includes(x)) found.add(x); }));
  }
  return found;
}

/* ---------- Stock ---------- */
export async function addPhones(base, units) {
  if (!A.guard()) return false;
  const now = Date.now(), day = dayStr();
  const ops = units.map(u => {
    const imeis = [u.imei1, u.imei2].filter(Boolean);
    return {
      op: 'set', coll: 'phones', id: A.data.newId(), data: {
        brand: base.brand, model: base.model, color: base.color || '', ram: base.ram || '', storage: base.storage || '',
        cost: num(base.cost), sell: num(base.sell), warranty: base.warranty || '', supplierName: base.supplierName || '',
        notes: base.notes || '', photo: base.photo || null,
        imei1: u.imei1, imei2: u.imei2 || '', imeis, status: 'Available',
        addedDay: day, addedAt: now, addedBy: who().by
      }
    };
  });
  await A.data.commit(ops, 'Add stock');
  return true;
}
export async function updatePhone(id, data) {
  if (!A.guard()) return false;
  data.imeis = [data.imei1, data.imei2].filter(Boolean);
  await A.data.commit([{ op: 'update', coll: 'phones', id, data }], 'Update phone');
  return true;
}
export async function deletePhone(p) {
  if (!A.guard()) return false;
  if (p.status === 'Sold') { toast('Sold phones cannot be deleted — cancel the bill instead', 'error'); return false; }
  await A.data.commit([{ op: 'delete', coll: 'phones', id: p.id }], 'Delete phone');
  return true;
}
export async function saveAccessory(id, data) {
  if (!A.guard()) return false;
  await A.data.commit([{ op: id ? 'update' : 'set', coll: 'accessories', id: id || A.data.newId(), data }], 'Save accessory');
  return true;
}
export async function restockAccessory(acc, qty, cost) {
  if (!A.guard()) return false;
  const data = { qty: INC(qty) };
  if (cost) data.cost = num(cost);
  await A.data.commit([{ op: 'update', coll: 'accessories', id: acc.id, data }], 'Restock');
  return true;
}

/* ---------- Customers ---------- */
export async function saveCustomer(id, data) {
  if (!A.guard()) return null;
  const newId = id || A.data.newId();
  if (!id) Object.assign(data, { balance: 0, totalSpent: 0, bills: 0, createdAt: Date.now() });
  await A.data.commit([{ op: id ? 'update' : 'set', coll: 'customers', id: newId, data }], 'Save customer');
  return newId;
}

/* ---------- Checkout ----------
   cart: [{type:'phone', phoneId, name, imei, imei2, price, cost, warranty} | {type:'acc', accId, name, price, cost, qty}] */
export async function checkout({ cart, customer, payment, discount = 0, paidNow = 0, dueDate, cheque = {}, note = '' }) {
  if (!A.guard()) return null;
  const today = dayStr(), ts = Date.now();
  const subtotal = round2(cart.reduce((a, c) => a + num(c.price) * (c.qty || 1), 0));
  const total = round2(Math.max(0, subtotal - num(discount)));
  const cost = round2(cart.reduce((a, c) => a + num(c.cost) * (c.qty || 1), 0));
  const saleId = A.data.newId();
  const invoiceNo = nextInvoiceNo();

  let status = 'paid', paid = total, due = 0, open = false;
  if (payment === 'credit') {
    paid = round2(Math.min(total, Math.max(0, num(paidNow)))); due = round2(total - paid);
    status = due > 0 ? 'due' : 'paid'; open = due > 0;
  } else if (payment === 'cheque') {
    paid = 0; due = total; status = 'cheque'; open = true;
  }
  const sale = {
    invoiceNo, day: today, ts, ...who(),
    customerId: customer ? customer.id : null,
    customerName: customer ? customer.name : 'Walk-in customer',
    customerPhone: customer ? (customer.phone || '') : '',
    items: cart.map(c => ({ ...c, qty: c.qty || 1 })),
    subtotal, discount: round2(num(discount)), total, cost, profit: round2(total - cost),
    payment, paid, paidAtSale: paid, due, status, open, note,
    reminderKeys: []
  };
  if (payment === 'credit') sale.dueDate = dueDate || addDays(today, 30);
  if (payment === 'cheque') Object.assign(sale, { chequeNo: cheque.no || '', bank: cheque.bank || '', chequeDate: cheque.date || today, chequeStatus: 'Pending' });

  const ops = [{ op: 'set', coll: 'sales', id: saleId, data: sale }];
  for (const c of cart) {
    if (c.type === 'phone') {
      ops.push({ op: 'update', coll: 'phones', id: c.phoneId, data: {
        status: 'Sold', saleId, invoiceNo, soldDay: today, soldAt: ts, soldTo: sale.customerName, soldPrice: num(c.price), soldBy: sale.by
      } });
    } else {
      ops.push({ op: 'update', coll: 'accessories', id: c.accId, data: { qty: INC(-(c.qty || 1)) } });
    }
  }
  if (customer) {
    ops.push({ op: 'update', coll: 'customers', id: customer.id, data: {
      totalSpent: INC(total), bills: INC(1), lastDay: today, ...(payment === 'credit' && due > 0 ? { balance: INC(due) } : {})
    } });
  }
  await A.data.commit(ops, 'Sale ' + invoiceNo);
  return { id: saleId, ...sale };
}

/* ---------- Payments ---------- */
function applyPaymentOps(sale, amount, method, note, kind = 'collection') {
  const newPaid = round2((sale.paid || 0) + amount);
  const due = round2(Math.max(0, sale.total - newPaid));
  const ops = [
    { op: 'set', coll: 'payments', id: A.data.newId(), data: {
      saleId: sale.id, invoiceNo: sale.invoiceNo, customerId: sale.customerId || null, customerName: sale.customerName,
      amount: round2(amount), method, note: note || '', kind, day: dayStr(), ts: Date.now(), ...who()
    } },
    { op: 'update', coll: 'sales', id: sale.id, data: { paid: newPaid, due, status: due > 0 ? 'due' : 'paid', open: due > 0 } }
  ];
  if (sale.customerId && kind === 'collection') ops.push({ op: 'update', coll: 'customers', id: sale.customerId, data: { balance: INC(-round2(amount)) } });
  return ops;
}
export async function receivePayment(sale, amount, method = 'cash', note = '') {
  if (!A.guard()) return false;
  amount = round2(amount);
  if (!(amount > 0)) { toast('Enter an amount', 'error'); return false; }
  if (amount > sale.due + 0.001) { toast('Amount is more than the balance due', 'error'); return false; }
  await A.data.commit(applyPaymentOps(sale, amount, method, note), 'Payment');
  return true;
}
/* Customer pays a lump sum → applied to their oldest dues first. */
export async function receiveCustomerPayment(customer, amount, method = 'cash', note = '') {
  if (!A.guard()) return false;
  amount = round2(amount);
  const open = openDuesFor(customer.id);
  const totalDue = round2(open.reduce((a, s) => a + s.due, 0));
  if (!(amount > 0)) { toast('Enter an amount', 'error'); return false; }
  if (amount > totalDue + 0.001) { toast('Amount is more than the total due (' + totalDue + ')', 'error'); return false; }
  let left = amount; const ops = [];
  for (const s of open) {
    if (left <= 0) break;
    const pay = round2(Math.min(left, s.due));
    ops.push(...applyPaymentOps(s, pay, method, note));
    left = round2(left - pay);
  }
  await A.data.commit(ops, 'Payment');
  return true;
}
export function openDuesFor(customerId) {
  return A.S.salesOpen.filter(s => s.customerId === customerId && s.status === 'due' && s.due > 0)
    .sort((a, b) => (a.dueDate || a.day).localeCompare(b.dueDate || b.day));
}

/* ---------- Cheques ---------- */
export async function setChequeStatus(sale, status) {
  if (!A.guard()) return false;
  const ops = [];
  if (status === 'Deposited') ops.push({ op: 'update', coll: 'sales', id: sale.id, data: { chequeStatus: 'Deposited' } });
  if (status === 'Cleared') {
    ops.push({ op: 'update', coll: 'sales', id: sale.id, data: { chequeStatus: 'Cleared', status: 'paid', open: false, paid: sale.total, due: 0 } });
    ops.push({ op: 'set', coll: 'payments', id: A.data.newId(), data: {
      saleId: sale.id, invoiceNo: sale.invoiceNo, customerId: sale.customerId || null, customerName: sale.customerName,
      amount: sale.total, method: 'cheque', note: 'Cheque ' + (sale.chequeNo || '') + ' cleared', kind: 'cheque', day: dayStr(), ts: Date.now(), ...who()
    } });
  }
  if (status === 'Returned') {
    // A bounced cheque becomes a normal credit debt with a 7-day due date, so reminders continue.
    ops.push({ op: 'update', coll: 'sales', id: sale.id, data: {
      chequeStatus: 'Returned', status: 'due', open: true, due: sale.total, paid: 0, dueDate: addDays(dayStr(), 7)
    } });
    if (sale.customerId) ops.push({ op: 'update', coll: 'customers', id: sale.customerId, data: { balance: INC(sale.total) } });
  }
  await A.data.commit(ops, 'Cheque');
  return true;
}
export async function changeDueDate(sale, newDate) {
  if (!A.guard()) return false;
  const field = sale.status === 'cheque' ? 'chequeDate' : 'dueDate';
  await A.data.commit([{ op: 'update', coll: 'sales', id: sale.id, data: { [field]: newDate } }], 'Date');
  return true;
}

/* ---------- Cancel a bill (owner) — puts stock back and reverses the customer balance ---------- */
export async function cancelSale(sale, reason = '') {
  if (!A.guard()) return false;
  const ops = [{ op: 'update', coll: 'sales', id: sale.id, data: {
    status: 'cancelled', open: false, cancelledDay: dayStr(), cancelledBy: who().by, cancelReason: reason, profit: 0
  } }];
  for (const it of sale.items || []) {
    if (it.type === 'phone') ops.push({ op: 'update', coll: 'phones', id: it.phoneId, data: {
      status: 'Available', saleId: null, invoiceNo: null, soldDay: null, soldAt: null, soldTo: null, soldPrice: null
    } });
    else ops.push({ op: 'update', coll: 'accessories', id: it.accId, data: { qty: INC(it.qty || 1) } });
  }
  if (sale.customerId) {
    const cu = { totalSpent: INC(-sale.total), bills: INC(-1) };
    if (sale.status === 'due') cu.balance = INC(-sale.due);
    ops.push({ op: 'update', coll: 'customers', id: sale.customerId, data: cu });
  }
  await A.data.commit(ops, 'Cancel bill');
  return true;
}

/* ---------- Expenses / suppliers ---------- */
export async function addExpense(data) {
  if (!A.guard()) return false;
  await A.data.commit([{ op: 'set', coll: 'expenses', id: A.data.newId(), data: { ...data, ts: Date.now(), ...who() } }], 'Expense');
  return true;
}
export async function removeDoc(coll, id) {
  if (!A.guard()) return false;
  await A.data.commit([{ op: 'delete', coll, id }], 'Delete');
  return true;
}
export async function saveSupplier(id, data) {
  if (!A.guard()) return false;
  await A.data.commit([{ op: id ? 'update' : 'set', coll: 'suppliers', id: id || A.data.newId(), data }], 'Supplier');
  return true;
}
export async function saveShopSettings(patch) {
  if (!A.guard()) return false;
  await A.data.commit([{ op: 'update', coll: 'shop', id: 'shop', data: patch }], 'Settings');
  return true;
}

export { luhnOk, UNION };
