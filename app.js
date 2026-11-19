/* Sample Pack Builder — interfaz y orquestación (todo en el navegador).
 * Flujo: decodificar -> separar stems (Demucs ONNX en el navegador, o DSP básico) -> worker.js extrae samples
 *        -> preescucha/selección -> ZIP generado en el cliente.
 */
window.__spbLoaded = true;
const $ = (s) => document.querySelector(s);
const SR = 44100;
const VERSION = 'v13';

/* ---------------------------------------------------------------- diagnóstico e informes de error */
const T0 = performance.now(), LOGS = [], TRACE = [], DIAG = {};
const tsec = () => `+${((performance.now() - T0) / 1000).toFixed(2)}s`;
const fmtArg = (x) => { try { if (x instanceof Error) return x.stack || String(x); return typeof x === 'object' ? JSON.stringify(x).slice(0, 500) : String(x); } catch (e) { return '[no serializable]'; } };
['log', 'info', 'warn', 'error'].forEach((k) => {
  const o = console[k].bind(console);
  console[k] = (...args) => { LOGS.push(`${tsec()} [${k}] ${args.map(fmtArg).join(' ').slice(0, 800)}`); if (LOGS.length > 300) LOGS.shift(); o(...args); };
});
function step(m) { TRACE.push(`${tsec()} ${m}`); if (TRACE.length > 250) TRACE.shift(); }
let lastReport = '', lastReportName = '', autoDownloads = 0;
function downloadText(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 20000);
}
async function buildReport(err, where) {
  const L = [], add = (k, v) => L.push(k.padEnd(24) + ': ' + v), now = new Date();
  L.push(`INFORME ${err ? 'DE ERROR' : 'DE DIAGNÓSTICO'} — Sample Pack Builder ${VERSION}`);
  L.push('Envíale este archivo a Claude para identificar y corregir el problema. No contiene audio.', '');
  add('Fecha', now.toISOString()); add('Dónde ocurrió', where || '-'); add('Etapa / progreso', `${$('#pstage') ? $('#pstage').textContent : '-'} (${$('#pbar > div') ? $('#pbar > div').style.width : '-'})`);
  if (err) { L.push('', '--- ERROR ---', String(err.message || err), err.stack ? String(err.stack) : '(sin stack)'); if (err.workerStack) L.push('Stack del worker:', err.workerStack); }
  L.push('', '--- ENTORNO ---');
  add('Versión app', VERSION); add('Navegador (UA)', navigator.userAgent);
  try { if (navigator.userAgentData) add('UA brands/móvil', JSON.stringify(navigator.userAgentData.brands) + ' mobile=' + navigator.userAgentData.mobile); } catch (e) { /* */ }
  add('Idioma', navigator.language); add('Núcleos CPU', navigator.hardwareConcurrency); add('RAM aprox. (GB)', navigator.deviceMemory ?? 'n/d');
  add('Pantalla', `${screen.width}x${screen.height} @${window.devicePixelRatio}`); add('URL', location.origin + location.pathname);
  add('Protocolo', location.protocol); add('Contexto seguro', self.isSecureContext); add('Aislamiento COOP/COEP', self.crossOriginIsolated);
  add('Modo de proceso', inlineMode ? 'hilo principal (sin Worker)' : 'Web Worker');
  add('AudioContext', `${actx.sampleRate} Hz, estado ${actx.state}`);
  try { if (performance.memory) add('Memoria JS (MB)', `usada ${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)} / total ${(performance.memory.totalJSHeapSize / 1048576).toFixed(0)} / límite ${(performance.memory.jsHeapSizeLimit / 1048576).toFixed(0)}`); } catch (e) { /* */ }
  try { if (navigator.storage && navigator.storage.estimate) { const s = await navigator.storage.estimate(); add('Almacenamiento (MB)', `uso ${(s.usage / 1048576).toFixed(0)} / cuota ${(s.quota / 1048576).toFixed(0)}`); } } catch (e) { /* */ }
  try {
    if ('gpu' in navigator) { const ad = await navigator.gpu.requestAdapter(); add('WebGPU', ad ? 'adaptador disponible ' + JSON.stringify(ad.info ? { vendor: ad.info.vendor, architecture: ad.info.architecture, device: ad.info.device, description: ad.info.description } : {}) : 'sin adaptador'); }
    else add('WebGPU', 'no disponible');
  } catch (e) { add('WebGPU', 'error: ' + e.message); }
  L.push('', '--- OPCIONES Y ARCHIVO ---');
  add('Archivo', chosen ? `${chosen.name} · ${(chosen.size / 1048576).toFixed(2)} MB · tipo ${chosen.type || 'n/d'}` : '(ninguno)');
  add('Separación elegida', $('#quality') ? $('#quality').value : '-'); add('Duración a procesar', $('#maxmin') ? $('#maxmin').value + ' min (0 = toda)' : '-');
  add('BPM indicado', ($('#bpm') && $('#bpm').value) || 'auto'); add('Separador usado', sepMethod || '-'); add('Duración audio (s)', DIAG.durationSec ?? '-');
  add('Demucs', JSON.stringify(DIAG.demucs || {}));
  L.push('', '--- RESULTADO PARCIAL ---');
  add('Canción', song ? JSON.stringify(song) : '(sin analizar)');
  const counts = {}; (samples || []).forEach((s) => { counts[s.cat] = (counts[s.cat] || 0) + 1; }); add('Samples por categoría', JSON.stringify(counts));
  if (DIAG.structure) L.push('', '--- ESTRUCTURA DETECTADA ---', JSON.stringify(DIAG.structure));
  L.push('', '--- SAMPLES (posición en la canción) ---', ...(samples || []).filter((s) => s.t0 !== undefined).map((s) => `  ${s.cat.padEnd(11)} ${String(s.label || '').padEnd(6)} ${s.t0}s → ${s.t1}s ${s.suffix} (puntuación ${s.score})`));
  L.push('', '--- PASOS (cronología) ---', ...TRACE, '', '--- CONSOLA (últimas líneas) ---', ...LOGS);
  return L.join('\n') + '\n';
}
async function reportError(err, where, opts = {}) {
  try {
    lastReport = await buildReport(err, where);
    lastReportName = `spb-informe-${err ? 'error' : 'diagnostico'}-${VERSION}-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}.txt`;
    if (err && autoDownloads++ < 3 && opts.auto !== false) downloadText(lastReportName, lastReport);   // se descarga solo y queda el botón por si el navegador lo bloquea
    const bar = $('#repbar'); if (bar) { bar.hidden = false; $('#repmsg').textContent = err ? 'Se generó un informe del error.' : 'Informe de diagnóstico listo.'; }
  } catch (e) { console.error('No se pudo generar el informe', e); }
}
window.addEventListener('error', (e) => { reportError(e.error || new Error(e.message), `error global (${e.filename || ''}:${e.lineno || ''})`); });
window.addEventListener('unhandledrejection', (e) => { reportError(e.reason instanceof Error ? e.reason : new Error(String(e.reason)), 'promesa sin capturar'); });


