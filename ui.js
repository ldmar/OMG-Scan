// src/ui.js — capa de UI compartida. Importa utils + loader.

import { $, $$ } from "./utils.js";
import { LibraryLoader } from "./loader.js";

/* ------------ VIEWS ------------ */
export const views = {
  home:    $("#home"),
  camera:  $("#camera"),
  crop:    $("#crop"),
  filters: $("#filters"),
  done:    $("#done"),
  library: $("#library"),
  doc:     $("#doc"),
};
export function show(name) {
  Object.values(views).forEach((v) => v.classList.remove("active"));
  views[name].classList.add("active");
}

/* ------------ TOAST ------------ */
const toast = $("#toast");
export function showToast(msg, ms = 1900) {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove("show"), ms);
}

/* ------------ MODALES ------------ */
export function initModals() {
  $$(".modal-backdrop").forEach((m) => {
    m.addEventListener("click", (e) => {
      if (e.target === m || e.target.hasAttribute("data-close")) m.classList.remove("show");
    });
  });
}

/* ------------ SHEET ------------ */
const sheetBackdrop = $("#sheetBackdrop");
const sheetTitle    = $("#sheetTitle");
const sheetItems    = $("#sheetItems");

export function openSheet(title, items) {
  sheetTitle.textContent = title;
  sheetItems.innerHTML = "";
  items.forEach((it) => {
    const btn = document.createElement("button");
    btn.className = "sheet-item" + (it.danger ? " danger" : "");
    btn.innerHTML = `<span class="ico">${it.icon}</span><span>${it.label}</span>`;
    btn.addEventListener("click", async () => {
      closeSheet();
      try { await it.action(); }
      catch (e) { console.error(e); showToast("Error: " + (e.message || "")); }
    });
    sheetItems.appendChild(btn);
  });
  sheetBackdrop.classList.add("show");
}
export function closeSheet() { sheetBackdrop.classList.remove("show"); }
export function initSheet() {
  $("#sheetCancel").addEventListener("click", closeSheet);
  sheetBackdrop.addEventListener("click", (e) => {
    if (e.target === sheetBackdrop) closeSheet();
  });
}

/* ------------ LIB OVERLAY + PRELOAD CHIP ------------ */
const libOverlay  = $("#libOverlay");
const libIcon     = $("#libIcon");
const libNameEl   = $("#libName");
const libStatusEl = $("#libStatus");
const libBarFill  = $("#libBarFill");
const libMetaEl   = $("#libMeta");
const libNoteEl   = $("#libNote");
const libCancelBtn = $("#libCancel");

const preloadChip = $("#preloadChip");
const preloadTxt  = $("#preloadTxt");
const preloadPct  = $("#preloadPct");

let currentLibURL = null;
export function setCurrentLibURL(url) { currentLibURL = url; }

export const preloadState = { quadscan: 0, tesseract: 0 };

export function updatePreloadChip() {
  const vals = Object.values(preloadState);
  if (!vals.length) return;
  const numericVals = vals.map((v) => typeof v === "number" ? v : 0);
  const avg         = numericVals.reduce((a, b) => a + b, 0) / numericVals.length;
  const allDone     = vals.every((v) => v === 1);
  const anyError    = vals.some((v) => v === "error");

  preloadChip.classList.add("show");
  preloadChip.classList.remove("error", "done");

  if (allDone) {
    preloadChip.classList.add("done");
    preloadTxt.textContent = "Todo listo";
    preloadPct.textContent = "✓";
    clearTimeout(preloadChip._hideTimer);
    preloadChip._hideTimer = setTimeout(() => preloadChip.classList.remove("show"), 2200);
    return;
  }
  if (anyError && preloadState.quadscan === "error" && preloadState.tesseract !== 1) {
    preloadTxt.textContent = "Cargando OCR…";
    preloadPct.textContent = Math.round((preloadState.tesseract || 0) * 100) + "%";
    return;
  }
  preloadTxt.textContent = "Preparando IA…";
  preloadPct.textContent = Math.round(avg * 100) + "%";
}

export function showLibOverlay({ icon, name, status, percent, meta, note, showCancel }) {
  libIcon.textContent = icon || "⚙️";
  libIcon.classList.toggle("spin", !percent || percent < 1);
  libNameEl.textContent   = name    || "Preparando…";
  libStatusEl.textContent = status  || "";
  libBarFill.style.width  = Math.round((percent || 0) * 100) + "%";
  libMetaEl.textContent   = meta    || "";
  libNoteEl.textContent   = note    || "";
  libCancelBtn.style.display = (showCancel && currentLibURL) ? "" : "none";
  libOverlay.classList.add("show");
}
export function hideLibOverlay() { libOverlay.classList.remove("show"); }

libCancelBtn.addEventListener("click", () => {
  if (currentLibURL) {
    LibraryLoader.abort(currentLibURL);
    showToast("Descarga cancelada. Podés reintentar.");
  }
  hideLibOverlay();
});

export function handleProgress(st, {
  silent = false, label = "", icon = "⚙️",
  trackPreload = null, showCancel = false,
} = {}) {
  if (trackPreload && preloadState[trackPreload] !== undefined) {
    if (st.phase === "download") {
      preloadState[trackPreload] = st.total ? st.percent : 0;
      updatePreloadChip();
    } else if (st.phase === "fallback") {
      preloadState[trackPreload] = Math.max(preloadState[trackPreload] || 0, 0.1);
      updatePreloadChip();
    } else if (st.phase === "ready") {
      preloadState[trackPreload] = 1;
      updatePreloadChip();
    } else if (st.phase === "error") {
      preloadState[trackPreload] = "error";
      updatePreloadChip();
    }
  }
  if (silent) return;

  if (st.phase === "download") {
    const pct  = st.total ? Math.round(st.percent * 100) : 0;
    const meta = st.total
      ? `${LibraryLoader.fmtBytes(st.loaded)} / ${LibraryLoader.fmtBytes(st.total)} · ${pct}%${
          st.eta > 0 ? " · ~" + LibraryLoader.fmtTime(st.eta) + " restantes" : ""
        }`
      : `${LibraryLoader.fmtBytes(st.loaded)} descargados`;
    showLibOverlay({
      icon, name: label, status: "Descargando…",
      percent: st.total ? st.percent : 0.1,
      meta, note: "Solo la primera vez. Después queda cacheado.", showCancel,
    });
  } else if (st.phase === "fallback") {
    showLibOverlay({
      icon, name: label,
      status: "Descargando (progreso no disponible)…",
      percent: 0.5,
      meta: "El servidor no permite medir el progreso",
      note: "Puede tardar unos segundos. Solo la primera vez.", showCancel,
    });
  } else if (st.phase === "injecting") {
    showLibOverlay({
      icon, name: label, status: "Inicializando motor…",
      percent: 0.95, meta: "", note: "", showCancel,
    });
  } else if (st.phase === "ready") {
    showLibOverlay({
      icon: "✅", name: label, status: "¡Listo!",
      percent: 1, meta: "", note: "",
    });
    setTimeout(hideLibOverlay, 350);
  } else if (st.phase === "error") {
    hideLibOverlay();
  }
}