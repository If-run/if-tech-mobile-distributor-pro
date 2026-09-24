/* =========================================================================
   SMS REMINDER ENGINE (runs in the cloud once a day, ~9:00 AM Sri Lanka time)
   For every active shop that switched reminders on:
     • credit customers  → SMS from N days before the due date, daily until the due date
                           (default N = 2), then every X days while overdue (default 3)
     • cheque customers  → SMS from N days before the cheque date (keep funds available)
     • shop owner        → one daily alert: who is due, overdue totals, cheques to deposit
   Each reminder has a key stored on the bill, so a customer never gets the same
   reminder twice, even if the job runs again.
   The planning logic (planShop) is pure and unit-tested in test-reminders.js.
   ========================================================================= */

const DEFAULTS = {
  daysBefore: 2,
  overdueEvery: 3,
  ownerSummary: true,
  tplCredit: 'Dear {customer}, reminder from {shop}: {amount} for bill {invoice} is due on {due_date}. Thank you. {shop_phone}',
  tplOverdue: 'Dear {customer}, {amount} for bill {invoice} from {shop} was due on {due_date} ({days} days ago). Please settle it soon. {shop_phone}',
  tplCheque: 'Dear {customer}, your cheque {cheque_no} ({bank}) for {amount} to {shop} will be deposited on {cheque_date}. Please keep funds available. {shop_phone}'
};
const MAX_OVERDUE_DAYS = 90;

function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}
function todayIn(tz = 'Asia/Colombo', now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function prettyDay(day) {
  if (!day) return '';
  const [y, m, d] = day.split('-').map(Number);
  return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`;
}
function money(n, cur = 'Rs') { return cur + ' ' + Math.round(Number(n) || 0).toLocaleString('en-US'); }
function intlPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.length === 10 && d.startsWith('0')) d = '94' + d.slice(1);
  else if (d.length === 9) d = '94' + d;
  return d;
}
function validLkMobile(p) { return /^947\d{8}$/.test(p); }
function fill(tpl, v) { return String(tpl).replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? String(v[k]) : '')).replace(/\s+/g, ' ').trim(); }

/**
 * Decide which SMS to send for one shop today. Pure function — no network, no database.
 * @returns {{ messages: {saleId,key,to,text}[], ownerText: string|null, skipped: string[] }}
 */
function planShop({ shop, cfg, sales, customers = {}, today }) {
  const c = { ...DEFAULTS, ...(cfg || {}) };
  const cur = (shop.settings && shop.settings.currency) || 'Rs';
  const shopPhone = (shop.settings && shop.settings.phone) || '';
  const messages = [], skipped = [];
  const dueSoon = [], overdue = [], cheques = [];

  for (const s of sales) {
    if (!s.open || s.status === 'cancelled') continue;
    const phone = intlPhone((customers[s.customerId] && customers[s.customerId].phone) || s.customerPhone);
    let key = null, tpl = null, d = null;
    const vars = {
      customer: s.customerName || 'Customer', shop: shop.name || '', amount: money(s.due, cur), invoice: s.invoiceNo || '',
      due_date: prettyDay(s.dueDate), cheque_date: prettyDay(s.chequeDate), cheque_no: s.chequeNo || '', bank: s.bank || '', shop_phone: shopPhone, days: ''
    };
    if (s.status === 'due' && s.dueDate && (s.due || 0) > 0) {
      d = daysBetween(today, s.dueDate);
      if (d >= 0 && d <= c.daysBefore) { key = `c:${s.dueDate}:${d}`; tpl = c.tplCredit; dueSoon.push({ s, d }); }
      else if (d < 0) {
        overdue.push({ s, d });
        const late = -d; vars.days = late;
        if (c.overdueEvery > 0 && late % c.overdueEvery === 0 && late <= MAX_OVERDUE_DAYS) { key = `o:${s.dueDate}:${late}`; tpl = c.tplOverdue; }
      }
    } else if (s.status === 'cheque' && s.chequeDate) {
      d = daysBetween(today, s.chequeDate);
      if (d <= c.daysBefore) cheques.push({ s, d });
      if ((s.chequeStatus || 'Pending') === 'Pending' && d >= 0 && d <= c.daysBefore) { key = `q:${s.chequeDate}:${d}`; tpl = c.tplCheque; }
    }
    if (!key) continue;
    if ((s.reminderKeys || []).includes(key)) continue;
    if (!validLkMobile(phone)) { skipped.push(`${s.invoiceNo}: no valid mobile number`); continue; }
    messages.push({ saleId: s.id, key, to: phone, text: fill(tpl, vars).slice(0, 621) });
  }

  let ownerText = null;
  if (c.ownerSummary && (dueSoon.length || overdue.length || cheques.length)) {
    const L = [`${shop.name || 'Shop'} - ${prettyDay(today)}`];
    if (dueSoon.length) {
      dueSoon.sort((a, b) => a.d - b.d);
      L.push('DUE: ' + dueSoon.map(({ s, d }) => `${s.customerName} ${money(s.due, cur)} (${d === 0 ? 'today' : d === 1 ? 'tomorrow' : prettyDay(s.dueDate).slice(0, -5)})`).join('; '));
    }
    if (overdue.length) L.push(`OVERDUE: ${overdue.length} bill${overdue.length > 1 ? 's' : ''} ${money(overdue.reduce((a, x) => a + (x.s.due || 0), 0), cur)}`);
    if (cheques.length) {
      cheques.sort((a, b) => a.d - b.d);
      L.push('CHEQUES: ' + cheques.map(({ s, d }) => `${s.customerName} #${s.chequeNo || ''} ${money(s.due, cur)} (${d < 0 ? 'deposit now' : d === 0 ? 'deposit today' : prettyDay(s.chequeDate).slice(0, -5)})`).join('; '));
    }
    ownerText = L.join('\n');
    if (ownerText.length > 600) ownerText = ownerText.slice(0, 590) + '… (see app)';
  }
  return { messages, ownerText, skipped };
}

