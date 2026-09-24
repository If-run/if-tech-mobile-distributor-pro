/* =========================================================================
   DEVICE LOCK — PIN and fingerprint / face unlock
   Two layers of security:
   1. Account login (email + password, Firebase Auth) + Firestore security rules.
      This is what actually protects the data in the cloud: a shop can only ever read
      its own shop's documents, whatever someone does in the browser.
   2. Device lock (this file). After logging in once on a phone, staff unlock the app
      with a 4-digit PIN or fingerprint instead of typing the password every time.
      The PIN is stored only as a salted hash, never as plain text. 5 wrong tries →
      the device is signed out and the full password is required.
   ========================================================================= */
import { $, esc, lsGet, lsSet } from './util.js';

const KEY = u => 'mdp_lock_' + u;
function read(u) { try { return JSON.parse(lsGet(KEY(u), 'null')); } catch { return null; } }
function write(u, v) { lsSet(KEY(u), JSON.stringify(v)); }

async function sha(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));

export const hasPin = u => !!(read(u) && read(u).hash);
export async function setPin(u, pin) {
  const cur = read(u) || {};
  const salt = crypto.getRandomValues(new Uint32Array(4)).join('-');
  write(u, { ...cur, salt, hash: await sha(salt + ':' + pin) });
}
export async function checkPin(u, pin) {
  const r = read(u); if (!r) return false;
  return (await sha(r.salt + ':' + pin)) === r.hash;
}
export function clearLock(u) { try { localStorage.removeItem(KEY(u)); } catch { } }

export async function fingerprintAvailable() {
  try {
    return !!(window.PublicKeyCredential && window.isSecureContext &&
      await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch { return false; }
}
export const fingerprintEnabled = u => !!(read(u) && read(u).cred);
export function disableFingerprint(u) { const r = read(u) || {}; delete r.cred; write(u, r); }
/* Registers this phone's fingerprint / face / screen lock as an unlock key (WebAuthn). */
export async function enableFingerprint(u, label) {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Mobile Distributor Pro' },
      user: { id: new TextEncoder().encode(u).slice(0, 64), name: label || u, displayName: label || u },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000, attestation: 'none'
    }
  });
  const r = read(u) || {}; r.cred = b64u(cred.rawId); write(u, r);
  return true;
}
export async function verifyFingerprint(u) {
  const r = read(u); if (!r || !r.cred) return false;
  await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: unb64u(r.cred), transports: ['internal'] }],
      userVerification: 'required', timeout: 60000
    }
  });
  return true; // the browser only resolves after the fingerprint/face check succeeded
}

/* ---------- Lock screen UI ----------
   mode 'unlock' → enter PIN (or fingerprint)
   mode 'setup'  → first time on this device: choose PIN, confirm, then offer fingerprint */
export function showLockScreen({ uid, title, subtitle, mode, onUnlock, onForgot }) {
  const root = $('#lockScreen');
  root.style.display = 'flex';
  let buf = '', first = '', stage = mode === 'setup' ? 'setup' : 'unlock', fails = 0;
  root.innerHTML = `
    <div class="login-card">
      <div class="login-logo">M</div>
      <h2 class="lock-title" style="color:#fff;font-size:20px;"></h2>
      <p class="lock-sub" style="color:#94A3B8;font-size:13px;margin-top:6px;"></p>
      <div class="pin-dots"></div>
      <p class="lock-msg" style="color:#F87171;font-size:12.5px;min-height:18px;margin-bottom:8px;"></p>
      <div class="keypad"></div>
      <div style="display:flex;justify-content:space-between;margin-top:18px;gap:10px;">
        <button class="linkbtn" data-forgot>Forgot PIN? Use password</button>
        <button class="linkbtn fp-btn" data-fp style="display:none;">☝ Fingerprint</button>
      </div>
    </div>`;
  const t = $('.lock-title', root), s = $('.lock-sub', root), msg = $('.lock-msg', root);
  const dots = () => { $('.pin-dots', root).innerHTML = [0, 1, 2, 3].map(i => `<div class="pin-dot ${i < buf.length ? 'filled' : ''}"></div>`).join(''); };
  const setText = () => {
    if (stage === 'setup') { t.textContent = 'Create a 4-digit PIN'; s.textContent = 'You will use it to open the app on this device'; }
    else if (stage === 'confirm') { t.textContent = 'Confirm your PIN'; s.textContent = 'Enter the same PIN again'; }
    else { t.textContent = title || 'Welcome back'; s.textContent = subtitle || 'Enter your PIN'; }
  };
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
  $('.keypad', root).innerHTML = keys.map(k => k ? `<button class="key" data-k="${k}">${k}</button>` : '<div></div>').join('');
  const done = () => { root.style.display = 'none'; root.innerHTML = ''; document.removeEventListener('keydown', onKey); onUnlock(); };
  async function press(k) {
    msg.textContent = '';
    if (k === '⌫') { buf = buf.slice(0, -1); dots(); return; }
    if (buf.length >= 4) return;
    buf += k; dots();
    if (buf.length < 4) return;
    await new Promise(r => setTimeout(r, 120));
    if (stage === 'setup') { first = buf; buf = ''; stage = 'confirm'; setText(); dots(); return; }
    if (stage === 'confirm') {
      if (buf !== first) { msg.textContent = "PINs didn't match — try again"; stage = 'setup'; buf = ''; first = ''; setText(); dots(); return; }
      await setPin(uid, buf);
      if (await fingerprintAvailable() && !fingerprintEnabled(uid)) {
        t.textContent = 'Use fingerprint too?'; s.textContent = 'Unlock with fingerprint or face instead of typing the PIN';
        $('.keypad', root).innerHTML = `<button class="btn btn-primary btn-block" data-yes style="grid-column:1/-1;padding:14px;">Yes, use fingerprint</button>
          <button class="btn btn-block" data-no style="grid-column:1/-1;padding:14px;background:transparent;color:#CBD5E1;border-color:#334155;">Not now</button>`;
        $('.pin-dots', root).innerHTML = '';
        $('[data-yes]', root).onclick = async () => { try { await enableFingerprint(uid, title); } catch (e) { console.warn(e); } done(); };
        $('[data-no]', root).onclick = done;
        return;
      }
      done(); return;
    }
    if (await checkPin(uid, buf)) { done(); return; }
    fails++; buf = ''; dots();
    if (fails >= 5) { msg.textContent = 'Too many wrong tries — please sign in with your password'; setTimeout(onForgot, 1200); return; }
    msg.textContent = `Wrong PIN (${5 - fails} tries left)`;
    const card = $('.login-card', root); card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
  }
  root.onclick = e => {
    const k = e.target.closest('[data-k]'); if (k) press(k.dataset.k);
    if (e.target.closest('[data-forgot]')) onForgot();
    if (e.target.closest('[data-fp]')) tryFp();
  };
  function onKey(e) { if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('⌫'); }
  document.addEventListener('keydown', onKey);
  async function tryFp() {
    try { if (await verifyFingerprint(uid)) done(); }
    catch (e) { msg.textContent = 'Fingerprint not recognised — use your PIN'; }
  }
  setText(); dots();
  if (stage === 'unlock' && fingerprintEnabled(uid)) {
    $('[data-fp]', root).style.display = '';
    setTimeout(tryFp, 350); // offer fingerprint straight away
  }
  if (stage === 'setup') $('[data-forgot]', root).style.display = 'none';
}

/* Lock again when the app has been in the background for a while. */
export function installAutoLock(getMinutes, lockFn) {
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > getMinutes() * 60000) lockFn();
  });
}
