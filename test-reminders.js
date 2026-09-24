/* Unit tests for the reminder planner. Run: node test-reminders.js */
const assert = require('assert');
const { planShop, daysBetween, intlPhone, todayIn, runReminders } = require('./reminders');

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('✓', name); };
const shop = { name: 'YF Marketing', settings: { currency: 'Rs', phone: '0771234567' } };
const base = { open: true, customerName: 'Nimal', customerPhone: '0771111111', invoiceNo: 'A1-260923-001', reminderKeys: [] };
const today = '2026-09-23';

t('daysBetween', () => { assert.strictEqual(daysBetween('2026-09-23', '2026-09-25'), 2); assert.strictEqual(daysBetween('2026-09-23', '2026-09-20'), -3); assert.strictEqual(daysBetween('2026-12-31', '2027-01-01'), 1); });
t('intlPhone', () => { assert.strictEqual(intlPhone('077 111 1111'), '94771111111'); assert.strictEqual(intlPhone('+94 77 111 1111'), '94771111111'); assert.strictEqual(intlPhone('771111111'), '94771111111'); });
t('todayIn Colombo crosses midnight correctly', () => { assert.strictEqual(todayIn('Asia/Colombo', new Date('2026-09-22T19:00:00Z')), '2026-09-23'); assert.strictEqual(todayIn('Asia/Colombo', new Date('2026-09-22T18:00:00Z')), '2026-09-22'); });

t('credit: reminds 2 days before, 1 day before and on the day; not 3 days before', () => {
  const mk = (due, id) => ({ ...base, id, status: 'due', due: 50000, dueDate: due });
  const p = planShop({ shop, cfg: { daysBefore: 2 }, sales: [mk('2026-09-26', 'a'), mk('2026-09-25', 'b'), mk('2026-09-24', 'c'), mk('2026-09-23', 'd')], today });
  assert.deepStrictEqual(p.messages.map(m => m.saleId), ['b', 'c', 'd']);
  assert.ok(p.messages[0].text.includes('Rs 50,000') && p.messages[0].text.includes('25 Sep 2026'), p.messages[0].text);
  assert.strictEqual(p.messages[0].to, '94771111111');
});
t('credit: same reminder never sent twice (key already on bill)', () => {
  const p = planShop({ shop, cfg: {}, sales: [{ ...base, id: 'x', status: 'due', due: 100, dueDate: '2026-09-25', reminderKeys: ['c:2026-09-25:2'] }], today });
  assert.strictEqual(p.messages.length, 0);
});
t('credit: due date moved → new reminders allowed', () => {
  const p = planShop({ shop, cfg: {}, sales: [{ ...base, id: 'x', status: 'due', due: 100, dueDate: '2026-09-24', reminderKeys: ['c:2026-09-20:0'] }], today });
  assert.strictEqual(p.messages.length, 1);
});
t('overdue: every 3 days by default, stops after 90 days, off when 0', () => {
  const mk = late => ({ ...base, id: 'o' + late, status: 'due', due: 100, dueDate: addDays(today, -late) });
  const sales = [1, 2, 3, 6, 7, 93].map(mk);
  assert.deepStrictEqual(planShop({ shop, cfg: {}, sales, today }).messages.map(m => m.saleId), ['o3', 'o6']);
  assert.strictEqual(planShop({ shop, cfg: { overdueEvery: 0 }, sales, today }).messages.length, 0);
  assert.deepStrictEqual(planShop({ shop, cfg: { overdueEvery: 1 }, sales, today }).messages.map(m => m.saleId), ['o1', 'o2', 'o3', 'o6', 'o7']);
  assert.ok(planShop({ shop, cfg: {}, sales, today }).messages[0].text.includes('3 days ago'));
});
t('cheque: reminds before cheque date only while Pending', () => {
  const s = { ...base, status: 'cheque', due: 36800, chequeNo: '349371', bank: 'BOC' };
  const p = planShop({ shop, cfg: {}, sales: [
    { ...s, id: 'q1', chequeDate: '2026-09-25', chequeStatus: 'Pending' },
    { ...s, id: 'q2', chequeDate: '2026-09-24', chequeStatus: 'Deposited' },
    { ...s, id: 'q3', chequeDate: '2026-09-28', chequeStatus: 'Pending' }], today });
  assert.deepStrictEqual(p.messages.map(m => m.saleId), ['q1']);
  assert.ok(p.messages[0].text.includes('349371') && p.messages[0].text.includes('BOC'));
});
t('paid / cancelled / closed bills are ignored', () => {
  const p = planShop({ shop, cfg: {}, sales: [
    { ...base, id: 'p', status: 'paid', open: false, due: 0, dueDate: today },
    { ...base, id: 'c', status: 'cancelled', open: false, due: 100, dueDate: today }], today });
  assert.strictEqual(p.messages.length, 0); assert.strictEqual(p.ownerText, null);
});
t('customer without a valid mobile is skipped and reported', () => {
  const p = planShop({ shop, cfg: {}, sales: [{ ...base, id: 'n', customerPhone: '011 2345678', status: 'due', due: 5, dueDate: today }], today });
  assert.strictEqual(p.messages.length, 0); assert.strictEqual(p.skipped.length, 1);
});
t('latest phone number from customer record is used', () => {
  const p = planShop({ shop, cfg: {}, customers: { c1: { phone: '0712222222' } }, sales: [{ ...base, id: 'n', customerId: 'c1', status: 'due', due: 5, dueDate: today }], today });
  assert.strictEqual(p.messages[0].to, '94712222222');
});
t('owner daily alert lists due, overdue and cheques; none when nothing to say', () => {
  const p = planShop({ shop, cfg: {}, sales: [
    { ...base, id: 'a', status: 'due', due: 50000, dueDate: '2026-09-24' },
    { ...base, id: 'b', customerName: 'Kasun', status: 'due', due: 20000, dueDate: '2026-09-10' },
    { ...base, id: 'c', customerName: 'Suresh', status: 'cheque', due: 36800, chequeNo: '349371', chequeDate: today, chequeStatus: 'Pending' }], today });
  assert.ok(/DUE: Nimal Rs 50,000 \(tomorrow\)/.test(p.ownerText), p.ownerText);
  assert.ok(/OVERDUE: 1 bill Rs 20,000/.test(p.ownerText));
  assert.ok(/CHEQUES: Suresh #349371 Rs 36,800 \(deposit today\)/.test(p.ownerText));
  assert.strictEqual(planShop({ shop, cfg: {}, sales: [], today }).ownerText, null);
  assert.strictEqual(planShop({ shop, cfg: { ownerSummary: false }, sales: [{ ...base, id: 'a', status: 'due', due: 1, dueDate: today }], today }).ownerText, null);
});
t('custom Sinhala template is filled', () => {
  const p = planShop({ shop, cfg: { tplCredit: '{customer} මහතා, {amount} {due_date} ගෙවන්න. {shop}' }, sales: [{ ...base, id: 'a', status: 'due', due: 1500, dueDate: today }], today });
  assert.strictEqual(p.messages[0].text, 'Nimal මහතා, Rs 1,500 23 Sep 2026 ගෙවන්න. YF Marketing');
});

function addDays(day, n) { const [y, m, d] = day.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1, d + n)); return x.toISOString().slice(0, 10); }

