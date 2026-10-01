// src/features/quadscan.js — carga y uso de Quadscan (auto-detección de bordes).

import { $, clamp, buzz } from "../utils.js";
import { state } from "../state.js";
import {
  showLibOverlay, hideLibOverlay, handleProgress,
  preloadState, setCurrentLibURL, showToast,
} from "../ui.js";
import { LibraryLoader } from "../loader.js";
import { emit, on } from "../events.js";
import { isValidQuad, scoreQuadWithContent } from "../pipeline/quad-validate.js";

const QUADSCAN_URL = "https://cdn.jsdelivr.net/npm/quadscan/dist/quadscan.iife.js";

export async function loadQuadscan({ silent = false } = {}) {
  if (state.quadscanReady && state.quadscanInstance) return state.quadscanInstance;
  if (state.quadscanPromise) return state.quadscanPromise;
  if (state.quadscanFailed) throw new Error("Quadscan no disponible");
  state.quadscanPromise = (async () => {
    if (!window.Quadscan) {
      setCurrentLibURL(QUADSCAN_URL);
      const { promise } = LibraryLoader.load(QUADSCAN_URL, {
        name: "IA de precisión",
        onProgress: (st) => handleProgress(st, {
          silent, label: "IA de precisión", icon: "🎯",
          trackPreload: "quadscan", showCancel: true,
        }),
      });
      await promise;
    }
    setCurrentLibURL(null);
    const Cls = (window.Quadscan && window.Quadscan.Quadscan) || window.Quadscan;
    if (typeof Cls !== "function") throw new Error("Quadscan clase no encontrada");
    const instance = new Cls();
    if (!silent) {
      showLibOverlay({
        icon: "🎯", name: "IA de precisión",
        status: "Inicializando modelo…", percent: 0.9,
        meta: "Descargando red neuronal (~4.5 MB)",
        note: "Solo la primera vez. Después queda cacheado.",
      });
    }
    await instance.initialize();
    state.quadscanInstance = instance;
    state.quadscanReady    = true;
    state.quadscanPromise  = null;
    updateAutoDetectBtn();
    emit("autoshutter:btn-changed");
    if (!silent) {
      showLibOverlay({
        icon: "✅", name: "IA de precisión", status: "¡Listo!",
        percent: 1, meta: "", note: "",
      });
      setTimeout(hideLibOverlay, 350);
    }
    return instance;
  })().catch((e) => {
    console.warn("[quadscan] Falló:", e.message);
    state.quadscanFailed  = true;
    state.quadscanPromise = null;
    updateAutoDetectBtn();
    emit("autoshutter:btn-changed");
    if (!silent) hideLibOverlay();
    throw e;
  });
  return state.quadscanPromise;
}

export async function preloadQuadscan() {
  try { await loadQuadscan({ silent: true }); preloadState.quadscan = 1; }
  catch (e) { preloadState.quadscan = "error"; }
  updateAutoDetectBtn();
}

export function updateAutoDetectBtn() {
  const btn = $("#cropAuto");
  if (!btn) return;
  btn.classList.remove("laser", "cargando", "fallado");
  if (state.quadscanReady) {
    btn.classList.add("laser");
    btn.disabled = false;
    btn.textContent = "✨ Auto-detectar";
  } else if (state.quadscanFailed) {
    btn.classList.add("fallado");
    btn.disabled = false;
    btn.textContent = "⚠️ IA no disponible";
  } else {
    const pct = Math.round((preloadState.quadscan || 0) * 100);
    btn.classList.add("cargando");
    btn.disabled = false;
    btn.textContent = `⏳ Preparando IA… ${pct}%`;
  }
}

