/* =========================================================================
   DATA LAYER
   The UI never talks to Firestore directly — it calls this small interface, which has
   two implementations with identical behaviour:
     • Firestore backend — real cloud data, shared by every device of the shop, with
       offline cache (works with no signal; syncs when back online).
     • Demo backend — in-browser only, pre-filled with sample data (the "Try demo" button).

   Every shop's data lives under  shops/{shopId}/...  and the Firestore security rules
   only let members of that shop read or write it. That is what keeps one customer's
   data invisible to another when you sell the app to many shops.

   Query spec used everywhere:  { where: [[field, op, value], ...], orderBy: [field, 'asc'|'desc'], limit: n }
   Write ops (always applied together, all-or-nothing):
     { op: 'set' | 'merge' | 'update' | 'delete', coll, id, data }
   Special values inside data:  INC(n) → add n to a number,  UNION(x) → add to an array.
   ========================================================================= */

export const INC = n => ({ __op: 'inc', n });
export const UNION = (...v) => ({ __op: 'union', v });

export const COLLECTIONS = ['phones', 'accessories', 'customers', 'sales', 'payments', 'expenses', 'suppliers'];

/* ---------------- Firestore backend ---------------- */
export function createFirestoreBackend({ fb, db, shopId, onWriteError, onSyncState }) {
  const colRef = c => fb.collection(db, 'shops', shopId, c);
  const docRef = (c, id) => c === 'shop' ? fb.doc(db, 'shops', shopId) : fb.doc(db, 'shops', shopId, c, id);
  const pending = new Map();
  let lastState = '';
  function emitSync() {
    const anyPending = [...pending.values()].some(Boolean);
    const st = !navigator.onLine ? 'offline' : anyPending ? 'pending' : 'synced';
    if (st !== lastState) { lastState = st; onSyncState && onSyncState(st); }
  }
  window.addEventListener('online', emitSync);
  window.addEventListener('offline', emitSync);

  function build(c, spec = {}) {
    const parts = [];
    (spec.where || []).forEach(([f, op, v]) => parts.push(fb.where(f, op, v)));
    if (spec.orderBy) parts.push(fb.orderBy(spec.orderBy[0], spec.orderBy[1] || 'asc'));
    if (spec.limit) parts.push(fb.limit(spec.limit));
    return fb.query(colRef(c), ...parts);
  }
  function conv(data) {
    const out = {};
    for (const [k, v] of Object.entries(data || {})) {
      if (k === 'id') continue; // the id is the document key, never stored as a field
      if (v && typeof v === 'object' && v.__op === 'inc') out[k] = fb.increment(v.n);
      else if (v && typeof v === 'object' && v.__op === 'union') out[k] = fb.arrayUnion(...v.v);
      else if (v === undefined) continue;
      else out[k] = v;
    }
    return out;
  }
  const snapDocs = snap => snap.docs.map(d => ({ id: d.id, ...d.data() }));
  let wid = 0;

  return {
    kind: 'cloud',
    shopId,
    newId: () => fb.doc(colRef('sales')).id,
    watch(c, spec, cb, onErr) {
      const key = 'w' + (++wid); let first = true;
      const unsub = fb.onSnapshot(build(c, spec), { includeMetadataChanges: true }, snap => {
        pending.set(key, snap.metadata.hasPendingWrites); emitSync();
        if (first || snap.docChanges().length) { first = false; cb(snapDocs(snap)); }
      }, err => { console.error('watch', c, err); onErr ? onErr(err) : onWriteError && onWriteError(err); });
      return () => { pending.delete(key); unsub(); };
    },
    async query(c, spec) { return snapDocs(await fb.getDocs(build(c, spec))); },
    async get(c, id) { const s = await fb.getDoc(docRef(c, id)); return s.exists() ? { id: s.id, ...s.data() } : null; },
    /* Applies locally at once (UI updates instantly, even offline). Resolves when the server
       confirms, or after 700 ms if we're offline/slow. A late rejection (e.g. the phone was
       already sold from another device) is reported through onWriteError. */
    commit(ops, label = 'Save') {
      const b = fb.writeBatch(db);
      for (const o of ops) {
        const r = docRef(o.coll, o.id);
        if (o.op === 'delete') b.delete(r);
        else if (o.op === 'set') b.set(r, conv(o.data));
        else if (o.op === 'merge') b.set(r, conv(o.data), { merge: true });
        else b.update(r, conv(o.data));
      }
      const p = b.commit();
      p.catch(err => onWriteError && onWriteError(err, label));
      return Promise.race([p, new Promise(r => setTimeout(r, 700))]);
    },
    watchShop(cb) {
      return fb.onSnapshot(fb.doc(db, 'shops', shopId), s => cb(s.exists() ? { id: s.id, ...s.data() } : null),
        err => console.error('shop watch', err));
    },
    async getPrivate() { const s = await fb.getDoc(fb.doc(db, 'shops', shopId, 'private', 'sms')); return s.exists() ? s.data() : {}; },
    async setPrivate(data) { await fb.setDoc(fb.doc(db, 'shops', shopId, 'private', 'sms'), data, { merge: true }); },
    async smsLog(limitN = 30) {
      const q = fb.query(fb.collection(db, 'shops', shopId, 'smsLog'), fb.orderBy('ts', 'desc'), fb.limit(limitN));
      return snapDocs(await fb.getDocs(q));
    },
    async chunkedCommit(ops, onProgress) {
      for (let i = 0; i < ops.length; i += 400) {
        const b = fb.writeBatch(db);
        ops.slice(i, i + 400).forEach(o => {
          const r = docRef(o.coll, o.id);
          if (o.op === 'delete') b.delete(r); else b.set(r, conv(o.data), o.op === 'merge' ? { merge: true } : undefined);
        });
        await b.commit();
        onProgress && onProgress(Math.min(ops.length, i + 400), ops.length);
      }
    }
  };
}