/* ---------------------------------------------------------------- configuración */
const ORT_VERSIONS = ['1.22.0', '1.21.0', '1.20.1'];
const ORT_FILES = ['ort.webgpu.min.mjs', 'ort.min.mjs'];       // con WebGPU; si no existe, solo WASM
const DEMUCS_LIB = ['https://esm.sh/demucs-web', 'https://cdn.jsdelivr.net/npm/demucs-web/+esm'];
const MODEL4_URL = 'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx';
const MODEL6_URL = 'https://huggingface.co/StemSplitio/htdemucs-6s-onnx/resolve/main/htdemucs_6s_fp16weights.onnx';   // 6 stems: + guitarra y piano

const CATS = [
  { key: 'break', color: '#fb923c', folder: '01_Drum_Breaks', prefix: 'Break', numbered: true, loop: true, title: 'Breaks de batería' },
  { key: 'bass_loop', color: '#a78bfa', folder: '02_Bass_Loops', prefix: 'BassLoop', numbered: true, loop: true, title: 'Loops de bajo' },
  { key: 'inst_loop', color: '#5eead4', folder: '03_Instrument_Loops', prefix: 'InstLoop', numbered: true, loop: true, title: 'Loops de instrumentos' },
  { key: 'guitar_loop', color: '#facc15', folder: '03_Instrument_Loops/Guitar', prefix: 'GuitarLoop', numbered: true, loop: true, title: 'Loops de guitarra' },
  { key: 'keys_loop', color: '#60a5fa', folder: '03_Instrument_Loops/Keys', prefix: 'KeysLoop', numbered: true, loop: true, title: 'Loops de teclado / piano' },
  { key: 'kick', color: '#f87171', folder: '04_One_Shots/Drums/Kicks', prefix: 'Kick', numbered: true, title: 'Bombos', drum: true },
  { key: 'snare', color: '#fbbf24', folder: '04_One_Shots/Drums/Snares', prefix: 'Snare', numbered: true, title: 'Cajas', drum: true },
  { key: 'hat_closed', color: '#22d3ee', folder: '04_One_Shots/Drums/HiHats_Closed', prefix: 'HatClosed', numbered: true, title: 'Hi-hats cerrados', drum: true },
  { key: 'hat_open', color: '#38bdf8', folder: '04_One_Shots/Drums/HiHats_Open', prefix: 'HatOpen', numbered: true, title: 'Hi-hats abiertos', drum: true },
  { key: 'tom', color: '#f472b6', folder: '04_One_Shots/Drums/Toms', prefix: 'Tom', numbered: true, title: 'Toms', drum: true },
  { key: 'cymbal', color: '#cbd5e1', folder: '04_One_Shots/Drums/Cymbals_Perc', prefix: 'Cymbal', numbered: true, title: 'Platos y percusión', drum: true },
  { key: 'bass_note', color: '#c084fc', folder: '04_One_Shots/Bass_Notes', prefix: 'BassNote', numbered: false, title: 'Notas de bajo' },
  { key: 'chord', color: '#4ade80', folder: '04_One_Shots/Chords', prefix: 'Chord', numbered: false, title: 'Acordes' },
];
const CAT = Object.fromEntries(CATS.map((c) => [c.key, c]));

