/* =========================================================================
   ADMIN — for you, the app seller. Lists every shop, extends / suspends licences,
   creates new shops for customers, and switches on platform SMS.
   Access: create a document  admins/{your-uid}  (any content) in the Firebase console.
   ========================================================================= */
import * as fb from '../vendor/firebase.js';
import { FIREBASE_CONFIG } from './config.js';
import { $, esc, toast, modal, confirmBox, toMillis } from './util.js';

if (!FIREBASE_CONFIG.apiKey) { document.body.innerHTML = '<p style="padding:30px;font-family:sans-serif">Fill in js/config.js first (see SETUP-GUIDE).</p>'; throw new Error('Firebase not configured'); }
const app = fb.initializeApp(FIREBASE_CONFIG);
const auth = fb.getAuth(app);
const db = fb.initializeFirestore(app, {});
let shops = [], q = '';

function login(msg = '') {
  const a = $('#authScreen'); a.style.display = 'flex'; $('#adminApp').style.display = 'none';
  a.innerHTML = `<div class="login-card auth-card"><div class="login-logo">A</div><h2>Admin</h2><p class="auth-sub">Shops &amp; licences</p>
    <form><input name="email" type="email" placeholder="Admin email" required><input name="password" type="password" placeholder="Password" required>
    <button class="btn btn-primary btn-block btn-lg">Sign in</button></form><p class="auth-msg">${esc(msg)}</p></div>`;
  a.querySelector('form').onsubmit = async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    try { await fb.signInWithEmailAndPassword(auth, f.email, f.password); } catch (err) { a.querySelector('.auth-msg').textContent = err.code || err.message; }
  };
}

async function load() {
  const s = await fb.getDocs(fb.collection(db, 'shops'));
  shops = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
  render();
}
const daysLeft = s => Math.ceil((toMillis(s.paidUntil) - Date.now()) / 86400000);

function render() {
  const el = $('#adminApp');
  const list = shops.filter(s => !q || [s.name, s.ownerName, s.ownerEmail, s.phone].join(' ').toLowerCase().includes(q));
  const active = shops.filter(s => s.status === 'active' && daysLeft(s) > 0).length;
  el.innerHTML = `
    <div class="top"><div><h2>Shops &amp; licences</h2><p class="muted small">${shops.length} shops · ${active} active · signed in as ${esc(auth.currentUser.email)}</p></div>
      <div class="toolbar" style="margin:0"><input id="q" placeholder="Search shop, owner, phone" value="${esc(q)}" style="width:240px"><button class="btn btn-primary" data-new>+ New shop</button><button class="btn" data-out>Sign out</button></div></div>
    <div class="card table-wrap"><table><thead><tr><th>Shop</th><th>Owner</th><th>Plan</th><th>Valid until</th><th>SMS</th><th>Actions</th></tr></thead><tbody>
    ${list.map(s => { const d = daysLeft(s); return `<tr>
      <td><b>${esc(s.name)}</b><div class="muted small">since ${esc(new Date(toMillis(s.createdAt) || Date.now()).toLocaleDateString('en-GB'))}</div></td>
      <td>${esc(s.ownerName || '')}<div class="muted small">${esc(s.ownerEmail || '')} · ${esc(s.phone || '')}</div></td>
      <td><span class="badge ${s.status !== 'active' ? 'badge-red' : s.plan === 'trial' ? 'badge-amber' : 'badge-green'}">${esc(s.status !== 'active' ? 'suspended' : s.plan || 'trial')}</span></td>
      <td>${esc(new Date(toMillis(s.paidUntil)).toLocaleDateString('en-GB'))}<div class="small ${d <= 0 ? 'txt-red' : d <= 7 ? 'txt-amber' : 'muted'}">${d <= 0 ? 'expired' : d + ' days left'}</div></td>
      <td>${s.smsEnabled ? '<span class="badge badge-green">on</span>' : '<span class="muted small">off</span>'}${s.smsPlatform ? '<div class="badge badge-teal" style="margin-top:3px">platform</div>' : ''}</td>
      <td style="white-space:nowrap"><button class="btn btn-sm" data-ext="1" data-id="${s.id}">+1 month</button><button class="btn btn-sm" data-ext="12" data-id="${s.id}">+1 year</button>
        <button class="btn btn-sm" data-plat data-id="${s.id}">${s.smsPlatform ? 'Platform SMS off' : 'Platform SMS on'}</button>
        <button class="btn btn-sm ${s.status === 'active' ? 'btn-red' : 'btn-primary'}" data-sus data-id="${s.id}">${s.status === 'active' ? 'Suspend' : 'Activate'}</button></td></tr>`; }).join('') || '<tr><td colspan="6" class="muted">No shops</td></tr>'}
    </tbody></table></div>
    <p class="hint" style="margin-top:12px">+1 month / +1 year counts from today or from the current end date, whichever is later, and marks the shop as paid. “Platform SMS” lets a shop send reminders through YOUR Notify.lk account (set NOTIFY_* for the reminder service).</p>`;
  $('#q').oninput = e => { q = e.target.value.toLowerCase(); render(); $('#q').focus(); $('#q').setSelectionRange(q.length, q.length); };
  el.querySelector('[data-out]').onclick = () => fb.signOut(auth);
  el.querySelector('[data-new]').onclick = newShop;
  el.onclick = async e => {
    const b = e.target.closest('[data-id]'); if (!b) return;
    const s = shops.find(x => x.id === b.dataset.id); const ref = fb.doc(db, 'shops', s.id);
    try {
      if (b.dataset.ext) {
        const months = Number(b.dataset.ext);
        const from = new Date(Math.max(Date.now(), toMillis(s.paidUntil))); from.setMonth(from.getMonth() + months);
        if (!await confirmBox(`Extend ${s.name} to ${from.toLocaleDateString('en-GB')}?`, 'Extend', false)) return;
        await fb.updateDoc(ref, { paidUntil: fb.Timestamp.fromDate(from), plan: 'paid', status: 'active' });
      }
      if (b.hasAttribute('data-sus')) {
        if (!await confirmBox(`${s.status === 'active' ? 'Suspend' : 'Activate'} ${s.name}?`, 'Yes', s.status === 'active')) return;
        await fb.updateDoc(ref, { status: s.status === 'active' ? 'suspended' : 'active' });
      }
      if (b.hasAttribute('data-plat')) await fb.updateDoc(ref, { smsPlatform: !s.smsPlatform });
      toast('Saved'); load();
    } catch (err) { toast('Failed: ' + (err.code || err.message), 'error'); }
  };
}

