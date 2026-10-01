// src/main.js — orquestador. Solo boot, wiring de navegación e inits.

import { $ } from "./utils.js";
import { state, prefs } from "./state.js";
import {
  show, views, showToast,
  initModals, initSheet,
} from "./ui.js";

import {
  startCamera, stopCamera, capture,
  initCamera,
} from "./features/camera.js";
import {
  openCrop, initCrop,
  buildCroppedCanvas, polygonArea,
} from "./features/crop.js";
import {
  initFiltersView, buildFilterRail,
  renderFinal, commitCurrentPage,
} from "./features/filters-view.js";
import {
  initLiveDetect, cancelAutoShutter, updateAutoShutterBtn,
} from "./features/live-detect.js";
import {
  loadQuadscan, preloadQuadscan, autoDetectEdges, updateAutoDetectBtn, initQuadscan,
} from "./features/quadscan.js";
import {
  runOCR, preloadTesseract, initOcr,
} from "./features/ocr.js";
import {
  initLibrary, renderLibrary, openLibrary, openDoc,
  saveCurrentToLibrary, refreshLibraryCount,
} from "./features/library.js";
import { initInstall } from "./features/install.js";
import { makePDFFromPages, downloadPDF, sharePDF } from "./features/pdf.js";
import { straightenCanvas } from "./pipeline/straighten.js";
import { flatFieldCorrect } from "./pipeline/flat-field.js";
import { on, emit } from "./events.js";

/* =========================================================
   FLUJO CROP → FILTERS (goToFilters) — queda acá
   ========================================================= */
