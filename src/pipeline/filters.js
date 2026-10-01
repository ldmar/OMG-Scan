// src/pipeline/filters.js — filtros pixel-a-pixel + lógica del pincel.
// Importa state (deuda técnica: Fase C las refactoriza a puras).
// TODO(Fase C): pasar brush por parámetro en vez de leer state.brush.

import { state } from "../state.js";

/* --------- FILTROS --------- */
export function applyFilterToCanvas(srcCanvas, filterId) {
  const c = document.createElement("canvas");
  c.width = srcCanvas.width; c.height = srcCanvas.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(srcCanvas, 0, 0);
  if (filterId === "original") return c;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  if (filterId === "bw") {
    for (let i = 0; i < d.length; i += 4) {
      let v = d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114;
      v = (v - 128) * 1.9 + 138;
      v = v < 70 ? 0 : v > 195 ? 255 : v;
      d[i] = d[i+1] = d[i+2] = v;
    }
    } else if (filterId === "gray") {
      // 1. Grayscale + histograma
      const lum = new Uint8Array(d.length / 4);
      const hist = new Uint32Array(256);
      for (let i = 0, j = 0; i < d.length; i += 4, j++) {
        const L = (d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114) | 0;
        lum[j] = L;
        hist[L]++;
      }
      const total = lum.length;

      // 2. Percentiles 2% y 98%
      let acc = 0, lo = 0, hi = 255;
      for (let v = 0; v < 256; v++) {
        acc += hist[v];
        if (acc >= total * 0.02) { lo = v; break; }
      }
      acc = 0;
      for (let v = 0; v < 256; v++) {
        acc += hist[v];
        if (acc >= total * 0.98) { hi = v; break; }
      }
      if (hi - lo < 20) { lo = 0; hi = 255; }

      // 3. Stretch + S-curve suave
      const range = hi - lo;
      const scale = 255 / range;
      for (let i = 0, j = 0; i < d.length; i += 4, j++) {
        let v = (lum[j] - lo) * scale;
        if (v < 0) v = 0;
        else if (v > 255) v = 255;
        // S-curve: oscurece negros, aclara blancos
        v = v < 128 ? v * 0.82 : 255 - (255 - v) * 0.82;
        d[i] = d[i+1] = d[i+2] = v;
      }
    }
  } else if (filterId === "auto") {
    for (let i = 0; i < d.length; i += 4) {
      let r = (d[i]   - 128) * 1.35 + 142;
      let g = (d[i+1] - 128) * 1.35 + 142;
      let b = (d[i+2] - 128) * 1.35 + 142;
      if (r > 200) r = 255;
      if (g > 200) g = 255;
      if (b > 200) b = 255;
      d[i]   = Math.max(0, Math.min(255, r));
      d[i+1] = Math.max(0, Math.min(255, g));
      d[i+2] = Math.max(0, Math.min(255, b));
    }
  } else if (filterId === "color") {
    for (let i = 0; i < d.length; i += 4) {
      d[i]   = Math.max(0, Math.min(255, (d[i]   - 128) * 1.15 + 132));
      d[i+1] = Math.max(0, Math.min(255, (d[i+1] - 128) * 1.15 + 132));
      d[i+2] = Math.max(0, Math.min(255, (d[i+2] - 128) * 1.15 + 132));
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/* --------- PINCEL --------- */
export function ensureMask(w, h) {
  const b = state.brush;
  if (b.w !== w || b.h !== h) {
    b.w = w; b.h = h;
    b.mask = new Uint8Array(w * h);
    b.strokes = [];
  }
  return b.mask;
}

export function resetMask() {
  if (state.brush.mask) state.brush.mask.fill(0);
}

export function paintDot(cx, cy, radius, strengthPct, erase) {
  const b = state.brush;
  const w = b.w, h = b.h, mask = b.mask;
  if (!mask) return;
  const r = radius, r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(w, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(h, Math.ceil(cy + r));
  const maxAdd = (strengthPct / 100) * 255;
  for (let y = y0; y < y1; y++) {
    const dy = y - cy;
    for (let x = x0; x < x1; x++) {
      const dx = x - cx;
      const d2 = dx*dx + dy*dy;
      if (d2 > r2) continue;
      const f = 1 - Math.sqrt(d2) / r;
      const add = maxAdd * f;
      const idx = y * w + x;
      if (erase) mask[idx] = Math.max(0, mask[idx] - add);
      else       mask[idx] = Math.min(255, mask[idx] + add);
    }
  }
}

export function applyShadowBrushToCanvas(baseCanvas) {
  const b = state.brush;
  if (!b.mask || !b.strokes.length) return baseCanvas;
  const w = baseCanvas.width, h = baseCanvas.height;
  if (b.w !== w || b.h !== h) return baseCanvas;
  const ctx = baseCanvas.getContext("2d");
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const mask = b.mask;
  const total = w * h;
  for (let i = 0; i < total; i++) {
    const m = mask[i];
    if (!m) continue;
    const mf = m / 255;
    const i4 = i * 4;
    for (let c = 0; c < 3; c++) {
      const v = d[i4 + c];
      let t = (v - 55) / 100;
      if (t <= 0) continue;
      if (t > 1) t = 1;
      t = t * t * (3 - 2 * t);
      d[i4 + c] = v + (255 - v) * mf * t;
    }
  }
  ctx.putImageData(img, 0, 0);
  return baseCanvas;
}

export function replayStrokes() {
  const b = state.brush;
  resetMask();
  for (const s of b.strokes) {
    const step = Math.max(1, Math.floor(s.radius / 3));
    let prev = null;
    for (const p of s.points) {
      if (prev) {
        const d = Math.hypot(p.x - prev.x, p.y - prev.y);
        const n = Math.max(1, Math.ceil(d / step));
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          paintDot(prev.x + (p.x - prev.x) * t, prev.y + (p.y - prev.y) * t,
                   s.radius, s.strength, s.erase);
        }
      } else {
        paintDot(p.x, p.y, s.radius, s.strength, s.erase);
      }
      prev = p;
    }
  }
}
