/* Sample Pack Builder — worker de DSP (sin dependencias).
 * Recibe stems mono (drums/bass/other) y devuelve los samples; si no hay stems, puede separar con HPSS.
 * También se puede cargar desde Node para pruebas: require('./worker.js').
 */
(function (root) {
'use strict';
const SR = 44100;
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const KS_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
let post = (m, t) => { try { self.postMessage(m, t || []); } catch (e) { /* node */ } };
const progress = (p, s) => post({ type: 'progress', p, stage: s });

/* ============================================================ FFT */
const fftCache = {};
function getFFT(n) {
  if (fftCache[n]) return fftCache[n];
  const levels = Math.round(Math.log2(n));
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2), rev = new Uint32Array(n);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = Math.sin(2 * Math.PI * i / n); }
  for (let i = 0; i < n; i++) { let r = 0, v = i; for (let b = 0; b < levels; b++) { r = (r << 1) | (v & 1); v >>= 1; } rev[i] = r; }
  const f = {
    n,
    forward(re, im) {
      for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
      for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1, step = n / size;
        for (let i = 0; i < n; i += size) {
          for (let j = i, k = 0; j < i + half; j++, k += step) {
            const l = j + half, c = cos[k], s = sin[k];
            const tr = re[l] * c + im[l] * s, ti = im[l] * c - re[l] * s;
            re[l] = re[j] - tr; im[l] = im[j] - ti; re[j] += tr; im[j] += ti;
          }
        }
      }
    },
    inverse(re, im) { f.forward(im, re); const s = 1 / n; for (let i = 0; i < n; i++) { re[i] *= s; im[i] *= s; } },
  };
  return (fftCache[n] = f);
}
const hann = (n) => { const w = new Float32Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n); return w; };
const nextPow2 = (n) => { let p = 1; while (p < n) p <<= 1; return p; };

/* STFT de magnitudes por frames (dos frames reales por FFT). Frame f centrado en f*hop. */
function stftMag(x, nfft, hop, onFrame) {
  const len = x.length, pad = nfft >> 1, nFrames = 1 + Math.ceil(len / hop), bins = (nfft >> 1) + 1;
  const fft = getFFT(nfft), win = hann(nfft);
  const re = new Float64Array(nfft), im = new Float64Array(nfft), mA = new Float32Array(bins), mB = new Float32Array(bins);
  for (let f = 0; f < nFrames; f += 2) {
    const s0 = f * hop - pad, s1 = (f + 1) * hop - pad, two = f + 1 < nFrames;
    for (let i = 0; i < nfft; i++) {
      const a = s0 + i, b = s1 + i;
      re[i] = a >= 0 && a < len ? x[a] * win[i] : 0;
      im[i] = two && b >= 0 && b < len ? x[b] * win[i] : 0;
    }
    fft.forward(re, im);
    for (let k = 0; k < bins; k++) {
      const kk = (nfft - k) & (nfft - 1);
      const ar = (re[k] + re[kk]) / 2, ai = (im[k] - im[kk]) / 2, br = (im[k] + im[kk]) / 2, bi = -(re[k] - re[kk]) / 2;
      mA[k] = Math.sqrt(ar * ar + ai * ai); mB[k] = Math.sqrt(br * br + bi * bi);
    }
    onFrame(f, mA);
    if (two) onFrame(f + 1, mB);
  }
  return nFrames;
}

/* STFT compleja (frame-major, Float32) + ISTFT, para HPSS */
function stftComplex(x, nfft, hop) {
  const len = x.length, pad = nfft >> 1, nFrames = 1 + Math.ceil(len / hop), bins = (nfft >> 1) + 1;
  const fft = getFFT(nfft), win = hann(nfft);
  const SRe = new Float32Array(nFrames * bins), SIm = new Float32Array(nFrames * bins);
  const re = new Float64Array(nfft), im = new Float64Array(nfft);
  for (let f = 0; f < nFrames; f += 2) {
    const s0 = f * hop - pad, s1 = (f + 1) * hop - pad, two = f + 1 < nFrames;
    for (let i = 0; i < nfft; i++) {
      const a = s0 + i, b = s1 + i;
      re[i] = a >= 0 && a < len ? x[a] * win[i] : 0;
      im[i] = two && b >= 0 && b < len ? x[b] * win[i] : 0;
    }
    fft.forward(re, im);
    for (let k = 0; k < bins; k++) {
      const kk = (nfft - k) & (nfft - 1);
      SRe[f * bins + k] = (re[k] + re[kk]) / 2; SIm[f * bins + k] = (im[k] - im[kk]) / 2;
      if (two) { SRe[(f + 1) * bins + k] = (im[k] + im[kk]) / 2; SIm[(f + 1) * bins + k] = -(re[k] - re[kk]) / 2; }
    }
  }
  return { re: SRe, im: SIm, nFrames, bins };
}
function istftMasked(S, mask, nfft, hop, length, invert) {
  const { re: SRe, im: SIm, nFrames, bins } = S;
  const fft = getFFT(nfft), win = hann(nfft);
  const out = new Float32Array((nFrames - 1) * hop + nfft), norm = new Float32Array(out.length);
  const re = new Float64Array(nfft), im = new Float64Array(nfft);
  for (let f = 0; f < nFrames; f += 2) {
    const two = f + 1 < nFrames;
    for (let k = 0; k < bins; k++) {
      const m0 = invert ? 1 - mask[f * bins + k] : mask[f * bins + k];
      const ar = SRe[f * bins + k] * m0, ai = SIm[f * bins + k] * m0;
      let br = 0, bi = 0;
      if (two) { const m1 = invert ? 1 - mask[(f + 1) * bins + k] : mask[(f + 1) * bins + k]; br = SRe[(f + 1) * bins + k] * m1; bi = SIm[(f + 1) * bins + k] * m1; }
      re[k] = ar - bi; im[k] = ai + br;              // Z = A + iB
      if (k > 0 && k < nfft >> 1) { const kk = nfft - k; re[kk] = ar + bi; im[kk] = -ai + br; } // conj(A) + i conj(B)
    }
    fft.inverse(re, im);
    for (let i = 0; i < nfft; i++) {
      const s = f * hop + i; out[s] += re[i] * win[i]; norm[s] += win[i] * win[i];
      if (two) { const s2 = (f + 1) * hop + i; out[s2] += im[i] * win[i]; norm[s2] += win[i] * win[i]; }
    }
  }
  const y = new Float32Array(length), off = nfft >> 1;
  for (let i = 0; i < length; i++) { const j = i + off; y[i] = j < out.length ? out[j] / Math.max(norm[j], 1e-6) : 0; }
  return y;
}

/* ============================================================ utilidades */
function uniformFilter(x, size) {
  const n = x.length, out = new Float32Array(n), pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + x[i];
  const lo = size >> 1;
  for (let i = 0; i < n; i++) {
    let a = i - lo, b = a + size - 1, s = 0;
    if (a < 0) { s += x[0] * -a; a = 0; }
    if (b > n - 1) { s += x[n - 1] * (b - (n - 1)); b = n - 1; }
    if (b >= a) s += pre[b + 1] - pre[a];
    out[i] = s / size;
  }
  return out;
}
const absArr = (x) => { const o = new Float32Array(x.length); for (let i = 0; i < x.length; i++) o[i] = Math.abs(x[i]); return o; };
function percentile(arr, q) {
  if (!arr.length) return 0;
  const a = Float32Array.from(arr).sort(), p = (q / 100) * (a.length - 1), i = Math.floor(p), f = p - i;
  return i + 1 < a.length ? a[i] * (1 - f) + a[i + 1] * f : a[i];
}
function rmsRange(x, a, b) {
  a = Math.max(0, a | 0); b = Math.min(x.length, b | 0);
  if (b <= a) return 0;
  let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / (b - a));
}
const cosSim = (a, b) => {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na) * Math.sqrt(nb) + 1e-12);
};
const clip = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function fade(x, inMs, outMs) {
  const y = Float32Array.from(x), n = y.length;
  const nIn = Math.min(Math.floor(inMs * SR / 1000), n >> 1), nOut = Math.min(Math.floor(outMs * SR / 1000), n >> 1);
  for (let i = 0; i < nIn; i++) y[i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / nIn);
  for (let i = 0; i < nOut; i++) y[n - nOut + i] *= 0.5 + 0.5 * Math.cos(Math.PI * i / nOut);
  return y;
}
function normalizePeak(x, db) {
  let p = 0; for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > p) p = v; }
  if (p < 1e-9) return x;
  const g = Math.pow(10, db / 20) / p, y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = x[i] * g;
  return y;
}
function peaksOf(x, n = 72) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * x.length / n), b = Math.max(a + 1, Math.floor((i + 1) * x.length / n));
    let m = 0; for (let j = a; j < b && j < x.length; j++) { const v = Math.abs(x[j]); if (v > m) m = v; }
    out.push(m);
  }
  const mx = Math.max(...out) || 1;
  return out.map((v) => Math.round(v / mx * 1000) / 1000);
}

/* scipy.signal.find_peaks (height escalar o por muestra + distance) */
function findPeaks(x, height, distance) {
  const n = x.length, cand = [];
  let i = 1; const iMax = n - 1;
  while (i < iMax) {
    if (x[i - 1] < x[i]) {
      let ia = i + 1;
      while (ia < iMax && x[ia] === x[i]) ia++;
      if (x[ia] < x[i]) { cand.push((i + ia - 1) >> 1); i = ia; }
    }
    i++;
  }
  let peaks = cand.filter((p) => x[p] >= (typeof height === 'number' ? height : height[p]));
  if (distance && distance > 1 && peaks.length) {
    const m = peaks.length, keep = new Uint8Array(m).fill(1), d = Math.ceil(distance);
    const order = Array.from({ length: m }, (_, k) => k).sort((a, b) => x[peaks[a]] - x[peaks[b]]);
    for (let j = m - 1; j >= 0; j--) {
      const k = order[j]; if (!keep[k]) continue;
      for (let l = k - 1; l >= 0 && peaks[k] - peaks[l] < d; l--) keep[l] = 0;
      for (let l = k + 1; l < m && peaks[l] - peaks[k] < d; l++) keep[l] = 0;
    }
    peaks = peaks.filter((_, k) => keep[k]);
  }
  return peaks;
}

