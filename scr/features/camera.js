// src/features/camera.js — cámara, captura, torch, quality loop.

import { $ } from "../utils.js";
import { state, prefs } from "../state.js";
import { showToast } from "../ui.js";
import { buzz } from "../utils.js";
import { emit } from "../events.js";

const video = $("#video");

export async function startCamera() {
  stopCamera();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: state.facing },
               width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    state.stream = stream;
    video.srcObject = stream;
    await video.play().catch(() => {});
    const track = stream.getVideoTracks()[0];
    const caps  = track.getCapabilities ? track.getCapabilities() : {};
    state.torchSupported = !!caps.torch;
    state.torchOn = false;
    updateFlashBtn();
    startQualityLoop();
    emit("camera:started");
  } catch (err) {
    console.error(err);
    showToast("No pudimos abrir la cámara. Usá Galería.");
    $("#fileInput").click();
  }
}

export function stopCamera() {
  stopQualityLoop();
  if (state.stream) {
    state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }
}

function updateFlashBtn() {
  const b = $("#btnFlash");
  b.style.display = state.torchSupported ? "" : "none";
  b.classList.toggle("on", state.torchOn);
  b.textContent = state.torchOn ? "⚡ On" : "⚡ Flash";
}

async function toggleFlash() {
  if (!state.stream || !state.torchSupported) return;
  try {
    await state.stream.getVideoTracks()[0].applyConstraints({ advanced: [{ torch: !state.torchOn }] });
    state.torchOn = !state.torchOn;
    updateFlashBtn(); buzz();
  } catch (_) { showToast("Flash no disponible"); }
}

function startQualityLoop() {
  stopQualityLoop();
  const canvas = document.createElement("canvas");
  canvas.width = 64; canvas.height = 36;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const qBox = $("#quality"), qTxt = $("#qualityText");
  state.qualityTimer = setInterval(() => {
    if (video.readyState < 2) return;
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let sum = 0, sq = 0; const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) {
        const l = d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114;
        sum += l; sq += l * l;
      }
      const mean = sum / n;
      const std  = Math.sqrt(Math.max(0, sq / n - mean * mean));
      let cls = "", txt = "Listo para escanear";
      if (mean < 55)       { cls = "warn"; txt = "Muy oscuro"; }
      else if (mean > 220) { cls = "warn"; txt = "Muy brillante"; }
      else if (std < 22)   { cls = "bad";  txt = "Sin contraste / movido"; }
      qBox.className = "quality " + cls;
      qTxt.textContent = txt;
    } catch (_) {}
  }, 700);
}

function stopQualityLoop() {
  if (state.qualityTimer) clearInterval(state.qualityTimer);
  state.qualityTimer = null;
}

export async function capture({ onCaptured } = {}) {
  if (!state.stream || video.readyState < 2) return;
  emit("autoshutter:cancel");
  buzz(12);
  const sweep = $("#sweep");
  sweep.classList.remove("go"); void sweep.offsetWidth;
  sweep.classList.add("go");
  const w = video.videoWidth, h = video.videoHeight;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d").drawImage(video, 0, 0, w, h);
  state.rawCapture = c.toDataURL("image/jpeg", 0.92);
  state.rotation = 0;
  stopCamera();
  if (onCaptured) onCaptured();
}

export function initCamera() {
  $("#btnFlash").addEventListener("click", toggleFlash);
  $("#btnSwitch").addEventListener("click", async () => {
    state.facing = state.facing === "environment" ? "user" : "environment";
    await startCamera();
  });
  $("#btnGallery").addEventListener("click", () => $("#fileInput").click());
  $("#fileInput").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      state.rawCapture = r.result;
      state.rotation = 0;
      stopCamera();
      emit("crop:open");
    };
    r.readAsDataURL(f);
    e.target.value = "";
  });
}