/* ---------------------------------------------------------------- estado */
let chosen = null, song = null, samples = [], excluded = new Set(), overrides = {};
let selId = null, playId = null, raf = 0, curSrc = null, curStart = 0, curDur = 0, sepMethod = '';
const actx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SR });
let worker = null, inlineMode = false, wResolve = null, wProgress = null;
const onWMsg = (e) => {
  const m = e.data;
  if (m.type === 'progress') wProgress && wProgress(m.p, m.stage);
  else if (wResolve) { const r = wResolve; wResolve = null; r(m); }
};
async function initWorker() {
  const http = /^https?:$/.test(location.protocol), emb = document.getElementById('worker-src');
  try {                                                        // 1) Web Worker (también desde un Blob, si el navegador lo permite)
    step('inicializando worker'); const url = emb ? URL.createObjectURL(new Blob([emb.textContent], { type: 'text/javascript' })) : (http ? 'worker.js' : null);
    if (url) {
      const w = new Worker(url);
      w.onmessage = onWMsg;
      w.onerror = (e) => { if (wResolve) { const r = wResolve; wResolve = null; r({ type: 'error', message: e.message || 'Error en el worker' }); } };
      const ok = await new Promise((res) => {
        const t = setTimeout(() => res(false), 2500);
        wResolve = (m) => { clearTimeout(t); res(m.type === 'pong'); };
        w.postMessage({ type: 'ping' });
      });
      wResolve = null;
      if (ok) { worker = w; return; }
      w.terminate();
    }
  } catch (e) { /* respaldo */ }
  // 2) Hilo principal (file:// / content:// sin Workers)
  if (!self.SPB) {
    if (emb) (0, eval)(emb.textContent);
    else await new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = 'worker.js'; s.onload = res;
      s.onerror = () => rej(new Error('No se pudo cargar worker.js (debe estar junto a index.html)'));
      document.head.appendChild(s);
    });
  }
  self.SPB.setPost((m) => onWMsg({ data: m }));
  worker = { postMessage: (msg) => setTimeout(() => self.SPB.handle(msg), 40) };
  inlineMode = true;
}
async function callWorker(msg, transfer, onProgress) {
  if (!worker) await initWorker();
  wProgress = onProgress || null;
  return new Promise((resolve, reject) => {
    wResolve = (m) => { if (m.type === 'error') { const e = new Error(m.message); e.workerStack = m.stack; reject(e); } else resolve(m); };
    worker.postMessage(msg, inlineMode ? undefined : (transfer || []));
  });
}

/* ---------------------------------------------------------------- valores por defecto en móvil */
if (/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) {
  $('#maxmin').value = '3'; $('#quality').value = 'dsp';
  $('#mobilehint').hidden = false;
}

/* ---------------------------------------------------------------- subida */
const drop = $('#drop'), fileIn = $('#file');
drop.addEventListener('click', () => fileIn.click());
drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } });
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); });
fileIn.addEventListener('change', () => { if (fileIn.files[0]) setFile(fileIn.files[0]); });
function setFile(f) {
  chosen = f;
  $('#fname').textContent = f.name + ' · ' + (f.size / 1048576).toFixed(1) + ' MB';
  $('#go').disabled = false;
  $('#packname').placeholder = f.name.replace(/\.[^.]+$/, '');
}
function showError(msg) { const e = $('#error'); e.textContent = msg; e.hidden = !msg; }
function showProgress(name) {
  $('#up').hidden = true; $('#res').hidden = true; $('#dock').hidden = true; $('#prog').hidden = false;
  $('#pfile').textContent = name; setBar(1, 'Empezando');
}
let lastStage = '';
function setBar(p, stage) { $('#pbar > div').style.width = Math.max(1, Math.min(100, p)) + '%'; if (stage) { $('#pstage').textContent = stage + '…'; if (stage !== lastStage) { lastStage = stage; step(`[${Math.round(p)}%] ${stage}`); } } }
function fail(msg, err) { showError(msg); $('#prog').hidden = true; $('#up').hidden = false; $('#go').disabled = !chosen; reportError(err || new Error(msg), 'fallo del flujo principal'); }