/* ---- End-to-end with a fake Firestore + fake Notify.lk ---- */
(async () => {
  const docs = {
    'shops/s1': { name: 'Shop One', smsEnabled: true, status: 'active', paidUntil: { toMillis: () => Date.now() + 1e9 }, settings: { phone: '0770000000' } },
    'shops/s1/private/sms': { enabled: true, userId: 'u', apiKey: 'k', senderId: 'NotifyDEMO', ownerPhone: '0779999999' },
    'shops/s1/sales/x1': { ...base, status: 'due', due: 1000, dueDate: '2026-09-24' },
    'shops/s1/customers/c': { phone: '0771111111' },
    'shops/s2': { name: 'Expired', smsEnabled: true, status: 'active', paidUntil: { toMillis: () => 1 } }
  };
  const writes = [];
  const ref = path => ({
    path, id: path.split('/').pop(),
    collection: c => col(path + '/' + c),
    doc: id => ref(path + '/' + id),
    get: async () => ({ exists: !!docs[path], data: () => docs[path], id: path.split('/').pop() }),
    update: async d => { writes.push(['update', path, d]); },
    set: async d => { writes.push(['set', path, d]); }
  });
  const col = path => ({
    doc: id => ref(path + '/' + (id || 'auto' + Math.random().toString(36).slice(2, 6))),
    where: (f, op, v) => ({
      get: async () => ({ docs: Object.keys(docs).filter(k => k.startsWith(path + '/') && k.split('/').length === path.split('/').length + 1 && docs[k][f] === v).map(k => ({ id: k.split('/').pop(), ref: ref(k), data: () => docs[k] })) })
    })
  });
  const db = { collection: c => col(c), getAll: async (...refs) => Promise.all(refs.map(r => r.get())), batch: () => { const ops = []; return { update: (r, d) => ops.push(['update', r.path, d]), set: (r, d) => ops.push(['set', r.path, d]), commit: async () => writes.push(...ops) }; } };
  const FieldValue = { arrayUnion: (...v) => ({ union: v }), serverTimestamp: () => 'TS' };
  const sent = [];
  global.fetch = async (url, opt) => { sent.push(Object.fromEntries(new URLSearchParams(opt.body))); return { json: async () => ({ status: 'success', data: 'Sent' }) }; };
  const logs = [];
  const sum = await runReminders({ db, FieldValue, now: new Date('2026-09-23T04:00:00Z'), log: m => logs.push(m) });
  assert.strictEqual(sum.shops, 1, 'expired shop must be skipped');
  assert.strictEqual(sent.length, 2, 'customer + owner');
  assert.strictEqual(sent[0].to, '94771111111'); assert.strictEqual(sent[1].to, '94779999999');
  assert.ok(writes.some(w => w[1] === 'shops/s1/sales/x1' && w[2].reminderKeys.union[0] === 'c:2026-09-24:1'), 'reminder key saved on bill');
  assert.ok(writes.some(w => w[1] === 'shops/s1' && w[2].smsOwnerDay === '2026-09-23'), 'owner alert marked for today');
  assert.ok(logs.some(l => l.includes('Expired') && l.includes('licence')));
  passed++; console.log('✓ end-to-end run with fake Firestore and Notify.lk');
  console.log(`\nAll ${passed} tests passed`);
})().catch(e => { console.error('✗', e); process.exit(1); });
