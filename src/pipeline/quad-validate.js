// src/pipeline/quad-validate.js — validación y scoring de cuadriláteros.
// Hoja pura (excepto lectura de canvas por parámetro).
//
// Orden de corners: [topLeft, topRight, bottomRight, bottomLeft].

/* --------- GEOMETRÍA PURA --------- */

function polyArea(corners) {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p = corners[i], q = corners[(i + 1) % 4];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

function isConvex(corners) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const c = corners[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-6) return false; // colineal
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function internalAngles(corners) {
  const angles = [];
  for (let i = 0; i < 4; i++) {
    const prev = corners[(i + 3) % 4];
    const curr = corners[i];
    const next = corners[(i + 1) % 4];
    const v1x = prev.x - curr.x, v1y = prev.y - curr.y;
    const v2x = next.x - curr.x, v2y = next.y - curr.y;
    const dot = v1x * v2x + v1y * v2y;
    const m1  = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
    const cos = Math.max(-1, Math.min(1, dot / Math.max(1e-6, m1 * m2)));
    angles.push((Math.acos(cos) * 180) / Math.PI);
  }
  return angles;
}

function bboxAspect(corners) {
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  return Math.max(w / Math.max(1e-6, h), h / Math.max(1e-6, w));
}

/* --------- VALIDACIÓN DURA --------- */

export function isValidQuad(corners) {
  if (!Array.isArray(corners) || corners.length !== 4) return false;
  if (!isConvex(corners)) return false;

  const area = polyArea(corners);
  if (area < 0.15 || area > 0.985) return false;

  const aspect = bboxAspect(corners);
  if (aspect > 5) return false;

  const angles = internalAngles(corners);
  for (const a of angles) {
    if (a < 55 || a > 125) return false;
  }
  return true;
}

/* --------- SCORING SUAVE --------- */

export function scoreQuad(corners, confidence) {
  const area = polyArea(corners);
  const areaScore = Math.min(1, area / 0.4); // 40% del frame = 1.0

  const angles = internalAngles(corners);
  let maxDev = 0;
  for (const a of angles) {
    const dev = Math.abs(a - 90) / 35; // 0 en 90°, 1 en 55° o 125°
    if (dev > maxDev) maxDev = dev;
  }
  const angleScore = 1 - Math.min(1, maxDev);

  const aspect = bboxAspect(corners);
  const aspectScore = Math.max(0, 1 - Math.max(0, aspect - 1.6) / 3);

  const conf = typeof confidence === "number" ? confidence : 0.7;

  return conf * 0.35 + areaScore * 0.25 + angleScore * 0.25 + aspectScore * 0.15;
}

/* --------- HELPER: convierte <img> o <canvas> a canvas real --------- */

export function elementToCanvas(el, maxW = 800) {
  const nw = el.naturalWidth || el.width;
  const nh = el.naturalHeight || el.height;
  if (!nw || !nh) return null;
  const scale = Math.min(1, maxW / Math.max(nw, nh));
  const w = Math.round(nw * scale);
  const h = Math.round(nh * scale);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d", { willReadFrequently: true }).drawImage(el, 0, 0, w, h);
  return c;
}

/* --------- ANÁLISIS DE CONTENIDO INTERIOR --------- */

export function sampleInterior(canvas, corners, gridN = 8) {
  const cw = canvas.width;
  const ch = canvas.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  // Un solo getImageData de todo el canvas (rápido)
  const imgData = ctx.getImageData(0, 0, cw, ch).data;

  // Bbox del quad
  const xs = corners.map((p) => p.x * cw);
  const ys = corners.map((p) => p.y * ch);
  const bx0 = Math.max(0, Math.floor(Math.min(...xs)));
  const by0 = Math.max(0, Math.floor(Math.min(...ys)));
  const bx1 = Math.min(cw, Math.ceil(Math.max(...xs)));
  const by1 = Math.min(ch, Math.ceil(Math.max(...ys)));
  const bw = bx1 - bx0, bh = by1 - by0;
  if (bw < 4 || bh < 4) return null;

  // Point-in-quad test
  const qx = corners.map((p) => p.x * cw);
  const qy = corners.map((p) => p.y * ch);
  function pointInQuad(px, py) {
    let inside = false;
    for (let i = 0, j = 3; i < 4; j = i++) {
      const xi = qx[i], yi = qy[i], xj = qx[j], yj = qy[j];
      if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }

  // Muestrear desde el buffer (sin más getImageData)
  const samples = [];
  for (let gy = 0; gy < gridN; gy++) {
    for (let gx = 0; gx < gridN; gx++) {
      const px = bx0 + ((gx + 0.5) / gridN) * bw;
      const py = by0 + ((gy + 0.5) / gridN) * bh;
      if (!pointInQuad(px, py)) continue;
      const xi = Math.floor(px);
      const yi = Math.floor(py);
      const i4 = (yi * cw + xi) * 4;
      const L = 0.299 * imgData[i4] + 0.587 * imgData[i4+1] + 0.114 * imgData[i4+2];
      samples.push(L);
    }
  }
  if (samples.length < 10) return null;

  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  const mean   = samples.reduce((a, b) => a + b, 0) / samples.length;
  let variance = 0;
  for (const s of samples) variance += (s - mean) * (s - mean);
  variance /= samples.length;
  const std = Math.sqrt(variance);

  let dark = 0, bright = 0;
  for (const s of samples) {
    if (s < 80)  dark++;
    if (s > 200) bright++;
  }

  return {
    median,
    mean,
    std,
    darkRatio:   dark   / samples.length,
    brightRatio: bright / samples.length,
    sampleCount: samples.length,
  };
}

/* --------- SCORE FINAL CON CONTENIDO --------- */

export function scoreQuadWithContent(canvas, corners, confidence) {
  const base = scoreQuad(corners, confidence);
  const interior = sampleInterior(canvas, corners);
  if (!interior) return { score: 0, reason: "no-samples" };

  // Gates duros
  if (interior.median < 110)       return { score: 0, reason: "interior-oscuro", interior };
  if (interior.darkRatio > 0.35)   return { score: 0, reason: "interior-texturado", interior };
  if (interior.brightRatio < 0.25) return { score: 0, reason: "poco-papel", interior };
  if (interior.std > 80)           return { score: 0, reason: "interior-mixto", interior };

  const paperScore =
    Math.min(1, interior.median / 170) * 0.5 +
    Math.min(1, interior.brightRatio / 0.4) * 0.3 +
    Math.max(0, 1 - interior.darkRatio / 0.35) * 0.2;

  const score = base * 0.6 + paperScore * 0.4;
  return { score, reason: "ok", interior };
}

/* --------- EMA SOBRE HISTORIAL DE ESQUINAS --------- */

export function smoothQuad(history, alpha = 0.4) {
  if (!history || history.length === 0) return null;
  if (history.length === 1) return history[0].map((p) => ({ ...p }));

  const smoothed = history[0].map((p) => ({ ...p }));
  for (let i = 1; i < history.length; i++) {
    for (let k = 0; k < 4; k++) {
      smoothed[k].x = alpha * history[i][k].x + (1 - alpha) * smoothed[k].x;
      smoothed[k].y = alpha * history[i][k].y + (1 - alpha) * smoothed[k].y;
    }
  }
  return smoothed;
}
