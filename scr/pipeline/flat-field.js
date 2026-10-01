// src/pipeline/flat-field.js — corrección de iluminación no uniforme.
// Hoja pura: no importa nada nuestro.

export function flatFieldCorrect(srcCanvas, { strength = 0.75, downsample = 8 } = {}) {
  try {
    return _flatFieldCorrect(srcCanvas, strength, downsample);
  } catch (e) {
    console.warn("[flat-field] Falló, devolviendo original:", e.message);
    return srcCanvas;
  }
}

function _flatFieldCorrect(srcCanvas, strength, downsample) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const sw = Math.max(8, Math.floor(w / downsample));
  const sh = Math.max(8, Math.floor(h / downsample));

  // ---- 1. Downscale a sw×sh ----
  const small = document.createElement("canvas");
  small.width = sw; small.height = sh;
  const sctx = small.getContext("2d", { willReadFrequently: true });
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = "low";
  sctx.drawImage(srcCanvas, 0, 0, sw, sh);

  // ---- 2. Blur (aproxima iluminación local) ----
  const smallImg = sctx.getImageData(0, 0, sw, sh);
  const radius = Math.max(2, Math.round(sw * 0.08));
  boxBlurRGB(smallImg.data, sw, sh, radius);
  boxBlurRGB(smallImg.data, sw, sh, radius);

  // ---- 3. Target = percentil 85 de luminancia (top 15%) ----
  const hist = new Uint32Array(256);
  for (let i = 0; i < smallImg.data.length; i += 4) {
    const lum = (0.299 * smallImg.data[i] + 0.587 * smallImg.data[i+1] + 0.114 * smallImg.data[i+2]) | 0;
    hist[lum]++;
  }
  const totalPx = sw * sh;
  const targetCount = totalPx * 0.15;
  let acc = 0, target = 220;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc >= targetCount) { target = v; break; }
  }
  if (target < 60) return srcCanvas; // imagen casi negra, no hay nada útil que corregir

  // ---- 4. Upscale del blur al tamaño original ----
  const smallBlurred = document.createElement("canvas");
  smallBlurred.width = sw; smallBlurred.height = sh;
  smallBlurred.getContext("2d").putImageData(smallImg, 0, 0);

  const bigBlurred = document.createElement("canvas");
  bigBlurred.width = w; bigBlurred.height = h;
  const bctx = bigBlurred.getContext("2d", { willReadFrequently: true });
  bctx.imageSmoothingEnabled = true;
  bctx.imageSmoothingQuality = "high";
  bctx.drawImage(smallBlurred, 0, 0, w, h);
  const blurData = bctx.getImageData(0, 0, w, h).data;

  // ---- 5. Aplicar corrección pixel a pixel ----
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  const octx = out.getContext("2d", { willReadFrequently: true });
  octx.drawImage(srcCanvas, 0, 0);
  const outImg  = octx.getImageData(0, 0, w, h);
  const outData = outImg.data;

  const blend = 1 - strength;
  for (let i = 0; i < outData.length; i += 4) {
    const lum = 0.299 * blurData[i] + 0.587 * blurData[i+1] + 0.114 * blurData[i+2];
    let scale = target / Math.max(20, lum);
    if (scale < 0.5) scale = 0.5;
    else if (scale > 2.5) scale = 2.5;
    const f = blend + strength * scale;
    // Uint8ClampedArray clampea al asignar, no hace falta min(255, ...)
    outData[i]   = outData[i]   * f;
    outData[i+1] = outData[i+1] * f;
    outData[i+2] = outData[i+2] * f;
  }
  octx.putImageData(outImg, 0, 0);
  return out;
}

/* Box blur separable, dos pasadas (H + V). In-place. */
function boxBlurRGB(data, w, h, radius) {
  const r = radius;
  const tmp = new Uint8ClampedArray(data.length);

  // ---- Horizontal ----
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let x = -r; x <= r; x++) {
        const xi = x < 0 ? 0 : (x >= w ? w - 1 : x);
        sum += data[(row + xi) * 4 + c];
      }
      const denom = 2 * r + 1;
      for (let x = 0; x < w; x++) {
        tmp[(row + x) * 4 + c] = sum / denom;
        const xOut = x - r;
        const xIn  = x + r + 1;
        const xiOut = xOut < 0 ? 0 : (xOut >= w ? w - 1 : xOut);
        const xiIn  = xIn  < 0 ? 0 : (xIn  >= w ? w - 1 : xIn);
        sum += data[(row + xiIn) * 4 + c] - data[(row + xiOut) * 4 + c];
      }
    }
    // Alpha passthrough
    for (let x = 0; x < w; x++) tmp[(row + x) * 4 + 3] = data[(row + x) * 4 + 3];
  }

  // ---- Vertical ----
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) {
        const yi = y < 0 ? 0 : (y >= h ? h - 1 : y);
        sum += tmp[(yi * w + x) * 4 + c];
      }
      const denom = 2 * r + 1;
      for (let y = 0; y < h; y++) {
        data[(y * w + x) * 4 + c] = sum / denom;
        const yOut = y - r;
        const yIn  = y + r + 1;
        const yiOut = yOut < 0 ? 0 : (yOut >= h ? h - 1 : yOut);
        const yiIn  = yIn  < 0 ? 0 : (yIn  >= h ? h - 1 : yIn);
        sum += tmp[(yiIn  * w + x) * 4 + c] - tmp[(yiOut * w + x) * 4 + c];
      }
    }
  }
}