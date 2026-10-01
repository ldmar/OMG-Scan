// src/features/ocr.js — extracción de texto con Tesseract.js.

import { $, clamp, buzz } from "../utils.js";
import { state } from "../state.js";
import {
  showToast, handleProgress, preloadState, setCurrentLibURL,
} from "../ui.js";
import { LibraryLoader } from "../loader.js";
import { preprocessForOCR, prepareForOCR } from "../pipeline/ocr-preprocess.js";

const ocrOverlay    = $("#ocrOverlay");
const ocrTitle      = $("#ocrTitle");
const ocrStatus     = $("#ocrStatus");
const ocrBarFill    = $("#ocrBarFill");
const ocrText       = $("#ocrText");
const ocrActions    = $("#ocrActions");
const ocrRing       = $("#ocrRing");
const ocrConfidence = $("#ocrConfidence");
const ocrConfValue  = $("#ocrConfValue");
const ocrSubline    = $("#ocrSubline");
const ocrRetryBtn   = $("#ocrRetry");

const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";

let tesseractPromise = null;
let ocrWorker = null;
let lastOCRData = null;

function ensureTesseract({ silent = false, trackPreload = null } = {}) {
  if (tesseractPromise) return tesseractPromise;
  setCurrentLibURL(TESSERACT_URL);
  const { promise } = LibraryLoader.load(TESSERACT_URL, {
    name: "Motor OCR",
    onProgress: (st) => handleProgress(st, {
      silent, label: "Motor OCR", icon: "📝",
      trackPreload, showCancel: !silent,
    }),
  });
  tesseractPromise = promise.then(() => {
    if (!window.Tesseract) throw new Error("Tesseract no cargó");
    return window.Tesseract;
  }).catch((e) => {
    tesseractPromise = null;
    throw e;
  });
  return tesseractPromise;
}

export async function preloadTesseract() {
  try {
    await ensureTesseract({ silent: true, trackPreload: "tesseract" });
    preloadState.tesseract = 1;
  } catch (e) {
    console.warn("[preload] Tesseract falló:", e.message);
    preloadState.tesseract = "error";
  }
}

async function getOCRWorker(logger) {
  if (ocrWorker) return ocrWorker;
  const Tesseract = await ensureTesseract({ silent: false });
  ocrWorker = await Tesseract.createWorker(["spa", "eng"], 1, { logger });
  return ocrWorker;
}

async function configureOCRWorker(worker, { mode = "normal" } = {}) {
  const params = {
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
    tessedit_pageseg_mode: mode === "aggressive" ? "6" : "3",
    textord_tablefind_recognize_tables: "1",
    textord_tabfind_find_tables: "1",
  };
  try { await worker.setParameters(params); } catch (_) {}
}

