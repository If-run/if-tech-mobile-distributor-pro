import { A } from '../app.js';
import { $, $$, esc, toast, modal, confirmBox, toMillis, lsGet, lsSet, deviceCode, intlPhone, cleanDigits, prettyDay } from '../util.js';
import * as ops from '../ops.js';
import * as sec from '../security.js';
import { exportAll, importFile } from '../importer.js';
import { SUPPORT_PHONE } from '../config.js';

export const DEFAULT_TEMPLATES = {
  tplCredit: 'Dear {customer}, reminder from {shop}: {amount} for bill {invoice} is due on {due_date}. Thank you. {shop_phone}',
  tplOverdue: 'Dear {customer}, {amount} for bill {invoice} from {shop} was due on {due_date} ({days} days ago). Please settle it soon. {shop_phone}',
  tplCheque: 'Dear {customer}, your cheque {cheque_no} ({bank}) for {amount} to {shop} will be deposited on {cheque_date}. Please keep funds available. {shop_phone}'
};

let sms = null, staff = null, smsLog = null, stale = true;

function section(title, body, sub = '') {
  return `<div class="card pad settings-card"><h4>${title}</h4>${sub ? `<p class="muted small" style="margin:4px 0 12px;">${sub}</p>` : '<div style="height:10px"></div>'}${body}</div>`;
}

async function loadOwnerData() {
  try { sms = await A.data.getPrivate(); } catch { sms = {}; }
  try { staff = A.staffApi ? await A.staffApi.list() : []; } catch { staff = []; }
  try { smsLog = await A.data.smsLog(20); } catch { smsLog = []; }
  stale = true; A.refresh();
}

function staffDialog() {
  const m = modal({
    title: 'Add staff member',
    body: `<p class="muted small" style="margin-bottom:12px;">Staff can sell, add customers and receive payments. They cannot see cost price and profit, delete records or change settings.</p>
      <div class="field"><label>Name</label><input data-f="name"></div>
      <div class="field"><label>Email (their login)</label><input data-f="email" type="email" autocomplete="off"></div>
      <div class="field"><label>Password (min 6 characters)</label><input data-f="password" type="text" autocomplete="new-password"></div>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-ok>Create login</button>`
  });
  m.$('[data-ok]').onclick = async () => {
    const d = {}; m.el.querySelectorAll('[data-f]').forEach(i => d[i.dataset.f] = i.value.trim());
    if (!d.name || !d.email || d.password.length < 6) return toast('Fill name, email and a 6+ character password', 'error');
    const b = m.$('[data-ok]'); b.disabled = true; b.textContent = 'Creating…';
    try { await A.staffApi.create(d); toast('Staff login created — give them the email and password'); m.close(); loadOwnerData(); }
    catch (e) { toast(e.code === 'auth/email-already-in-use' ? 'That email already has an account' : 'Could not create: ' + (e.message || e), 'error'); b.disabled = false; b.textContent = 'Create login'; }
  };
}