/* ============================================================ onsets */
function fluxEnv(x, nfft, hop, fmin, fmax) {
  let pk = 0; for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > pk) pk = v; }
  const nFrames = 1 + Math.ceil(x.length / hop);
  if (pk < 1e-6) return new Float32Array(Math.max(nFrames, 2));
  const inv = 1 / pk, bins = (nfft >> 1) + 1, binHz = SR / nfft;
  const k0 = fmin ? Math.ceil(fmin / binHz) : 0, k1 = fmax ? Math.min(bins - 1, Math.floor(fmax / binHz)) : bins - 1;
  const xs = new Float32Array(x.length); for (let i = 0; i < x.length; i++) xs[i] = x[i] * inv;
  const env = new Float32Array(nFrames), prev = new Float32Array(bins), cur = new Float32Array(bins), c = 10 / (nfft / 2);
  stftMag(xs, nfft, hop, (f, mag) => {
    let s = 0;
    for (let k = k0; k <= k1; k++) { const l = Math.log1p(mag[k] * c); cur[k] = l; if (f > 0) { const d = l - prev[k]; if (d > 0) s += d; } }
    env[f] = s; prev.set(cur);
  });
  return env;
}
function pickOnsets(env, hop, minGap, delta, winS = 0.4) {
  if (env.length < 3) return [];
  const w = Math.max(3, Math.floor(winS * SR / hop)), local = uniformFilter(env, w), p99 = percentile(env, 99);
  const thr = new Float32Array(env.length);
  for (let i = 0; i < env.length; i++) thr[i] = local[i] * 1.5 + delta * p99;
  return findPeaks(env, thr, Math.max(1, Math.floor(minGap * SR / hop)));
}
function detectOnsets(x, o = {}) {
  const nfft = o.nfft || 1024, hop = o.hop || 256, delta = o.delta ?? 0.1, minGap = o.minGap ?? 0.03, smooth = o.smooth || 32;
  const env = fluxEnv(x, nfft, hop, o.fmin, o.fmax), pk = pickOnsets(env, hop, minGap, delta);
  if (!pk.length) return { pos: [], strength: [] };
  const ae = uniformFilter(absArr(x), smooth), pairs = [];
  for (const f of pk) {
    const c = f * hop, a = Math.max(0, c - nfft), b = Math.min(x.length, c + nfft + smooth);
    let pos = c;
    if (b - a > smooth) {
      let best = -Infinity, bi = 0;
      for (let i = 0; i < b - a - smooth; i++) { const d = ae[a + i + smooth] - ae[a + i]; if (d > best) { best = d; bi = i; } }
      pos = Math.max(0, a + bi + (smooth >> 1) - 8);
    }
    pairs.push([pos, env[f]]);
  }
  pairs.sort((p, q) => p[0] - q[0]);
  const pos = [], strength = [];
  for (const [p, s] of pairs) if (!pos.length || p - pos[pos.length - 1] > Math.floor(0.01 * SR)) { pos.push(p); strength.push(s); }
  return { pos, strength };
}
function energyOnsets(x, o = {}) {
  const win = o.win ?? 0.02, hop = o.hop ?? 0.005, look = o.look ?? 0.04, riseDb = o.riseDb ?? 4, minGap = o.minGap ?? 0.06;
  const floorDb = o.floorDb ?? -45, smooth = o.smooth ?? 441;
  const hw = Math.max(3, Math.floor(win * SR)), hp = Math.max(1, Math.floor(hop * SR));
  const sq = new Float32Array(x.length); for (let i = 0; i < x.length; i++) sq[i] = x[i] * x[i];
  const e = uniformFilter(sq, hw), nd = Math.ceil(x.length / hp), edb = new Float32Array(nd);
  for (let i = 0; i < nd; i++) edb[i] = 20 * Math.log10(Math.sqrt(Math.max(e[i * hp], 0)) + 1e-6);
  const k = Math.max(1, Math.floor(look / hop));
  if (nd <= k + 2) return [];
  const ref = percentile(edb, 95), d = new Float32Array(nd - k);
  for (let i = 0; i < nd - k; i++) d[i] = edb[i + k] - edb[i];
  const pk = findPeaks(d, riseDb, Math.max(1, Math.floor(minGap / hop))).filter((p) => edb[p + k] > ref + floorDb);
  const ae = uniformFilter(absArr(x), smooth), pos = [];
  for (const i of pk) {
    const a = i * hp, b = Math.min(x.length, (i + k) * hp + hw + smooth);
    if (b - a <= smooth) continue;
    let best = -Infinity, bi = 0;
    for (let j = 0; j < b - a - smooth; j++) { const dd = ae[a + j + smooth] - ae[a + j]; if (dd > best) { best = dd; bi = j; } }
    pos.push(Math.max(0, a + bi + (smooth >> 1) - 8));
  }
  pos.sort((p, q) => p - q);
  const out = [];
  for (const p of pos) if (!out.length || p - out[out.length - 1] > Math.floor(minGap * SR)) out.push(p);
  return out;
}

/* ============================================================ tempo y rejilla */
const normEnv = (e) => { const p = percentile(e, 95); const o = new Float32Array(e.length); for (let i = 0; i < e.length; i++) o[i] = p > 0 ? e[i] / p : e[i]; return o; };
function interp(arr, t) {
  if (t <= 0) return arr[0];
  const i = Math.floor(t); if (i >= arr.length - 1) return arr[arr.length - 1];
  const f = t - i; return arr[i] * (1 - f) + arr[i + 1] * f;
}
function comb(env, fps, bpm, nPhase = 48) {
  const P = fps * 60 / bpm, K = Math.floor((env.length - 1) / P);
  if (K < 4) return [0, 0];
  let best = -1, bp = 0;
  for (let q = 0; q < nPhase; q++) {
    const ph = P * q / nPhase; let s = 0;
    for (let k = 0; k < K; k++) s += interp(env, ph + P * k);
    s /= K; if (s > best) { best = s; bp = ph; }
  }
  return [best, bp];
}
function estimateTempo(env, fps, hint) {
  const n = env.length, det = uniformFilter(env, Math.max(3, Math.floor(fps))), e = new Float32Array(n);
  for (let i = 0; i < n; i++) e[i] = Math.max(env[i] - det[i], 0);
  let centre, span;
  if (hint) { centre = hint; span = 0.012; }
  else {
    const size = nextPow2(2 * n), re = new Float64Array(size), im = new Float64Array(size), fft = getFFT(size);
    re.set(e); fft.forward(re, im);
    for (let i = 0; i < size; i++) { re[i] = re[i] * re[i] + im[i] * im[i]; im[i] = 0; }
    fft.inverse(re, im);
    const ac = new Float32Array(n), a0 = re[0] + 1e-9; for (let i = 0; i < n; i++) ac[i] = re[i] / a0;
    let bestS = -Infinity; centre = 110;
    for (let bpm = 55; bpm < 200; bpm += 0.25) {
      let s = 0;
      for (const [m, w] of [[1, 1], [2, 0.5], [4, 0.25]]) { const lag = fps * 60 / bpm * m; if (lag < n - 1) s += w * interp(ac, lag); }
      s *= Math.exp(-0.5 * Math.pow(Math.log2(bpm / 110) / 0.9, 2));
      if (s > bestS) { bestS = s; centre = bpm; }
    }
    span = 0.03;
  }
  const es = uniformFilter(e, 3);
  let best = [-1, centre, 0];
  for (let bpm = centre * (1 - span); bpm <= centre * (1 + span) + 1e-9; bpm += centre * 0.0006) {
    const [s, ph] = comb(es, fps, bpm); if (s > best[0]) best = [s, bpm, ph];
  }
  return [best[1], best[2] / fps];
}
function refineGrid(onsetT, t0, T, iters = 3) {
  if (onsetT.length < 12) return [t0, T];
  let sub = T / 4;
  for (let it = 0; it < iters; it++) {
    const xs = [], ys = [];
    for (const t of onsetT) {
      const g = (t - t0) / sub, idx = Math.round(g), err = (g - idx) * sub;
      if (Math.abs(err) < Math.min(0.035, sub / 3)) { xs.push(idx); ys.push(t); }
    }
    if (xs.length < 12) break;
    const n = xs.length; let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
    const den = n * sxx - sx * sx; if (Math.abs(den) < 1e-9) break;
    const subn = (n * sxy - sx * sy) / den, t0n = (sy - subn * sx) / n;
    if (subn <= 0 || Math.abs(subn * 4 / T - 1) > 0.02) break;
    t0 = t0n; T = subn * 4; sub = subn;
  }
  return [t0, T];
}
/* Sigue las pequeñas variaciones de tempo (PLL sobre los golpes): la rejilla deja de ser rígida. */
function trackBeats(onT, onS, t0, T, duration) {
  const thr = onS.length ? percentile(onS, 50) * 0.5 : 0, beats = [];
  let t = t0, Tl = T, j = 0;
  while (t < duration) {
    while (j < onT.length && onT[j] < t - 0.045) j++;
    let best = -1, bs = 0;
    for (let k = j; k < onT.length && onT[k] <= t + 0.045; k++) { const s = onS[k] * (1 - Math.abs(onT[k] - t) / 0.09); if (onS[k] >= thr && s > bs) { bs = s; best = k; } }
    if (best >= 0) { const err = onT[best] - t; t += 0.5 * err; Tl = clip(Tl + 0.08 * err, T * 0.97, T * 1.03); } else Tl += 0.02 * (T - Tl);
    beats.push(t); t += Tl;
  }
  return beats;
}
/* Curva de tempo local (autocorrelación por ventanas + Viterbi) y seguimiento de pulsos por programación dinámica:
 * encuentra la secuencia de pulsos que mejor casa con los golpes permitiendo que el tempo cambie a lo largo de la canción. */
