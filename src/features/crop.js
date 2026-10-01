// src/features/crop.js — vista de crop: esquinas, gestos, lupa, rotación.

import { $, $$, clamp, dist, buzz } from "../utils.js";
import { state, prefs, DEFAULT_CORNERS, MAX_DIM } from "../state.js";
import { show, showToast } from "../ui.js";
import { isNearlyAxisRect } from "../pipeline/homography.js";
import { warpPerspectiveAsync } from "../pipeline/warp.js";
import { emit, on } from "../events.js";

const cropImg       = $("#cropImg");
const cropWrap      = $("#cropWrap");
const cropPoly      = $("#cropPoly");
const cropDark      = $("#cropDark");
const cropStage     = $("#cropStage");
const cropHint      = $("#cropHint");
const cropMagnifier = $("#cropMagnifier");
const cropMagCanvas = cropMagnifier.querySelector("canvas");
const MAG_SIZE = 130;
cropMagCanvas.width  = MAG_SIZE;
cropMagCanvas.height = MAG_SIZE;

export function openCrop() {
  cropImg.style.opacity = "1";
  cropImg.src = state.rawCapture;
  state.rotation       = 0;
  state.crop.corners   = DEFAULT_CORNERS();
  state.crop.zoom      = 1;
  state.crop.panX      = 0;
  state.crop.panY      = 0;
  applyCropTransform();
  cropImg.onload = () => {
    requestAnimationFrame(() => {
      drawCropOverlay();
      emit("quadscan:btn-changed");
    });
  };
  show("crop");
  emit("quadscan:btn-changed");
}

function cornersToPointsAttr(corners) {
  return corners.map((c) => `${c.x},${c.y}`).join(" ");
}

export function drawCropOverlay() {
  const c = state.crop.corners;
  cropPoly.setAttribute("points", cornersToPointsAttr(c));
  const outer = "M0,0 L1,0 L1,1 L0,1 Z";
  const inner = `M${c[0].x},${c[0].y} L${c[1].x},${c[1].y} L${c[2].x},${c[2].y} L${c[3].x},${c[3].y} Z`;
  cropDark.setAttribute("d", outer + " " + inner);
  $$(".crop-handle", cropWrap).forEach((h, i) => {
    const p = c[i];
    h.style.left = (p.x * 100) + "%";
    h.style.top  = (p.y * 100) + "%";
  });
}

export function applyCropTransform() {
  const { zoom, panX, panY } = state.crop;
  cropWrap.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  cropHint.textContent = zoom > 1.05
    ? `Zoom ${zoom.toFixed(1)}× · arrastrá para mover`
    : "Pellizcá para zoom · arrastrá las esquinas";
}

function rotateImageDataURL(dataURL, degrees) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight;
      const rad = (degrees * Math.PI) / 180;
      const cos = Math.abs(Math.cos(rad));
      const sin = Math.abs(Math.sin(rad));
      const nw = Math.round(w * cos + h * sin);
      const nh = Math.round(w * sin + h * cos);
      const c = document.createElement("canvas");
      c.width = nw; c.height = nh;
      const ctx = c.getContext("2d");
      ctx.translate(nw / 2, nh / 2);
      ctx.rotate(rad);
      ctx.drawImage(img, -w / 2, -h / 2);
      resolve(c.toDataURL("image/jpeg", 0.92));
    };
    img.onerror = () => resolve(dataURL);
    img.src = dataURL;
  });
}

async function rotateCrop(degrees) {
  if (!state.rawCapture) return;
  cropImg.style.opacity = "0.35";
  const newData = await rotateImageDataURL(state.rawCapture, degrees);
  state.rawCapture = newData;
  state.rotation = ((state.rotation + degrees) % 360 + 360) % 360;
  const c = state.crop.corners;
  let rotated;
  if (degrees === 90) {
    rotated = [
      { x: 1 - c[3].y, y: c[3].x },
      { x: 1 - c[0].y, y: c[0].x },
      { x: 1 - c[1].y, y: c[1].x },
      { x: 1 - c[2].y, y: c[2].x },
    ];
  } else if (degrees === -90) {
    rotated = [
      { x: c[1].y, y: 1 - c[1].x },
      { x: c[2].y, y: 1 - c[2].x },
      { x: c[3].y, y: 1 - c[3].x },
      { x: c[0].y, y: 1 - c[0].x },
    ];
  } else { rotated = c; }
  state.crop.corners = rotated.map((p) => ({
    x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1),
  }));
  state.crop.zoom = 1; state.crop.panX = 0; state.crop.panY = 0;
  applyCropTransform();
  cropImg.onload = () => {
    cropImg.style.opacity = "1";
    requestAnimationFrame(() => drawCropOverlay());
  };
  cropImg.src = state.rawCapture;
  buzz(12);
}

