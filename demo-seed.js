/* Sample data for "Try demo" — lets a shop owner try every feature before signing up.
   IMEIs are valid (correct check digit), so scanning tests behave like the real thing. */
import { dayStr, addDays } from './util.js';

function luhnDigit(body14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) { let d = +body14[i]; if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; } sum += d; }
  return String((10 - (sum % 10)) % 10);
}
export function makeImei(tac8, serial6) { const b = tac8 + String(serial6).padStart(6, '0'); return b + luhnDigit(b); }

export function demoSeed() {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const today = dayStr();
  const id = (p, n) => p + n;
  const store = { phones: {}, accessories: {}, customers: {}, sales: {}, payments: {}, expenses: {}, suppliers: {} };
  store.shop = {
    id: 'demo', name: 'Demo Mobile Centre', status: 'active', plan: 'demo', paidUntil: Date.now() + 365 * 86400000,
    smsEnabled: false, settings: { currency: 'Rs', phone: '077 123 4567', address: 'No. 12, Main Street, Gampaha', footer: 'Thank you! Warranty only with this bill.', daysBefore: 2 }
  };
  const sups = ['Singer Distributors', 'Softlogic Mobile', 'Metropolitan Traders'];
  sups.forEach((n, i) => store.suppliers[id('s', i)] = { id: id('s', i), name: n, phone: '07' + (10000000 + i * 1234567), address: 'Colombo' });

  const models = [
    { brand: 'Samsung', model: 'Galaxy A15', ram: '6GB', storage: '128GB', color: 'Blue Black', cost: 47500, sell: 54900, tac: '35291861', n: 6 },
    { brand: 'Samsung', model: 'Galaxy A25', ram: '8GB', storage: '256GB', color: 'Light Blue', cost: 71000, sell: 79900, tac: '35604213', n: 4 },
    { brand: 'Redmi', model: '13C', ram: '4GB', storage: '128GB', color: 'Midnight Black', cost: 30500, sell: 35900, tac: '86729106', n: 5 },
    { brand: 'Apple', model: 'iPhone 13', ram: '4GB', storage: '128GB', color: 'Midnight', cost: 178000, sell: 199000, tac: '35386411', n: 2 },
    { brand: 'Vivo', model: 'Y17s', ram: '4GB', storage: '128GB', color: 'Glitter Purple', cost: 33000, sell: 38500, tac: '86301506', n: 3 },
    { brand: 'Oppo', model: 'A18', ram: '4GB', storage: '128GB', color: 'Glowing Blue', cost: 36000, sell: 41900, tac: '86829707', n: 3 }
  ];
  let pn = 0, serial = 104233;
  const allPhones = [];
  models.forEach(m => {
    for (let i = 0; i < m.n + 3; i++) {
      serial += 17 + Math.floor(rnd() * 40);
      const imei1 = makeImei(m.tac, serial), imei2 = m.brand === 'Apple' ? '' : makeImei(m.tac, serial + 1);
      const p = { id: id('p', pn++), brand: m.brand, model: m.model, ram: m.ram, storage: m.storage, color: m.color, cost: m.cost, sell: m.sell,
        warranty: m.brand === 'Apple' ? '6 months shop warranty' : '1 year company warranty', supplierName: pick(sups), notes: '',
        imei1, imei2, imeis: [imei1, imei2].filter(Boolean), status: 'Available', addedDay: addDays(today, -25 + Math.floor(rnd() * 10)), addedAt: Date.now() - 20 * 86400000, addedBy: 'Demo Owner' };
      store.phones[p.id] = p; allPhones.push(p);
    }
  });
  const accs = [
    ['Charger', 'Samsung 25W Type-C charger', 3200, 4500, 14], ['Cable', 'Type-C to Type-C 1m cable', 450, 900, 30],
    ['Earphones', 'JBL wired earphones', 1500, 2500, 9], ['Tempered glass', 'Full glue tempered glass', 150, 500, 60],
    ['Back cover', 'Silicone back cover (A15)', 350, 900, 2], ['Power bank', 'Anker 10000mAh power bank', 6200, 7900, 5],
    ['Memory card', 'SanDisk 64GB microSD', 1900, 2900, 1], ['Smart watch', 'Xiaomi Smart Band 8', 8900, 10900, 3]
  ];
  accs.forEach(([category, name, cost, sell, qty], i) => store.accessories[id('a', i)] = { id: id('a', i), category, name, cost, sell, qty, min: 3, supplierName: pick(sups) });

  const custs = [['Nimal Perera', '0771234567', 'Retail'], ['Kasun Traders', '0712345678', 'Dealer'], ['Fathima Rizna', '0759876543', 'Retail'],
    ['Suresh Kumar', '0764567890', 'Wholesale'], ['Dilani Fernando', '0703456789', 'Retail'], ['Ruwan Mobile Shop', '0786543210', 'Dealer'], ['Tharindu Silva', '0721112223', 'Retail']];
  custs.forEach(([name, phone, type], i) => store.customers[id('c', i)] = { id: id('c', i), name, phone, type, nic: '', address: pick(['Gampaha', 'Kandy', 'Negombo', 'Kurunegala', 'Colombo 10']), balance: 0, totalSpent: 0, bills: 0, createdAt: Date.now() - 40 * 86400000 });

  // sales over the last 18 days
  let sn = 0, pay = 0;
  const plan = [
    // [daysAgo, customerIdx|null, payment, extra]
    [18, 1, 'credit', { due: 2 }], [15, 3, 'cheque', { chq: 1 }], [14, null, 'cash'], [12, 0, 'cash'], [11, 5, 'credit', { due: -3 }],
    [9, null, 'card'], [8, 2, 'credit', { due: 1, adv: 10000 }], [7, null, 'cash'], [6, 6, 'cheque', { chq: 2 }], [5, 4, 'bank'],
    [4, null, 'cash'], [3, 1, 'credit', { due: 12 }], [2, null, 'cash'], [1, 3, 'cash'], [0, null, 'cash'], [0, 0, 'credit', { due: 0, adv: 5000 }]
  ];
  const avail = () => allPhones.filter(p => p.status === 'Available');
  plan.forEach(([ago, ci, payment, x = {}]) => {
    const day = addDays(today, -ago);
    const items = [];
    const nPh = ci === 1 || ci === 5 ? 2 : 1;
    for (let k = 0; k < nPh; k++) {
      const p = pick(avail().filter(q => q.brand !== 'Apple' || rnd() > 0.6));
      items.push({ type: 'phone', phoneId: p.id, name: [p.brand, p.model, p.storage, p.color].join(' '), imei: p.imei1, imei2: p.imei2, price: p.sell, cost: p.cost, warranty: p.warranty, qty: 1 });
      p.status = 'Sold';
    }
    if (rnd() > 0.4) { const a = store.accessories[id('a', Math.floor(rnd() * 4))]; items.push({ type: 'acc', accId: a.id, name: a.name, price: a.sell, cost: a.cost, qty: 1 }); }
    const total = items.reduce((a, i) => a + i.price * i.qty, 0), cost = items.reduce((a, i) => a + i.cost * i.qty, 0);
    const c = ci == null ? null : store.customers[id('c', ci)];
    const sid = id('sale', sn++);
    let ts = new Date(day + 'T' + String(9 + Math.floor(rnd() * 9)).padStart(2, '0') + ':' + String(Math.floor(rnd() * 60)).padStart(2, '0') + ':00').getTime();
    if (ts > Date.now()) ts = Date.now() - (plan.length - sn) * 600000; // never in the future
    const s = { id: sid, invoiceNo: 'D1-' + day.slice(2).replace(/-/g, '') + '-' + String(sn).padStart(3, '0'), day, ts, by: pick(['Demo Owner', 'Sahan (staff)']), byUid: 'demo',
      customerId: c ? c.id : null, customerName: c ? c.name : 'Walk-in customer', customerPhone: c ? c.phone : '', items, subtotal: total, discount: 0, total, cost, profit: total - cost,
      payment, paid: total, paidAtSale: total, due: 0, status: 'paid', open: false, reminderKeys: [] };
    if (payment === 'credit') { const adv = x.adv || 0; Object.assign(s, { paid: adv, paidAtSale: adv, due: total - adv, status: 'due', open: true, dueDate: addDays(today, x.due) }); }
    if (payment === 'cheque') Object.assign(s, { paid: 0, paidAtSale: 0, due: total, status: 'cheque', open: true, chequeNo: String(100000 + Math.floor(rnd() * 800000)), bank: pick(['BOC', 'Commercial Bank', 'Sampath', 'HNB']), chequeDate: addDays(today, x.chq), chequeStatus: 'Pending' });
    items.filter(i => i.type === 'phone').forEach(i => Object.assign(store.phones[i.phoneId], { saleId: sid, invoiceNo: s.invoiceNo, soldDay: day, soldAt: ts, soldTo: s.customerName, soldPrice: i.price, soldBy: s.by }));
    items.filter(i => i.type === 'acc').forEach(i => { store.accessories[i.accId].qty -= 1; });
    if (c) { c.totalSpent += total; c.bills += 1; c.lastDay = day; if (s.status === 'due') c.balance += s.due; }
    store.sales[sid] = s;
  });
  // one partial collection
  const cr = Object.values(store.sales).find(s => s.status === 'due' && s.customerId === 'c1');
  if (cr) {
    const amt = 20000; cr.paid += amt; cr.due -= amt; store.customers.c1.balance -= amt;
    store.payments['pay' + pay++] = { id: 'pay0', saleId: cr.id, invoiceNo: cr.invoiceNo, customerId: 'c1', customerName: cr.customerName, amount: amt, method: 'cash', note: '', kind: 'collection', day: addDays(today, -1), ts: Date.now() - 86400000, by: 'Demo Owner' };
  }
  [['Rent', 45000, 1], ['Electricity', 8200, 3], ['Salary', 35000, 2], ['Tea / Food', 1800, 0], ['Transport', 2500, 5]].forEach(([category, amount, ago], i) => {
    const d = addDays(today, -ago); if (d.slice(0, 7) !== today.slice(0, 7)) return;
    store.expenses['e' + i] = { id: 'e' + i, category, amount, note: '', day: d, ts: Date.now(), by: 'Demo Owner' };
  });
  return store;
}