function localPeriods(e, fps, P0) {
  const n = e.length, win = Math.floor(12 * fps), hop = Math.floor(2 * fps), l0 = Math.max(4, Math.floor(P0 / 1.18)), l1 = Math.ceil(P0 * 1.18), nl = l1 - l0 + 1;
  const centers = [], S = [];
  for (let a = 0; a === 0 || a + win / 2 < n; a += hop) {
    const b = Math.min(n, a + win), row = new Float64Array(nl); let z = 1e-9; for (let i = a; i < b; i++) z += e[i] * e[i];
    for (let l = l0; l <= l1; l++) {
      let s = 0;
      for (const [m, wt] of [[1, 1], [2, 0.5], [4, 0.25]]) { const lag = l * m; if (lag >= b - a) continue; let c = 0; for (let i = a; i + lag < b; i++) c += e[i] * e[i + lag]; s += wt * c / z * ((b - a) / (b - a - lag)); }
      row[l - l0] = s;
    }
    centers.push((a + b) / 2); S.push(row);
    if (b >= n) break;
  }
  const W = S.length, cost = S.map((r) => Float64Array.from(r)), back = S.map(() => new Int32Array(nl)), lam = 150;
  for (let w = 1; w < W; w++) for (let j = 0; j < nl; j++) {
    let best = -Infinity, bi = 0;
    for (let k = Math.max(0, j - 4); k <= Math.min(nl - 1, j + 4); k++) { const d = Math.log((l0 + j) / (l0 + k)), v = cost[w - 1][k] - lam * d * d; if (v > best) { best = v; bi = k; } }
    cost[w][j] = S[w][j] + best; back[w][j] = bi;
  }
  const path = new Float64Array(W); let j = 0; for (let k = 1; k < nl; k++) if (cost[W - 1][k] > cost[W - 1][j]) j = k;
  for (let w = W - 1; w >= 0; w--) {
    const r = S[w]; let d = 0; if (j > 0 && j < nl - 1) { const den = r[j - 1] - 2 * r[j] + r[j + 1]; if (den < 0) d = clip(0.5 * (r[j - 1] - r[j + 1]) / den, -0.5, 0.5); }
    path[w] = l0 + j + d; j = back[w][j];
  }
  const per = new Float32Array(n);
  for (let i = 0, w = 0; i < n; i++) {
    while (w + 1 < W && centers[w + 1] <= i) w++;
    if (i <= centers[0] || w + 1 >= W) per[i] = path[i <= centers[0] ? 0 : W - 1];
    else { const f = (i - centers[w]) / (centers[w + 1] - centers[w]); per[i] = path[w] * (1 - f) + path[w + 1] * f; }
  }
  return per;
}
function trackBeatsDP(env, fps, P0, ons, duration) {
  const n = env.length, det = uniformFilter(env, Math.max(3, Math.floor(fps))), e0 = new Float32Array(n);
  let v = 1e-12; for (let i = 0; i < n; i++) { e0[i] = Math.max(env[i] - det[i], 0); v += e0[i] * e0[i]; }
  const sd = Math.sqrt(v / n), e = uniformFilter(e0, 3); for (let i = 0; i < n; i++) e[i] /= sd;
  const per = localPeriods(e, fps, P0), cum = new Float32Array(n), back = new Int32Array(n).fill(-1), tight = 100;
  for (let t = 0; t < n; t++) {
    const P = per[t], a = Math.max(0, Math.round(t - 2 * P)), b = Math.round(t - P / 2); let best = 0, bi = -1;
    for (let p = a; p <= b; p++) { const d = Math.log((t - p) / P), s = cum[p] - tight * d * d; if (s > best) { best = s; bi = p; } }
    cum[t] = e[t] + best; back[t] = bi;
  }
  let last = n - 1; { const a = Math.max(0, Math.floor(n - 1.2 * per[n - 1])); for (let t = a; t < n; t++) if (cum[t] > cum[last]) last = t; }
  const fr = []; for (let t = last; t >= 0; t = back[t]) fr.push(t);
  fr.reverse();
  const beats = fr.map((f) => f / fps);
  // afinado: cada pulso se acerca al golpe fuerte más próximo (la DP va a saltos de ~6 ms)
  const thr = ons.s.length ? percentile(ons.s, 50) * 0.5 : 0; let j = 0;
  for (let k = 0; k < beats.length; k++) {
    const t = beats[k]; while (j < ons.t.length && ons.t[j] < t - 0.03) j++;
    let bi = -1, bs = 0; for (let q = j; q < ons.t.length && ons.t[q] <= t + 0.03; q++) { const s = ons.s[q] * (1 - Math.abs(ons.t[q] - t) / 0.06); if (ons.s[q] >= thr && s > bs) { bs = s; bi = q; } }
    if (bi >= 0) beats[k] = t + 0.7 * (ons.t[bi] - t);
  }
  while (beats.length > 1 && beats[0] - (beats[1] - beats[0]) >= 0) beats.unshift(beats[0] - (beats[1] - beats[0]));
  while (beats.length > 1 && beats[beats.length - 1] + (beats[beats.length - 1] - beats[beats.length - 2]) < duration) beats.push(2 * beats[beats.length - 1] - beats[beats.length - 2]);
  return beats;
}
function pickDownbeat(beats, drums, bass, harm) {
  const hop = 256, ek = normEnv(fluxEnv(drums, 2048, hop, 0, 200)), eb = normEnv(fluxEnv(bass, 2048, hop, 0, 300));
  const n = Math.min(ek.length, eb.length), w = Math.max(1, Math.floor(0.03 * SR / hop)), sums = [0, 0, 0, 0], cnt = [0, 0, 0, 0], hs = [0, 0, 0, 0];
  let prev = null;
  beats.forEach((t, k) => {
    const c = Math.floor(t * SR / hop);
    if (c - w >= 0 && c + w < n) { let m = 0; for (let i = c - w; i <= c + w; i++) m = Math.max(m, ek[i] + 0.5 * eb[i]); sums[k % 4] += m; cnt[k % 4]++; }
    if (harm && k + 1 < beats.length) {                           // los acordes suelen cambiar en el tiempo 1
      const a = Math.floor(t * SR), b = Math.min(harm.length, Math.floor(beats[k + 1] * SR));
      const ch = b - a >= 8192 ? chromaMean(harm.subarray(a, b)) : null;
      if (ch && prev && ch.some((v) => v > 0) && prev.some((v) => v > 0)) hs[k % 4] += 1 - cosSim(prev, ch);
      prev = ch;
    }
  });
  const kv = sums.map((s, i) => s / Math.max(cnt[i], 1)), km = Math.max(...kv, 1e-9), hm = Math.max(...hs, 1e-9);
  let bi = 0, bv = -1; for (let i = 0; i < 4; i++) { const v = kv[i] / km + 0.8 * hs[i] / hm; if (v > bv) { bv = v; bi = i; } }
  return bi;
}
function findGrid(mix, drums, bass, harm, ons, duration, hint) {
  const hop = 256, e1 = normEnv(fluxEnv(mix, 1024, hop)), e2 = normEnv(fluxEnv(drums, 1024, hop));
  const n = Math.min(e1.length, e2.length), env = new Float32Array(n); for (let i = 0; i < n; i++) env[i] = e1[i] + e2[i];
  const [bpm, phase] = estimateTempo(env, SR / hop, hint);
  let T = 60 / bpm, t0;
  [t0, T] = refineGrid(ons.t, phase, T);
  if (hint && Math.abs(60 / T - hint) / hint > 0.012) T = 60 / hint;
  t0 = ((t0 % T) + T) % T;
  let beats = trackBeatsDP(env, SR / hop, T * SR / hop, ons, duration);
  if (beats.length < 8) beats = trackBeats(ons.t, ons.s, t0, T, duration);
  else { const d = beats.slice(1).map((t, i) => t - beats[i]); T = percentile(d, 50); }
  const db = beats.length >= 8 ? pickDownbeat(beats, drums, bass, harm) : 0;
  return { bpm: 60 / T, T, beats, db, beat0: beats[0] ?? t0, bar0: beats[db] ?? t0 };
}

/* ============================================================ croma / tonalidad */
function chromaMean(x, nfft = 8192, hop = 4096, fmin = 90, fmax = 5000) {
  const bins = (nfft >> 1) + 1, pc = new Int8Array(bins).fill(-1), binHz = SR / nfft;
  for (let k = 0; k < bins; k++) { const f = k * binHz; if (f >= fmin && f <= fmax) pc[k] = (((Math.round(69 + 12 * Math.log2(f / 440)) % 12) + 12) % 12); }
  const c = new Float64Array(12); let frames = 0;
  stftMag(x, nfft, hop, (f, mag) => { frames++; for (let k = 0; k < bins; k++) if (pc[k] >= 0) c[pc[k]] += mag[k]; });
  return Array.from(c, (v) => v / Math.max(frames, 1));
}
function pearson(a, b) {
  const n = a.length; let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
  let d = 0, va = 0, vb = 0; for (let i = 0; i < n; i++) { d += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; }
  return d / (Math.sqrt(va * vb) + 1e-12);
}
function estimateKey(c12, prefer, bias = 0.04) {
  let best = [-2, 0, 'maj'];
  for (const [mode, prof] of [['maj', KS_MAJ], ['min', KS_MIN]]) {
    for (let t = 0; t < 12; t++) {
      const rolled = prof.map((_, i) => prof[(i - t + 12) % 12]);
      let r = pearson(c12, rolled);
      if (prefer && prefer[0] === t && prefer[1] === mode) r += bias;
      if (r > best[0]) best = [r, t, mode];
    }
  }
  return [best[1], best[2], best[0]];
}
const keyName = (t, m) => (m === 'min' ? `${NOTE_NAMES[t]}m` : `${NOTE_NAMES[t]}maj`);