function expandQuad(corners, pctOfSize, minMargin) {
  const cx = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
  const cy = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4;
  return corners.map((p) => {
    const sdx = Math.sign(p.x - cx) || 1;
    const sdy = Math.sign(p.y - cy) || 1;
    const dxRel = Math.abs(p.x - cx) * pctOfSize;
    const dyRel = Math.abs(p.y - cy) * pctOfSize;
    const dx = Math.max(dxRel, minMargin) * sdx;
    const dy = Math.max(dyRel, minMargin) * sdy;
    return {
      x: clamp(p.x + dx, 0, 1),
      y: clamp(p.y + dy, 0, 1),
    };
  });
}
export async function autoDetectEdges() {
  const cropImg = $("#cropImg");
  if (!cropImg.complete || !cropImg.naturalWidth) {
    showToast("Esperá a que la imagen cargue"); return;
  }
  if (!state.quadscanReady) {
    if (state.quadscanFailed) {
      showToast("IA no disponible en este dispositivo. Ajustá a mano."); return;
    }
    showLibOverlay({
      icon: "🎯", name: "IA de precisión",
      status: "Preparando detector…",
      percent: preloadState.quadscan || 0.05,
      meta: "El primer escaneo descarga el modelo (~4.5 MB)",
      note: "Después queda cacheado y es instantáneo.",
    });
    try { await loadQuadscan({ silent: true }); }
    catch (e) { hideLibOverlay(); showToast("No pudimos cargar la IA."); return; }
    hideLibOverlay();
  }
  const btn = $("#cropAuto");
  btn.disabled = true;
  btn.textContent = "⏳ Detectando…";
  await new Promise((r) => setTimeout(r, 40));
  try {
    const t0 = performance.now();
    const result = await state.quadscanInstance.scan(cropImg);
    const ms = Math.round(performance.now() - t0);
    if (!result || !result.success || !result.corners) {
      showToast("No detectamos bordes. Ajustá a mano."); return;
    }
    const w = cropImg.naturalWidth;
    const h = cropImg.naturalHeight;
    const { topLeft, topRight, bottomRight, bottomLeft } = result.corners;
    const pad = 0.005;
    let newCorners = [
      { x: clamp(topLeft.x / w - pad, 0, 1),     y: clamp(topLeft.y / h - pad, 0, 1)     },
      { x: clamp(topRight.x / w + pad, 0, 1),    y: clamp(topRight.y / h - pad, 0, 1)    },
      { x: clamp(bottomRight.x / w + pad, 0, 1), y: clamp(bottomRight.y / h + pad, 0, 1) },
      { x: clamp(bottomLeft.x / w - pad, 0, 1),  y: clamp(bottomLeft.y / h + pad, 0, 1)  },
    ];
    // Expandir 2.5% hacia afuera del centro, para no cortar márgenes del papel
    newCorners = expandQuad(newCorners, 0.05, 0.045);
    // cual quier cosa subirlo a expandQuad(newCorners, 0.07, 0.06)

    // Validación geométrica dura
    if (!isValidQuad(newCorners)) {
      showToast("No pude encuadrar bien. Ajustá a mano.", 2200);
      buzz(30);
      return;
    }

    // Scoring con análisis de contenido
    const { score, reason, interior } = scoreQuadWithContent(cropImg, newCorners, result.confidence);

    if (score < 0.35) {
      const msg = reason === "interior-texturado" || reason === "interior-mixto"
        ? "Mucho fondo alrededor. Acercate al doc o ajustá a mano."
        : reason === "interior-oscuro" || reason === "poco-papel"
        ? "Poca luz o poco papel. Mejorá la iluminación."
        : "Detección dudosa. Ajustá las esquinas.";
      showToast(msg, 2400);
      buzz(30);
      return;
    }
    state.crop.corners = newCorners;
    state.crop.zoom = 1; state.crop.panX = 0; state.crop.panY = 0;
    emit("crop:refit");
    emit("crop:redraw");
    buzz(20);

    const conf = typeof result.confidence === "number"
      ? Math.round(result.confidence * 100) : null;
    const pct  = Math.round(score * 100);

    if (score >= 0.7) {
      showToast(conf != null
        ? `Bordes detectados ✨ ${conf}% · ${ms}ms`
        : `Bordes detectados ✨ ${ms}ms`);
    } else {
      // Score medio: aplica pero avisa
      showToast(`Encuadre aproximado (${pct}%). Revisá las esquinas.`, 2400);
    }
  } catch (e) {
    console.error("[autoDetect]", e);
    showToast("Error al detectar: " + (e.message || "desconocido"));
  } finally {
    updateAutoDetectBtn();
  }
}

export function initQuadscan() {
  on("quadscan:btn-changed", updateAutoDetectBtn);
}
