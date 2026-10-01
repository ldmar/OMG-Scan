// src/features/pdf.js — PDF A4 y compartir.

import { dataURLtoBlob } from "../utils.js";

export async function makePDFFromPages(pages) {
  if (!pages.length) throw new Error("Sin páginas");
  if (!window.PDFLib) throw new Error("pdf-lib aún cargando…");
  const { PDFDocument } = window.PDFLib;
  const pdf = await PDFDocument.create();
  pdf.setTitle("OMG Scan · " + new Date().toLocaleDateString("es"));
  pdf.setCreator("OMG Scan by Ohmygoch");
  pdf.setProducer("OMG Scan");
  for (const page of pages) {
    const blob  = page.blob || dataURLtoBlob(page.dataURL);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const img   = await pdf.embedJpg(bytes);
    const A4 = [595.28, 841.89];
    const p = pdf.addPage(A4);
    const margin = 20;
    const maxW = A4[0] - margin * 2, maxH = A4[1] - margin * 2;
    const r = Math.min(maxW / img.width, maxH / img.height);
    const w = img.width * r, h = img.height * r;
    p.drawImage(img, { x: (A4[0] - w) / 2, y: (A4[1] - h) / 2, width: w, height: h });
  }
  return await pdf.save();
}

export function downloadPDF(bytes, name) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export async function sharePDF(bytes, name = "OMG-Scan.pdf") {
  const file = new File([bytes], name, { type: "application/pdf" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "OMG Scan", text: "Escaneo OMG" });
      return "shared";
    } catch (e) {
      if (e.name === "AbortError") return "cancelled";
      return false;
    }
  }
  return false;
}