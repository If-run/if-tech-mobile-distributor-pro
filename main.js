/* =========================================================================
   BOOT — login / sign-up / demo, then device lock, then the app.
   ========================================================================= */
import * as fb from '../vendor/firebase.js';
import { FIREBASE_CONFIG, APP_NAME, ALLOW_SIGNUP, TRIAL_DAYS } from './config.js';
import { startApp, stopApp, A, setSyncState } from './app.js';
import { createFirestoreBackend, createDemoBackend } from './data.js';
import { showLockScreen, hasPin, installAutoLock, clearLock } from './security.js';
import { demoSeed } from './demo-seed.js';
import { $, esc, toast, lsGet } from './util.js';

const configured = !!(FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId);
let fapp, auth, db, signingUp = false, started = false, ctx = null;

/* ---------------- Screens ---------------- */
function showLoading(msg) { const a = $('#authScreen'); a.style.display = 'flex'; a.innerHTML = `<div class="login-card"><div class="login-logo">M</div><p style="color:#CBD5E1">${esc(msg)}</p><div class="spinner"></div></div>`; }
function hideAuth() { const a = $('#authScreen'); a.style.display = 'none'; a.innerHTML = ''; }

function showAuth(mode = 'login', msg = '') {
  const a = $('#authScreen'); a.style.display = 'flex';
  const demoBtn = `<button class="btn btn-block btn-ghost-light" data-demo>Try the demo (sample data)</button>`;
  if (!configured) {
    a.innerHTML = `<div class="login-card"><div class="login-logo">M</div><h2>${esc(APP_NAME)}</h2>
      <p class="auth-sub">Cloud is not connected yet. Paste your Firebase settings into <b>js/config.js</b> (see SETUP-GUIDE). Until then you can try the demo.</p>
      <button class="btn btn-primary btn-block btn-lg" data-demo>Try the demo</button></div>`;
    a.querySelector('[data-demo]').onclick = startDemo; return;
  }
  const forms = {
    login: `<h2>Sign in</h2><p class="auth-sub">${esc(APP_NAME)}</p>
      <form data-form="login"><input name="email" type="email" placeholder="Email" autocomplete="username" required>
      <input name="password" type="password" placeholder="Password" autocomplete="current-password" required>
      <button class="btn btn-primary btn-block btn-lg" type="submit">Sign in</button></form>
      <div class="auth-links"><button class="linkbtn" data-mode="reset">Forgot password?</button>${ALLOW_SIGNUP ? '<button class="linkbtn" data-mode="signup">Register a new shop</button>' : ''}</div>`,
    signup: `<h2>Register your shop</h2><p class="auth-sub">${TRIAL_DAYS}-day free trial. Your data is private to your shop.</p>
      <form data-form="signup"><input name="shopName" placeholder="Shop name" required><input name="name" placeholder="Your name" required>
      <input name="phone" inputmode="tel" placeholder="Mobile number" required><input name="email" type="email" placeholder="Email (your login)" autocomplete="username" required>
      <input name="password" type="password" placeholder="Password (min 8 characters)" autocomplete="new-password" minlength="8" required>
      <button class="btn btn-primary btn-block btn-lg" type="submit">Create shop</button></form>
      <div class="auth-links"><button class="linkbtn" data-mode="login">I already have a login</button></div>`,
    reset: `<h2>Reset password</h2><p class="auth-sub">We will email you a reset link.</p>
      <form data-form="reset"><input name="email" type="email" placeholder="Email" required><button class="btn btn-primary btn-block btn-lg" type="submit">Send reset link</button></form>
      <div class="auth-links"><button class="linkbtn" data-mode="login">Back to sign in</button></div>`
  };
  a.innerHTML = `<div class="login-card auth-card"><div class="login-logo">M</div>${forms[mode]}<p class="auth-msg">${esc(msg)}</p><div class="auth-demo">${demoBtn}</div></div>`;
  a.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => showAuth(b.dataset.mode));
  a.querySelector('[data-demo]').onclick = startDemo;
  const form = a.querySelector('form');
  form.onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form).entries());
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
    const msgEl = a.querySelector('.auth-msg'); msgEl.textContent = '';
    try {
      if (mode === 'login') await fb.signInWithEmailAndPassword(auth, f.email.trim(), f.password);
      if (mode === 'reset') { await fb.sendPasswordResetEmail(auth, f.email.trim()); msgEl.textContent = 'Reset link sent — check your email.'; }
      if (mode === 'signup') await signup(f);
    } catch (err) { console.warn(err); msgEl.textContent = authError(err); }
    btn.disabled = false;
  };
}
function authError(e) {
  const c = e && e.code || '';
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found')) return 'Email or password is wrong.';
  if (c.includes('too-many-requests')) return 'Too many tries. Wait a few minutes, or reset your password.';
  if (c.includes('email-already-in-use')) return 'That email already has an account — sign in instead.';
  if (c.includes('weak-password')) return 'Password is too weak — use at least 8 characters.';
  if (c.includes('network')) return 'No internet connection.';
  return e.message || String(e);
}

