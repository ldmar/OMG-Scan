// src/utils.js — helpers puros. Sin DOM salvo $ y $$.
// Regla: este módulo NO importa a nadie.

export const $  = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const dist  = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function buzz(ms = 8) {
  try { navigator.vibrate && navigator.vibrate(ms); } catch (_) {}
}

export function uuid() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function formatDate(ts) {
  const d = new Date(ts), now = new Date();
  const time = d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return `Hoy · ${time}`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Ayer · ${time}`;
  return d.toLocaleDateString("es", { day: "2-digit", month: "short" }) + " · " + time;
}

export function defaultName() {
  const d = new Date();
  return `Escaneo ${d.toLocaleDateString("es", { day: "2-digit", month: "2-digit" })} ${d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}`;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

export function dataURLtoBlob(dataURL) {
  const [h, b] = dataURL.split(",");
  const m = h.match(/:(.*?);/)[1];
  const bin = atob(b);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: m });
}

export function blobToDataURL(blob) {
  return new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.readAsDataURL(blob);
  });
}