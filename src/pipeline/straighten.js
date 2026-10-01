// src/pipeline/straighten.js — detección de inclinación + rotación.
// Hoja pura: no importa nada nuestro.

export function detectSkewAngle(canvas) {
  const w = canvas.width, h = canvas.height;
  const maxW = 700;
  const scale = Math.min(1, maxW / w);
  const sw = Math.round(w * scale), sh = Math.round(h * scale);

  // ---- Downscale ----
  const small = document.createElement("canvas");
  small.width = sw; small.height = sh;
  const sctx = small.getContext("2d", { willReadFrequently: true });
  sctx.drawImage(canvas, 0, 0, sw, sh);
  const data = sctx.getImageData(0, 0, sw, sh).data;

  // ---- Grayscale ----
  const gray = new Uint8Array(sw * sh);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = (data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114) | 0;
  }

  // ---- Sobel magnitude ----
  const mag = new Float32Array(sw * sh);
  let maxMag = 0;
  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      const i = y * sw + x;
      const gx = gray[i + 1] - gray[i - 1];
      const gy = gray[i + sw] - gray[i - sw];
      const m = Math.hypot(gx, gy);
      mag[i] = m;
      if (m > maxMag) maxMag = m;
    }
  }
  if (maxMag < 1e-3) return 0;

  // ---- Edge selection (magnitud, no binario) ----
  const edgeThreshold = Math.max(40, maxMag * 0.20);
  const edgeDX = new Int32Array(sw * sh);
  const edgeDY = new Int32Array(sw * sh);
  const edgeW  = new Float32Array(sw * sh);
  let edgeCount = 0;
  const cx = sw / 2, cy = sh / 2;
  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      const i = y * sw + x;
      if (mag[i] >= edgeThreshold) {
        edgeDX[edgeCount] = x - cx;
        edgeDY[edgeCount] = y - cy;
        edgeW [edgeCount] = mag[i];
        edgeCount++;
      }
    }
  }
  if (edgeCount < 50) return 0;

  // ---- Proyección rotada, histograma del eje Y ----
  const range = Math.ceil(Math.hypot(sw, sh));
  const halfRange = range / 2;
  const buckets = new Float32Array(range);

  function scoreAt(angleDeg) {
    buckets.fill(0);
    const rad = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    for (let k = 0; k < edgeCount; k++) {
      const projY = -edgeDX[k] * sin + edgeDY[k] * cos;
      const idx = (projY + halfRange) | 0;
      if (idx >= 0 && idx < range) buckets[idx] += edgeW[k];
    }
    let sum = 0, peak = 0;
    for (let i = 0; i < range; i++) {
      sum += buckets[i];
      if (buckets[i] > peak) peak = buckets[i];
    }
    const mean = sum / range;
    return mean > 1e-6 ? peak / mean : 0;
  }

  // ---- Barrido grueso ±15° ----
  let bestAngle = 0, bestRatio = 0;
  for (let a = -15; a <= 15; a += 0.5) {
    const r = scoreAt(a);
    if (r > bestRatio) { bestRatio = r; bestAngle = a; }
  }
  // ---- Refinamiento fino ±0.5° del ganador ----
  const coarse = bestAngle;
  for (let a = coarse - 0.5; a <= coarse + 0.5; a += 0.1) {
    const r = scoreAt(a);
    if (r > bestRatio) { bestRatio = r; bestAngle = a; }
  }
  const zeroRatio = scoreAt(0);

  // ---- Gates de confianza ----
  // 1. Sin pico claro en ningún ángulo → imagen sin estructura legible.
  if (bestRatio < 1.25) return 0;
  // 2. El mejor ángulo no supera a "derecho" por margen suficiente.
  if (bestRatio < zeroRatio * 1.10) return 0;

  return bestAngle;
}

export function straightenCanvas(canvas) {
  const angle = detectSkewAngle(canvas);
  if (Math.abs(angle) < 0.4) return { canvas, angle: 0 };
  const rad = (-angle * Math.PI) / 180;
  const w = canvas.width, h = canvas.height;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const nw = Math.round(Math.abs(w * cos) + Math.abs(h * sin));
  const nh = Math.round(Math.abs(w * sin) + Math.abs(h * cos));
  const out = document.createElement("canvas");
  out.width = nw; out.height = nh;
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, nw, nh);
  ctx.translate(nw / 2, nh / 2);
  ctx.rotate(rad);
  ctx.drawImage(canvas, -w / 2, -h / 2);
  const innerScale = 1 / (Math.abs(cos) + Math.abs(sin) * (h / w));
  const cw = Math.round(w * innerScale * 0.99);
  const ch = Math.round(h * innerScale * 0.99);
  const cropped = document.createElement("canvas");
  cropped.width = cw; cropped.height = ch;
  cropped.getContext("2d").drawImage(
    out,
    Math.round((nw - cw) / 2), Math.round((nh - ch) / 2), cw, ch,
    0, 0, cw, ch
  );
  return { canvas: cropped, angle };
}
