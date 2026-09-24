/* Import / export.
   • Export: every record of this shop as one JSON file (keep it as an off-cloud backup).
   • Import: accepts either this app's export, OR a backup file from the old offline
     "Mobile Distributor Pro" (IndexedDB) app — so existing shops move over without retyping. */
import { A } from './app.js';
import { COLLECTIONS } from './data.js';
import { dayStr, imageToThumb, downloadFile, num } from './util.js';

export async function exportAll() {
  const out = { format: 'mdp-cloud-1', exportedAt: new Date().toISOString(), shop: { name: A.shop.name, settings: A.settings() }, data: {} };
  for (const c of COLLECTIONS) out.data[c] = await A.data.query(c, {});
  downloadFile(`mdp-backup-${dayStr()}.json`, JSON.stringify(out, null, 1), 'application/json');
  return Object.values(out.data).reduce((a, l) => a + l.length, 0);
}

const localDay = iso => { const d = new Date(iso); return isNaN(d) ? dayStr() : dayStr(d); };

/* Old app → new model */
export async function convertOld(old, onStep) {
  const ops = [];
  const P = id => 'old-p-' + id, AC = id => 'old-a-' + id, C = id => 'old-c-' + id, S = id => 'old-s-' + id;
  const bal = {}, spent = {}, bills = {}, last = {};
  const saleById = {};
  (old.sales || []).forEach(s => { saleById[s.id] = s; });

  onStep && onStep('Converting phones…');
  for (const p of old.phones || []) {
    const photo = p.photo ? await imageToThumb(p.photo, 240) : null;
    const s = p.saleId != null ? saleById[p.saleId] : null;
    const sold = p.status === 'Sold';
    ops.push({ op: 'set', coll: 'phones', id: P(p.id), data: {
      brand: p.brand || '', model: p.model || '', color: p.color || '', ram: p.ram || '', storage: p.storage || '',
      cost: num(p.cost), sell: num(p.sell), warranty: p.warranty || '', supplierName: p.supplier || '', notes: p.notes || '', photo,
      imei1: p.imei || '', imei2: '', imeis: p.imei ? [String(p.imei)] : [], status: sold ? 'Sold' : 'Available',
      addedDay: s ? localDay(s.date) : dayStr(), addedAt: Date.now(), addedBy: 'Import',
      ...(sold && s ? { saleId: S(s.id), invoiceNo: 'OLD-' + s.id, soldDay: localDay(s.date), soldAt: new Date(s.date).getTime(), soldTo: s.customerName || '', soldPrice: null } : {})
    } });
  }
  onStep && onStep('Converting accessories…');
  for (const a of old.accessories || []) {
    const photo = a.photo ? await imageToThumb(a.photo, 240) : null;
    ops.push({ op: 'set', coll: 'accessories', id: AC(a.id), data: { category: a.category || '', name: a.name || '', cost: num(a.cost), sell: num(a.sell), qty: Math.round(num(a.qty)), min: a.min ?? 2, supplierName: a.supplier || '', photo } });
  }
  onStep && onStep('Converting sales…');
  const phoneById = {}; (old.phones || []).forEach(p => phoneById[p.id] = p);
  const accById = {}; (old.accessories || []).forEach(a => accById[a.id] = a);
  const custById = {}; (old.customers || []).forEach(c => custById[c.id] = c);
  for (const s of old.sales || []) {
    const day = localDay(s.date), ts = new Date(s.date).getTime() || Date.now();
    let status = 'paid', paid = num(s.total), due = 0, extra = {};
    if (s.payment === 'credit') {
      paid = s.creditStatus === 'Paid' ? num(s.total) : num(s.paidAmount); due = Math.max(0, num(s.total) - paid);
      status = due > 0 ? 'due' : 'paid'; extra.dueDate = s.dueDate || day;
    } else if (s.payment === 'cheque') {
      extra = { chequeNo: s.chequeNo || '', bank: s.bank || '', chequeDate: s.chequeDate || day, chequeStatus: s.chequeStatus || 'Pending' };
      if (s.chequeStatus === 'Cleared') { status = 'paid'; }
      else if (s.chequeStatus === 'Returned') { status = 'due'; paid = 0; due = num(s.total); extra.dueDate = dayStr(); }
      else { status = 'cheque'; paid = 0; due = num(s.total); }
    }
    const cust = s.customerId != null ? custById[s.customerId] : null;
    const cid = cust ? C(cust.id) : null;
    if (cid) { spent[cid] = (spent[cid] || 0) + num(s.total); bills[cid] = (bills[cid] || 0) + 1; if (status === 'due') bal[cid] = (bal[cid] || 0) + due; if (!last[cid] || day > last[cid]) last[cid] = day; }
    const items = (s.items || []).map(i => i.type === 'phone'
      ? { type: 'phone', phoneId: P(i.phoneId), name: i.name, imei: i.imei || '', imei2: '', price: num(i.price), cost: num(phoneById[i.phoneId]?.cost), qty: 1, warranty: phoneById[i.phoneId]?.warranty || '' }
      : { type: 'acc', accId: AC(i.accId), name: i.name, price: num(i.price), cost: num(accById[i.accId]?.cost), qty: i.qty || 1 });
    ops.push({ op: 'set', coll: 'sales', id: S(s.id), data: {
      invoiceNo: 'OLD-' + s.id, day, ts, by: 'Import', byUid: A.user.uid,
      customerId: cid, customerName: s.customerName || (cust && cust.name) || 'Walk-in customer', customerPhone: cust ? cust.phone || '' : '',
      items, subtotal: num(s.total), discount: 0, total: num(s.total), cost: num(s.total) - num(s.profit), profit: num(s.profit),
      payment: s.payment || 'cash', paid, paidAtSale: s.payment === 'cash' ? num(s.total) : 0, due, status, open: status === 'due' || status === 'cheque',
      reminderKeys: [], ...extra
    } });
  }
  onStep && onStep('Converting customers, expenses, suppliers…');
  for (const c of old.customers || []) {
    const id = C(c.id);
    ops.push({ op: 'set', coll: 'customers', id, data: { name: c.name || '', phone: c.phone || '', nic: c.nic || '', address: c.address || '', type: c.type || 'Retail', balance: Math.round((bal[id] || 0) * 100) / 100, totalSpent: spent[id] || 0, bills: bills[id] || 0, lastDay: last[id] || null, createdAt: Date.now() } });
  }
  for (const e of old.expenses || []) ops.push({ op: 'set', coll: 'expenses', id: 'old-e-' + e.id, data: { category: e.category || 'Other', note: e.note || '', amount: num(e.amount), day: e.date || dayStr(), ts: Date.now(), by: 'Import' } });
  for (const s of old.suppliers || []) ops.push({ op: 'set', coll: 'suppliers', id: 'old-sup-' + s.id, data: { name: s.name || '', phone: s.phone || '', email: s.email || '', address: s.address || '' } });
  const settingsRow = (old.meta || []).find(m => m.key === 'settings');
  return { ops, shopName: settingsRow?.value?.shopName, currency: settingsRow?.value?.currency };
}

export async function importFile(text, onStep) {
  const j = JSON.parse(text);
  let ops = [], shopName, currency;
  if (j.format === 'mdp-cloud-1') {
    for (const c of COLLECTIONS) for (const d of j.data[c] || []) { const { id, ...rest } = d; ops.push({ op: 'set', coll: c, id, data: rest }); }
  } else if (Array.isArray(j.phones) || Array.isArray(j.sales)) {
    ({ ops, shopName, currency } = await convertOld(j, onStep));
  } else throw new Error('This file is not a Mobile Distributor Pro backup');
  onStep && onStep(`Uploading ${ops.length} records…`);
  await A.data.chunkedCommit(ops, (n, t) => onStep && onStep(`Uploading ${n} / ${t}…`));
  return { count: ops.length, shopName, currency };
}
