// src/pipeline/auto-levels.js — estiramiento de histograma con K-means bimodal.
// Hoja pura: no importa nada nuestro.

export function autoLevels(srcCanvas, { targetLow = 8, targetHigh = 248 } = {}) {
  try {
    return _autoLevels(srcCanvas, targetLow, targetHigh);
  } catch (e) {
    console.warn("[auto-levels] Falló, devolviendo original:", e.message);
    return srcCanvas;
  }
}

function _autoLevels(srcCanvas, targetLow, targetHigh) {
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

  // ---- 2. K-means 1D con 2 clusters ----
  let c1 = 30, c2 = 220;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= total * 0.10) { c1 = v; break; }
  }
  acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= total * 0.90) { c2 = v; break; }
  }

  for (let iter = 0; iter < 15; iter++) {
    let sum1 = 0, n1 = 0, sum2 = 0, n2 = 0;
    for (let v = 0; v < 256; v++) {
      if (hist[v] === 0) continue;
      if (Math.abs(v - c1) < Math.abs(v - c2)) {
        sum1 += v * hist[v]; n1 += hist[v];
      } else {
        sum2 += v * hist[v]; n2 += hist[v];
      }
    }
    if (n1 === 0 || n2 === 0) return srcCanvas;
    const nc1 = sum1 / n1;
    const nc2 = sum2 / n2;
    const d1 = Math.abs(nc1 - c1) + Math.abs(nc2 - c2);
    c1 = nc1; c2 = nc2;
    if (d1 < 1) break;
  }

  const lo = c1;
  const hi = c2;

  // Rango útil muy chico → imagen plana (niebla, velo). No forzar.
  if (hi - lo < 20) return srcCanvas;

  // ---- 3. Stretch lineal sobre luminancia ----
  const scale = (targetHigh - targetLow) / (hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const L = d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114;
    let Ln = (L - lo) * scale + targetLow;
    if (Ln < 0) Ln = 0;
    else if (Ln > 255) Ln = 255;
    const s = L > 1 ? Ln / L : 1;
    d[i]   *= s;
    d[i+1] *= s;
    d[i+2] *= s;
  }

  ctx.putImageData(img, 0, 0);
  return srcCanvas;
}