export default {
  id: 'settings', title: 'Settings',
  init(el) {
    el.addEventListener('click', async e => {
      const a = e.target.closest('[data-act]'); if (!a) return;
      const act = a.dataset.act;
      const val = s => ($(s, el) || {}).value?.trim() ?? '';
      if (act === 'save-shop') {
        const st = { ...A.settings(), phone: val('#stPhone'), address: val('#stAddr'), footer: val('#stFooter'), currency: val('#stCur') || 'Rs', staffCanAddStock: $('#stStaffStock', el).checked };
        if (await ops.saveShopSettings({ name: val('#stName') || 'My Shop', settings: st })) toast('Shop details saved');
      }
      if (act === 'save-sms') {
        const data = {
          enabled: $('#smsOn', el).checked, userId: val('#smsUser'), apiKey: val('#smsKey'), senderId: val('#smsSender') || 'NotifyDEMO',
          ownerPhone: val('#smsOwner'), daysBefore: Number(val('#smsDays')) || 2, overdueEvery: Number(val('#smsOver')), ownerSummary: $('#smsSummary', el).checked,
          tplCredit: val('#tplCredit') || DEFAULT_TEMPLATES.tplCredit, tplOverdue: val('#tplOverdue') || DEFAULT_TEMPLATES.tplOverdue, tplCheque: val('#tplCheque') || DEFAULT_TEMPLATES.tplCheque
        };
        if (data.enabled && !A.shop.smsPlatform && (!data.userId || !data.apiKey)) return toast('Enter your Notify.lk User ID and API key', 'error');
        if (data.enabled && cleanDigits(data.ownerPhone).length < 9 && data.ownerSummary) return toast('Enter the owner mobile number for the daily alert', 'error');
        try {
          await A.data.setPrivate(data);
          await ops.saveShopSettings({ smsEnabled: data.enabled, settings: { ...A.settings(), daysBefore: data.daysBefore } });
          sms = data; toast('SMS reminder settings saved');
        } catch (err) { toast('Could not save: ' + (err.message || err), 'error'); }
      }
      if (act === 'test-sms') {
        const to = intlPhone(val('#smsOwner')); if (to.length < 11) return toast('Enter the owner mobile number first', 'error');
        const u = new URL('https://app.notify.lk/api/v1/send');
        u.search = new URLSearchParams({ user_id: val('#smsUser'), api_key: val('#smsKey'), sender_id: val('#smsSender') || 'NotifyDEMO', to, message: `Test from ${A.shop.name || 'Mobile Distributor Pro'}: SMS reminders are working.` });
        window.open(u.toString(), '_blank'); toast('Opened Notify.lk — it shows "success" if the SMS was sent');
      }
      if (act === 'tpl-reset') { ['tplCredit', 'tplOverdue', 'tplCheque'].forEach(k => { $('#' + k, el).value = DEFAULT_TEMPLATES[k]; }); }
      if (act === 'add-staff') staffDialog();
      if (act === 'staff-toggle') {
        const u = staff.find(x => x.id === a.dataset.uid); if (!u) return;
        if (await confirmBox(`${u.active === false ? 'Re-activate' : 'Block'} ${u.name}?`, 'Yes', u.active !== false)) { await A.staffApi.setActive(u.id, u.active === false); toast('Updated'); loadOwnerData(); }
      }
      if (act === 'pin') {
        const m = modal({ title: 'Change PIN', body: `<div class="field"><label>Current PIN</label><input data-c inputmode="numeric" maxlength="4" type="password"></div><div class="field"><label>New 4-digit PIN</label><input data-n inputmode="numeric" maxlength="4" type="password"></div>`, foot: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-ok>Save</button>` });
        m.$('[data-ok]').onclick = async () => {
          if (!await sec.checkPin(A.user.uid, m.$('[data-c]').value)) return toast('Current PIN is wrong', 'error');
          const n = m.$('[data-n]').value; if (!/^\d{4}$/.test(n)) return toast('PIN must be 4 digits', 'error');
          await sec.setPin(A.user.uid, n); toast('PIN changed'); m.close();
        };
      }
      if (act === 'fp') {
        if (sec.fingerprintEnabled(A.user.uid)) { sec.disableFingerprint(A.user.uid); toast('Fingerprint unlock turned off'); }
        else { try { await sec.enableFingerprint(A.user.uid, A.user.email); toast('Fingerprint unlock turned on'); } catch (err) { toast('Could not set up fingerprint: ' + (err.message || err), 'error'); } }
        stale = true; this.render(el);
      }
      if (act === 'device') { const v = val('#devCode').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3); if (v.length < 2) return toast('Use 2–3 letters/numbers', 'error'); lsSet('mdp_device_code', v); toast('Device code saved — new bills start with ' + v); }
      if (act === 'export') { try { const n = await exportAll(); toast(`Backup downloaded (${n} records)`); } catch (err) { toast('Export failed: ' + (err.message || err), 'error'); } }
      if (act === 'import') $('#importFile', el).click();
      if (act === 'signout') A.onSignOut && A.onSignOut();
    });
    el.addEventListener('change', async e => {
      if (e.target.id === 'stTheme') { lsSet('mdp_theme', e.target.value); document.body.setAttribute('data-theme', e.target.value); }
      if (e.target.id === 'stLock') lsSet('mdp_autolock', e.target.value);
      if (e.target.id === 'importFile') {
        const f = e.target.files[0]; e.target.value = ''; if (!f) return;
        if (!await confirmBox('Import this backup into this shop? Records with the same ID are replaced. Do this once, before you start selling in the new app.', 'Import', false)) return;
        const m = modal({ title: 'Importing…', body: '<p data-s>Reading file…</p>' });
        try {
          const r = await importFile(await f.text(), s => { m.$('[data-s]').textContent = s; });
          if (r.shopName && A.isOwner()) await ops.saveShopSettings({ name: r.shopName, settings: { ...A.settings(), currency: r.currency || A.settings().currency || 'Rs' } });
          m.$('[data-s]').textContent = `Done — ${r.count} records imported.`; toast('Import complete');
        } catch (err) { console.error(err); m.$('[data-s]').textContent = 'Import failed: ' + (err.message || err); }
      }
    });
  },
  enter() { sms = null; staff = null; smsLog = null; stale = true; if (A.isOwner()) loadOwnerData(); },
  render(el) {
    const own = A.isOwner(), st = A.settings(), u = A.user;
    // Only redraw when entering the page or after loading — live syncs must not wipe a form being edited.
    if (!stale) return; stale = false;
    const end = toMillis(A.shop.paidUntil);
    const s = sms || {};
    const html = [];

    if (own) html.push(section('Shop details', `
      <div class="field-row"><div class="field"><label>Shop name</label><input id="stName" value="${esc(A.shop.name || '')}"></div><div class="field"><label>Shop phone</label><input id="stPhone" value="${esc(st.phone || '')}"></div></div>
      <div class="field"><label>Address</label><input id="stAddr" value="${esc(st.address || '')}"></div>
      <div class="field-row"><div class="field"><label>Invoice footer</label><input id="stFooter" value="${esc(st.footer || '')}" placeholder="Thank you! No refunds after 7 days."></div><div class="field"><label>Currency</label><input id="stCur" value="${esc(st.currency || 'Rs')}"></div></div>
      <label class="check"><input type="checkbox" id="stStaffStock" ${st.staffCanAddStock ? 'checked' : ''}> Staff can add stock (they will see cost price in the add-stock form)</label>
      <button class="btn btn-primary" data-act="save-shop" style="margin-top:12px;">Save shop details</button>`));

    if (own) html.push(section('📩 Automatic SMS reminders', sms === null ? '<p class="muted">Loading…</p>' : `
      <label class="check big"><input type="checkbox" id="smsOn" ${s.enabled ? 'checked' : ''}> Send automatic reminders every morning at 9:00</label>
      <ul class="muted small bullets">
        <li>Credit customers: SMS <b>${s.daysBefore || 2} days before</b> the due date, each day until it, and on the due date.</li>
        <li>Cheque customers: SMS before the cheque date to keep funds available.</li>
        <li>You (the owner): one daily alert listing who is due and which cheques to deposit.</li>
      </ul>
      ${A.shop.smsPlatform ? '<p class="banner info" style="margin:10px 0;">SMS service is provided by your app supplier — you don\'t need your own Notify.lk account.</p>' : `
      <div class="field-row3">
        <div class="field"><label>Notify.lk User ID</label><input id="smsUser" value="${esc(s.userId || '')}"></div>
        <div class="field"><label>Notify.lk API key</label><input id="smsKey" type="password" value="${esc(s.apiKey || '')}" autocomplete="off"></div>
        <div class="field"><label>Sender ID</label><input id="smsSender" value="${esc(s.senderId || 'NotifyDEMO')}"></div>
      </div>
      <p class="hint">Create an account at notify.lk → Settings → API keys. “NotifyDEMO” works for testing; ask Notify.lk to approve your own sender name (e.g. your shop name).</p>`}
      <div class="field-row3">
        <div class="field"><label>Owner mobile (daily alert)</label><input id="smsOwner" value="${esc(s.ownerPhone || st.phone || '')}" placeholder="07X XXX XXXX"></div>
        <div class="field"><label>Start reminding</label><select id="smsDays">${[1, 2, 3, 5, 7].map(n => `<option value="${n}" ${(s.daysBefore || 2) === n ? 'selected' : ''}>${n} day${n > 1 ? 's' : ''} before</option>`).join('')}</select></div>
        <div class="field"><label>After due date</label><select id="smsOver">${[[0, 'Stop'], [1, 'Remind daily'], [3, 'Every 3 days'], [7, 'Weekly']].map(([v, l]) => `<option value="${v}" ${(s.overdueEvery ?? 3) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      </div>
      <label class="check"><input type="checkbox" id="smsSummary" ${s.ownerSummary !== false ? 'checked' : ''}> Send me (owner) the daily alert</label>
      <details style="margin-top:12px;"><summary class="linkbtn">Edit message wording</summary>
        <p class="hint">Words in {curly brackets} are filled in automatically: {customer} {shop} {amount} {invoice} {due_date} {days} {cheque_no} {bank} {cheque_date} {shop_phone}. Sinhala / Tamil text is fine.</p>
        <div class="field"><label>Credit reminder</label><textarea id="tplCredit" rows="3">${esc(s.tplCredit || DEFAULT_TEMPLATES.tplCredit)}</textarea></div>
        <div class="field"><label>Overdue reminder</label><textarea id="tplOverdue" rows="3">${esc(s.tplOverdue || DEFAULT_TEMPLATES.tplOverdue)}</textarea></div>
        <div class="field"><label>Cheque reminder</label><textarea id="tplCheque" rows="3">${esc(s.tplCheque || DEFAULT_TEMPLATES.tplCheque)}</textarea></div>
        <button class="btn btn-sm" data-act="tpl-reset">Reset wording</button>
      </details>
      <div class="toolbar" style="margin-top:14px;"><button class="btn btn-primary" data-act="save-sms">Save SMS settings</button>${A.shop.smsPlatform ? '' : '<button class="btn" data-act="test-sms">Send test SMS to owner</button>'}</div>
      ${A.shop.smsLastRun ? `<p class="hint">Last automatic run: ${esc(new Date(toMillis(A.shop.smsLastRun)).toLocaleString('en-GB'))}${A.shop.smsLastResult ? ' — ' + esc(A.shop.smsLastResult) : ''}</p>` : ''}
      ${smsLog && smsLog.length ? `<details style="margin-top:8px;"><summary class="linkbtn">Recent SMS (${smsLog.length})</summary>${smsLog.map(l => `<div class="list-row"><div class="grow small"><b>${esc(l.to)}</b> ${l.ok ? '<span class="badge badge-green">sent</span>' : `<span class="badge badge-red">failed</span> ${esc(l.error || '')}`}<div class="muted">${esc(l.text)}</div></div><span class="muted small">${esc(prettyDay(l.day))}</span></div>`).join('')}</details>` : ''}
    `, 'Reminders are sent by the cloud, so they go out even when no phone has the app open.'));

    if (own && !u.demo) html.push(section('Staff logins', staff === null ? '<p class="muted">Loading…</p>' : `
      ${staff.filter(x => x.role === 'staff').map(x => `<div class="list-row"><div class="avatar">${esc((x.name || '?').charAt(0).toUpperCase())}</div><div class="grow"><b>${esc(x.name)}</b><div class="muted small">${esc(x.email || '')}</div></div>
        ${x.active === false ? '<span class="badge badge-red">Blocked</span>' : '<span class="badge badge-green">Active</span>'}<button class="btn btn-sm" data-act="staff-toggle" data-uid="${x.id}">${x.active === false ? 'Unblock' : 'Block'}</button></div>`).join('') || '<p class="muted small">No staff yet.</p>'}
      <button class="btn btn-primary" data-act="add-staff" style="margin-top:10px;">+ Add staff login</button>`, 'Each person gets their own login, so bills show who sold them. A blocked login can no longer save anything, and is signed out the next time the app opens.'));

    html.push(section('This device', `
      <div class="field-row3">
        <div class="field"><label>Device code (start of bill numbers)</label><div class="input-btn"><input id="devCode" value="${esc(deviceCode())}" maxlength="3"><button class="btn" data-act="device">Save</button></div></div>
        <div class="field"><label>Auto-lock after</label><select id="stLock">${[[1, '1 minute'], [3, '3 minutes'], [5, '5 minutes'], [15, '15 minutes'], [60, '1 hour']].map(([v, l]) => `<option value="${v}" ${Number(lsGet('mdp_autolock', '5')) === v ? 'selected' : ''}>${l} in background</option>`).join('')}</select></div>
        <div class="field"><label>Theme</label><select id="stTheme"><option value="light">Light</option><option value="dark" ${lsGet('mdp_theme') === 'dark' ? 'selected' : ''}>Dark</option></select></div>
      </div>
      ${u.demo ? '' : `<div class="toolbar"><button class="btn" data-act="pin">Change PIN</button><button class="btn" data-act="fp" id="fpBtn">${sec.fingerprintEnabled(u.uid) ? 'Turn off fingerprint unlock' : 'Use fingerprint / face unlock'}</button></div>`}`,
      'Give each phone or PC a different code (e.g. A1, A2) so bill numbers never repeat.'));

    if (!u.demo) html.push(section('Subscription', `
      <div class="kv"><span>Plan</span><b style="text-transform:capitalize">${esc(A.shop.plan || 'trial')}</b></div>
      <div class="kv"><span>Status</span><b>${A.canWrite() ? '<span class="badge badge-green">Active</span>' : '<span class="badge badge-red">Expired / suspended</span>'}</b></div>
      <div class="kv"><span>Valid until</span><b>${end ? esc(new Date(end).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })) : '—'}</b></div>
      ${SUPPORT_PHONE ? `<div class="kv"><span>To renew, call</span><b><a href="tel:${esc(cleanDigits(SUPPORT_PHONE))}">${esc(SUPPORT_PHONE)}</a></b></div>` : ''}`));

    if (own) html.push(section('Backup &amp; import', `
      <div class="toolbar"><button class="btn" data-act="export">⬇ Download full backup</button><button class="btn" data-act="import">⬆ Import backup / old app data</button></div>
      <input type="file" id="importFile" accept=".json,application/json" style="display:none">`,
      'Your data is already saved in the cloud. A downloaded backup is an extra copy you keep. Import also accepts the backup file from the old offline app.'));

    html.push(section('Account', `<div class="kv"><span>Signed in as</span><b>${esc(u.email || u.name)} · ${own ? 'Owner' : 'Staff'}</b></div>
      <button class="btn btn-red" data-act="signout" style="margin-top:10px;">${u.demo ? 'Exit demo' : 'Sign out of this device'}</button>`));

    el.innerHTML = `<div class="settings-grid">${html.join('')}</div>`;
  }
};