/* ============================================================ golpes de batería */
const D_CLASSES = ['kick', 'snare', 'hat_closed', 'hat_open', 'tom', 'cymbal'];
const D_MAXLEN = { kick: 0.9, snare: 0.6, hat_closed: 0.25, hat_open: 0.9, tom: 0.9, cymbal: 2.5 };
const D_MINLEN = { kick: 0.08, snare: 0.08, hat_closed: 0.025, hat_open: 0.12, tom: 0.10, cymbal: 0.30 };
const D_KEEP = { kick: 8, snare: 8, hat_closed: 6, hat_open: 4, tom: 6, cymbal: 4 };
const PART_OF = { kick: 0, snare: 1, hat_closed: 2, hat_open: 2, cymbal: 2, perc: 2, tom: 3 }, PART_NAMES = ['Kick', 'Snare', 'Hats', 'Toms'];
const DUP_COS = 0.99, PRE_ROLL = 0.0015, DN = 4096;
const D_EDGES = Array.from({ length: 25 }, (_, i) => 30 * Math.pow(16000 / 30, i / 24));
const D_WIN = (() => { const w = new Float32Array(DN); for (let i = 0; i < 64; i++) w[i] = i / 63; for (let i = 64; i < DN; i++) w[i] = 0.5 * (1 + Math.cos(Math.PI * (i - 64) / (DN - 65))); return w; })();
const D_BAND = (() => { const b = new Int8Array(DN / 2 + 1).fill(-1); for (let k = 0; k < b.length; k++) { const f = k * SR / DN; for (let i = 0; i < 24; i++) if (f >= D_EDGES[i] && f < D_EDGES[i + 1]) { b[k] = i; break; } } return b; })();

function drumFeatures(seg) {
  const fft = getFFT(DN), re = new Float64Array(DN), im = new Float64Array(DN), m = Math.min(seg.length, DN);
  for (let i = 0; i < m; i++) re[i] = seg[i] * D_WIN[i];
  fft.forward(re, im);
  const bins = DN / 2 + 1, spec = new Float64Array(bins); let tot = 1e-12;
  for (let k = 0; k < bins; k++) { spec[k] = re[k] * re[k] + im[k] * im[k]; tot += spec[k]; }
  const hz = SR / DN, band = (lo, hi) => { let s = 0; for (let k = 0; k < bins; k++) { const f = k * hz; if (f >= lo && f < hi) s += spec[k]; } return s / tot; };
  let cen = 0, fpk = 0, pv = -1; const be = new Float64Array(24);
  for (let k = 0; k < bins; k++) {
    const f = k * hz; cen += f * spec[k];
    if (D_BAND[k] >= 0) be[D_BAND[k]] += spec[k];
    if (f >= 25 && f <= 600 && spec[k] > pv) { pv = spec[k]; fpk = f; }
  }
  const vec = Array.from(be, Math.sqrt), nrm = Math.sqrt(vec.reduce((a, v) => a + v * v, 0)) + 1e-12;
  let ls = 0, as = 0, nb = 0; for (let k = 0; k < bins; k++) { const f = k * hz; if (f >= 200 && f < 8000) { ls += Math.log(spec[k] + 1e-18); as += spec[k]; nb++; } }
  const flat = nb ? Math.exp(ls / nb) / (as / nb + 1e-18) : 0;
  return { flat, low: band(20, 140), body: band(100, 500), mid: band(150, 8000), hi: band(5000, 20000), centroid: cen / tot, fpk, vec: vec.map((v) => v / nrm) };
}
function decayInfo(seg) {
  const env = uniformFilter(absArr(seg), Math.max(3, Math.floor(0.004 * SR))), lim = Math.min(env.length, Math.floor(0.03 * SR) + 1);
  let ref = 0, pk = 0; for (let i = 0; i < lim; i++) if (env[i] > ref) { ref = env[i]; pk = i; }
  ref += 1e-12;
  let t30 = seg.length / SR, t50 = null;
  for (let i = pk; i < env.length; i++) { if (env[i] < ref * 0.0316) { t30 = i / SR; break; } }
  for (let i = pk; i < env.length; i++) { if (env[i] < ref * 0.00316) { t50 = i; break; } }
  return { t30, t50, ref, env };
}
let DEBUG_CLS = null;
function classifyHit(f, decayLen) {
  if (f.hi > 0.5 || f.centroid > 5000) return [decayLen < 0.14 ? 'hat_closed' : decayLen < 0.7 ? 'hat_open' : 'cymbal', f.hi];
  if (f.low > 0.5 && f.fpk < 100) return ['kick', f.low];
  if (f.centroid < 1000 && f.body + f.low > 0.6) return ['tom', Math.min(1, f.body + f.low)];
  // caja: cuerpo (100-500 Hz) + bordonera; un soplido sin cuerpo o casi ruido blanco plano es "perc"/ruido, no caja
  if (DEBUG_CLS) DEBUG_CLS.push([f.body, f.flat, f.mid]);
  if (f.body < 0.05 || f.flat > 0.58 || f.mid < 0.5) return ['perc', 0];
  return ['snare', clip(f.mid - 0.6 * f.low - 0.4 * Math.max(0, f.hi - 0.35), 0, 1)];
}
/* Busca el ataque más marcado en [p-back, p+fwd] y devuelve el punto tranquilo justo ANTES de que empiece a subir (-1 si no hay ataque). */
function attackStart(x, p, back, fwd, level) {
  const st = 22, win = 110, a = Math.max(0, Math.floor(p - back * SR)), b = Math.min(x.length - win, Math.floor(p + fwd * SR)), n = Math.floor((b - a) / st);
  if (n < 8) return -1;
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; const o = a + i * st; for (let k = 0; k < win; k++) s += Math.abs(x[o + k]); env[i] = s / win; }
  const lag = 6; let rise = 0, ri = -1;                           // subida en ~3 ms
  for (let i = 0; i + lag < n; i++) { const d = env[i + lag] - env[i]; if (d > rise) { rise = d; ri = i; } }
  if (ri < 0 || rise < 0.06 * level || env[ri + lag] < 1.6 * env[ri]) return -1;
  let q = ri;   // retrocede hasta el último punto todavía tranquilo
  while (q > 0 && env[q - 1] < env[q] * 0.985 && ri - q < 50) q--;   // baja por la rampa del ataque hasta el valle previo
  return Math.max(0, a + q * st + (win >> 1) - 2 * st);
}
function preOnset(x, p, back = 0.02) {
  let lvl = 0; const a = Math.max(0, Math.floor(p - 0.01 * SR)), b = Math.min(x.length, Math.floor(p + 0.03 * SR));
  for (let i = a; i < b; i++) lvl = Math.max(lvl, Math.abs(x[i]));
  const q = attackStart(x, p, back, 0.012, lvl * 0.5);
  return q >= 0 ? q : Math.max(0, Math.floor(p) - 110);
}
/* Separa el stem de batería en piezas (bombo, caja, hats/platos, toms) con máscaras por bandas según qué golpe "posee" cada banda. */
function splitDrums(x, all) {
  const nfft = 1024, hop = 256, bins = nfft / 2 + 1, nF = 1 + Math.ceil(x.length / hop), kLow = 3, kHi = Math.round(5000 / (SR / nfft));
  const lowO = new Int8Array(nF).fill(-1), midO = new Int8Array(nF).fill(-1), hiO = new Int8Array(nF).fill(-1);
  let lo = -1, mi = -1, hi = -1, j = 0;
  for (let f = 0; f < nF; f++) {
    while (j < all.length && Math.floor(all[j][0] * SR / hop) - 1 <= f) {
      const c = all[j][1], p = PART_OF[c]; hi = p;
      if (c !== 'hat_closed' && c !== 'hat_open' && c !== 'cymbal') mi = p;
      if (c === 'kick' || c === 'tom') lo = p;
      j++;
    }
    lowO[f] = lo < 0 ? (mi < 0 ? hi : mi) : lo; midO[f] = mi < 0 ? hi : mi; hiO[f] = hi;
  }
  const parts = [0, 1, 2, 3].map(() => new Float32Array(x.length)), BL = 1 << 20, PAD = 4 * nfft;
  for (let s = 0; s < x.length; s += BL) {
    const a = Math.max(0, s - PAD), a0 = a - (a % hop), b = Math.min(x.length, s + BL + PAD), S = stftComplex(x.subarray(a0, b), nfft, hop), f0 = a0 / hop;
    const mask = new Float32Array(S.nFrames * bins);
    for (let p = 0; p < 4; p++) {
      let any = false;
      for (let f = 0; f < S.nFrames; f++) {
        const g = Math.min(nF - 1, f0 + f), l = lowO[g] === p ? 1 : 0, m = midO[g] === p ? 1 : 0, h = hiO[g] === p ? 1 : 0, o = f * bins;
        if (l || m || h) any = true;
        for (let k = 0; k < bins; k++) mask[o + k] = k < kLow ? l : k < kHi ? m : h;
      }
      if (!any) continue;
      const y = istftMasked(S, mask, nfft, hop, b - a0, false), e = Math.min(x.length, s + BL);
      parts[p].set(y.subarray(s - a0, e - a0), s);
    }
  }
  return parts;
}
/* Quita el hat que suena a la vez que un bombo/tom/caja: se conserva el ataque completo (el "click") y, pasados unos ms,
 * se filtran los agudos que esa pieza ya no tiene y que solo pueden ser del hat. */
