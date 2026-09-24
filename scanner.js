/* =========================================================================
   IMEI SCANNER
   Accuracy measures (why this is reliable enough for stock control):
   1. Only accepts 15-digit numbers whose Luhn check digit is correct — random misreads,
      EAN product codes, serial numbers and IMEISV (16 digits) are all rejected.
   2. The same IMEI must be read in 2 separate camera frames before it is accepted.
   3. Only the area around the on-screen frame is decoded, so other labels on the box are ignored.
   4. Uses the phone's built-in barcode engine where available (Android Chrome), otherwise
      ZXing-C++ (WebAssembly, bundled locally — works offline, including on iPhone).
   5. Torch, zoom and camera-switch buttons for small or shiny box labels.
   6. Manual entry + USB/Bluetooth scanner-gun support in the same box, with the same check.
   ========================================================================= */
import { $, esc, extractImeis, luhnOk, cleanDigits, beep, lsGet, lsSet } from './util.js';

const FORMATS = ['code_128', 'code_39', 'qr_code', 'data_matrix'];
let detectorPromise = null;

function getDetector() {
  if (!detectorPromise) detectorPromise = (async () => {
    if ('BarcodeDetector' in window) {
      try {
        const sup = await window.BarcodeDetector.getSupportedFormats();
        if (sup.includes('code_128')) return { det: new window.BarcodeDetector({ formats: FORMATS.filter(f => sup.includes(f)) }), engine: 'native' };
      } catch { /* fall through to ZXing */ }
    }
    const m = await import('../vendor/barcode.js');
    const wasmUrl = new URL('../vendor/zxing_reader.wasm', import.meta.url).href;
    await m.prepareZXingModule({ overrides: { locateFile: (p, prefix) => p.endsWith('.wasm') ? wasmUrl : prefix + p }, fireImmediately: true });
    return { det: new m.BarcodeDetector({ formats: FORMATS }), engine: 'zxing' };
  })();
  detectorPromise.catch(() => { detectorPromise = null; });
  return detectorPromise;
}
export function preloadScanner() { getDetector().catch(() => { }); }

/**
 * openScanner({ title, hint, multi, onCode })
 *   onCode(imeis: string[]) → Promise<{ ok: boolean, msg: string, close?: boolean }>
 *   imeis holds 1 IMEI, or 2 when both IMEI barcodes of a dual-SIM label were read together
 *   (ordered top → bottom, so IMEI 1 comes first).
 * Resolves when the scanner closes.
 */
