/* Shared helpers: escaping, money, local dates, IMEI validation, toast, modal, sound. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* Escape every piece of user-entered text before putting it into innerHTML.
   Several staff on several devices now type into the same data, so this matters. */
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let CURRENCY = 'Rs';
export function setCurrency(c) { CURRENCY = c || 'Rs'; }
export function money(n) {
  return CURRENCY + ' ' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function money0(n) {
  return CURRENCY + ' ' + Math.round(Number(n) || 0).toLocaleString('en-US');
}
export const num = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return isFinite(n) ? n : 0; };

/* ---------- Dates ----------
   All business dates are stored as LOCAL 'YYYY-MM-DD' strings (day, dueDate, chequeDate).
   The old app used toISOString() (UTC) which put sales made before 5:30 AM in Sri Lanka on
   the previous day. Local strings also sort and range-query correctly in Firestore. */
const pad = n => String(n).padStart(2, '0');
export function dayStr(d = new Date()) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
export function addDays(day, n) { const [y, m, d] = day.split('-').map(Number); return dayStr(new Date(y, m - 1, d + n)); }
export function daysBetween(a, b) { // b - a, in whole days
  const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}
export function monthStart(day = dayStr()) { return day.slice(0, 8) + '01'; }
export function prettyDay(day) {
  if (!day) return '—';
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
export function shortDay(day) {
  if (!day) return '—';
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
export function prettyTime(ts) { return ts ? new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''; }
export function toMillis(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v.seconds != null) return v.seconds * 1000;
  const t = new Date(v).getTime(); return isNaN(t) ? 0 : t;
}
/* Friendly "due" label: Overdue 3 days / Due today / Due tomorrow / In 5 days */
export function dueLabel(day, today = dayStr()) {
  if (!day) return { text: 'No date', cls: 'badge-slate', d: 9999 };
  const d = daysBetween(today, day);
  if (d < 0) return { text: `Overdue ${-d} day${d === -1 ? '' : 's'}`, cls: 'badge-red', d };
  if (d === 0) return { text: 'Due today', cls: 'badge-red', d };
  if (d === 1) return { text: 'Due tomorrow', cls: 'badge-amber', d };
  if (d <= 7) return { text: `In ${d} days`, cls: 'badge-amber', d };
  return { text: `In ${d} days`, cls: 'badge-slate', d };
}

/* ---------- IMEI ----------
   An IMEI is 15 digits and the last digit is a Luhn check digit. Checking it rejects
   almost every camera misread or typing mistake — this is what makes scanning reliable. */
export function luhnOk(s) {
  if (!/^\d{15}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = s.charCodeAt(i) - 48;
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}
/* Pull every valid IMEI out of a scanned barcode text (QR codes on boxes often hold
   "IMEI1:xxxx IMEI2:yyyy", Code-128 labels hold just the 15 digits). */
export function extractImeis(text) {
  const out = [];
  const s = String(text || '');
  const re = /(?<!\d)(\d{15})(?!\d)/g; let m;
  while ((m = re.exec(s))) if (luhnOk(m[1]) && !out.includes(m[1])) out.push(m[1]);
  // IMEISV (16 digits) is not an IMEI — ignored on purpose.
  return out;
}
export function cleanDigits(s) { return String(s || '').replace(/\D/g, ''); }

/* Sri Lankan phone numbers → 94XXXXXXXXX (format needed by SMS gateways and WhatsApp). */
export function intlPhone(p) {
  let d = cleanDigits(p);
  if (d.length === 10 && d.startsWith('0')) d = '94' + d.slice(1);
  else if (d.length === 9) d = '94' + d;
  return d;
}

/* ---------- IDs / invoice numbers ---------- */
export function uid(prefix = '') {
  const a = crypto.getRandomValues(new Uint8Array(10));
  return prefix + [...a].map(b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
}
function lsGet(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
export { lsGet, lsSet };
/* Each device gets a 2-character code (changeable in Settings). Invoice = code + date + daily
   counter, e.g. "K7-260923-004". Works offline on many devices with no clashes and no server. */
export function deviceCode() {
  let c = lsGet('mdp_device_code');
  if (!c) { // letter + digit, e.g. "K7" — easy to read on a bill
    const r = crypto.getRandomValues(new Uint8Array(2));
    c = 'ABCDEFGHJKMNPQRSTUVWXYZ'[r[0] % 23] + '23456789'[r[1] % 8]; lsSet('mdp_device_code', c);
  }
  return c;
}
export function nextInvoiceNo() {
  const today = dayStr();
  const key = 'mdp_seq_' + today;
  const n = (parseInt(lsGet(key, '0'), 10) || 0) + 1;
  lsSet(key, String(n));
  return `${deviceCode()}-${today.slice(2).replace(/-/g, '')}-${String(n).padStart(3, '0')}`;
}

/* ---------- Toast ---------- */
export function toast(msg, type = '') {
  let wrap = $('#toastWrap');
  if (!wrap) { wrap = document.createElement('div'); wrap.id = 'toastWrap'; wrap.className = 'toast-wrap'; document.body.appendChild(wrap); }
  const el = document.createElement('div'); el.className = 'toast ' + type; el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), type === 'error' ? 5000 : 2600);
}

/* ---------- Modal ----------
   modal({title, body, foot, wide, onMount}) → {el, close}. Buttons with data-close close it. */
export function modal({ title = '', body = '', foot = '', wide = false, full = false, onMount, onClose } = {}) {
  const ov = document.createElement('div');
  ov.className = 'overlay active';
  ov.innerHTML = `<div class="modal ${wide ? 'wide' : ''} ${full ? 'full' : ''}" role="dialog" aria-modal="true">
    ${title ? `<div class="modal-head"><h3>${title}</h3><button class="icon-btn" data-close aria-label="Close">✕</button></div>` : ''}
    <div class="modal-body">${body}</div>
    ${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div>`;
  document.body.appendChild(ov);
  let closed = false;
  const close = () => { if (closed) return; closed = true; ov.remove(); onClose && onClose(); };
  ov.addEventListener('click', e => {
    if (e.target === ov || e.target.closest('[data-close]')) close();
  });
  const api = { el: ov, close, $: s => ov.querySelector(s) };
  onMount && onMount(api);
  const first = ov.querySelector('input:not([type=hidden]):not([readonly]),select,textarea');
  if (first && window.matchMedia('(pointer:fine)').matches) setTimeout(() => first.focus(), 50);
  return api;
}
export function confirmBox(msg, okText = 'Confirm', danger = true) {
  return new Promise(res => {
    let answered = false;
    const m = modal({
      body: `<p style="font-size:15px;font-weight:600;text-align:center;padding:10px 4px;">${esc(msg)}</p>`,
      foot: `<button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'btn-red-fill' : 'btn-primary'}" data-ok>${esc(okText)}</button>`,
      onClose: () => { if (!answered) res(false); }
    });
    m.$('[data-ok]').onclick = () => { answered = true; m.close(); res(true); };
  });
}

/* ---------- Sound + vibration for scanner feedback ---------- */
let audioCtx = null;
export function beep(ok = true) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = ok ? 1760 : 220; o.type = ok ? 'sine' : 'square';
    g.gain.value = 0.12; o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + (ok ? 0.09 : 0.25));
  } catch { /* no audio */ }
  try { navigator.vibrate && navigator.vibrate(ok ? 60 : [80, 60, 80]); } catch { }
}

/* ---------- Download helper ---------- */
export function downloadFile(filename, content, mime) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.style.display = 'none';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export function toCsv(rows) {
  return rows.map(r => r.map(cell => { const v = String(cell ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',')).join('\n');
}

/* Shrink a photo to a small JPEG data URL so it fits comfortably inside a Firestore document
   (hard limit 1 MB). The old app stored full camera photos, which would break on Firestore. */
export function imageToThumb(fileOrDataUrl, max = 240, quality = 0.72) {
  return new Promise(resolve => {
    if (!fileOrDataUrl) return resolve(null);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(null);
    if (typeof fileOrDataUrl === 'string') img.src = fileOrDataUrl;
    else { const r = new FileReader(); r.onload = () => { img.src = r.result; }; r.readAsDataURL(fileOrDataUrl); }
  });
}

export function debounce(fn, ms = 200) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