const DEHAT = { kick: [2500, 0.008, 0.025], tom: [4500, 0.010, 0.035], snare: [9000, 0.030, 0.090] };
function deHat(seg, cls) {
  const p = DEHAT[cls]; if (!p || seg.length < 0.03 * SR) return seg;
  const lp = filtfilt(seg, [biquadLow(p[0], 0.707), biquadLow(p[0], 0.707)]), out = new Float32Array(seg.length), a = p[1] * SR, b = p[2] * SR;
  for (let i = 0; i < seg.length; i++) { const g = clip((i - a) / (b - a), 0, 1); out[i] = seg[i] * (1 - g) + lp[i] * g; }
  return out;
}
/* Caja o tom: la caja tiene ruido de bordonera (1,5-9 kHz) que se mantiene tras el ataque; el tom es casi solo nota grave.
 * Se mide tras 12 ms (sin el golpe de baqueta) y se decide comparando los golpes de la propia canción. */
function bodyNoise(x, s) {
  const a = s + Math.floor(0.012 * SR), fft = getFFT(DN), re = new Float64Array(DN), im = new Float64Array(DN), m = Math.min(DN, x.length - a);
  if (m < 512) return 0;
  for (let i = 0; i < m; i++) re[i] = x[a + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (DN - 1)));
  fft.forward(re, im);
  let hi = 0, tot = 1e-18; const hz = SR / DN;
  for (let k = 1; k < DN / 2; k++) { const f = k * hz; if (f < 80 || f > 9000) continue; const p = re[k] * re[k] + im[k] * im[k]; tot += p; if (f >= 1500) hi += p; }
  return hi / tot;
}
function splitSnareTom(x, pre, all) {
  const idx = []; pre.forEach((h, i) => { if (h.cls === 'snare' || h.cls === 'tom') { h.nz = 10 * Math.log10(bodyNoise(x, h.s) + 1e-6); idx.push(i); } });
  if (!idx.length) return;
  const v = idx.map((i) => pre[i].nz); let lo = Math.min(...v), hi = Math.max(...v);
  for (let it = 0; it < 12; it++) { let sl = 0, nl = 0, sh = 0, nh = 0; for (const d of v) { if (Math.abs(d - lo) < Math.abs(d - hi)) { sl += d; nl++; } else { sh += d; nh++; } } if (nl) lo = sl / nl; if (nh) hi = sh / nh; }
  const two = hi - lo >= 7, mid = (hi + lo) / 2, nLow = v.filter((d) => d < mid).length;
  // dos grupos claros: el ruidoso es la caja y el tonal los toms (salvo que el "tonal" sea la gran mayoría: entonces es una caja seca)
  const tomIf = (d) => (two ? d < mid && nLow <= 0.6 * v.length && d < -8 : d < -16);
  for (const i of idx) {
    const h = pre[i], isTom = tomIf(h.nz);
    h.cls = isTom ? 'tom' : 'snare'; h.conf = isTom ? clip(0.5 + (-8 - h.nz) / 20, 0.4, 1) : clip(0.5 + (h.nz + 16) / 20, 0.4, 1);
    all[i][1] = h.cls;
  }
}
function extractDrums(x) {
  const { pos, strength } = detectOnsets(x, { nfft: 1024, hop: 256, delta: 0.1, minGap: 0.03 });
  if (!pos.length) return { hits: [], all: [], onsetT: [], onsetS: [], parts: null };
  const n = x.length, pre = [], all = [];
  let pr = 0; { const a = absArr(x); pr = percentile(a.length > 2e6 ? a.filter((_, i) => i % 7 === 0) : a, 99.9) + 1e-9; }
  pos.forEach((s, i) => {                                         // 1) clasificar cada golpe sobre el stem completo
    const nxt = i + 1 < pos.length ? pos[i + 1] : n, cut = Math.max(s + Math.floor(0.02 * SR), nxt - Math.floor(0.002 * SR));
    const seg = x.subarray(s, Math.min(cut, s + Math.floor(1.5 * SR), n));
    if (seg.length < Math.floor(0.015 * SR)) return;
    const f = drumFeatures(seg), d = decayInfo(seg), [cls, conf] = classifyHit(f, d.t30);
    all.push([s / SR, cls, strength[i]]); pre.push({ s, cls, conf, vec: f.vec, hi: f.hi });
  });
  splitSnareTom(x, pre, all);
  const parts = splitDrums(x, all), cands = [];                   // 2) recortar cada golpe de SU pieza, sin el golpe siguiente
  pre.forEach((h, i) => {
    if (h.cls === 'perc') return;
    const p = PART_OF[h.cls], src = parts[p];
    let nxt = n; for (let k = i + 1; k < pre.length; k++) if (PART_OF[pre[k].cls] === p || pre[k].s - h.s > 3 * SR) { nxt = pre[k].s; break; }
    const hard = nxt < n ? preOnset(src, nxt) : n;            // justo antes del siguiente golpe de la misma pieza
    const lim = Math.min(hard, h.s + Math.floor(D_MAXLEN[h.cls] * SR), n);
    if (lim - h.s < Math.floor(D_MINLEN[h.cls] * SR)) return;
    const seg = src.subarray(h.s, lim), d = decayInfo(seg);
    let end = seg.length; const natural = d.t50 !== null && d.t50 < end; if (natural) end = d.t50;
    if (end / SR < D_MINLEN[h.cls]) return;
    const tail = d.env[Math.min(end, d.env.length - 1)] / d.ref, comp = natural ? 1 : clip((-20 * Math.log10(tail + 1e-9) - 6) / 19, 0, 1);
    const pa = Math.max(0, h.s - Math.floor(0.025 * SR)), pb = Math.max(0, h.s - Math.floor(0.003 * SR));
    const r = pb > pa ? rmsRange(src, pa, pb) / (rmsRange(src, h.s, h.s + Math.floor(0.03 * SR)) + 1e-9) : 0;
    cands.push({ cls: h.cls, conf: h.conf, clean: clip(1 - r / 0.3, 0, 1), comp, lvl: rmsRange(x, h.s, h.s + Math.floor(0.05 * SR)) / pr,
      start: Math.max(0, h.s - Math.floor(PRE_ROLL * SR)), end: h.s + end, natural, vec: h.vec, src, hi: h.hi });
  });
  for (const c of D_CLASSES) {
    const g = cands.filter((h) => h.cls === c); if (!g.length) continue;
    const ref = percentile(g.map((h) => h.lvl), 90) + 1e-9; g.forEach((h) => { h.lvlN = Math.min(1, h.lvl / ref); });
  }
  // hat colado encima del golpe: más agudos (>5 kHz) de lo normal para esa pieza -> se penaliza para elegir los golpes limpios
  const hiRef = {}; for (const c of ['kick', 'snare', 'tom']) { const g = cands.filter((h) => h.cls === c).map((h) => h.hi); if (g.length) hiRef[c] = percentile(g, 25); }
  cands.forEach((h) => {
    h.hat = h.cls in hiRef ? clip((h.hi - hiRef[h.cls]) / (h.cls === 'snare' ? 0.25 : 0.08), 0, 1) : 0;
    h.score = 0.35 * h.conf + 0.30 * h.clean + 0.20 * h.comp + 0.15 * h.lvlN - 0.30 * h.hat;
  });
  const hits = [];
  for (const c of D_CLASSES) {
    // lvlN >= 0.3: descarta ruidos flojos y fantasmas que no son un golpe de verdad
    const g = cands.filter((h) => h.cls === c && h.conf >= 0.4 && h.score >= 0.35 && h.lvlN >= 0.3).sort((a, b) => b.score - a.score), chosen = [];
    for (const h of g) {
      if (chosen.some((o) => cosSim(h.vec, o.vec) > DUP_COS)) continue;
      chosen.push(h); if (chosen.length >= D_KEEP[c]) break;
    }
    for (const h of chosen) hits.push({ cat: c, audio: fade(deHat(h.src.subarray(h.start, h.end), c), 1, h.natural ? 15 : 8), score: h.score });
  }
  return { hits, all, onsetT: Array.from(pos, (p) => p / SR), onsetS: Array.from(strength), parts };
}

