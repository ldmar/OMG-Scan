// src/features/filters-view.js — vista de filtros + pincel + compare.

import { $, clamp, buzz } from "../utils.js";
import { state, prefs, FILTERS } from "../state.js";
import { showToast } from "../ui.js";
import {
  applyFilterToCanvas,
  ensureMask, resetMask, paintDot,
  applyShadowBrushToCanvas, replayStrokes,
} from "../pipeline/filters.js";
import { on } from "../events.js";

const filtersImg     = $("#filtersImg");
const brushCursor    = $("#brushCursor");
const filtersStage   = $("#filtersStage");
const filtersImgWrap = document.querySelector(".filters-img-wrap");

let _renderQueued = false;
function scheduleRenderFinal() {
  if (_renderQueued) return;
  _renderQueued = true;
  requestAnimationFrame(() => {
    _renderQueued = false;
    renderFinal();
  });
}

export function renderFinal() {
  const b = state.brush;
  let out;
  if (b.enabled && b.w && b.mask) {
    out = applyFilterToCanvas(state.preFilterCanvas, state.currentFilter);
    applyShadowBrushToCanvas(out);
  } else {
    out = applyFilterToCanvas(state.preFilterCanvas, state.currentFilter);
  }
  state.renderedCanvas = out;
  filtersImg.src = out.toDataURL("image/jpeg", 0.9);
}

function renderPreviewOnly(filterId) {
  const out = applyFilterToCanvas(state.preFilterCanvas, filterId);
  if (state.brush.enabled && state.brush.mask) applyShadowBrushToCanvas(out);
  filtersImg.src = out.toDataURL("image/jpeg", 0.9);
}

export function buildFilterRail() {
  const rail = $("#filterRail");
  rail.innerHTML = "";
  FILTERS.forEach((f) => {
    const btn = document.createElement("button");
    btn.className = "filter-pill" + (f.id === state.currentFilter ? " on" : "");
    btn.dataset.id = f.id;
    btn.innerHTML = `<div class="swatch"></div><span>${f.label}</span>`;
    btn.addEventListener("click", () => {
      state.currentFilter = f.id;
      prefs.lastFilter = f.id;
      prefs.save();
      rail.querySelectorAll(".filter-pill").forEach((p) =>
        p.classList.toggle("on", p.dataset.id === f.id));
      renderPreviewOnly(f.id);
      buzz();
    });
    rail.appendChild(btn);
  });
  requestAnimationFrame(() => {
    const img = new Image();
    img.onload = () => {
      FILTERS.forEach((f) => {
        const swatch = rail.querySelector(`[data-id="${f.id}"] .swatch`);
        if (!swatch) return;
        const base = document.createElement("canvas");
        const size = 100;
        base.width = size; base.height = size;
        const ctx = base.getContext("2d");
        const ratio = Math.max(size / img.naturalWidth, size / img.naturalHeight);
        const dw = img.naturalWidth * ratio, dh = img.naturalHeight * ratio;
        ctx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh);
        const out = applyFilterToCanvas(base, f.id);
        const outImg = new Image();
        outImg.src = out.toDataURL("image/jpeg", 0.7);
        outImg.style.cssText = "width:100%;height:100%;object-fit:cover;display:block";
        swatch.replaceChildren(outImg);
      });
    };
    img.src = state.cropped;
  });
}

export function commitCurrentPage() {
  return new Promise((resolve) => {
    const dataURL = (state.renderedCanvas || state.preFilterCanvas).toDataURL("image/jpeg", 0.9);
    state.pages.push({ dataURL, filterId: state.currentFilter });
    const badge = $("#pagesBadge");
    const n = state.pages.length;
    if (n > 0) { badge.style.display = ""; badge.textContent = n; }
    else badge.style.display = "none";
    resolve();
  });
}