export async function runOCR(dataURLs, docName = "", { mode = "normal", isRetry = false } = {}) {
  ocrOverlay.classList.add("show");
  ocrRing.style.display = "";
  ocrText.style.display = "none";
  ocrText.value = "";
  ocrActions.style.display = "none";
  ocrConfidence.classList.remove("show", "good", "medium", "bad");
  ocrSubline.style.display = "none";
  ocrRetryBtn.style.display = "none";
  ocrTitle.textContent = isRetry ? "Reintentando con más agresividad…" : "Extrayendo texto…";
  ocrStatus.textContent = "Preparando imágenes…";
  ocrBarFill.style.width = "0%";
  if (!isRetry) lastOCRData = { dataURLs: [...dataURLs], docName };

  let totalProgress = 0;
  const progressPerPage = 1 / dataURLs.length;
  try {
    const logger = (m) => {
      if (m.status === "recognizing text") {
        const inner = m.progress || 0;
        const overall = (totalProgress + inner * progressPerPage) * 100;
        ocrBarFill.style.width = Math.round(overall) + "%";
        ocrStatus.textContent = `Reconociendo… ${Math.round(overall)}%`;
        return;
      }
      if (m.status === "loading language traineddata") {
        const pct = Math.round((m.progress || 0) * 100);
        ocrStatus.textContent = `Cargando idioma… ${pct}% (solo la primera vez)`;
        return;
      }
      if (m.status === "initializing api") ocrStatus.textContent = "Inicializando OCR…";
    };
    const worker = await getOCRWorker(logger);
    await configureOCRWorker(worker, { mode });

    const fullText = [];
    const confidences = [];
    for (let i = 0; i < dataURLs.length; i++) {
      ocrStatus.textContent = `Preparando página ${i + 1} de ${dataURLs.length}…`;
      const prepared = await prepareForOCR(dataURLs[i], { mode });
      const preparedURL = prepared.toDataURL("image/jpeg", 0.92);
      ocrStatus.textContent = `Página ${i + 1} de ${dataURLs.length}…`;
      const { data } = await worker.recognize(preparedURL);
      fullText.push((data.text || "").trim());
      let conf = typeof data.confidence === "number" ? data.confidence : null;
      if (conf == null && Array.isArray(data.words) && data.words.length) {
        const sum = data.words.reduce((a, w) => a + (w.confidence || 0), 0);
        conf = sum / data.words.length;
      }
      if (conf != null && isFinite(conf)) confidences.push(conf);
      totalProgress += progressPerPage;
      ocrBarFill.style.width = Math.round(totalProgress * 100) + "%";
    }
    const out = fullText.join("\n\n———\n\n");
    const avgConf = confidences.length
      ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length)
      : null;
    ocrRing.style.display = "none";
    ocrTitle.textContent = "Texto extraído";
    ocrStatus.textContent = `${out.length} caracteres · ${dataURLs.length} página(s)`;
    ocrBarFill.style.width = "100%";
    if (avgConf != null) {
      ocrConfValue.textContent = avgConf + "%";
      ocrConfidence.classList.add("show");
      if (avgConf >= 80)      ocrConfidence.classList.add("good");
      else if (avgConf >= 60) ocrConfidence.classList.add("medium");
      else                    ocrConfidence.classList.add("bad");
      if (avgConf < 60 && !isRetry) {
        ocrSubline.textContent = "La confianza es baja. Podés reintentar con un procesado más agresivo.";
        ocrSubline.style.display = "";
        ocrRetryBtn.style.display = "";
      } else if (avgConf < 60 && isRetry) {
        ocrSubline.textContent = "El resultado sigue siendo bajo. Probá con una foto más nítida o mejor iluminada.";
        ocrSubline.style.display = "";
      }
    }
    ocrText.value = out || "(sin texto reconocible)";
    ocrText.style.display = "";
    ocrActions.style.display = "";
    buzz(20);
  } catch (e) {
    console.error("[OCR]", e);
    ocrRing.style.display = "none";
    ocrTitle.textContent = "No pudimos extraer texto";
    ocrStatus.textContent = e.message || "Error desconocido";
    setTimeout(() => ocrOverlay.classList.remove("show"), 2400);
  }
}

export function initOcr() {
  ocrRetryBtn.addEventListener("click", async () => {
    if (!lastOCRData) return;
    ocrRetryBtn.style.display = "none";
    await runOCR(lastOCRData.dataURLs, lastOCRData.docName, { mode: "aggressive", isRetry: true });
  });
  $("#ocrClose").addEventListener("click", () => ocrOverlay.classList.remove("show"));
  $("#ocrCopy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(ocrText.value);
      showToast("Texto copiado ✓");
    } catch (_) {
      ocrText.select(); document.execCommand("copy");
      showToast("Texto copiado ✓");
    }
  });
  $("#ocrShare").addEventListener("click", async () => {
    const text = ocrText.value;
    if (!text) return;
    if (navigator.share) {
      try { await navigator.share({ title: "OMG Scan · OCR", text }); } catch (_) {}
    } else {
      try { await navigator.clipboard.writeText(text); showToast("Texto copiado ✓"); } catch (_) {}
    }
  });
}