/* ============================================================ notas de bajo (YIN) */
const Y_W = 3072, Y_TAUMAX = Math.floor(SR / 30), Y_N = Y_W + Y_TAUMAX;
function yin(frame, fmin = 30, fmax = 420, thr = 0.15) {
  const tauMax = Math.floor(SR / fmin), tauMin = Math.max(2, Math.floor(SR / fmax));
  if (frame.length < Y_W + tauMax) return null;
  const size = 8192, fft = getFFT(size), xr = new Float64Array(size), xi = new Float64Array(size), kr = new Float64Array(size), ki = new Float64Array(size);
  const N = Y_W + tauMax, c2 = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) { xr[i] = frame[i]; c2[i + 1] = c2[i] + frame[i] * frame[i]; }
  for (let i = 0; i < Y_W; i++) kr[i] = frame[i];
  fft.forward(xr, xi); fft.forward(kr, ki);
  for (let i = 0; i < size; i++) { const a = xr[i], b = xi[i]; xr[i] = a * kr[i] + b * ki[i]; xi[i] = b * kr[i] - a * ki[i]; } // X * conj(K)
  fft.inverse(xr, xi);
  const cmnd = new Float64Array(tauMax + 1); cmnd[0] = 1; let run = 0;
  for (let t = 1; t <= tauMax; t++) {
    const d = c2[Y_W] + (c2[Y_W + t] - c2[t]) - 2 * xr[t]; run += d;
    cmnd[t] = d * t / Math.max(run, 1e-12);
  }
  let t = -1;
  for (let i = tauMin; i < tauMax; i++) if (cmnd[i] < thr) { t = i; break; }
  if (t >= 0) { while (t + 1 < tauMax && cmnd[t + 1] < cmnd[t]) t++; }
  else {
    let mi = tauMin; for (let i = tauMin; i < tauMax; i++) if (cmnd[i] < cmnd[mi]) mi = i;
    if (cmnd[mi] > 0.35) return null; t = mi;
  }
  const a = cmnd[t - 1], b = cmnd[t], c = cmnd[t + 1], den = a - 2 * b + c, sh = Math.abs(den) > 1e-12 ? 0.5 * (a - c) / den : 0;
  return [SR / (t + sh), 1 - cmnd[t]];
}
const noteName = (m) => `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
function extractBassNotes(x, maxNotes = 24) {
  const pos = energyOnsets(x), best = {};
  pos.forEach((s, i) => {
    const nxt = i + 1 < pos.length ? pos[i + 1] : x.length, avail = Math.min(nxt - Math.floor(0.003 * SR), s + Math.floor(2.5 * SR)) - s;
    if (avail < Math.floor(0.15 * SR)) return;
    const a0 = Math.max(0, s - Math.floor(0.002 * SR)), full = x.subarray(a0, s + avail);
    const sq = new Float32Array(full.length); for (let j = 0; j < sq.length; j++) sq[j] = full[j] * full[j];
    const env = uniformFilter(sq, Math.floor(0.05 * SR)).map((v) => Math.sqrt(Math.max(v, 0)));
    let emax = 0; for (let j = 0; j < env.length; j++) if (env[j] > emax) emax = env[j];
    const off = Math.floor(0.05 * SR); let sil = -1, low = -1;
    for (let j = off; j < env.length; j++) { if (sil < 0 && env[j] < emax * 0.0178) sil = j - off; if (env[j] < emax * 0.0056) { low = j - off; break; } }
    const active = sil < 0 ? avail : Math.min(avail, off + sil);
    if (active < Math.floor(0.15 * SR)) return;
    const first = s + Math.floor(0.04 * SR), last = s + active - Y_N;
    if (last < first) return;
    const k = 1 + Math.min(2, Math.floor((last - first) / (0.1 * SR))), f0s = [], confs = [];
    for (let q = 0; q < k; q++) {
      const p = k === 1 ? first : Math.floor(first + (last - first) * q / (k - 1)), r = yin(x.subarray(p, p + Y_N));
      if (!r) return; f0s.push(r[0]); confs.push(r[1]);
    }
    const midis = f0s.map((f) => 69 + 12 * Math.log2(f / 440)), sorted = [...midis].sort((p, q) => p - q), med = sorted[sorted.length >> 1];
    const spread = Math.max(...midis.map((m) => Math.abs(m - med))) * 100;
    if (spread > 60) return;
    const note = Math.round(med), cents = Math.abs(med - note) * 100;
    if (note < 23 || note > 68) return;
    const pre = rmsRange(x, s - Math.floor(0.025 * SR), s - Math.floor(0.003 * SR)), post = rmsRange(x, s, s + Math.floor(0.06 * SR));
    const clean = clip(1 - (s - Math.floor(0.025 * SR) > 0 ? pre / (post + 1e-9) : 0) / 0.5, 0, 1);
    const score = 0.35 * (confs.reduce((p, q) => p + q, 0) / confs.length) + 0.2 * clip(1 - spread / 60, 0, 1) + 0.15 * clip(1 - cents / 50, 0, 1)
      + 0.15 * clean + 0.15 * Math.min(1, avail / SR);
    if (!best[note] || score > best[note].score) {
      const seg = low >= 0 ? full.subarray(0, off + low) : full;
      best[note] = { cat: 'bass_note', label: noteName(note), rank: note, audio: fade(seg, 1.5, 25), score };
    }
  });
  return Object.values(best).sort((a, b) => b.score - a.score).slice(0, maxNotes).sort((a, b) => a.rank - b.rank);
}

/* ============================================================ acordes */
const QUALITIES = [['', [0, 4, 7], 0], ['m', [0, 3, 7], 0], ['7', [0, 4, 7, 10], -0.03], ['m7', [0, 3, 7, 10], -0.02], ['maj7', [0, 4, 7, 11], -0.03]];
const TEMPLATES = (() => {
  const out = [];
  for (let root = 0; root < 12; root++) QUALITIES.forEach(([suf, iv, bias], qi) => {
    const t = new Float64Array(12); iv.forEach((k) => { t[(root + k) % 12] = 1; }); t[root] = 1.2;
    const nrm = Math.sqrt(t.reduce((a, v) => a + v * v, 0)); out.push({ root, qi, name: NOTE_NAMES[root] + suf, t: Array.from(t, (v) => v / nrm), bias });
  });
  return out;
})();
function extractChords(x, grid, duration, maxChords = 16) {
  const T = grid.T; let nb = Math.max(2, Math.ceil(0.9 / T)), segLen = nb * T;
  if (segLen > 3) { nb = Math.max(1, Math.floor(3 / T)); segLen = nb * T; }
  const onsT = detectOnsets(x, { nfft: 2048, hop: 256, delta: 0.1, minGap: 0.05 }).pos.map((p) => p / SR);
  const gb = grid.beats, nBeats = gb.length - 1, brms = [];
  for (let k = 0; k < nBeats; k++) brms.push(rmsRange(x, gb[k] * SR, gb[k + 1] * SR));
  const ref = brms.length ? percentile(brms, 95) + 1e-9 : 1, best = {};
  for (let k = 0; k < nBeats - nb; k++) {
    let t = gb[k];
    if (onsT.length) { let bj = 0; onsT.forEach((o, j) => { if (Math.abs(o - t) < Math.abs(onsT[bj] - t)) bj = j; }); if (Math.abs(onsT[bj] - t) < 0.06) t = onsT[bj]; }
    const a = Math.floor(t * SR), b = Math.floor((t + segLen) * SR); if (b > x.length) break;
    const seg = x.subarray(a, b), lvl = rmsRange(seg, 0, seg.length) / ref; if (lvl < 0.15) continue;
    const mid = seg.length >> 1, c1 = chromaMean(seg.subarray(0, mid)), c2 = chromaMean(seg.subarray(mid)), c = c1.map((v, i) => v + c2[i]), stab = cosSim(c1, c2);
    let bm = null; for (const tp of TEMPLATES) { const s = cosSim(c, tp.t) + tp.bias; if (!bm || s > bm.s) bm = { s, ...tp }; }
    if (bm.s < 0.80 || stab < 0.85) continue;
    const score = 0.5 * Math.min(1, bm.s) + 0.3 * stab + 0.2 * Math.min(1, lvl);
    if (!best[bm.name] || score > best[bm.name].score) best[bm.name] = { cat: 'chord', label: bm.name, rank: bm.root * 10 + bm.qi, audio: fade(seg, 3, 60), score };
  }
  return Object.values(best).sort((p, q) => q.score - p.score).slice(0, maxChords).sort((p, q) => p.rank - q.rank);
}

/* ============================================================ loops y breaks */
const L_BANDS = Array.from({ length: 17 }, (_, i) => 40 * Math.pow(300, i / 16));
const PLANS = { break: { 1: 2, 2: 3, 4: 3, 8: 1 }, bass_loop: { 1: 2, 2: 3, 4: 2 }, inst_loop: { 1: 2, 2: 3, 4: 3, 8: 1 } };
const MIN_COV = { break: 0.85, bass_loop: 0.7, inst_loop: 0.7 };
function bandFrames(x) {
  const nfft = 2048, hop = 512, bins = nfft / 2 + 1, band = new Int8Array(bins).fill(-1), nF = 1 + Math.ceil(x.length / hop), B = new Float32Array(16 * nF);
  for (let k = 0; k < bins; k++) { const f = k * SR / nfft; for (let i = 0; i < 16; i++) if (f >= L_BANDS[i] && f < L_BANDS[i + 1]) { band[k] = i; break; } }
  stftMag(x, nfft, hop, (f, mag) => { for (let k = 0; k < bins; k++) if (band[k] >= 0) B[band[k] * nF + f] += mag[k]; });
  return { B, nF, fps: SR / hop };
}
/* Descripción por compases de un stem: actividad, timbre por bandas y fronteras de sección. */
function stemBars(x, grid) {
  const gb = grid.beats.slice(grid.db), nBars = Math.floor((gb.length - 1) / 4), nBeat = nBars * 4, beatT = gb.slice(0, nBeat + 1);
  const brms = [], active = [];
  for (let i = 0; i < nBeat; i++) brms.push(rmsRange(x, Math.floor(beatT[i] * SR), Math.floor(beatT[i + 1] * SR)));
  const ref = percentile(brms, 95) + 1e-9; brms.forEach((v) => active.push(v > 0.05 * ref ? 1 : 0));
  const { B, nF, fps } = bandFrames(x), cs = [];
  for (let b = 0; b < 16; b++) { const c = new Float64Array(nF + 1); for (let i = 0; i < nF; i++) c[i + 1] = c[i] + B[b * nF + i]; cs.push(c); }
  const feat = [];
  for (let i = 0; i < nBeat; i++) {
    const fa = clip(Math.floor(beatT[i] * fps), 0, nF), fb = clip(Math.max(Math.floor(beatT[i + 1] * fps), fa + 1), 0, nF), row = new Float64Array(16);
    for (let b = 0; b < 16; b++) row[b] = Math.sqrt(Math.max((cs[b][fb] - cs[b][fa]) / Math.max(fb - fa, 1), 0));
    feat.push(row);
  }
  const barVec = [], barLvl = [], barAct = [];
  for (let b = 0; b < nBars; b++) {
    const v = new Float64Array(16); let l = 0, a = 0;
    for (let i = b * 4; i < b * 4 + 4; i++) { for (let k = 0; k < 16; k++) v[k] += feat[i][k]; l += brms[i]; a += active[i]; }
    barVec.push(v); barLvl.push(l / 4); barAct.push(a);
  }
  const bounds = new Set([0, nBars]), nov = new Float64Array(nBars + 1), mean2 = (i, j) => { const o = new Float64Array(16); for (let b = i; b < j; b++) if (b >= 0 && b < nBars) for (let k = 0; k < 16; k++) o[k] += barVec[b][k]; return o; };
  for (let b = 1; b < nBars; b++) {
    const on0 = barAct[b - 1] >= 3, on1 = barAct[b] >= 3;
    if (on0 !== on1) { bounds.add(b); nov[b] = 1; continue; }
    if (!on1) continue;
    const dl = Math.abs(20 * Math.log10((barLvl[b] + 1e-9) / (barLvl[b - 1] + 1e-9)));
    nov[b] = (1 - cosSim(mean2(b - 2, b), mean2(b, b + 2))) + (dl > 4 ? 0.05 : 0);
  }
  const act = Array.from(nov).filter((v) => v > 0 && v < 1), thr = act.length ? Math.max(0.035, percentile(act, 50) + 2.5 * (percentile(act, 75) - percentile(act, 50))) : 1;
  for (let b = 1; b < nBars; b++) if (nov[b] < 1 && nov[b] >= thr && nov[b] >= nov[b - 1] && nov[b] >= (nov[b + 1] || 0)) bounds.add(b);
  return { beatT, nBars, nBeat, brms, active, ref, feat, barAct, bounds: [...bounds].sort((p, q) => p - q) };
}
/* Fase de frase: las secciones suelen cambiar cada 4/8 compases; se usa para que los loops empiecen al inicio de frase. */
function phrasePhase(infos) {
  const h = new Float64Array(8); let n = 0;
  for (const inf of infos) for (const b of inf.bounds) if (b > 0 && b < inf.nBars) { h[b % 8]++; n++; }
  const h4 = [0, 1, 2, 3].map((i) => h[i] + h[i + 4]), p4 = h4.indexOf(Math.max(...h4)), sorted = [...h4].sort((a, b) => b - a);
  const p8 = h[p4] >= h[p4 + 4] ? p4 : p4 + 4;
  return { p4, p8, strong: n >= 4 && sorted[0] >= 1.6 * Math.max(sorted[1], 0.5), hist: Array.from(h) };
}
function pickLoops(kind, x, grid, info, hits, phrase) {
  const { beatT, nBars, nBeat, brms, active, ref, feat, barAct, bounds } = info;
  if (nBars < 1) return [];
  const base = kind === 'break' ? 'break' : kind === 'bass_loop' ? 'bass_loop' : 'inst_loop';
  let ot, cls = null;
  if (base === 'break' && hits) { ot = hits.map((h) => h[0]); cls = hits.map((h) => h[1]); }
  else ot = (base === 'bass_loop' ? energyOnsets(x) : detectOnsets(x, { nfft: 2048, hop: 256, delta: 0.1, minGap: 0.05 }).pos).map((p) => p / SR);
  const w = { break: [0.30, 0.25, 0.20, 0.15, 0.10], bass_loop: [0, 0.25, 0.35, 0.25, 0.15], inst_loop: [0, 0.10, 0.40, 0.35, 0.15] }[base];
  const lower = (arr, v) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; } return lo; };
  const near = (t, tol) => { const i = lower(ot, t); let b = -1; for (const k of [i - 1, i]) if (k >= 0 && k < ot.length && Math.abs(ot[k] - t) <= tol && (b < 0 || Math.abs(ot[k] - t) < Math.abs(ot[b] - t))) b = k; return b; };
  const flat = (a, b) => { const o = new Float64Array((b - a) * 16); for (let i = a; i < b; i++) o.set(feat[i], (i - a) * 16); return o; };
  const minBar = base === 'break' ? 4 : 3, out = [];
  for (const [Ls, cap] of Object.entries(PLANS[base])) {
    const L = +Ls; if (nBars < L) continue;
    const cands = [];
    for (let a = 0; a <= nBars - L; a++) {
      if (bounds.some((b) => b > a && b < a + L)) continue;        // no cruzar un cambio de sección
      let okBars = true; for (let b = a; b < a + L; b++) if (barAct[b] < minBar) { okBars = false; break; }
      if (!okBars || !active[a * 4]) continue;                     // todos los compases con contenido, y sonando desde el primer tiempo
      const al = L === 1 ? true : L === 2 ? (a - phrase.p4) % 2 === 0 : L === 4 ? (((a - phrase.p4) % 4) + 4) % 4 === 0 : (((a - phrase.p8) % 8) + 8) % 8 === 0;
      const secStart = bounds.some((b) => b <= a && (a - b) % L === 0 && !bounds.some((c) => c > b && c <= a));  // alineado con el inicio de su sección
      if (L >= 2 && phrase.strong && !al && !secStart) continue;
      const b0 = a * 4, b1 = (a + L) * 4, len = b1 - b0, vec = flat(b0, b1); let cov = 0; for (let i = b0; i < b1; i++) cov += active[i]; cov /= len;
      if (L >= 2 && cosSim(flat(b0, b0 + len / 2), flat(b0 + len / 2, b1)) > 0.992) continue;   // es un loop más corto repetido: compases de más
      let rep;
      if (b1 + len <= nBeat) rep = cosSim(vec, flat(b1, b1 + len)); else if (b0 - len >= 0) rep = cosSim(vec, flat(b0 - len, b0)); else rep = 0.3;
      const i0 = lower(ot, beatT[b0] - 0.03), i1 = lower(ot, beatT[b1] - 0.03), count = i1 - i0;
      const dens = Math.min(1, count / (L * 4 * { break: 1.5, bass_loop: 0.75, inst_loop: 0.4 }[base]));
      let v = 0;
      if (base === 'break') {
        const pr = new Set(cls.slice(i0, i1));
        if (!pr.has('kick') || !pr.has('snare')) continue;
        v = 0.3 + 0.3 + 0.2 * (pr.has('hat_closed') || pr.has('hat_open') ? 1 : 0) + 0.2 * (pr.has('tom') || pr.has('cymbal') || pr.has('hat_open') ? 1 : 0);
      }
      let lv = 0; for (let i = b0; i < b1; i++) lv += brms[i]; lv = Math.min(1, lv / len / ref);
      const bonus = (al ? 0.06 : 0) + (secStart ? 0.06 : 0) + (near(beatT[b0], 0.05) >= 0 ? 0.05 : 0);
      cands.push({ score: w[0] * v + w[1] * dens + w[2] * cov + w[3] * rep + w[4] * lv + bonus, a, vec });
    }
    cands.sort((p, q) => q.score - p.score);
    const chosen = [];
    for (const c of cands) {
      if (chosen.some((o) => Math.abs(c.a - o.a) < L)) continue;
      if (chosen.some((o) => cosSim(c.vec, o.vec) > 0.985)) continue;
      chosen.push(c); if (chosen.length >= cap) break;
    }
    for (const c of chosen) {
      // corte exacto: empieza en el ataque real del primer golpe y termina justo ANTES del ataque del compás siguiente
      const tS = beatT[c.a * 4], tE = beatT[(c.a + L) * 4], iS = near(tS, 0.035), iE = near(tE, 0.04);
      const isB = base === 'break', pS = Math.round((isB && iS >= 0 ? ot[iS] : tS) * SR), pE = Math.round((isB && iE >= 0 ? ot[iE] : tE) * SR);
      const aS = attackStart(x, pS, isB ? 0.03 : 0.015, isB ? 0.02 : 0.012, ref), aE = attackStart(x, pE, isB ? 0.03 : 0.015, isB ? 0.02 : 0.012, ref);
      const lim = Math.floor(0.006 * SR), s = Math.max(0, aS >= 0 && aS <= pS + lim ? aS : pS - Math.floor(PRE_ROLL * SR));
      let e = Math.min(x.length, s + Math.round((tE - tS) * SR));  // duración musical exacta del tramo...
      if (aE >= 0 && aE < e && aE <= pE + lim) e = aE;                               // ...salvo que se cuele el ataque del compás siguiente
      if (e - s < 0.9 * (tE - tS) * SR) continue;
      out.push({ cat: kind, bars: L, score: c.score, audio: fade(x.subarray(s, e), 1, 4), s, e, a: c.a, bpm: Math.round(60 * L * 4 / (tE - tS)) });   // tempo real de ESE tramo
    }
  }
  return out;
}

/* ============================================================ separador DSP de emergencia (HPSS) */
function slidingMedian(src, n, h, tmp, outFn) {
  // mediana deslizante de ventana 2h+1 con bordes replicados; src(i) devuelve el valor i
  const w = 2 * h + 1, win = new Float32Array(w);
  for (let j = 0; j < w; j++) win[j] = src(Math.min(Math.max(j - h, 0), n - 1));
  win.sort();
  outFn(0, win[h]);
  for (let i = 1; i < n; i++) {
    const out = src(Math.min(Math.max(i - 1 - h, 0), n - 1)), inc = src(Math.min(Math.max(i + h, 0), n - 1));
    let lo = 0, hi = w; while (lo < hi) { const m = (lo + hi) >> 1; if (win[m] < out) lo = m + 1; else hi = m; }
    win.copyWithin(lo, lo + 1);                       // elimina `out`
    let l2 = 0, h2 = w - 1; while (l2 < h2) { const m = (l2 + h2) >> 1; if (win[m] < inc) l2 = m + 1; else h2 = m; }
    if (l2 < w - 1 && win[l2] < inc) l2++;
    win.copyWithin(l2 + 1, l2, w - 1); win[l2] = inc;  // inserta `inc`
    outFn(i, win[h]);
  }
}
function biquadLow(fc, q) {
  const w0 = 2 * Math.PI * fc / SR, c = Math.cos(w0), al = Math.sin(w0) / (2 * q), a0 = 1 + al;
  return { b0: (1 - c) / 2 / a0, b1: (1 - c) / a0, b2: (1 - c) / 2 / a0, a1: -2 * c / a0, a2: (1 - al) / a0 };
}
function filtfilt(x, secs) {
  const run = (src) => { let y = Float32Array.from(src); for (const s of secs) { let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let i = 0; i < y.length; i++) { const v = y[i], o = s.b0 * v + s.b1 * x1 + s.b2 * x2 - s.a1 * y1 - s.a2 * y2; x2 = x1; x1 = v; y2 = y1; y1 = o; y[i] = o; } } return y; };
  const f = run(x); f.reverse(); const b = run(f); b.reverse(); return b;
}
function hpssSeparate(mono) {
  const nfft = 2048, hop = 1024, S = stftComplex(mono, nfft, hop), { nFrames: nF, bins } = S;
  let mag = new Float32Array(nF * bins); for (let i = 0; i < mag.length; i++) mag[i] = Math.hypot(S.re[i], S.im[i]);
  const H = new Float32Array(mag.length);
  for (let k = 0; k < bins; k++) slidingMedian((f) => mag[f * bins + k], nF, 7, null, (f, v) => { H[f * bins + k] = v; });
  const P = new Float32Array(mag.length);
  for (let f = 0; f < nF; f++) slidingMedian((k) => mag[f * bins + k], bins, 8, null, (k, v) => { P[f * bins + k] = v; });
  mag = null;
  for (let i = 0; i < H.length; i++) { const h2 = H[i] * H[i], p2 = P[i] * P[i]; H[i] = h2 / (h2 + p2 + 1e-10); }   // máscara armónica (P se libera)
  P.fill(0);
  const harm = istftMasked(S, H, nfft, hop, mono.length, false), drums = istftMasked(S, H, nfft, hop, mono.length, true);
  const bass = filtfilt(harm, [biquadLow(240, 0.5412), biquadLow(240, 1.3066)]), other = new Float32Array(harm.length);
  for (let i = 0; i < other.length; i++) other[i] = harm[i] - bass[i];
  return { drums, bass, other };
}

/* ============================================================ pipeline */
const bars = (n) => (n === 1 ? '1bar' : `${n}bars`);
function mergedOnsets(mix, dr) {
  const mo = detectOnsets(mix, { nfft: 1024, hop: 256, delta: 0.1, minGap: 0.03 }), dm = percentile(dr.onsetS, 50) + 1e-9, mm = percentile(mo.strength, 50) + 1e-9;
  const merged = dr.onsetT.map((t, i) => [t, dr.onsetS[i] / dm]).concat(Array.from(mo.pos, (p, i) => [p / SR, 0.5 * mo.strength[i] / mm])).sort((a, b) => a[0] - b[0]);
  return { t: merged.map((v) => v[0]), s: merged.map((v) => v[1]) };
}
function analyzeAll({ mix, drums, bass, other, guitar, piano, bpmHint }) {
  const duration = mix.length / SR;
  progress(5, 'Detectando golpes y separando las piezas de la batería');
  const dr = extractDrums(drums);
  progress(22, 'Analizando tempo, compases y estructura');
  let harm = new Float32Array(mix.length), hmax = 0;
  for (let i = 0; i < harm.length; i++) { harm[i] = other[i] + bass[i] + (guitar ? guitar[i] : 0) + (piano ? piano[i] : 0); hmax = Math.max(hmax, Math.abs(harm[i])); }
  if (hmax <= 1e-4) harm = mix;
  const grid = findGrid(mix, drums, bass, harm, mergedOnsets(mix, dr), duration, bpmHint);
  const tl = grid.beats.length > 8 ? grid.beats.slice(1).map((t, i) => t - grid.beats[i]) : [grid.T];
  const tl4 = grid.beats.length > 12 ? grid.beats.slice(4).map((t, i) => (t - grid.beats[i]) / 4) : tl;   // tempo por compás (sin el temblor pulso a pulso)
  const songBpm = 60 / percentile(tl, 50), [tonic, mode, kscore] = estimateKey(chromaMean(harm)), songKey = [tonic, mode];
  const stems = [['break', drums], ['bass_loop', bass], ['inst_loop', other]];
  if (guitar) stems.push(['guitar_loop', guitar]); if (piano) stems.push(['keys_loop', piano]);
  const infos = stems.map(([, x]) => stemBars(x, grid)), phrase = phrasePhase([stemBars(mix, grid), ...infos]);
  progress(40, 'Extrayendo notas de bajo');
  const bassNotes = extractBassNotes(bass);
  progress(52, 'Buscando acordes');
  let chordSrc = other;
  if (guitar || piano) { chordSrc = new Float32Array(other.length); for (let i = 0; i < chordSrc.length; i++) chordSrc[i] = other[i] + (guitar ? guitar[i] : 0) + (piano ? piano[i] : 0); }
  const chordItems = extractChords(chordSrc, grid, duration);
  const raw = [], loops = [];
  stems.forEach(([kind, x], i) => {
    progress(62 + 6 * i, { break: 'Buscando breaks de batería', bass_loop: 'Buscando loops de bajo', inst_loop: 'Buscando loops de instrumentos', guitar_loop: 'Buscando loops de guitarra', keys_loop: 'Buscando loops de teclado/piano' }[kind]);
    loops.push(...pickLoops(kind, x, grid, infos[i], kind === 'break' ? dr.all : null, phrase));
  });
  dr.hits.forEach((h) => raw.push({ ...h, label: '', suffix: '', rank: -h.score }));
  [...bassNotes, ...chordItems].forEach((h) => raw.push({ ...h, suffix: '' }));
  loops.forEach((l) => {
    if (l.cat === 'break') {
      raw.push({ ...l, label: '', rank: l.bars * 10 - l.score, suffix: `_${l.bpm}bpm_${bars(l.bars)}`, group: l.a * 100 + l.bars });
      return;
    }
    let key = keyName(...songKey);
    if (l.audio.length >= 16384) {
      const c = chromaMean(l.audio);
      if (c.reduce((a, v) => a + v, 0) > 0) { const [t, m] = estimateKey(c, songKey, l.cat === 'bass_loop' ? 1.0 : 0.12); key = keyName(t, m); }
    }
    raw.push({ ...l, label: '', rank: l.bars * 10 - l.score, suffix: `_${l.bpm}bpm_${key}_${bars(l.bars)}` });
  });
  const ORDER = ['break', 'bass_loop', 'inst_loop', 'guitar_loop', 'keys_loop', 'kick', 'snare', 'hat_closed', 'hat_open', 'tom', 'cymbal', 'bass_note', 'chord'];
  raw.sort((a, b) => ORDER.indexOf(a.cat) - ORDER.indexOf(b.cat) || a.rank - b.rank);
  const samples = raw.map((s, i) => {
    const audio = normalizePeak(s.audio, -1);
    return { id: `s${String(i + 1).padStart(3, '0')}`, cat: s.cat, label: s.label, suffix: s.suffix, rank: Math.round(s.rank * 1e4) / 1e4,
      score: Math.round(100 * clip(s.score, 0, 1)), dur: Math.round(audio.length / SR * 1000) / 1000, peaks: peaksOf(audio), audio, ...(s.bars ? { bars: s.bars } : {}), ...(s.group !== undefined ? { group: s.group } : {}), ...(s.s !== undefined ? { t0: Math.round(s.s / SR * 1000) / 1000, t1: Math.round(s.e / SR * 1000) / 1000 } : {}) };
  });
  progress(100, 'Listo');
  return { song: { duration: Math.round(duration * 100) / 100, bpm: Math.round(songBpm * 100) / 100, bpmInt: Math.round(songBpm), bpmMin: Math.round(600 / percentile(tl4, 97)) / 10, bpmMax: Math.round(600 / percentile(tl4, 3)) / 10, key: keyName(...songKey), keyConfidence: kscore },
    samples, structure: { bars: infos[0].nBars, firstDownbeat: Math.round(grid.bar0 * 1000) / 1000, phrase, tempoMin: Math.round(600 / percentile(tl, 95)) / 10, tempoMax: Math.round(600 / percentile(tl, 5)) / 10,
      sections: Object.fromEntries(stems.map(([k], i) => [k, infos[i].bounds])) } };
}

/* ============================================================ mensajes */
let STORE = null;   // stems mono en memoria: permite reanalizar con otro BPM sin repetir la separación
function handle(m) {
  try {
    if (m.type === 'ping') { post({ type: 'pong' }); return; }
    if (m.type === 'mix') { STORE = { mix: m.mix }; post({ type: 'loaded' }); }
    else if (m.type === 'load') {
      Object.assign(STORE, { drums: m.drums, bass: m.bass, other: m.other, guitar: m.guitar || null, piano: m.piano || null });
      post({ type: 'loaded' });
    } else if (m.type === 'hpss') {
      progress(5, 'Separando con DSP básico');
      Object.assign(STORE, hpssSeparate(STORE.mix), { guitar: null, piano: null });
      post({ type: 'loaded' });
    } else if (m.type === 'analyze') {
      if (!STORE || !STORE.mix || !STORE.drums) throw new Error('No hay audio cargado.');
      const res = analyzeAll({ ...STORE, bpmHint: m.bpmHint || null });
      post({ type: 'result', result: res }, res.samples.map((s) => s.audio.buffer));
    }
  } catch (err) { post({ type: 'error', message: String(err && err.message || err), stack: String(err && err.stack || '') }); }
}
if (typeof importScripts === 'function') self.onmessage = (e) => handle(e.data);   // dentro de un Worker
const API = { gridFor: (mix, drums, bass, harm, hint) => { const dr = extractDrums(drums); return findGrid(mix, drums, bass, harm, mergedOnsets(mix, dr), mix.length / SR, hint); }, dbg: (a) => { DEBUG_CLS = a; }, detectOnsets, stemBars, phrasePhase, pickLoops, splitDrums, preOnset, trackBeats, handle, setPost: (f) => { post = f; }, analyzeAll, hpssSeparate, extractDrums, findGrid, yin, estimateKey, chromaMean };
root.SPB = API;                                                                  // uso en el hilo principal (file://)
if (typeof module !== 'undefined') module.exports = API;
})(typeof self !== 'undefined' ? self : globalThis);
