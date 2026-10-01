// src/features/live-detect.js — detección en vivo + auto-shutter.

import { $ } from "../utils.js";
import { state, prefs } from "../state.js";
import { showToast } from "../ui.js";
import { buzz } from "../utils.js";
import { on } from "../events.js";

const video              = $("#video");
const liveOverlay        = $("#liveOverlay");
const livePoly           = $("#livePoly");
const liveBadge          = $("#liveBadge");
const btnLiveDetect      = $("#btnLiveDetect");
const btnAutoShutter     = $("#btnAutoShutter");
const shutterCountdown   = $("#shutterCountdown");
const shutterCountdownFill = $("#shutterCountdownFill");

const liveCanvas = document.createElement("canvas");
liveCanvas.width = 320;
liveCanvas.height = 240;
const liveCtx = liveCanvas.getContext("2d");

const AUTOSHUTTER_DURATION    = 600;
const COUNTDOWN_CIRCUMFERENCE = 2 * Math.PI * 46;
shutterCountdownFill.style.strokeDasharray = COUNTDOWN_CIRCUMFERENCE;

let onCaptureCallback = null;

export function updateAutoShutterBtn() {
  if (!btnAutoShutter) return;
  btnAutoShutter.disabled = !state.liveDetect;
  btnAutoShutter.classList.toggle("on", state.autoShutter && state.liveDetect);
  btnAutoShutter.textContent = "📸";
}

function startLiveDetection() {
  stopLiveDetection();
  state.liveIntervalMs    = 500;
  state.liveSuccessStreak = 0;
  state.liveFailStreak    = 0;
  state.liveCornersHistory = [];
  scheduleNextLive();
}

function scheduleNextLive() {
  if (!state.liveDetect) return;
  state.liveTimer = setTimeout(async () => {
    await runLiveDetectionOnce();
    scheduleNextLive();
  }, state.liveIntervalMs);
}

export function stopLiveDetection() {
  if (state.liveTimer) { clearTimeout(state.liveTimer); state.liveTimer = null; }
  state.liveBusy = false;
}

function cornersDelta(c1, c2) {
  if (!c1 || !c2) return Infinity;
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    sum += Math.hypot(c1[i].x - c2[i].x, c1[i].y - c2[i].y);
  }
  return sum / 4;
}

function areCornersStable(history) {
  if (history.length < 3) return false;
  const t1 = cornersDelta(history[history.length - 1], history[history.length - 2]);
  const t2 = cornersDelta(history[history.length - 2], history[history.length - 3]);
  const maxDelta = 0.012;
  return t1 < maxDelta && t2 < maxDelta;
}

async function runLiveDetectionOnce() {
  if (state.liveBusy) return;
  if (!state.stream || video.readyState < 2) return;
  if (!state.quadscanReady || !state.quadscanInstance) return;
  state.liveBusy = true;
  btnLiveDetect.classList.add("busy");

  const t0 = performance.now();
  try {
    const vw = video.videoWidth, vh = video.videoHeight;
    const targetW = 320;
    const targetH = Math.round(vh * (targetW / vw));
    if (liveCanvas.width !== targetW || liveCanvas.height !== targetH) {
      liveCanvas.width = targetW;
      liveCanvas.height = targetH;
    }
    liveCtx.drawImage(video, 0, 0, targetW, targetH);
    const result = await state.quadscanInstance.scan(liveCanvas);

    if (result && result.success && result.corners) {
      const { topLeft, topRight, bottomRight, bottomLeft } = result.corners;
      const n = [
        { x: topLeft.x / liveCanvas.width,     y: topLeft.y / liveCanvas.height     },
        { x: topRight.x / liveCanvas.width,    y: topRight.y / liveCanvas.height    },
        { x: bottomRight.x / liveCanvas.width, y: bottomRight.y / liveCanvas.height },
        { x: bottomLeft.x / liveCanvas.width,  y: bottomLeft.y / liveCanvas.height  },
      ];
      state.liveCornersHistory.push(n);
      if (state.liveCornersHistory.length > 5) state.liveCornersHistory.shift();
      state.liveSuccessStreak++;
      state.liveFailStreak = 0;

      const nx = (p) => (p.x * 100);
      const ny = (p) => (p.y * 100);
      livePoly.setAttribute("points", [
        `${nx(n[0])},${ny(n[0])}`,
        `${nx(n[1])},${ny(n[1])}`,
        `${nx(n[2])},${ny(n[2])}`,
        `${nx(n[3])},${ny(n[3])}`,
      ].join(" "));

      const conf      = typeof result.confidence === "number" ? result.confidence : 0;
      const stable    = areCornersStable(state.liveCornersHistory);
      const confident = conf >= 0.7;

      if (confident && stable) {
        liveBadge.classList.add("show", "stable");
        liveBadge.textContent = "✓ Encuadrado · ¡capturando!";
        liveOverlay.classList.add("stable");
        if (state.autoShutter && state.autoShutterEnabled && !state.autoShutterCountdown) {
          startAutoShutterCountdown();
        }
      } else if (confident) {
        liveBadge.classList.add("show");
        liveBadge.classList.remove("stable");
        liveBadge.textContent = `Documento detectado ✓ ${Math.round(conf * 100)}%`;
        liveOverlay.classList.remove("stable");
        cancelAutoShutter();
      } else {
        liveBadge.classList.remove("show", "stable");
        liveOverlay.classList.remove("stable");
        cancelAutoShutter();
      }
    } else {
      state.liveSuccessStreak = 0;
      state.liveFailStreak++;
      state.liveCornersHistory = [];
      livePoly.setAttribute("points", "");
      liveBadge.classList.remove("show", "stable");
      liveOverlay.classList.remove("stable");
      cancelAutoShutter();
    }

    const elapsed = performance.now() - t0;
    if (elapsed > 380 || state.liveFailStreak >= 3) {
      state.liveIntervalMs = 900;
    } else if (elapsed < 200 && state.liveSuccessStreak >= 3) {
      state.liveIntervalMs = 450;
    } else {
      state.liveIntervalMs = 600;
    }
  } catch (_) {
  } finally {
    state.liveBusy = false;
    btnLiveDetect.classList.remove("busy");
  }
}