export function openScanner({ title = 'Scan IMEI', hint = 'Point at the IMEI barcode', multi = false, onCode, doneLabel = 'Done' }) {
  return new Promise(resolveOpen => {
    const ov = document.createElement('div');
    ov.className = 'scan-ov';
    ov.innerHTML = `
      <div class="scan-top">
        <button class="scan-ib" data-x aria-label="Close">✕</button>
        <div class="scan-title">${esc(title)}</div>
        <button class="scan-ib" data-torch aria-label="Torch" style="visibility:hidden">🔦</button>
        <button class="scan-ib" data-switch aria-label="Switch camera" style="visibility:hidden">⟳</button>
      </div>
      <div class="scan-stage">
        <video playsinline muted autoplay></video>
        <div class="scan-frame"><i></i><i></i><i></i><i></i><div class="scan-line"></div></div>
        <div class="scan-hint">${esc(hint)}</div>
        <div class="scan-msg" style="display:none"></div>
      </div>
      <div class="scan-bottom">
        <div class="scan-zoom" style="display:none"><span>Zoom</span><input type="range" data-zoom></div>
        <div class="scan-result" aria-live="polite">Starting camera…</div>
        <form class="scan-manual" autocomplete="off">
          <input inputmode="numeric" maxlength="20" placeholder="Type IMEI or use scanner gun" data-manual>
          <button class="btn btn-primary" type="submit">Add</button>
        </form>
        ${multi ? `<button class="btn btn-block scan-done" data-done>${esc(doneLabel)}</button>` : ''}
      </div>`;
    document.body.appendChild(ov);
    const video = $('video', ov), frame = $('.scan-frame', ov), stage = $('.scan-stage', ov);
    const result = $('.scan-result', ov), stageMsg = $('.scan-msg', ov);
    let stream = null, track = null, running = true, busy = false, timer = null, torchOn = false;
    const seen = new Map();          // imei → {n, t}
    const accepted = new Map();      // imei → time accepted
    let lastDupMsg = 0, manualWarned = '';
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const setResult = (html, cls = '') => { result.className = 'scan-result ' + cls; result.innerHTML = html; };

    function close() {
      if (!running) return;
      running = false; clearTimeout(timer);
      if (stream) stream.getTracks().forEach(t => t.stop());
      ov.remove(); resolveOpen();
    }
    $('[data-x]', ov).onclick = close;
    if (multi) $('[data-done]', ov).onclick = close;

    async function deliver(list) {
      busy = true;
      try {
        const r = (await onCode(list)) || { ok: true, msg: '' };
        beep(r.ok);
        setResult(esc(r.msg || list.join(' / ')), r.ok ? 'ok' : 'bad');
        frame.classList.remove('hit', 'miss'); void frame.offsetWidth; frame.classList.add(r.ok ? 'hit' : 'miss');
        if (!r.ok) setTimeout(() => list.forEach(i => accepted.delete(i)), 4000); // allow a retry later
        if (r.close || (!multi && r.ok)) { setTimeout(close, r.ok ? 350 : 0); return; }
      } catch (e) { console.error(e); beep(false); setResult(esc(e.message || 'Error'), 'bad'); }
      busy = false;
    }

    /* ---- manual / scanner gun ---- */
    $('.scan-manual', ov).onsubmit = e => {
      e.preventDefault();
      const inp = $('[data-manual]', ov); const d = cleanDigits(inp.value);
      if (d.length !== 15) { beep(false); setResult('IMEI must be exactly 15 digits (you entered ' + d.length + ')', 'bad'); return; }
      if (!luhnOk(d) && manualWarned !== d) {
        manualWarned = d; beep(false);
        setResult('Check digit is wrong — re-check the number. Press Add again to use it anyway.', 'bad'); return;
      }
      manualWarned = ''; inp.value = '';
      accepted.set(d, Date.now());
      deliver([d]);
    };
    if (window.matchMedia('(pointer:fine)').matches) setTimeout(() => $('[data-manual]', ov).focus(), 100);

    /* ---- camera ---- */
    async function startCamera(deviceId) {
      if (stream) stream.getTracks().forEach(t => t.stop());
      const video_c = deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        : { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } };
      stream = await navigator.mediaDevices.getUserMedia({ video: video_c, audio: false });
      if (!running) { stream.getTracks().forEach(t => t.stop()); return; }
      track = stream.getVideoTracks()[0];
      video.srcObject = stream; await video.play().catch(() => { });
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      const adv = {};
      if (caps.focusMode && caps.focusMode.includes('continuous')) adv.focusMode = 'continuous';
      if (caps.zoom) {
        const z = $('[data-zoom]', ov); $('.scan-zoom', ov).style.display = '';
        z.min = caps.zoom.min; z.max = Math.min(caps.zoom.max, 8); z.step = caps.zoom.step || 0.1;
        const start = Math.min(z.max, Math.max(caps.zoom.min, 1.5)); z.value = start; adv.zoom = start;
        z.oninput = () => track.applyConstraints({ advanced: [{ zoom: Number(z.value) }] }).catch(() => { });
      }
      if (Object.keys(adv).length) await track.applyConstraints({ advanced: [adv] }).catch(() => { });
      const tb = $('[data-torch]', ov);
      if (caps.torch) { tb.style.visibility = 'visible'; tb.onclick = () => { torchOn = !torchOn; tb.classList.toggle('on', torchOn); track.applyConstraints({ advanced: [{ torch: torchOn }] }).catch(() => { }); }; }
      else tb.style.visibility = 'hidden';
      const cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
      const sb = $('[data-switch]', ov);
      if (cams.length > 1) {
        sb.style.visibility = 'visible';
        sb.onclick = () => {
          const curId = track.getSettings().deviceId;
          const i = cams.findIndex(c => c.deviceId === curId);
          const next = cams[(i + 1) % cams.length];
          lsSet('mdp_cam', next.deviceId);
          startCamera(next.deviceId).catch(err => showError(err));
        };
      }
    }
    function showError(err) {
      console.warn(err);
      let m = 'Camera not available. Type the IMEI below instead.';
      if (!window.isSecureContext) m = 'Camera needs a secure (https://) address. Type the IMEI below instead.';
      else if (err && err.name === 'NotAllowedError') m = 'Camera permission was blocked. Allow camera for this site in browser settings, or type the IMEI below.';
      stageMsg.style.display = ''; stageMsg.textContent = m;
      setResult('', '');
    }

    /* Map the on-screen frame to video pixels (video uses object-fit: cover). */
    function cropRect() {
      const vw = video.videoWidth, vh = video.videoHeight;
      const sr = stage.getBoundingClientRect(), fr = frame.getBoundingClientRect();
      const scale = Math.max(sr.width / vw, sr.height / vh);
      const offX = (sr.width - vw * scale) / 2, offY = (sr.height - vh * scale) / 2;
      const padX = fr.width * 0.12, padY = fr.height * 0.6; // decode a bit beyond the frame so both IMEI barcodes of a label fit
      let sx = (fr.left - sr.left - padX - offX) / scale, sy = (fr.top - sr.top - padY - offY) / scale;
      let sw = (fr.width + padX * 2) / scale, sh = (fr.height + padY * 2) / scale;
      sx = Math.max(0, sx); sy = Math.max(0, sy); sw = Math.min(vw - sx, sw); sh = Math.min(vh - sy, sh);
      return { sx, sy, sw, sh };
    }

    async function loop(det) {
      if (!running) return;
      if (!busy && video.readyState >= 2 && video.videoWidth) {
        try {
          const { sx, sy, sw, sh } = cropRect();
          canvas.width = Math.round(sw); canvas.height = Math.round(sh);
          ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
          const codes = await det.detect(canvas);
          handle(codes);
        } catch (e) { /* a bad frame — keep going */ }
      }
      timer = setTimeout(() => loop(det), 70);
    }

    function handle(codes) {
      if (busy || !running) return;
      const now = Date.now();
      const found = [];
      codes.slice().sort((a, b) => (a.boundingBox?.y || 0) - (b.boundingBox?.y || 0))
        .forEach(c => extractImeis(c.rawValue).forEach(i => { if (!found.includes(i)) found.push(i); }));
      if (!found.length) return;
      const confirmed = [];
      for (const imei of found) {
        const s = seen.get(imei) || { n: 0, t: 0 };
        if (now - s.t > 1500) s.n = 0;
        s.n++; s.t = now; seen.set(imei, s);
        if (s.n >= 2) confirmed.push(imei);
      }
      const fresh = confirmed.filter(i => !accepted.has(i));
      if (!fresh.length) {
        if (confirmed.length && now - lastDupMsg > 2500) { lastDupMsg = now; setResult('Already scanned: ' + esc(confirmed[0]), 'warn'); }
        return;
      }
      fresh.forEach(i => accepted.set(i, now));
      deliver(fresh.slice(0, 2));
    }

    (async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { showError(); return; }
      try {
        const [det] = await Promise.all([
          getDetector(),
          startCamera(lsGet('mdp_cam')).catch(async err => {
            if (err && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) { lsSet('mdp_cam', ''); return startCamera(); }
            throw err;
          })
        ]);
        if (!running) return;
        setResult(multi ? 'Ready — scan one box after another' : 'Ready — hold steady over the barcode', '');
        loop(det.det);
      } catch (err) { showError(err); }
    })();
  });
}
