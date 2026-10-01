// src/pipeline/auto-levels.js — estiramiento de histograma adaptativo.
// Hoja pura: no importa nada nuestro.

export function autoLevels(srcCanvas, { lowPct = 0.01, highPct = 0.01 } = {}) {
  try {
    return _autoLevels(srcCanvas, lowPct, highPct);
  } catch (e) {
    console.warn("[auto-levels] Falló, devolviendo original:", e.message);
    return srcCanvas;
  }
}

function _autoLevels(srcCanvas, lowPct, highPct) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const ctx = srcCanvas.getContext("2d", { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;

  // ---- 1. Histograma de luminancia ----
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const L = (d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114) | 0;
    hist[L]++;
  }

  const total = w * h;
  const lowTarget  = total * lowPct;
  const highTarget = total * (1 - highPct);

  // ---- 2. Percentiles ----
  let acc = 0, lo = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= lowTarget) { lo = v; break; }
  }
  acc = 0;
  let hi = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= highTarget) { hi = v; break; }
  }

  // Rango útil muy chico → la imagen está plana (velo, niebla). No forzar.
  if (hi - lo < 30) return srcCanvas;

  // ---- 3. Strech lineal en luminancia, preservando tono ----
  const range = hi - lo;
  const scale255 = 255 / range;
  for (let i = 0; i < d.length; i += 4) {
    const L = d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114;
    let Ln = (L - lo) * scale255;
    if (Ln < 0) Ln = 0;
    else if (Ln > 255) Ln = 255;
    const scale = L > 1 ? Ln / L : 1;
    d[i]   *= scale;
    d[i+1] *= scale;
    d[i+2] *= scale;
  }

  ctx.putImageData(img, 0, 0);
  return srcCanvas;
}