async function goToFilters() {
  if (polygonArea(state.crop.corners) < 0.01) {
    showToast("El área seleccionada es muy chica"); return;
  }
  const btn = $("#cropNext");
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Procesando…`;
  await new Promise((r) => setTimeout(r, 30));
  try {
    let canvas = await buildCroppedCanvas();
    
    // Flat-field: corrige iluminación no uniforme
    btn.innerHTML = `<span class="spinner"></span> Corrigiendo iluminación…`;
    await new Promise((r) => setTimeout(r, 20));
    canvas = flatFieldCorrect(canvas, { strength: 0.75 });
    
    if (state.autoStraighten) {
      btn.innerHTML = `<span class="spinner"></span> Enderezando…`;
      await new Promise((r) => setTimeout(r, 20));
      const res = straightenCanvas(canvas);
      if (Math.abs(res.angle) >= 0.4) {
        canvas = res.canvas;
        showToast(`Enderezado ${res.angle > 0 ? "+" : ""}${res.angle.toFixed(1)}°`, 1600);
      }
    }
    state.preFilterCanvas = canvas;
    state.cropped = canvas.toDataURL("image/jpeg", 0.92);
    state.brush.mask = null;
    state.brush.strokes = [];
    state.brush.w = 0;
    state.brush.h = 0;
    // ensureMask desde pipeline
    const { ensureMask } = await import("./pipeline/filters.js");
    ensureMask(canvas.width, canvas.height);
    show("filters");
    buildFilterRail();
    renderFinal();
  } catch (e) {
    console.error("[goToFilters]", e);
    showToast("Error al procesar: " + (e.message || ""));
  } finally {
    btn.disabled = false;
    btn.innerHTML = old;
  }
}

function updateStraightenBtn() {
  const btn = $("#cropStraighten");
  if (!btn) return;
  btn.classList.toggle("toggle-on", state.autoStraighten);
  btn.textContent = state.autoStraighten ? "📐 Enderezar ✓" : "📐 Enderezar";
}

function updatePagesBadge() {
  const n = state.pages.length;
  const badge = $("#pagesBadge");
  if (n > 0) { badge.style.display = ""; badge.textContent = n; }
  else badge.style.display = "none";
}

function updateDoneScreen() {
  const n = state.pages.length;
  $("#doneSub").textContent =
    n === 0 ? "Sin páginas" :
    n === 1 ? "1 página lista" :
              `${n} páginas listas`;
  $("#btnSaveLib").textContent = state.currentDocId
    ? "💾 Actualizar en biblioteca"
    : "💾 Guardar en biblioteca";
}

/* =========================================================
   START SCAN (usado por home + biblioteca vacía)
   ========================================================= */
async function startScan() {
  state.pages = [];
  state.currentDocId = null;
  updatePagesBadge();
  show("camera");
  await startCamera();
  // camera.js emite "camera:started" → live-detect reanuda si corresponde
}
window.__omgStartScan = startScan;

/* =========================================================
   INIT + WIRING
   ========================================================= */
initModals();
initSheet();
initCamera();
initCrop();
initQuadscan();
initFiltersView();
initLiveDetect({ onCapture: () => capture({ onCaptured: openCrop }) });
initOcr();
initLibrary();
initInstall();

on("scan:start", startScan);

/* --- Handlers de navegación --- */
$("#btnStart").addEventListener("click", startScan);
$("#btnLibrary").addEventListener("click", openLibrary);
$("#btnClose").addEventListener("click", () => { stopCamera(); show("home"); });
$("#btnShutter").addEventListener("click", () => capture({ onCaptured: openCrop }));

$("#cropCancel").addEventListener("click", async () => {
  state.crop.zoom = 1; state.crop.panX = 0; state.crop.panY = 0;
  $("#cropWrap").style.transform = "";
  show("camera"); await startCamera();
});
$("#cropAuto").addEventListener("click", autoDetectEdges);
$("#cropNext").addEventListener("click", goToFilters);
$("#cropStraighten").addEventListener("click", () => {
  state.autoStraighten = !state.autoStraighten;
  prefs.autoStraighten = state.autoStraighten;
  prefs.save();
  updateStraightenBtn();
  navigator.vibrate && navigator.vibrate(8);
  showToast(state.autoStraighten
    ? "Enderezado automático activado"
    : "Enderezado automático desactivado", 1400);
});

$("#filtersBack").addEventListener("click", () => {
  emit("filters:brush-set", { enabled: false });
  show("crop");
  requestAnimationFrame(() => emit("crop:redraw"));
});
$("#filtersAddPage").addEventListener("click", async () => {
  await commitCurrentPage();
  showToast("Página agregada ✓");
  state.rawCapture = null;
  state.cropped = null;
  show("camera");
  await startCamera();
});
$("#filtersDone").addEventListener("click", async () => {
  await commitCurrentPage();
  updateDoneScreen();
  show("done");
});

$("#btnPdf").addEventListener("click", async () => {
  if (!state.pages.length) return;
  try {
    showToast("Generando PDF…");
    const bytes = await makePDFFromPages(state.pages);
    const name = "OMG-Scan-" + new Date().toISOString().slice(0, 10) + ".pdf";
    downloadPDF(bytes, name);
    showToast("PDF descargado ✓");
    navigator.vibrate && navigator.vibrate(20);
  } catch (e) { showToast(e.message || "Error al generar PDF"); }
});
$("#btnShare").addEventListener("click", async () => {
  if (!state.pages.length) return;
  try {
    showToast("Preparando PDF…");
    const bytes = await makePDFFromPages(state.pages);
    const name = "OMG-Scan-" + new Date().toISOString().slice(0, 10) + ".pdf";
    const r = await sharePDF(bytes, name);
    if (r === false) {
      downloadPDF(bytes, name);
      showToast("PDF descargado (compartir no disponible)");
    }
  } catch (e) { showToast(e.message || "Error al compartir"); }
});
$("#btnOcr").addEventListener("click", async () => {
  if (!state.pages.length) return;
  await runOCR(state.pages.map((p) => p.dataURL));
});
$("#btnSaveLib").addEventListener("click", saveCurrentToLibrary);
$("#btnNew").addEventListener("click", startScan);

$("#libBack").addEventListener("click", () => show("home"));
$("#docBack").addEventListener("click", () => {
  state.currentDocId = null;
  show("library"); renderLibrary();
});
$("#docPdf").addEventListener("click", async () => {
  if (!state.currentDocId) return;
  const { dbGet } = await import("./db.js");
  const doc = await dbGet(state.currentDocId);
  if (!doc) return;
  showToast("Generando PDF…");
  const bytes = await makePDFFromPages(doc.pages);
  const safe = doc.name.replace(/[^a-z0-9\-_ ]/gi, "").trim() || "OMG-Scan";
  downloadPDF(bytes, `${safe}.pdf`);
  showToast("PDF descargado ✓");
});
$("#docShare").addEventListener("click", async () => {
  if (!state.currentDocId) return;
  const { dbGet } = await import("./db.js");
  const doc = await dbGet(state.currentDocId);
  if (!doc) return;
  showToast("Preparando PDF…");
  const bytes = await makePDFFromPages(doc.pages);
  const safe = doc.name.replace(/[^a-z0-9\-_ ]/gi, "").trim() || "OMG-Scan";
  const r = await sharePDF(bytes, `${safe}.pdf`);
  if (r === false) {
    downloadPDF(bytes, `${safe}.pdf`);
    showToast("PDF descargado");
  }
});
$("#docOcr").addEventListener("click", async () => {
  if (!state.currentDocId) return;
  const { dbGet } = await import("./db.js");
  const { blobToDataURL } = await import("./utils.js");
  const doc = await dbGet(state.currentDocId);
  if (!doc) return;
  const urls = await Promise.all(doc.pages.map((p) => blobToDataURL(p.blob)));
  await runOCR(urls, doc.name);
});

/* --- Ciclo de vida --- */
document.addEventListener("visibilitychange", () => {
  if (document.hidden && state.stream) {
    state.stream.getVideoTracks().forEach((t) => t.enabled = false);
  } else if (!document.hidden && state.stream) {
    state.stream.getVideoTracks().forEach((t) => t.enabled = true);
  }
});

/* --- Service Worker --- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js", { scope: "./" })
      .then((reg) => setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000))
      .catch((e) => console.warn("[SW]", e));
  });
}

/* --- Boot --- */
(function boot() {
  updateAutoDetectBtn();
  updateStraightenBtn();
  updateAutoShutterBtn();

  const params = new URLSearchParams(location.search);
  const action = params.get("action");
  if (action === "scan") { startScan(); }
  else if (action === "library") { openLibrary(); }

  setTimeout(() => {
    preloadQuadscan();
    setTimeout(preloadTesseract, 5000);
  }, 800);
})();