/* ---------------- Demo ---------------- */
function startDemo() {
  try { sessionStorage.setItem('mdp_demo', '1'); } catch { }
  hideAuth();
  const data = createDemoBackend({ seed: demoSeed, onSyncState: setSyncState });
  A.onSignOut = A.onLock = () => { try { sessionStorage.removeItem('mdp_demo'); } catch { } data.reset(); location.hash = ''; location.reload(); };
  A.staffApi = null;
  startApp({ data, user: { uid: 'demo', name: 'Demo Owner', email: 'demo', role: 'owner', demo: true }, shop: null });
  started = true;
}

/* ---------------- Cloud ---------------- */
async function signup(f) {
  signingUp = true;
  try {
    const cred = await fb.createUserWithEmailAndPassword(auth, f.email.trim(), f.password);
    await createShopDocs(cred.user, f);
    signingUp = false;
    await enterCloud(cred.user);
  } catch (e) { signingUp = false; throw e; }
}
async function createShopDocs(user, f) {
  const uid = user.uid;
  try { sessionStorage.setItem('mdp_pending_shop', JSON.stringify(f)); } catch { }
  const b = fb.writeBatch(db);
  b.set(fb.doc(db, 'shops', uid), {
    name: f.shopName, ownerUid: uid, ownerName: f.name, ownerEmail: user.email, phone: f.phone || '',
    status: 'active', plan: 'trial', paidUntil: fb.Timestamp.fromMillis(Date.now() + TRIAL_DAYS * 86400000),
    createdAt: fb.serverTimestamp(), smsEnabled: false, smsPlatform: false,
    settings: { currency: 'Rs', phone: f.phone || '', daysBefore: 2 }
  });
  b.set(fb.doc(db, 'users', uid), { shopId: uid, role: 'owner', name: f.name, email: user.email, active: true, createdAt: fb.serverTimestamp() });
  await b.commit();
  try { sessionStorage.removeItem('mdp_pending_shop'); } catch { }
}