function newShop() {
  const m = modal({
    title: 'Create a shop for a customer',
    body: `<div class="field"><label>Shop name</label><input data-f="shopName"></div>
      <div class="field-row"><div class="field"><label>Owner name</label><input data-f="name"></div><div class="field"><label>Owner mobile</label><input data-f="phone"></div></div>
      <div class="field-row"><div class="field"><label>Owner email (login)</label><input data-f="email" type="email"></div><div class="field"><label>Temporary password</label><input data-f="password"></div></div>
      <div class="field"><label>Paid months</label><select data-f="months"><option value="0.5">Trial (14 days)</option><option value="1">1 month</option><option value="6">6 months</option><option value="12" selected>12 months</option></select></div>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-ok>Create</button>`
  });
  m.$('[data-ok]').onclick = async () => {
    const f = {}; m.el.querySelectorAll('[data-f]').forEach(i => f[i.dataset.f] = i.value.trim());
    if (!f.shopName || !f.email || f.password.length < 8) return toast('Shop name, email and an 8+ character password are needed', 'error');
    const second = fb.initializeApp(FIREBASE_CONFIG, 'new-' + Date.now());
    try {
      const cred = await fb.createUserWithEmailAndPassword(fb.getAuth(second), f.email, f.password);
      const uid = cred.user.uid; const months = Number(f.months);
      const until = new Date(); if (months < 1) until.setDate(until.getDate() + 14); else until.setMonth(until.getMonth() + months);
      const b = fb.writeBatch(db);
      b.set(fb.doc(db, 'shops', uid), { name: f.shopName, ownerUid: uid, ownerName: f.name, ownerEmail: f.email, phone: f.phone, status: 'active', plan: months < 1 ? 'trial' : 'paid',
        paidUntil: fb.Timestamp.fromDate(until), createdAt: fb.serverTimestamp(), smsEnabled: false, smsPlatform: false, settings: { currency: 'Rs', phone: f.phone, daysBefore: 2 } });
      b.set(fb.doc(db, 'users', uid), { shopId: uid, role: 'owner', name: f.name, email: f.email, active: true, createdAt: fb.serverTimestamp() });
      await b.commit();
      await fb.signOut(fb.getAuth(second));
      toast('Shop created — send the owner their email and password'); m.close(); load();
    } catch (err) { toast('Failed: ' + (err.code || err.message), 'error'); }
    finally { await fb.deleteApp(second); }
  };
}

fb.onAuthStateChanged(auth, async user => {
  if (!user) return login();
  const a = await fb.getDoc(fb.doc(db, 'admins', user.uid)).catch(() => null);
  if (!a || !a.exists()) { await fb.signOut(auth); return login(`Not an admin. Add a document admins/${user.uid} in the Firebase console first.`); }
  $('#authScreen').style.display = 'none'; $('#adminApp').style.display = 'block';
  load().catch(err => toast('Load failed: ' + err.message, 'error'));
});