function startAutoShutterCountdown() {
  if (state.autoShutterCountdown) return;
  state.autoShutterCountdown = { start: performance.now(), cancelled: false };
  shutterCountdown.classList.add("show");
  const step = () => {
    if (!state.autoShutterCountdown || state.autoShutterCountdown.cancelled) return;
    const elapsed = performance.now() - state.autoShutterCountdown.start;
    const pct = Math.min(1, elapsed / AUTOSHUTTER_DURATION);
    shutterCountdownFill.style.strokeDashoffset = -(COUNTDOWN_CIRCUMFERENCE * pct);
    if (pct >= 1) { triggerAutoShutter(); return; }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  buzz(6);
}

export function cancelAutoShutter() {
  if (state.autoShutterCountdown) {
    state.autoShutterCountdown.cancelled = true;
    state.autoShutterCountdown = null;
  }
  shutterCountdown.classList.remove("show");
  shutterCountdownFill.style.strokeDashoffset = 0;
}

function triggerAutoShutter() {
  state.autoShutterCountdown = null;
  shutterCountdown.classList.remove("show");
  shutterCountdownFill.style.strokeDashoffset = 0;
  buzz([15, 30, 15]);
  if (onCaptureCallback) onCaptureCallback();
}

export function initLiveDetect({ onCapture }) {
  onCaptureCallback = onCapture;

  btnLiveDetect.addEventListener("click", async () => {
    if (!state.quadscanReady) { showToast("La IA todavía está cargando…"); return; }
    state.liveDetect = !state.liveDetect;
    prefs.liveDetect = state.liveDetect;
    prefs.save();
    btnLiveDetect.classList.toggle("on", state.liveDetect);
    updateAutoShutterBtn();
    if (state.liveDetect) {
      liveOverlay.classList.add("show");
      startLiveDetection();
      showToast("Detección en vivo activada");
    } else {
      liveOverlay.classList.remove("show");
      liveBadge.classList.remove("show");
      liveOverlay.classList.remove("stable");
      stopLiveDetection();
      cancelAutoShutter();
      showToast("Detección en vivo desactivada");
    }
    buzz(10);
  });

  btnAutoShutter.addEventListener("click", () => {
    state.autoShutter        = !state.autoShutter;
    state.autoShutterEnabled = state.autoShutter;
    prefs.liveAutoShutter    = state.autoShutter;
    prefs.save();
    updateAutoShutterBtn();
    buzz(8);
    if (state.autoShutter) showToast("Auto-shutter activado 📸");
    else { cancelAutoShutter(); showToast("Auto-shutter desactivado"); }
  });
  
  on("autoshutter:btn-changed", updateAutoShutterBtn);
  on("autoshutter:cancel",      cancelAutoShutter);

  on("camera:started", () => {
    if (prefs.liveDetect && state.quadscanReady && !state.liveDetect) {
      state.liveDetect = true;
      btnLiveDetect.classList.add("on");
      liveOverlay.classList.add("show");
      startLiveDetection();
    }
  });
  
}