async function enterCloud(user) {
  showLoading('Opening your shop…');
  let u = null;
  try { const s = await fb.getDoc(fb.doc(db, 'users', user.uid)); u = s.exists() ? s.data() : null; }
  catch (e) { console.warn(e); showAuth('login', 'Could not reach the server. Check the internet connection and try again.'); return; }
  if (!u) {
    // Sign-up interrupted half way (e.g. lost signal)? Finish it.
    let pending = null; try { pending = JSON.parse(sessionStorage.getItem('mdp_pending_shop') || 'null'); } catch { }
    if (pending) { try { await createShopDocs(user, pending); return enterCloud(user); } catch (e) { console.warn(e); } }
    await fb.signOut(auth);
    showAuth('login', 'This login is not linked to a shop. Ask your shop owner to add you, or register a new shop.'); return;
  }
  if (u.active === false) { await fb.signOut(auth); showAuth('login', 'This login has been blocked by the shop owner.'); return; }
  let shop = null;
  try { const ss = await fb.getDoc(fb.doc(db, 'shops', u.shopId)); shop = ss.exists() ? { id: ss.id, ...ss.data() } : null; } catch (e) { console.warn(e); }
  ctx = { uid: user.uid, name: u.name || user.email, email: user.email, role: u.role, shopId: u.shopId };
  hideAuth();
  showLockScreen({
    uid: user.uid, title: (shop && shop.name) || APP_NAME, subtitle: `${ctx.name} — enter your PIN`,
    mode: hasPin(user.uid) ? 'unlock' : 'setup',
    onForgot: () => forgotPin(user.uid),
    onUnlock: () => {
      const data = createFirestoreBackend({ fb, db, shopId: u.shopId, onWriteError, onSyncState: setSyncState });
      A.staffApi = u.role === 'owner' ? staffApi(u.shopId) : null;
      A.onLock = () => lockNow();
      A.onSignOut = signOutAll;
      startApp({ data, user: ctx, shop });
      started = true;
    }
  });
}
function lockNow() {
  if (!started || !ctx || A.user.demo) return;
  document.querySelectorAll('.overlay,.scan-ov').forEach(o => o.remove());
  showLockScreen({ uid: ctx.uid, title: A.shop.name || APP_NAME, subtitle: `${ctx.name} — enter your PIN`, mode: 'unlock', onForgot: () => forgotPin(ctx.uid), onUnlock: () => { } });
}
async function forgotPin(uid) { clearLock(uid); await signOutAll(); }

/* Sign out AND wipe this device's offline copy of the shop's data (important on shared devices). */
async function signOutAll() {
  try { stopApp(); } catch { }
  started = false;
  try { await fb.signOut(auth); } catch { }
  try { await fb.terminate(db); await fb.clearIndexedDbPersistence(db); } catch (e) { console.warn('cache clear', e); }
  location.hash = ''; location.reload();
}

function onWriteError(err, label = 'Change') {
  console.error(label, err);
  if (err && err.code === 'permission-denied') toast(`${label} was NOT saved — not allowed (subscription expired, login blocked, or the phone was already sold on another device).`, 'error');
  else toast(`${label} was not saved: ${err && err.message || err}`, 'error');
}

function staffApi(shopId) {
  return {
    async list() {
      const s = await fb.getDocs(fb.query(fb.collection(db, 'users'), fb.where('shopId', '==', shopId)));
      return s.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    /* Creates the staff member's login without signing the owner out (uses a second, temporary Firebase app). */
    async create({ name, email, password }) {
      const second = fb.initializeApp(FIREBASE_CONFIG, 'staff-' + Date.now());
      try {
        const sa = fb.getAuth(second);
        const cred = await fb.createUserWithEmailAndPassword(sa, email, password);
        await fb.setDoc(fb.doc(db, 'users', cred.user.uid), { shopId, role: 'staff', name, email, active: true, createdAt: fb.serverTimestamp() });
        await fb.signOut(sa);
      } finally { await fb.deleteApp(second); }
    },
    async setActive(uid, active) { await fb.updateDoc(fb.doc(db, 'users', uid), { active }); }
  };
}

/* ---------------- Start ---------------- */
function boot() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
  installAutoLock(() => Number(lsGet('mdp_autolock', '5')), lockNow);
  let demo = false; try { demo = sessionStorage.getItem('mdp_demo') === '1'; } catch { }
  if (!configured || demo || /[?&]demo\b/.test(location.search)) {
    if (demo || /[?&]demo\b/.test(location.search)) return startDemo();
    return showAuth();
  }
  fapp = fb.initializeApp(FIREBASE_CONFIG);
  auth = fb.getAuth(fapp);
  // Offline-first: every device keeps a local copy and syncs when online.
  db = fb.initializeFirestore(fapp, { localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() }) });
  showLoading('Loading…');
  fb.onAuthStateChanged(auth, user => {
    if (signingUp) return;
    if (!user) { if (started) { stopApp(); started = false; } showAuth(); return; }
    if (!started) enterCloud(user);
  });
}
boot();
