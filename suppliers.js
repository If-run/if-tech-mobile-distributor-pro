import { A } from '../app.js';
import { $, esc, toast, modal, confirmBox, cleanDigits } from '../util.js';
import * as ops from '../ops.js';
import { openWhatsApp } from '../ui.js';

function dialog(s = null) {
  const m = modal({
    title: s ? 'Edit supplier' : 'New supplier',
    body: `<div class="field"><label>Name *</label><input data-f="name" value="${esc(s?.name)}"></div>
      <div class="field-row"><div class="field"><label>Phone</label><input data-f="phone" inputmode="tel" value="${esc(s?.phone)}"></div><div class="field"><label>Email</label><input data-f="email" value="${esc(s?.email)}"></div></div>
      <div class="field"><label>Address</label><input data-f="address" value="${esc(s?.address)}"></div>
      <div class="field"><label>Notes (bank details, rep name…)</label><input data-f="notes" value="${esc(s?.notes)}"></div>`,
    foot: `${s && A.isOwner() ? '<button class="btn btn-red" data-del style="margin-right:auto">Delete</button>' : ''}<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-ok>Save</button>`
  });
  m.$('[data-ok]').onclick = async () => {
    const d = {}; m.el.querySelectorAll('[data-f]').forEach(i => d[i.dataset.f] = i.value.trim());
    if (!d.name) return toast('Name is required', 'error');
    if (await ops.saveSupplier(s?.id, d)) { toast('Saved'); m.close(); }
  };
  const del = m.$('[data-del]');
  if (del) del.onclick = async () => { if (await confirmBox('Delete ' + s.name + '?', 'Delete')) { await ops.removeDoc('suppliers', s.id); toast('Deleted'); m.close(); } };
}

export default {
  id: 'suppliers', title: 'Suppliers',
  init(el) {
    el.innerHTML = `<div class="toolbar"><div class="grow"></div><button class="btn btn-primary" id="btnAddSup">+ New supplier</button></div><div id="supBody"></div>`;
    $('#btnAddSup', el).onclick = () => dialog();
    el.addEventListener('click', e => {
      const r = e.target.closest('[data-edit]'); if (r) { const s = A.S.suppliers.find(x => x.id === r.dataset.edit); if (s) dialog(s); }
      const w = e.target.closest('[data-wa]'); if (w) { e.stopPropagation(); openWhatsApp(w.dataset.wa, ''); }
    });
  },
  render(el) {
    const list = A.S.suppliers.slice().sort((a, b) => a.name.localeCompare(b.name));
    $('#supBody', el).innerHTML = list.length ? `<div class="card">${list.map(s => {
      const n = A.S.phones.filter(p => p.supplierName === s.name).length;
      return `<div class="list-row click" data-edit="${s.id}"><div class="avatar">${esc(s.name.charAt(0).toUpperCase())}</div>
        <div class="grow"><b>${esc(s.name)}</b><div class="muted small">${esc([s.phone, s.email, s.address].filter(Boolean).join(' · '))}</div>${s.notes ? `<div class="muted small">${esc(s.notes)}</div>` : ''}</div>
        ${n ? `<span class="badge badge-teal">${n} in stock</span>` : ''}
        ${s.phone ? `<a class="btn btn-sm" href="tel:${esc(cleanDigits(s.phone))}" onclick="event.stopPropagation()">📞</a><button class="btn btn-sm btn-wa" data-wa="${esc(s.phone)}">WA</button>` : ''}</div>`;
    }).join('')}</div>` : `<div class="empty"><div class="e-icon">🚚</div>No suppliers yet</div>`;
  }
};