function updateMagnifier(clientX, clientY) {
  const stageRect = cropStage.getBoundingClientRect();
  let mx = clientX - stageRect.left;
  let my = clientY - stageRect.top - MAG_SIZE * 0.55 - 40;
  if (my < 10) my = clientY - stageRect.top + MAG_SIZE * 0.55 + 40;
  mx = clamp(mx, MAG_SIZE / 2 + 4, stageRect.width - MAG_SIZE / 2 - 4);
  cropMagnifier.style.left = mx + "px";
  cropMagnifier.style.top  = my + "px";
  const ctx = cropMagCanvas.getContext("2d");
  ctx.clearRect(0, 0, MAG_SIZE, MAG_SIZE);
  if (!cropImg.complete || !cropImg.naturalWidth) return;
  const rect = cropImg.getBoundingClientRect();
  const nx = (clientX - rect.left) / rect.width;
  const ny = (clientY - rect.top)  / rect.height;
  const px = nx * cropImg.naturalWidth;
  const py = ny * cropImg.naturalHeight;
  const srcSize = MAG_SIZE / state.magnifierZoom;
  try {
    ctx.drawImage(cropImg, px - srcSize/2, py - srcSize/2, srcSize, srcSize, 0, 0, MAG_SIZE, MAG_SIZE);
    ctx.strokeStyle = "rgba(200,255,46,.9)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(MAG_SIZE / 2, MAG_SIZE / 2 - 12);
    ctx.lineTo(MAG_SIZE / 2, MAG_SIZE / 2 + 12);
    ctx.moveTo(MAG_SIZE / 2 - 12, MAG_SIZE / 2);
    ctx.lineTo(MAG_SIZE / 2 + 12, MAG_SIZE / 2);
    ctx.stroke();
  } catch (_) {}
}

function showMagnifier(x, y) { cropMagnifier.classList.add("show"); updateMagnifier(x, y); }
function hideMagnifier()     { cropMagnifier.classList.remove("show"); }

const zoomLevels = [2, 3, 4, 6];

function updateZoomBadge() {
  const badge = $("#zoomBadge");
  if (badge) badge.textContent = state.magnifierZoom + "×";
}

export function polygonArea(corners) {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p = corners[i], q = corners[(i + 1) % 4];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/* --------- WORK CANVAS + WARP --------- */
function getWorkCanvas(imgEl) {
  const nw = imgEl.naturalWidth, nh = imgEl.naturalHeight;
  const scale = Math.min(1, MAX_DIM / Math.max(nw, nh));
  const w = Math.round(nw * scale);
  const h = Math.round(nh * scale);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d").drawImage(imgEl, 0, 0, w, h);
  return c;
}

export async function buildCroppedCanvas() {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = async () => {
      const full = getWorkCanvas(img);
      const c = state.crop.corners;
      if (isNearlyAxisRect(c)) {
        const xs = c.map((p) => p.x), ys = c.map((p) => p.y);
        const x1 = clamp(Math.min(...xs), 0, 1), x2 = clamp(Math.max(...xs), 0, 1);
        const y1 = clamp(Math.min(...ys), 0, 1), y2 = clamp(Math.max(...ys), 0, 1);
        const cw = Math.round((x2 - x1) * full.width);
        const ch = Math.round((y2 - y1) * full.height);
        const out = document.createElement("canvas");
        out.width = Math.max(1, cw); out.height = Math.max(1, ch);
        out.getContext("2d").drawImage(
          full,
          Math.round(x1 * full.width), Math.round(y1 * full.height), cw, ch,
          0, 0, cw, ch
        );
        resolve(out);
        return;
      }
      try {
        const out = await warpPerspectiveAsync(full, c);
        resolve(out);
      } catch (e) {
        console.error("[warp] Falló, usando bounding box:", e);
        const xs = c.map((p) => p.x), ys = c.map((p) => p.y);
        const x1 = clamp(Math.min(...xs), 0, 1), x2 = clamp(Math.max(...xs), 0, 1);
        const y1 = clamp(Math.min(...ys), 0, 1), y2 = clamp(Math.max(...ys), 0, 1);
        const cw = Math.round((x2 - x1) * full.width);
        const ch = Math.round((y2 - y1) * full.height);
        const out = document.createElement("canvas");
        out.width = Math.max(1, cw); out.height = Math.max(1, ch);
        out.getContext("2d").drawImage(
          full,
          Math.round(x1 * full.width), Math.round(y1 * full.height), cw, ch,
          0, 0, cw, ch
        );
        resolve(out);
      }
    };
    img.src = state.rawCapture;
  });
}

