// src/features/library.js — biblioteca + doc detail + save + modales.

import { $, uuid, buzz, formatDate, defaultName, escapeHtml, blobToDataURL } from "../utils.js";
import { state } from "../state.js";
import { show, showToast, openSheet, closeSheet } from "../ui.js";
import { dbPut, dbGet, dbGetAll, dbDelete, dbCount } from "../db.js";
import { makePDFFromPages, downloadPDF, sharePDF } from "./pdf.js";
import { runOCR } from "./ocr.js";
import { emit } from "../events.js";

const urlCache = new Map();
export function blobURL(blob) {
  if (!blob) return "";
  if (urlCache.has(blob)) return urlCache.get(blob);
  const url = URL.createObjectURL(blob);
  urlCache.set(blob, url);
  return url;
}

async function refreshLibraryCount() {
  try {
    const n = await dbCount();
    const b = $("#libCount");
    if (n > 0) { b.style.display = ""; b.textContent = n; }
    else b.style.display = "none";
  } catch (_) {}
}

export async function openLibrary() { show("library"); renderLibrary(); }

export async function renderLibrary() {
  const grid = $("#libGrid");
  grid.innerHTML = `<div class="lib-empty">⏳</div>`;
  let docs = [];
  try { docs = await dbGetAll(); } catch (e) { console.error(e); }
  if (!docs.length) {
    grid.innerHTML = `
      <div class="lib-empty">
        <svg viewBox="0 0 24 24"><path d="M4 4h11l5 5v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><polyline points="14 4 14 10 20 10"/></svg>
        <div class="empty-title">Biblioteca vacía</div>
        <div class="empty-sub">Tus escaneos aparecerán acá.<br/>Escaneá tu primer documento.</div>
        <button class="btn primary" id="emptyStart" style="margin-top:8px">Escanear ahora</button>
      </div>`;
    $("#emptyStart").addEventListener("click", () => {
      emit("scan:start");
    });
    return;
  }
  grid.innerHTML = "";
  docs.forEach((doc) => {
    const card = document.createElement("div");
    card.className = "lib-card";
    card.innerHTML = `
      <div class="lib-thumb">
        <img src="${blobURL(doc.thumbnail)}" alt="" />
        <div class="pages-badge">${doc.pages.length}p</div>
      </div>
      <div class="lib-meta">
        <div class="lib-name">${escapeHtml(doc.name)}</div>
        <div class="lib-sub">${formatDate(doc.updatedAt)}</div>
      </div>`;
    card.addEventListener("click", () => openDoc(doc.id));
    grid.appendChild(card);
  });
}

async function makeThumbnail(dataURL, maxW = 320) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const ratio = maxW / img.naturalWidth;
      const w = Math.min(maxW, img.naturalWidth);
      const h = Math.round(img.naturalHeight * ratio);
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      c.toBlob((b) => resolve(b), "image/jpeg", 0.72);
    };
    img.src = dataURL;
  });
}

export async function saveCurrentToLibrary() {
  if (!state.pages.length) { showToast("No hay páginas para guardar"); return; }
  try {
    const thumbBlob = await makeThumbnail(state.pages[0].dataURL);
    const pagesBlobs = state.pages.map((p) => ({
      filterId: p.filterId,
      blob: (function() {
        const [h, b] = p.dataURL.split(",");
        const m = h.match(/:(.*?);/)[1];
        const bin = atob(b);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return new Blob([u8], { type: m });
      })(),
    }));
    const id = state.currentDocId || uuid();
    const now = Date.now();
    const existing = state.currentDocId ? await dbGet(state.currentDocId) : null;
    const doc = {
      id,
      name: existing?.name || defaultName(),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      thumbnail: thumbBlob,
      pages: pagesBlobs,
    };
    await dbPut(doc);
    state.currentDocId = id;
    await refreshLibraryCount();
    showToast("Guardado en biblioteca ✓");
    buzz(18);
  } catch (e) {
    console.error(e);
    showToast("No pudimos guardar: " + (e.message || "error"));
  }
}

export async function openDoc(id) {
  const doc = await dbGet(id);
  if (!doc) { showToast("Documento no encontrado"); return; }
  state.currentDocId = id;
  $("#docTitle").textContent = doc.name;
  const cont = $("#docPages");
  cont.innerHTML = "";
  doc.pages.forEach((p, i) => {
    const wrap = document.createElement("div");
    wrap.className = "doc-page";
    wrap.innerHTML = `<div class="page-num">${i + 1}</div><img src="${blobURL(p.blob)}" alt="" />`;
    cont.appendChild(wrap);
  });
  show("doc");
}

function docActionsMenu() {
  if (!state.currentDocId) return;
  openSheet("Opciones del documento", [
    { icon: "📤", label: "Compartir PDF", action: async () => {
      const doc = await dbGet(state.currentDocId); if (!doc) return;
      showToast("Preparando PDF…");
      const bytes = await makePDFFromPages(doc.pages);
      const safe = doc.name.replace(/[^a-z0-9\-_ ]/gi, "").trim() || "OMG-Scan";
      const r = await sharePDF(bytes, `${safe}.pdf`);
      if (r === false) { downloadPDF(bytes, `${safe}.pdf`); showToast("PDF descargado"); }
    }},
    { icon: "⬇", label: "Descargar PDF", action: async () => {
      const doc = await dbGet(state.currentDocId); if (!doc) return;
      showToast("Generando PDF…");
      const bytes = await makePDFFromPages(doc.pages);
      const safe = doc.name.replace(/[^a-z0-9\-_ ]/gi, "").trim() || "OMG-Scan";
      downloadPDF(bytes, `${safe}.pdf`);
      showToast("PDF descargado ✓");
    }},
    { icon: "📝", label: "Extraer texto (OCR)", action: async () => {
      const doc = await dbGet(state.currentDocId); if (!doc) return;
      const urls = await Promise.all(doc.pages.map((p) => blobToDataURL(p.blob)));
      await runOCR(urls, doc.name);
    }},
    { icon: "✏️", label: "Renombrar", action: async () => {
      const doc = await dbGet(state.currentDocId); if (!doc) return;
      $("#renameInput").value = doc.name;
      $("#modalRename").classList.add("show");
      setTimeout(() => $("#renameInput").focus(), 100);
    }},
    { icon: "🗑️", label: "Borrar documento", danger: true, action: async () => {
      $("#modalDelete").classList.add("show");
    }},
  ]);
}

export function initLibrary() {
  refreshLibraryCount();

  $("#renameSave").addEventListener("click", async () => {
    const val = $("#renameInput").value.trim();
    if (!val || !state.currentDocId) { $("#modalRename").classList.remove("show"); return; }
    const doc = await dbGet(state.currentDocId);
    if (doc) {
      doc.name = val; doc.updatedAt = Date.now();
      await dbPut(doc);
      $("#docTitle").textContent = val;
      showToast("Renombrado ✓");
    }
    $("#modalRename").classList.remove("show");
  });

  $("#deleteConfirm").addEventListener("click", async () => {
    if (!state.currentDocId) return;
    await dbDelete(state.currentDocId);
    state.currentDocId = null;
    $("#modalDelete").classList.remove("show");
    showToast("Documento borrado");
    buzz(20);
    await refreshLibraryCount();
    show("library"); renderLibrary();
  });

  $("#docMenu").addEventListener("click", docActionsMenu);
}

export { refreshLibraryCount };
