// src/pipeline/ocr-preprocess.js — preprocessing para Tesseract.
// Hoja pura: no importa nada nuestro.

import { clamp } from "../utils.js";

export function preprocessForOCR(srcCanvas, { mode = "normal" } = {}) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const sctx = srcCanvas.getContext("2d", { willReadFrequently: true });
  const src = sctx.getImageData(0, 0, w, h).data;
  const gray = new Uint8Array(w * h);
  const hist = new Uint32Array(256);
  for (let i = 0, j = 0; i < src.length; i += 4, j++) {
    const v = (src[i] * 0.299 + src[i+1] * 0.587 + src[i+2] * 0.114) | 0;
    gray[j] = v;
    hist[v]++;
  }
  let acc = 0, median = 128;
  const half = gray.length / 2;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= half) { median = v; break; }
  }
  if (median < 110) {
    for (let i = 0; i < gray.length; i++) gray[i] = 255 - gray[i];
  }
  const integral = new Uint32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    const rowBase = (y + 1) * (w + 1);
    const prevBase = y * (w + 1);
    for (let x = 0; x < w; x++) {
      rowSum += gray[y * w + x];
      integral[rowBase + (x + 1)] = integral[prevBase + (x + 1)] + rowSum;
    }
  }
  const minDim = Math.min(w, h);
  const windowSize = mode === "aggressive"
    ? clamp(Math.round(minDim / 60), 10, 70)
    : clamp(Math.round(minDim / 40), 15, 90);
  const tolerance = mode === "aggressive" ? 0.20 : 0.15;
  const halfWin = Math.floor(windowSize / 2);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y1 = Math.max(0, y - halfWin);
    const y2 = Math.min(h - 1, y + halfWin);
    const rowTop = y1 * (w + 1);
    const rowBot = (y2 + 1) * (w + 1);
    for (let x = 0; x < w; x++) {
      const x1 = Math.max(0, x - halfWin);
      const x2 = Math.min(w - 1, x + halfWin);
      const count = (x2 - x1 + 1) * (y2 - y1 + 1);
      const sum = integral[rowBot + (x2 + 1)]
                - integral[rowTop + (x2 + 1)]
                - integral[rowBot + x1]
                + integral[rowTop + x1];
      const mean = sum / count;
      const v = gray[y * w + x];
      const bin = v < mean * (1 - tolerance) ? 0 : 255;
      const i4 = (y * w + x) * 4;
      out[i4] = out[i4+1] = out[i4+2] = bin;
      out[i4+3] = 255;
    }
  }
  const dst = document.createElement("canvas");
  dst.width = w; dst.height = h;
  dst.getContext("2d").putImageData(new ImageData(out, w, h), 0, 0);
  return dst;
}

export function prepareForOCR(dataURL, { mode = "normal" } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const nw = img.naturalWidth, nh = img.naturalHeight;
      const targetW = 2000;
      let scale = 1;
      if (nw < 1400) scale = Math.min(2, targetW / nw);
      else if (nw > 2600) scale = targetW / nw;
      const w = Math.round(nw * scale);
      const h = Math.round(nh * scale);
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, w, h);
      try { resolve(preprocessForOCR(c, { mode })); }
      catch (e) {
        console.warn("[preprocess] Falló, usando imagen cruda:", e.message);
        resolve(c);
      }
    };
    img.onerror = () => reject(new Error("No se pudo cargar la imagen para OCR"));
    img.src = dataURL;
  });
}