/* --------- INIT --------- */
export function initFiltersView() {
  const toolFilters = $("#toolFilters");
  const toolBrush   = $("#toolBrush");
  const filterRail  = $("#filterRail");
  const brushPanel  = $("#brushPanel");

  function setBrushEnabled(on) {
    state.brush.enabled = on;
    toolFilters.classList.toggle("on", !on);
    toolBrush.classList.toggle("on", on);
    filterRail.style.display = on ? "none" : "";
    brushPanel.classList.toggle("on", on);
    $("#compareHint").style.opacity = on ? "0" : "";
    if (!on) brushCursor.classList.remove("show");
  }
  
  toolFilters.addEventListener("click", () => setBrushEnabled(false));
  toolBrush.addEventListener("click", () => {
    if (!state.preFilterCanvas) { showToast("Primero cargá una imagen"); return; }
    ensureMask(state.preFilterCanvas.width, state.preFilterCanvas.height);
    setBrushEnabled(true);
    showToast("Pintá sobre las sombras ✨");
  });

  const brushSizeInput     = $("#brushSize");
  const brushStrengthInput = $("#brushStrength");
  brushSizeInput.addEventListener("input", () => {
    state.brush.size = +brushSizeInput.value;
    $("#brushSizeVal").textContent = brushSizeInput.value;
  });
  brushStrengthInput.addEventListener("input", () => {
    state.brush.strength = +brushStrengthInput.value;
    $("#brushStrengthVal").textContent = brushStrengthInput.value;
  });
  $("#brushUndo").addEventListener("click", () => {
    if (!state.brush.strokes.length) return;
    state.brush.strokes.pop();
    replayStrokes();
    scheduleRenderFinal();
    showToast("Trazo deshecho");
  });
  $("#brushClear").addEventListener("click", () => {
    state.brush.strokes = [];
    resetMask();
    scheduleRenderFinal();
    showToast("Pincel limpiado");
  });

  function clientToImage(clientX, clientY) {
    const rect = filtersImg.getBoundingClientRect();
    const nx = (clientX - rect.left) / rect.width;
    const ny = (clientY - rect.top)  / rect.height;
    const c = state.preFilterCanvas;
    return {
      x: nx * c.width,
      y: ny * c.height,
      inBounds: nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1,
      rectW: rect.width,
    };
  }
  function brushRadiusInImage(screenRadius, rectW) {
    const c = state.preFilterCanvas;
    return screenRadius * (c.width / rectW);
  }

  let currentStroke  = null;
  let paintPointerId = null;

  filtersStage.addEventListener("pointerdown", (e) => {
    if (!state.brush.enabled) return;
    e.preventDefault();
    if (paintPointerId !== null) return;
    paintPointerId = e.pointerId;
    filtersStage.setPointerCapture(e.pointerId);
    const pt = clientToImage(e.clientX, e.clientY);
    if (!pt.inBounds) { paintPointerId = null; return; }
    currentStroke = {
      points: [ { x: pt.x, y: pt.y } ],
      radius: brushRadiusInImage(state.brush.size / 2, pt.rectW),
      strength: state.brush.strength,
      erase: false,
    };
    state.isPainting = true;
    const wrapRect = filtersImgWrap.getBoundingClientRect();
    brushCursor.style.width  = state.brush.size + "px";
    brushCursor.style.height = state.brush.size + "px";
    brushCursor.style.left   = (e.clientX - wrapRect.left) + "px";
    brushCursor.style.top    = (e.clientY - wrapRect.top) + "px";
    brushCursor.classList.add("show");
    paintDot(pt.x, pt.y, currentStroke.radius, currentStroke.strength, false);
    scheduleRenderFinal();
    buzz(6);
  });
  filtersStage.addEventListener("pointermove", (e) => {
    if (!state.brush.enabled) return;
    const wrapRect = filtersImgWrap.getBoundingClientRect();
    brushCursor.style.left = (e.clientX - wrapRect.left) + "px";
    brushCursor.style.top  = (e.clientY - wrapRect.top)  + "px";
    if (!state.isPainting || e.pointerId !== paintPointerId) return;
    const pt = clientToImage(e.clientX, e.clientY);
    if (!pt.inBounds) return;
    const last = currentStroke.points[currentStroke.points.length - 1];
    const step = Math.max(1, Math.floor(currentStroke.radius / 3));
    const d = Math.hypot(pt.x - last.x, pt.y - last.y);
    const n = Math.max(1, Math.ceil(d / step));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      paintDot(last.x + (pt.x - last.x) * t, last.y + (pt.y - last.y) * t,
               currentStroke.radius, currentStroke.strength, false);
    }
    currentStroke.points.push({ x: pt.x, y: pt.y });
    scheduleRenderFinal();
  });
  const endPaint = (e) => {
    if (e.pointerId !== paintPointerId) return;
    if (currentStroke && currentStroke.points.length) {
      state.brush.strokes.push(currentStroke);
    }
    currentStroke = null;
    paintPointerId = null;
    state.isPainting = false;
  };
  filtersStage.addEventListener("pointerup", endPaint);
  filtersStage.addEventListener("pointercancel", endPaint);
  filtersStage.addEventListener("pointerleave", () => {
    brushCursor.classList.remove("show");
  });
  filtersStage.addEventListener("pointerenter", () => {
    if (state.brush.enabled) brushCursor.classList.add("show");
  });

  /* COMPARE */
  let originalSrc = null;
  const onDown = (e) => {
    if (state.brush.enabled) return;
    if (e.target.closest(".brush-cursor")) return;
    originalSrc = filtersImg.src;
    filtersImg.src = state.cropped;
    $("#compareHint").style.opacity = "0";
  };
  const onUp = () => {
    if (originalSrc) { filtersImg.src = originalSrc; originalSrc = null; }
    $("#compareHint").style.opacity = "";
  };
  filtersStage.addEventListener("pointerdown", onDown);
  filtersStage.addEventListener("pointerup", onUp);
  filtersStage.addEventListener("pointercancel", onUp);
  
  on("filters:brush-set", ({ enabled }) => setBrushEnabled(enabled));
  
}
