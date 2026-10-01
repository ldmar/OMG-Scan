// src/pipeline/warp.js — warp de perspectiva en Web Worker.
// Importa homography. No importa UI ni state.

import { computeHomography } from "./homography.js";

const warpWorker = (() => {
  const code = `
    self.onmessage = function(e) {
      const d = e.data;
      if (d.type !== 'warp') return;
      const { id, srcBuf, srcW, srcH, dstW, dstH, H } = d;
      const srcPix = new Uint8ClampedArray(srcBuf);
      const dstPix = new Uint8ClampedArray(dstW * dstH * 4);
      const h0=H[0],h1=H[1],h2=H[2],h3=H[3],h4=H[4],h5=H[5],h6=H[6],h7=H[7],h8=H[8];
      let di = 0;
      for (let y = 0; y < dstH; y++) {
        const yh6 = y * h6, yh7 = y * h7;
        for (let x = 0; x < dstW; x++) {
          const denom = x * h6 + yh7 + h8;
          const sxn = (h0*x + h1*y + h2) / denom;
          const syn = (h3*x + h4*y + h5) / denom;
          const x0 = sxn | 0, y0 = syn | 0;
          const x1 = x0 + 1, y1 = y0 + 1;
          const fx = sxn - x0, fy = syn - y0;
          const ifx = 1 - fx, ify = 1 - fy;
          if (x0 < 0 || y0 < 0 || x1 >= srcW || y1 >= srcH) {
            dstPix[di] = 0; dstPix[di+1] = 0; dstPix[di+2] = 0; dstPix[di+3] = 255;
            di += 4; continue;
          }
          const i00 = (y0*srcW + x0) * 4;
          const i10 = (y0*srcW + x1) * 4;
          const i01 = (y1*srcW + x0) * 4;
          const i11 = (y1*srcW + x1) * 4;
          const w00 = ifx*ify, w10 = fx*ify, w01 = ifx*fy, w11 = fx*fy;
          dstPix[di]   = srcPix[i00]   * w00 + srcPix[i10]   * w10 + srcPix[i01]   * w01 + srcPix[i11]   * w11;
          dstPix[di+1] = srcPix[i00+1] * w00 + srcPix[i10+1] * w10 + srcPix[i01+1] * w01 + srcPix[i11+1] * w11;
          dstPix[di+2] = srcPix[i00+2] * w00 + srcPix[i10+2] * w10 + srcPix[i01+2] * w01 + srcPix[i11+2] * w11;
          dstPix[di+3] = 255;
          di += 4;
        }
      }
      self.postMessage({ id, dstBuf: dstPix.buffer }, [dstPix.buffer]);
    };
  `;
  let worker = null;
  try {
    const blob = new Blob([code], { type: "application/javascript" });
    worker = new Worker(URL.createObjectURL(blob));
  } catch (e) {
    console.warn("[warp-worker]", e.message);
  }
  let seq = 0;
  const pending = new Map();
  if (worker) {
    worker.onmessage = (e) => {
      const { id, dstBuf } = e.data;
      const cb = pending.get(id);
      if (cb) { pending.delete(id); cb(dstBuf); }
    };
    worker.onerror = (e) => console.error("[warp-worker]", e.message);
  }
  return {
    available: !!worker,
    async warp(srcImageData, srcW, srcH, dstW, dstH, H) {
      if (!worker) throw new Error("Worker no disponible");
      const id = ++seq;
      const promise = new Promise((resolve) => pending.set(id, resolve));
      worker.postMessage({
        type: "warp", id,
        srcBuf: srcImageData.data.buffer,
        srcW, srcH, dstW, dstH, H,
      }, [srcImageData.data.buffer]);
      const dstBuf = await promise;
      return new ImageData(new Uint8ClampedArray(dstBuf), dstW, dstH);
    },
  };
})();

export async function warpPerspectiveAsync(srcCanvas, corners) {
  const sw = srcCanvas.width, sh = srcCanvas.height;
  const srcPts = corners.map((c) => ({ x: c.x * sw, y: c.y * sh }));
  const wTop = Math.hypot(srcPts[1].x - srcPts[0].x, srcPts[1].y - srcPts[0].y);
  const wBot = Math.hypot(srcPts[2].x - srcPts[3].x, srcPts[2].y - srcPts[3].y);
  const hL   = Math.hypot(srcPts[3].x - srcPts[0].x, srcPts[3].y - srcPts[0].y);
  const hR   = Math.hypot(srcPts[2].x - srcPts[1].x, srcPts[2].y - srcPts[1].y);
  const dstW = Math.max(1, Math.round(Math.max(wTop, wBot)));
  const dstH = Math.max(1, Math.round(Math.max(hL, hR)));
  const dstPts = [{ x: 0, y: 0 }, { x: dstW, y: 0 }, { x: dstW, y: dstH }, { x: 0, y: dstH }];
  const H = computeHomography(dstPts, srcPts);

  if (!warpWorker.available) throw new Error("Worker no disponible");

  const srcCtx  = srcCanvas.getContext("2d", { willReadFrequently: true });
  const srcData = srcCtx.getImageData(0, 0, sw, sh);
  const copy    = new ImageData(new Uint8ClampedArray(srcData.data), sw, sh);
  const dstData = await warpWorker.warp(copy, sw, sh, dstW, dstH, H);
  const out = document.createElement("canvas");
  out.width = dstW; out.height = dstH;
  out.getContext("2d").putImageData(dstData, 0, 0);
  return out;
}