/* ---------------- Demo backend (browser only) ---------------- */
function matches(doc, where = []) {
  return where.every(([f, op, v]) => {
    const x = doc[f];
    switch (op) {
      case '==': return x === v;
      case '!=': return x !== v;
      case '<': return x != null && x < v;
      case '<=': return x != null && x <= v;
      case '>': return x != null && x > v;
      case '>=': return x != null && x >= v;
      case 'in': return v.includes(x);
      case 'array-contains': return Array.isArray(x) && x.includes(v);
      case 'array-contains-any': return Array.isArray(x) && x.some(i => v.includes(i));
      default: return false;
    }
  });
}
function runSpec(list, spec = {}) {
  let out = list.filter(d => matches(d, spec.where));
  if (spec.orderBy) {
    const [f, dir] = spec.orderBy; const k = dir === 'desc' ? -1 : 1;
    out.sort((a, b) => (a[f] > b[f] ? 1 : a[f] < b[f] ? -1 : 0) * k);
  }
  if (spec.limit) out = out.slice(0, spec.limit);
  return out.map(d => JSON.parse(JSON.stringify(d)));
}

export function createDemoBackend({ seed, onSyncState }) {
  const KEY = 'mdp_demo_v2';
  let store;
  try { store = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { store = null; }
  if (!store) { store = seed(); }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { } };
  save();
  const watchers = new Set();
  const shopWatchers = new Set();
  const notify = () => {
    watchers.forEach(w => w.cb(runSpec(Object.values(store[w.c] || {}), w.spec)));
    shopWatchers.forEach(cb => cb({ ...store.shop }));
  };
  setTimeout(() => onSyncState && onSyncState('demo'), 0);
  function apply(target, data, merge) {
    const out = merge ? { ...target } : {};
    for (const [k, v] of Object.entries(data || {})) {
      if (v && typeof v === 'object' && v.__op === 'inc') out[k] = (Number(out[k]) || 0) + v.n;
      else if (v && typeof v === 'object' && v.__op === 'union') out[k] = [...new Set([...(out[k] || []), ...v.v])];
      else if (v !== undefined) out[k] = v;
    }
    return out;
  }
  return {
    kind: 'demo',
    shopId: 'demo',
    newId: () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4),
    watch(c, spec, cb) {
      const w = { c, spec, cb }; watchers.add(w);
      setTimeout(() => cb(runSpec(Object.values(store[c] || {}), spec)), 0);
      return () => watchers.delete(w);
    },
    async query(c, spec) { return runSpec(Object.values(store[c] || {}), spec); },
    async get(c, id) { const d = (store[c] || {})[id]; return d ? JSON.parse(JSON.stringify(d)) : null; },
    async commit(ops) {
      for (const o of ops) {
        if (o.coll === 'shop') { store.shop = apply(store.shop, o.data, true); continue; }
        store[o.coll] = store[o.coll] || {};
        const cur = store[o.coll][o.id];
        if (o.op === 'delete') delete store[o.coll][o.id];
        else if (o.op === 'update' && !cur) throw new Error('Document not found');
        else store[o.coll][o.id] = { id: o.id, ...apply(o.op === 'set' ? {} : cur || {}, o.data, o.op !== 'set') };
      }
      save(); notify();
    },
    watchShop(cb) { shopWatchers.add(cb); setTimeout(() => cb({ ...store.shop }), 0); return () => shopWatchers.delete(cb); },
    async getPrivate() { return { ...(store.private || {}) }; },
    async setPrivate(data) { store.private = { ...(store.private || {}), ...data }; save(); },
    async smsLog() { return []; },
    async chunkedCommit(ops, onProgress) { await this.commit(ops); onProgress && onProgress(ops.length, ops.length); },
    reset() { try { localStorage.removeItem(KEY); } catch { } }
  };
}