async function sendNotify(creds, to, text) {
  const params = new URLSearchParams({ user_id: creds.userId, api_key: creds.apiKey, sender_id: creds.senderId || 'NotifyDEMO', to, message: text });
  if (/[^\x00-\x7F]/.test(text)) params.set('type', 'unicode'); // Sinhala / Tamil
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch('https://app.notify.lk/api/v1/send', { method: 'POST', body: params, signal: ctrl.signal });
    const j = await r.json().catch(() => ({}));
    return j.status === 'success' ? { ok: true } : { ok: false, error: JSON.stringify(j.errors || j.message || j).slice(0, 200) };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
  finally { clearTimeout(t); }
}

/**
 * Run for every shop. `db` is a firebase-admin Firestore instance.
 * env: { NOTIFY_USER_ID, NOTIFY_API_KEY, NOTIFY_SENDER_ID } — platform SMS account (optional),
 *      used only for shops where you (the app seller) switched on "platform SMS" in admin.html.
 */
async function runReminders({ db, FieldValue, env = {}, dryRun = false, log = console.log, now = new Date() }) {
  const shops = await db.collection('shops').where('smsEnabled', '==', true).get();
  const summary = { shops: 0, sent: 0, failed: 0, skipped: 0 };
  for (const shopDoc of shops.docs) {
    const shop = { id: shopDoc.id, ...shopDoc.data() };
    const paidUntil = shop.paidUntil && shop.paidUntil.toMillis ? shop.paidUntil.toMillis() : 0;
    if (shop.status !== 'active' || paidUntil < now.getTime()) { log(`skip ${shop.name}: licence not active`); continue; }
    const cfgSnap = await shopDoc.ref.collection('private').doc('sms').get();
    const cfg = cfgSnap.exists ? cfgSnap.data() : {};
    if (!cfg.enabled) continue;
    const creds = (cfg.userId && cfg.apiKey) ? { userId: cfg.userId, apiKey: cfg.apiKey, senderId: cfg.senderId }
      : (shop.smsPlatform && env.NOTIFY_USER_ID) ? { userId: env.NOTIFY_USER_ID, apiKey: env.NOTIFY_API_KEY, senderId: env.NOTIFY_SENDER_ID } : null;
    if (!creds) { log(`skip ${shop.name}: no SMS account`); continue; }
    const today = todayIn(shop.timezone || 'Asia/Colombo', now);
    summary.shops++;

    const salesSnap = await shopDoc.ref.collection('sales').where('open', '==', true).get();
    const sales = salesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const custIds = [...new Set(sales.map(s => s.customerId).filter(Boolean))];
    const customers = {};
    for (let i = 0; i < custIds.length; i += 100) {
      const refs = custIds.slice(i, i + 100).map(id => shopDoc.ref.collection('customers').doc(id));
      (await db.getAll(...refs)).forEach(d => { if (d.exists) customers[d.id] = d.data(); });
    }
    const plan = planShop({ shop, cfg, sales, customers, today });
    summary.skipped += plan.skipped.length;
    let sent = 0, failed = 0;

    for (const m of plan.messages) {
      const r = dryRun ? { ok: true } : await sendNotify(creds, m.to, m.text);
      log(`${dryRun ? '[dry] ' : ''}${shop.name} → ${m.to}: ${r.ok ? 'OK' : 'FAIL ' + r.error}`);
      if (r.ok) sent++; else failed++;
      if (!dryRun) {
        const batch = db.batch();
        if (r.ok) batch.update(shopDoc.ref.collection('sales').doc(m.saleId), { reminderKeys: FieldValue.arrayUnion(m.key), lastReminder: { day: today, text: m.text } });
        batch.set(shopDoc.ref.collection('smsLog').doc(), { day: today, ts: Date.now(), to: m.to, text: m.text, ok: r.ok, error: r.error || null, saleId: m.saleId, kind: 'customer' });
        await batch.commit();
      }
    }
    const ownerTo = intlPhone(cfg.ownerPhone);
    if (plan.ownerText && validLkMobile(ownerTo) && shop.smsOwnerDay !== today) {
      const r = dryRun ? { ok: true } : await sendNotify(creds, ownerTo, plan.ownerText);
      log(`${dryRun ? '[dry] ' : ''}${shop.name} owner alert → ${ownerTo}: ${r.ok ? 'OK' : 'FAIL ' + r.error}`);
      if (r.ok) sent++; else failed++;
      if (!dryRun) {
        await shopDoc.ref.collection('smsLog').doc().set({ day: today, ts: Date.now(), to: ownerTo, text: plan.ownerText, ok: r.ok, error: r.error || null, kind: 'owner' });
        if (r.ok) await shopDoc.ref.update({ smsOwnerDay: today });
      }
    }
    if (!dryRun) await shopDoc.ref.update({ smsLastRun: FieldValue.serverTimestamp(), smsLastResult: `${sent} sent${failed ? ', ' + failed + ' failed' : ''}${plan.skipped.length ? ', ' + plan.skipped.length + ' without mobile no.' : ''}` });
    summary.sent += sent; summary.failed += failed;
  }
  log(`Done: ${summary.shops} shops, ${summary.sent} sent, ${summary.failed} failed, ${summary.skipped} skipped`);
  return summary;
}

module.exports = { planShop, runReminders, sendNotify, todayIn, daysBetween, intlPhone, fill, DEFAULTS };