/* --------- INIT --------- */
export function initCrop() {
  const activePointers = new Map();
  let gesture = null;

  cropStage.addEventListener("pointerdown", (e) => {
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointers.size === 2) {
      const [a, b] = [...activePointers.values()];
      gesture = { mode: "pinch", initialDist: dist(a, b), initialZoom: state.crop.zoom };
      $$(".crop-handle.active").forEach((h) => h.classList.remove("active"));
      hideMagnifier();
      return;
    }
    if (activePointers.size === 1) {
      const handle = e.target.closest(".crop-handle");
      if (handle) {
        const i = +handle.dataset.i;
        gesture = { mode: "handle", i, pointerId: e.pointerId };
        handle.classList.add("active");
        showMagnifier(e.clientX, e.clientY);
      } else if (state.crop.zoom > 1.05) {
        gesture = {
          mode: "pan", pointerId: e.pointerId,
          start: { x: e.clientX, y: e.clientY },
          startPan: { x: state.crop.panX, y: state.crop.panY },
        };
      }
    }
    cropStage.setPointerCapture(e.pointerId);
  });

  cropStage.addEventListener("pointermove", (e) => {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture?.mode === "pinch" && activePointers.size >= 2) {
      const [a, b] = [...activePointers.values()];
      state.crop.zoom = clamp(gesture.initialZoom * (dist(a, b) / gesture.initialDist), 1, 5);
      applyCropTransform();
      return;
    }
    if (gesture?.mode === "pan" && gesture.pointerId === e.pointerId) {
      state.crop.panX = gesture.startPan.x + (e.clientX - gesture.start.x);
      state.crop.panY = gesture.startPan.y + (e.clientY - gesture.start.y);
      applyCropTransform();
      return;
    }
    if (gesture?.mode === "handle" && gesture.pointerId === e.pointerId) {
      const r = cropWrap.getBoundingClientRect();
      const nx = clamp((e.clientX - r.left) / r.width, 0, 1);
      const ny = clamp((e.clientY - r.top)  / r.height, 0, 1);
      state.crop.corners[gesture.i] = { x: nx, y: ny };
      drawCropOverlay();
      updateMagnifier(e.clientX, e.clientY);
    }
  });

  const endPointer = (e) => {
    activePointers.delete(e.pointerId);
    if (activePointers.size === 0) {
      gesture = null;
      $$(".crop-handle.active").forEach((h) => h.classList.remove("active"));
      hideMagnifier();
    }
    if (gesture?.mode === "pinch" && activePointers.size < 2) gesture = null;
  };
  cropStage.addEventListener("pointerup", endPointer);
  cropStage.addEventListener("pointercancel", endPointer);

  $("#cropZoomLens").addEventListener("click", () => {
    const idx  = zoomLevels.indexOf(state.magnifierZoom);
    const next = zoomLevels[(idx + 1) % zoomLevels.length];
    state.magnifierZoom = next;
    prefs.magnifierZoom = next;
    prefs.save();
    updateZoomBadge();
    buzz(6);
    showToast(`Lupa ${next}×`, 1200);
  });

  $("#cropFull").addEventListener("click", () => {
    state.crop.corners = [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
    ];
    state.crop.zoom = 1; state.crop.panX = 0; state.crop.panY = 0;
    applyCropTransform(); drawCropOverlay();
  });

  $("#cropReset").addEventListener("click", () => {
    state.crop.corners = DEFAULT_CORNERS();
    state.crop.zoom = 1; state.crop.panX = 0; state.crop.panY = 0;
    applyCropTransform(); drawCropOverlay();
  });

  $("#cropRotateL").addEventListener("click", () => rotateCrop(-90));
  $("#cropRotateR").addEventListener("click", () => rotateCrop(90));

  window.addEventListener("resize", () => {
    if ($("#crop").classList.contains("active")) drawCropOverlay();
  });
  window.addEventListener("orientationchange", () => setTimeout(() => {
    if ($("#crop").classList.contains("active")) drawCropOverlay();
  }, 250));
  on("crop:open",   () => openCrop());
  on("crop:redraw", () => drawCropOverlay());
  on("crop:refit",  () => applyCropTransform());
}

export function applyCropTransform_public() {
  const { zoom, panX, panY } = state.crop;
  cropWrap.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
}