/* ---------------------------------------------------------------- separación con Demucs (navegador) */
async function importFirst(urls) {
  let last;
  for (const u of urls) { try { return await import(u); } catch (e) { last = e; } }
  throw last || new Error('No se pudo cargar la librería');
}
async function loadOrt() {
  for (const v of ORT_VERSIONS) {
    for (const f of ORT_FILES) {
      try {
        const ort = await import(`https://cdn.jsdelivr.net/npm/onnxruntime-web@${v}/dist/${f}`);
        ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${v}/dist/`;
        ort.env.wasm.numThreads = self.crossOriginIsolated ? (navigator.hardwareConcurrency || 4) : 1;
        DIAG.demucs = { ...(DIAG.demucs || {}), ort: `${v}/${f}` };
        return ort;
      } catch (e) { /* siguiente */ }
    }
  }
  throw new Error('No se pudo cargar onnxruntime-web');
}
async function fetchModel(onProg, MODEL_URL = MODEL4_URL, approx = 172e6) {
  let cache = null;
  try { cache = await caches.open('spb-models-v1'); const hit = await cache.match(MODEL_URL); if (hit) { DIAG.demucs = { ...(DIAG.demucs || {}), model: 'caché' }; return await hit.arrayBuffer(); } } catch (e) { cache = null; }
  DIAG.demucs = { ...(DIAG.demucs || {}), model: 'red', cacheDisponible: !!cache };
  const r = await fetch(MODEL_URL);
  if (!r.ok) throw new Error('No se pudo descargar el modelo (' + r.status + ')');
  if (cache) { try { cache.put(MODEL_URL, r.clone()).catch(() => {}); } catch (e) { /* sin cuota */ } }   // el caché lee su copia del flujo, sin duplicar memoria
  const total = +r.headers.get('content-length') || 0, reader = r.body.getReader();
  if (total) {                                                  // tamaño conocido: un único buffer, sin copias
    const buf = new Uint8Array(total); let got = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; buf.set(value, got); got += value.length; onProg(got, total); }
    return got === total ? buf.buffer : buf.buffer.slice(0, got);
  }
  const chunks = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; onProg(got, approx); }
  const buf = new Uint8Array(got); let o = 0; for (const c of chunks) { buf.set(c, o); o += c.length; }
  return buf.buffer;
}
const monoOf = (l, r) => { const m = new Float32Array(l.length); for (let i = 0; i < m.length; i++) m[i] = (l[i] + r[i]) / 2; return m; };

/* Procesa por tramos de 60 s con solape de 2 s y fundido cruzado: la memoria queda acotada. */
async function separateChunked(L, R, sepFn, onProg) {
  const n = L.length, CH = 60 * SR, OV = 2 * SR, MINC = 10 * SR, starts = [0];
  while (starts[starts.length - 1] + CH < n) starts.push(starts[starts.length - 1] + CH - OV);
  if (starts.length > 1 && n - starts[starts.length - 1] < MINC) starts[starts.length - 1] = Math.max(0, n - CH);
  const out = { drums: new Float32Array(n), bass: new Float32Array(n), other: new Float32Array(n) };
  let done = 0;
  for (let c = 0; c < starts.length; c++) {
    const s = starts[c], e = Math.min(n, s + CH);
    const res = await sepFn(L.subarray(s, e), R.subarray(s, e), (p) => onProg((c + p) / starts.length, c + 1, starts.length));
    for (const k of ['drums', 'bass', 'other']) {
      const m = monoOf(res[k].left, res[k].right), o = out[k], len = Math.min(m.length, e - s);
      for (let i = 0; i < len; i++) {
        const g = s + i;
        if (g < done) { const w = (g - s) / Math.max(1, done - s); o[g] = o[g] * (1 - w) + m[i] * w; } else o[g] = m[i];
      }
    }
    done = e;
  }
  return out;
}

async function separateDemucs(L, R) {
  setBar(6, 'Cargando motor de IA');
  const ort = await loadOrt();
  const lib = await importFirst(DEMUCS_LIB);
  const DemucsProcessor = lib.DemucsProcessor || (lib.default && lib.default.DemucsProcessor);
  if (!DemucsProcessor) throw new Error('Librería Demucs no válida');
  let providers = ['wasm'];
  try { if ('gpu' in navigator && (await navigator.gpu.requestAdapter())) { providers = ['webgpu', 'wasm']; ort.env.webgpu = { powerPreference: 'high-performance' }; } } catch (e) { /* WASM */ }
  DIAG.demucs = { ...(DIAG.demucs || {}), providers: providers.join(',') };
  const model = await fetchModel((g, t) => setBar(8 + 12 * g / t, `Descargando modelo (${(g / 1048576).toFixed(0)} / ${(t / 1048576).toFixed(0)} MB, solo la primera vez)`));
  setBar(20, 'Preparando el modelo');
  let cb = null;
  const proc = new DemucsProcessor({
    ort, sessionOptions: { executionProviders: providers, enableCpuMemArena: false, enableMemPattern: false },
    onProgress: ({ progress }) => cb && cb(progress),
  });
  await proc.loadModel(model);
  return separateChunked(L, R, (l, r, onP) => { cb = onP; return proc.separate(l, r); },
    (p, c, t) => setBar(20 + 50 * p, `Separando stems con Demucs (${providers[0] === 'webgpu' ? 'GPU' : 'CPU, lento'}) · tramo ${c}/${t}`));
}

/* Demucs de 6 stems (batería, bajo, otros, voz, guitarra, piano) con onnxruntime-web directamente.
 * Modelo de entrada fija [1,2,343980] (7,8 s) -> salida [1,6,2,343980]; se procesa por ventanas con solape del 25 %. */
async function separateDemucs6(L, R) {
  setBar(6, 'Cargando motor de IA');
  const ort = await loadOrt();
  const model = await fetchModel((g, t) => setBar(8 + 12 * g / t, `Descargando modelo de 6 stems (${(g / 1048576).toFixed(0)} / ${(t / 1048576).toFixed(0)} MB, solo la primera vez)`), MODEL6_URL, 136e6);
  setBar(20, 'Preparando el modelo de 6 stems');
  const N = 343980, OV = Math.floor(N / 4), STRIDE = N - OV, n = L.length, names = ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'];
  let gpu = false; try { gpu = 'gpu' in navigator && !!(await navigator.gpu.requestAdapter()); } catch (e) { /* WASM */ }
  const mk = (ep) => ort.InferenceSession.create(model, { executionProviders: [ep], graphOptimizationLevel: 'all', enableCpuMemArena: false, enableMemPattern: false });
  const runOne = async (sess, buf) => {
    const res = await sess.run({ [sess.inputNames[0]]: new ort.Tensor('float32', buf, [1, 2, N]) }), t = res[sess.outputNames[0]];
    if (!t || t.dims.length !== 4 || t.dims[1] !== 6 || t.dims[3] !== N) throw new Error('Salida inesperada del modelo de 6 stems: ' + (t ? t.dims.join('x') : 'vacía'));
    return t.getData ? await t.getData() : t.data;
  };
  let sess = null, ep = 'wasm';
  if (gpu) {                                                    // prueba la GPU con un tramo de silencio; si falla, CPU
    try { sess = await mk('webgpu'); await runOne(sess, new Float32Array(2 * N)); ep = 'webgpu'; }
    catch (e) { console.warn('6 stems: WebGPU no disponible para este modelo, se usa CPU', e); try { sess && sess.release && await sess.release(); } catch (e2) { /* */ } sess = null; }
  }
  if (!sess) sess = await mk('wasm');
  DIAG.demucs = { ...(DIAG.demucs || {}), modelo: '6 stems', providers: ep };
  const keep = ['drums', 'bass', 'other', 'guitar', 'piano'], out = Object.fromEntries(keep.map((k) => [k, new Float32Array(n)])), weight = new Float32Array(n);
  const win = new Float32Array(N).fill(1); for (let i = 0; i < OV; i++) { win[i] = (i + 1) / (OV + 1); win[N - 1 - i] = (i + 1) / (OV + 1); }
  const nCh = Math.max(1, Math.ceil(Math.max(1, n - OV) / STRIDE)), buf = new Float32Array(2 * N);
  for (let c = 0; c < nCh; c++) {
    const s = c * STRIDE, len = Math.min(N, n - s);
    buf.fill(0); buf.set(L.subarray(s, s + len), 0); buf.set(R.subarray(s, s + len), N);
    const d = await runOne(sess, buf);
    for (const k of keep) {
      const row = names.indexOf(k) * 2 * N, o = out[k];
      for (let i = 0; i < len; i++) o[s + i] += 0.5 * (d[row + i] + d[row + N + i]) * win[i];
    }
    for (let i = 0; i < len; i++) weight[s + i] += win[i];
    setBar(20 + 50 * (c + 1) / nCh, `Separando 6 stems con Demucs (${ep === 'webgpu' ? 'GPU' : 'CPU, lento'}) · tramo ${c + 1}/${nCh}`);
    await new Promise((r) => setTimeout(r, 0));
  }
  for (const k of keep) { const o = out[k]; for (let i = 0; i < n; i++) o[i] /= Math.max(weight[i], 1e-8); }
  try { sess.release && await sess.release(); } catch (e) { /* */ }
  return out;
}

/* ---------------------------------------------------------------- flujo principal */
let wakeLock = null;
async function keepAwake() { try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* no disponible */ } }
function releaseAwake() { try { wakeLock && wakeLock.release(); } catch (e) { /* nada */ } wakeLock = null; }

$('#go').addEventListener('click', async () => {
  if (!chosen) return;
  showError(''); $('#repbar').hidden = true; $('#go').disabled = true; showProgress(chosen.name); keepAwake();
  step(`inicio: ${chosen.name} (${chosen.size} bytes), separación=${$('#quality').value}, límite=${$('#maxmin').value}`);
  try {
    if (actx.state === 'suspended') await actx.resume();
    setBar(2, 'Decodificando audio');
    let buf = await actx.decodeAudioData(await chosen.arrayBuffer());
    if (buf.duration < 8) throw new Error('La canción es demasiado corta (mínimo 8 s).');
    const limit = (parseFloat($('#maxmin').value) || 0) * 60 * SR, n = limit ? Math.min(buf.length, limit) : buf.length;
    if (n / SR > 12 * 60) throw new Error('La canción es demasiado larga (máximo 12 min). Usa "Duración a procesar".');
    DIAG.durationSec = Math.round(n / SR);
    const L = buf.getChannelData(0).subarray(0, n), R = (buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0)).subarray(0, n);
    const warns = [], mode = $('#quality').value;
    if (limit && buf.length > limit) warns.push(`Solo se procesaron los primeros ${Math.round(n / SR / 60 * 10) / 10} min de la canción.`);

    const bpmIn = parseFloat($('#bpm').value) || null, mix = monoOf(L, R);
    await callWorker({ type: 'mix', mix }, [mix.buffer]);
    const useDsp = async () => { setBar(10, 'Separando con DSP básico'); await callWorker({ type: 'hpss' }, [], (p, s) => setBar(10 + p * 0.55, s)); sepMethod = 'dsp'; };
    const use4 = async () => { const st = await separateDemucs(L, R); await callWorker({ type: 'load', ...st }, [st.drums.buffer, st.bass.buffer, st.other.buffer]); sepMethod = 'demucs'; };
    if (mode === 'demucs6' || mode === 'demucs') {
      let done = false;
      if (mode === 'demucs6') {
        try {
          const st = await separateDemucs6(L, R);
          await callWorker({ type: 'load', ...st }, Object.values(st).map((v) => v.buffer)); sepMethod = 'demucs6'; done = true;
        } catch (e) {
          console.error(e); warns.push('No se pudo usar el modelo de 6 stems (' + (e.message || e) + '). Se usó Demucs normal de 4 stems, sin guitarra/piano separados.');
          reportError(e, 'Demucs 6 stems (se continuó con 4 stems)');
        }
      }
      if (!done) {
        try { await use4(); } catch (e) {
          console.error(e); warns.push('No se pudo usar Demucs en este dispositivo (' + (e.message || e) + '). Se usó la separación DSP básica.');
          reportError(e, 'Demucs (se continuó con DSP básico)');
          await useDsp();
        }
      }
    } else await useDsp();
    buf = null;
    await runAnalysis(bpmIn, warns);
  } catch (e) { console.error(e); fail(e.message || String(e), e); }
  releaseAwake();
});

async function runAnalysis(bpm, warns = []) {
  step('análisis');
  const r = await callWorker({ type: 'analyze', bpmHint: bpm }, [], (p, s) => setBar(70 + p * 0.3, s));
  song = r.result.song; samples = r.result.samples; DIAG.structure = r.result.structure;
  step(`análisis listo: ${samples.length} samples, ${song.bpm} BPM, ${song.key}`);
  render(warns);
}

async function reprocess() {
  const bpm = parseFloat($('#bpmEdit').value);
  if (!(bpm >= 40 && bpm <= 240)) return showError('BPM no válido (40–240).');
  showError(''); stopPlay(); showProgress(chosen ? chosen.name : '');
  try { await runAnalysis(bpm, lastWarns); } catch (e) { fail(e.message, e); }
}
let lastWarns = [];

/* ---------------------------------------------------------------- nombres */
const catOf = (s) => overrides[s.id] || s.cat;
function computeNames(includeAll) {
  const groups = {};
  for (const s of samples) { if (!includeAll && excluded.has(s.id)) continue; (groups[catOf(s)] ||= []).push(s); }
  const names = {};
  const breakNo = {}, order = Object.keys(groups).sort((p, q) => (p === 'break_part') - (q === 'break_part'));
  for (const c of order) {
    const arr = groups[c];
    arr.sort((a, b) => a.rank - b.rank || (a.id < b.id ? -1 : 1));
    arr.forEach((s, i) => {
      const cfg = CAT[c], nn = String(i + 1).padStart(2, '0');
      if (c === 'break' && s.group !== undefined) breakNo[s.group] = nn;
      if (c === 'break_part') names[s.id] = (breakNo[s.group] ? `Break_${breakNo[s.group]}_${s.label}` : `BreakPart_${nn}_${s.label}`) + s.suffix + '.wav';
      else names[s.id] = (cfg.numbered ? `${cfg.prefix}_${nn}` : `${cfg.prefix}_${s.label}`) + s.suffix + '.wav';
    });
  }
  return names;
}
const safeName = (n) => (String(n || '').replace(/[^A-Za-z0-9._ -]+/g, '_').trim().replace(/^[ ._]+|[ ._]+$/g, '').slice(0, 60)) || 'SamplePack';

/* ---------------------------------------------------------------- render */
const ICON_PLAY = '<svg viewBox="0 0 16 16"><path d="M4 2l10 6-10 6z"/></svg>';
const ICON_STOP = '<svg viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10" rx="1"/></svg>';

function render(warns) {
  lastWarns = warns;
  excluded = new Set(); overrides = {}; selId = null; stopPlay();
  $('#prog').hidden = true; $('#up').hidden = true; $('#res').hidden = false; $('#dock').hidden = false;
  $('#packname2').value = safeName($('#packname').value || (chosen ? chosen.name.replace(/\.[^.]+$/, '') : ''));
  const mm = Math.floor(song.duration / 60), ss = String(Math.round(song.duration % 60)).padStart(2, '0');
  $('#chips').innerHTML = `
    <span class="chip">Tempo <input id="bpmEdit" type="number" min="40" max="240" step="0.1" value="${song.bpm.toFixed(1)}"> BPM</span>
    <button id="reproc" class="small" title="Recalcula compases y loops con este BPM (sin volver a separar)">Reanalizar con este BPM</button>
    <span class="chip">Tonalidad <b>${song.key}</b></span><span class="chip">Duración <b>${mm}:${ss}</b></span>
    ${song.bpmMax - song.bpmMin > 4 ? `<span class="chip" title="El tempo de la canción no es fijo: cada loop lleva en el nombre su tempo real">Tempo variable <b>${song.bpmMin}–${song.bpmMax}</b></span>` : ''}
    <span class="chip">Separador <b>${sepMethod === 'demucs6' ? 'Demucs 6 stems (IA)' : sepMethod === 'demucs' ? 'Demucs (IA)' : 'DSP básico'}</b></span>
    <button id="diagbtn" class="small" title="Descarga un .txt con el análisis detallado">Informe (.txt)</button>
    <span class="chip"><b>${samples.length}</b> samples</span>`;
  $('#reproc').onclick = reprocess;
  $('#diagbtn').onclick = async () => { await reportError(null, 'informe manual'); downloadText(lastReportName, lastReport); };
  const w = $('#sepwarn'), msgs = [...warns];
  if (sepMethod === 'dsp' && !warns.length) msgs.push('Se usó la separación DSP básica: es rápida pero con música real los stems tendrán mucho sangrado. Elige "Demucs" para obtener mejores resultados.');
  w.hidden = !msgs.length; w.textContent = msgs.join(' ');
  renderGroups(); refresh();
}

function renderGroups() {
  const root = $('#groups'); root.innerHTML = '';
  const byCat = {};
  for (const s of samples) (byCat[catOf(s)] ||= []).push(s);
  for (const c of CATS) {
    const arr = (byCat[c.key] || []).sort((a, b) => a.rank - b.rank || (a.id < b.id ? -1 : 1));
    if (!arr.length && !c.drum) continue;
    const sec = document.createElement('section');
    sec.className = 'grp'; sec.dataset.cat = c.key; sec.style.setProperty('--c', c.color);
    sec.innerHTML = `<div class="ghead"><h2>${c.title}${c.loop ? '<span class="loopmark">bucle</span>' : ''}</h2>
      <span class="path">${c.folder}/</span><span class="sp"></span><span class="cnt"></span>
      <button class="small" data-all="1">Todos</button><button class="small" data-all="0">Ninguno</button></div><div class="rows"></div>`;
    const rows = sec.querySelector('.rows');
    if (!arr.length) rows.innerHTML = '<div class="empty">No se encontró ningún golpe de este tipo.</div>';
    for (const s of arr) rows.appendChild(makeRow(s, c));
    sec.querySelectorAll('button[data-all]').forEach((b) => (b.onclick = () => { for (const s of arr) b.dataset.all === '1' ? excluded.delete(s.id) : excluded.add(s.id); refresh(); }));
    root.appendChild(sec);
  }
}

function makeRow(s, c) {
  const row = document.createElement('div');
  row.className = 'row'; row.dataset.id = s.id;
  const opts = c.drum ? CATS.filter((x) => x.drum).map((x) => `<option value="${x.key}"${x.key === catOf(s) ? ' selected' : ''}>${x.title}</option>`).join('') : '';
  row.innerHTML = `
    <input type="checkbox" title="Incluir en el pack" aria-label="Incluir en el pack">
    <button class="pbtn" title="Reproducir" aria-label="Reproducir">${ICON_PLAY}</button>
    <div class="wave"><canvas></canvas><div class="ph"></div></div>
    <div class="name"></div><div class="meta">${s.dur.toFixed(2)} s</div>
    <div class="q" title="Puntuación automática de calidad: ${s.score}/100"><i><b style="width:${s.score}%"></b></i></div>
    ${c.drum ? `<select title="Mover a otra categoría">${opts}</select>` : ''}`;
  const chk = row.querySelector('input');
  chk.onchange = () => { chk.checked ? excluded.delete(s.id) : excluded.add(s.id); refresh(); };
  row.querySelector('.pbtn').onclick = () => toggle(s.id);
  row.querySelector('.wave').onclick = () => toggle(s.id);
  row.querySelector('.name').onclick = () => select(s.id, false);
  const sel = row.querySelector('select');
  if (sel) sel.onchange = () => { if (sel.value === s.cat) delete overrides[s.id]; else overrides[s.id] = sel.value; renderGroups(); refresh(); };
  drawWave(row.querySelector('canvas'), s.peaks, (CAT[catOf(s)] || {}).color);
  return row;
}
function drawWave(cv, peaks, color) {
  const dpr = window.devicePixelRatio || 1, w = 190, h = 34;
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const bw = w / peaks.length; g.fillStyle = color || '#5eead4';
  peaks.forEach((p, i) => { const bh = Math.max(1.5, p * (h - 6)); g.fillRect(i * bw + 0.5, (h - bh) / 2, Math.max(1, bw - 1), bh); });
}
function refresh() {
  const names = computeNames(false), base = computeNames(true); let n = 0;
  document.querySelectorAll('.row').forEach((row) => {
    const id = row.dataset.id, off = excluded.has(id);
    row.classList.toggle('off', off); row.classList.toggle('sel', id === selId); row.classList.toggle('playing', id === playId);
    row.querySelector('input').checked = !off;
    row.querySelector('.name').textContent = off ? base[id] : names[id];
    if (!off) n++;
  });
  document.querySelectorAll('section.grp').forEach((sec) => {
    const rows = [...sec.querySelectorAll('.row')], inc = rows.filter((r) => !excluded.has(r.dataset.id)).length;
    sec.querySelector('.cnt').textContent = rows.length ? `${inc} de ${rows.length}` : '';
  });
  $('#selcount').textContent = n; $('#export').disabled = n === 0;
}

/* ---------------------------------------------------------------- reproducción (WebAudio) */
const rowEl = (id) => document.querySelector(`.row[data-id="${id}"]`);
function select(id, scroll = true) { selId = id; refresh(); const el = rowEl(id); if (el && scroll) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
function toggle(id) { select(id, false); if (playId === id) return stopPlay(); play(id); }
function play(id) {
  const s = samples.find((x) => x.id === id); if (!s) return;
  if (actx.state === 'suspended') actx.resume();
  stopSource();
  const ab = actx.createBuffer(1, s.audio.length, SR); ab.copyToChannel(s.audio, 0);
  const src = actx.createBufferSource(); src.buffer = ab; src.loop = !!CAT[catOf(s)].loop; src.connect(actx.destination);
  src.onended = () => { if (curSrc === src) stopPlay(); };
  curSrc = src; curStart = actx.currentTime; curDur = ab.duration; playId = id;
  src.start(); refresh(); setIcons(); tick();
}
function stopSource() { if (curSrc) { const s = curSrc; curSrc = null; try { s.stop(); } catch (e) { /* ya parado */ } } }
function stopPlay() {
  stopSource(); playId = null; cancelAnimationFrame(raf);
  document.querySelectorAll('.ph').forEach((p) => (p.style.left = '0'));
  if (document.querySelector('.row')) { refresh(); setIcons(); }
}
function setIcons() { document.querySelectorAll('.row').forEach((r) => { r.querySelector('.pbtn').innerHTML = r.dataset.id === playId ? ICON_STOP : ICON_PLAY; }); }
function tick() {
  cancelAnimationFrame(raf);
  const el = playId && rowEl(playId);
  if (el && curSrc) el.querySelector('.ph').style.left = (((actx.currentTime - curStart) % curDur) / curDur * 100) + '%';
  if (playId) raf = requestAnimationFrame(tick);
}
document.addEventListener('keydown', (e) => {
  if ($('#res').hidden) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if ((tag === 'input' && e.target.type !== 'checkbox') || tag === 'select') return;
  const ids = [...document.querySelectorAll('.row')].map((r) => r.dataset.id); if (!ids.length) return;
  const i = ids.indexOf(selId);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const ni = e.key === 'ArrowDown' ? Math.min(ids.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
    select(ids[ni]); play(ids[ni]);
  } else if (e.key === ' ' && tag !== 'button') {
    e.preventDefault(); if (selId) toggle(selId); else { select(ids[0]); play(ids[0]); }
  } else if ((e.key === 'x' || e.key === 'X' || e.key === 'Delete') && selId) {
    e.preventDefault(); excluded.has(selId) ? excluded.delete(selId) : excluded.add(selId);
    const ni = Math.min(ids.length - 1, i + 1); select(ids[ni]); play(ids[ni]);
  }
});

/* ---------------------------------------------------------------- WAV + ZIP (en el cliente) */
function wav24(f32) {
  const n = f32.length, buf = new ArrayBuffer(44 + n * 3), dv = new DataView(buf);
  const str = (o, t) => { for (let i = 0; i < t.length; i++) dv.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * 3, true); str(8, 'WAVE'); str(12, 'fmt '); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, SR, true); dv.setUint32(28, SR * 3, true);
  dv.setUint16(32, 3, true); dv.setUint16(34, 24, true); str(36, 'data'); dv.setUint32(40, n * 3, true);
  let o = 44;
  for (let i = 0; i < n; i++) { const v = Math.round(Math.max(-1, Math.min(1, f32[i])) * 8388607); dv.setUint8(o++, v & 255); dv.setUint8(o++, (v >> 8) & 255); dv.setUint8(o++, (v >> 16) & 255); }
  return new Uint8Array(buf);
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function makeZip(files) {   // files: [{name, data:Uint8Array}] — sin compresión (los WAV apenas comprimen)
  const enc = new TextEncoder(), parts = [], central = []; let offset = 0;
  const d = new Date(), dosT = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dosD = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, dosT, true); h.setUint16(12, dosD, true); h.setUint32(14, crc, true); h.setUint32(18, f.data.length, true);
    h.setUint32(22, f.data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(h.buffer, name, f.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, dosT, true); c.setUint16(14, dosD, true); c.setUint32(16, crc, true); c.setUint32(20, f.data.length, true);
    c.setUint32(24, f.data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    central.push(c.buffer, name);
    offset += 30 + name.length + f.data.length;
  }
  const cdSize = central.reduce((a, p) => a + (p.byteLength ?? p.length), 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

$('#export').addEventListener('click', async () => {
  const btn = $('#export'); btn.disabled = true; const old = btn.textContent; btn.textContent = 'Creando ZIP…';
  showError('');
  try {
    await new Promise((r) => setTimeout(r, 30));
    const pack = safeName($('#packname2').value), names = computeNames(false), files = [], counts = {};
    for (const s of samples) {
      if (excluded.has(s.id)) continue;
      const folder = CAT[catOf(s)].folder;
      files.push({ name: `${pack}/${folder}/${names[s.id]}`, data: wav24(s.audio) });
      counts[folder] = (counts[folder] || 0) + 1;
    }
    const sepTxt = sepMethod === 'demucs6' ? 'Demucs IA, 6 stems' : sepMethod === 'demucs' ? 'Demucs IA, 4 stems' : 'DSP básico';
    const info = [pack, '='.repeat(pack.length), '', `Creado con Sample Pack Builder ${VERSION} — By SampledHead`, `Fecha: ${new Date().toISOString().slice(0, 10)}`,
      `Canción de origen: ${chosen ? chosen.name : '-'}`, `Separación de stems: ${sepTxt}`, '',
      `Tempo: ${song.bpmInt} BPM (${song.bpm.toFixed(2)})` + (song.bpmMax - song.bpmMin > 4 ? ` · tempo variable ${song.bpmMin}–${song.bpmMax} BPM (cada loop lleva su tempo real en el nombre)` : ''), `Tonalidad estimada: ${song.key}`,
      'Formato: WAV mono 24 bit / 44.1 kHz, normalizado a -1 dBFS (pico)', '', 'Contenido:',
      ...Object.keys(counts).sort().map((f) => `  ${f}: ${counts[f]} archivos`)].join('\n') + '\n';
    files.push({ name: `${pack}/pack_info.txt`, data: new TextEncoder().encode(info) });
    const blob = makeZip(files), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = pack + '.zip';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 20000);
  } catch (e) { console.error(e); showError('No se pudo crear el ZIP: ' + (e.message || e)); reportError(e, 'exportar ZIP'); }
  btn.textContent = old; refresh();
});

$('#newbtn').addEventListener('click', () => {
  stopPlay(); samples = []; $('#repbar').hidden = true; $('#res').hidden = true; $('#dock').hidden = true; $('#up').hidden = false; showError('');
  chosen = null; fileIn.value = ''; $('#fname').textContent = ''; $('#go').disabled = true; $('#bpm').value = '';
});

$('#repbtn').addEventListener('click', () => { if (lastReport) downloadText(lastReportName, lastReport); });

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch((e) => console.warn('service worker', e));
